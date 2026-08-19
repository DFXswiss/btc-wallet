import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, AppStateStatus } from 'react-native';
import createHash from 'create-hash';
import { BlueStorageContext } from '../../../blue_modules/storage-context';
import { HDSegwitBech32Wallet } from '../../../class';
import { SparkWallet } from '../../../class/wallets/spark-wallet';
import loc from '../../../loc';
import {
  acquireSparkSessionLease,
  connectSparkSdk,
  disconnectSparkSdk,
  isSparkSdkConnected,
  SparkSessionStaleError,
  syncSparkWallet,
  type SparkSessionLease,
} from '../spark-sdk';
import { SdkEvent_Tags, type SdkEvent } from '@breeztech/breez-sdk-spark-react-native';

const LIGHTNING_ADDRESS_USERNAME_LENGTH = 16;
const LIGHTNING_ADDRESS_REGISTER_ATTEMPTS = 5;

/** Class/kind only — safe for crash-report breadcrumbs and console.error issues. */
function errorClass(e: unknown): string {
  return e instanceof Error ? e.name : typeof e;
}

function lightningAddressUsername(identityPubkey: string, attempt: number): string {
  const base = createHash('sha256').update(identityPubkey).digest().toString('hex').slice(0, LIGHTNING_ADDRESS_USERNAME_LENGTH);
  return attempt === 0 ? base : `${base}${attempt + 1}`;
}

async function registerLightningAddressOnce(
  identityPubkey: string,
  description: string,
  lease: SparkSessionLease,
): Promise<string | undefined> {
  for (let attempt = 0; attempt < LIGHTNING_ADDRESS_REGISTER_ATTEMPTS; attempt++) {
    const username = lightningAddressUsername(identityPubkey, attempt);
    const available = await lease.requireSdk().checkLightningAddressAvailable({ username });
    const sdk = lease.requireSdk();
    if (!available) continue;
    try {
      const info = await sdk.registerLightningAddress({ username, description });
      lease.requireSdk();
      return info?.lightningAddress;
    } catch (e) {
      if (e instanceof SparkSessionStaleError) {
        throw e;
      }
      console.warn('SparkContext: registerLightningAddress failed', errorClass(e));
    }
  }
  return undefined;
}

export interface SparkContextInterface {
  isConnected: boolean;
  isConnecting: boolean;
  isCreating: boolean;
  createSparkWallet: () => Promise<SparkWallet | null>;
}

const SparkContext = createContext<SparkContextInterface | undefined>(undefined);

export function useSparkContext(): SparkContextInterface {
  const ctx = useContext(SparkContext);
  if (!ctx) {
    throw new Error('useSparkContext must be used within SparkContextProvider');
  }
  return ctx;
}

function userFacingError(e: unknown): string {
  return loc.formatString(loc.wallets.lightning_spark_generic_error, { kind: errorClass(e) });
}

function getOnChainMnemonic(wallets: { type: string; getSecret: () => string }[]): string {
  const hd = wallets.find(w => w.type === HDSegwitBech32Wallet.type) || wallets[0];
  if (!hd) {
    throw new Error('On-chain wallet is required to create a Spark Lightning wallet');
  }
  const secret = hd.getSecret();
  if (!secret || !secret.includes(' ')) {
    throw new Error('On-chain recovery phrase is not available');
  }
  return secret;
}

function getSparkWallet(wallets: { type: string }[]): SparkWallet | undefined {
  return wallets.find(w => w.type === SparkWallet.type) as SparkWallet | undefined;
}

function writeLightningAddress(wallet: SparkWallet, address: string): void {
  wallet.lnAddress = address;
}

export function SparkContextProvider(props: PropsWithChildren): React.JSX.Element {
  const { wallets, walletsInitialized, addAndSaveWallet, saveToDisk } = useContext(BlueStorageContext);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const connectingCountRef = useRef(0);
  const isCreatingRef = useRef(false);
  const sparkWalletRef = useRef<SparkWallet | undefined>(undefined);
  const lnAddressRegisterAttemptedRef = useRef(false);
  const createSparkWalletRef = useRef<(() => Promise<SparkWallet | null>) | undefined>(undefined);

  useEffect(() => {
    sparkWalletRef.current = getSparkWallet(wallets);
  }, [wallets]);

  const refreshSparkWallet = useCallback(
    async (wallet?: SparkWallet) => {
      const target = wallet || sparkWalletRef.current;
      if (!target || !isSparkSdkConnected()) return;
      try {
        await target.fetchBalance();
        await target.fetchTransactions();
        await target.fetchUserInvoices();
        const lease = acquireSparkSessionLease();
        if (lease.identity !== target.identityPubkey) {
          return;
        }
        const lnInfo = await lease.requireSdk().getLightningAddress();
        lease.requireSdk();
        if (lnInfo?.lightningAddress) {
          writeLightningAddress(target, lnInfo.lightningAddress);
        } else if (!target.lnAddress && !lnAddressRegisterAttemptedRef.current && target.identityPubkey) {
          lnAddressRegisterAttemptedRef.current = true;
          const registered = await registerLightningAddressOnce(target.identityPubkey, loc.wallets.lightning_spark_wallet_label, lease);
          lease.requireSdk();
          if (registered) {
            writeLightningAddress(target, registered);
          }
        }
        await saveToDisk();
      } catch (e) {
        if (e instanceof SparkSessionStaleError) {
          return;
        }
        console.warn('SparkContext: refresh failed', errorClass(e));
      }
    },
    [saveToDisk],
  );

  const onSdkEvent = useCallback(
    async (event: SdkEvent) => {
      if (
        event.tag === SdkEvent_Tags.Synced ||
        event.tag === SdkEvent_Tags.PaymentSucceeded ||
        event.tag === SdkEvent_Tags.PaymentPending ||
        event.tag === SdkEvent_Tags.PaymentFailed ||
        event.tag === SdkEvent_Tags.LightningAddressChanged ||
        event.tag === SdkEvent_Tags.NewDeposits ||
        event.tag === SdkEvent_Tags.ClaimedDeposits ||
        event.tag === SdkEvent_Tags.UnclaimedDeposits
      ) {
        if (event.tag === SdkEvent_Tags.UnclaimedDeposits) {
          console.warn('SparkContext: unclaimed deposits remain');
        }
        await refreshSparkWallet();
      }
    },
    [refreshSparkWallet],
  );

  const ensureConnected = useCallback(
    async (mnemonic: string): Promise<void> => {
      // Always call through: connectSparkSdk reuses, replaces, or joins an in-flight connect.
      connectingCountRef.current += 1;
      setIsConnecting(true);
      try {
        await connectSparkSdk(mnemonic, onSdkEvent);
        setIsConnected(true);
      } finally {
        connectingCountRef.current -= 1;
        if (connectingCountRef.current === 0) {
          setIsConnecting(false);
        }
      }
    },
    [onSdkEvent],
  );

  const sparkIdentity = getSparkWallet(wallets)?.identityPubkey ?? '';

  // Connect when a Spark wallet exists, and again when that wallet is replaced.
  useEffect(() => {
    lnAddressRegisterAttemptedRef.current = false;
    if (!walletsInitialized) return;
    const spark = getSparkWallet(wallets);
    if (!spark) {
      // Wallet gone: drop the native session. Do not disconnect in the cleanup
      // of a run that still had a wallet — a re-run must not tear the session down.
      setIsConnected(false);
      Promise.resolve(disconnectSparkSdk()).catch(() => {});
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const mnemonic = getOnChainMnemonic(wallets);
        await ensureConnected(mnemonic);
        if (!cancelled) {
          await refreshSparkWallet(spark);
        }
      } catch (e: unknown) {
        // console.error is forwarded to crash reports; never log the raw message
        // because connect receives the recovery phrase and API key, and the error
        // text can repeat those inputs. Log only a fixed tag and the error class.
        console.error('SparkContext: failed to connect', errorClass(e));
        // Missing API key must fail loudly — never leave a silent broken Lightning tab.
        Alert.alert(loc.wallets.lightning_spark_wallet_label, userFacingError(e));
      }
    })();

    return () => {
      cancelled = true;
    };
    // Re-run when init flips or the stored Spark identity changes (wallet set swap).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletsInitialized, sparkIdentity]);

  // Teardown once when the provider unmounts (app session end).
  useEffect(() => {
    return () => {
      Promise.resolve(disconnectSparkSdk()).catch(() => {});
    };
  }, []);

  // sync_wallet when returning to foreground — no polling.
  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state === 'active' && isSparkSdkConnected()) {
        syncSparkWallet()
          .then(() => refreshSparkWallet())
          .catch(e => console.warn('SparkContext: foreground sync failed', errorClass(e)));
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => {
      // RN's test mock may not return a subscription object.
      if (sub && typeof sub.remove === 'function') {
        sub.remove();
      }
    };
  }, [refreshSparkWallet]);

  const createSparkWallet = useCallback(async (): Promise<SparkWallet | null> => {
    if (getSparkWallet(wallets)) {
      return getSparkWallet(wallets) as SparkWallet;
    }
    if (isCreatingRef.current) return null;

    isCreatingRef.current = true;
    setIsCreating(true);
    try {
      const mnemonic = getOnChainMnemonic(wallets);
      await ensureConnected(mnemonic);

      const lease = acquireSparkSessionLease();
      const info = await lease.requireSdk().getInfo({ ensureSynced: false });
      const session = lease.requireSdk();

      // Lightning address is optional; a failed lookup or name conflict must not abort create.
      let lnAddress: string | undefined;
      try {
        const lnInfo = await session.getLightningAddress();
        lease.requireSdk();
        lnAddress = lnInfo?.lightningAddress;
        if (!lnAddress) {
          lnAddress = await registerLightningAddressOnce(info.identityPubkey, loc.wallets.lightning_spark_wallet_label, lease);
        }
      } catch (e) {
        if (e instanceof SparkSessionStaleError) {
          throw e;
        }
        console.warn('SparkContext: getLightningAddress failed; wallet remains usable without lnAddress', errorClass(e));
      }
      lnAddressRegisterAttemptedRef.current = true;

      lease.requireSdk();
      const created = SparkWallet.create(info.identityPubkey, lnAddress);
      created.setLabel(loc.wallets.lightning_spark_wallet_label);
      // Never write the recovery phrase into the Spark wallet record.
      created.secret = '';
      created.balance = Number(info.balanceSats);

      await addAndSaveWallet(created);
      await refreshSparkWallet(created);
      return created;
    } catch (e: unknown) {
      // Nothing half-created: wallet is only persisted via addAndSaveWallet on success.
      if (!getSparkWallet(wallets)) {
        await Promise.resolve(disconnectSparkSdk()).catch(() => {});
        setIsConnected(false);
      }
      Alert.alert(loc.wallets.lightning_spark_wallet_label, userFacingError(e), [
        { text: loc._.cancel, style: 'cancel' },
        {
          text: loc._.repeat,
          onPress: () => {
            const create = createSparkWalletRef.current;
            if (create) {
              create().catch(() => {});
            }
          },
        },
      ]);
      return null;
    } finally {
      isCreatingRef.current = false;
      setIsCreating(false);
    }
  }, [wallets, ensureConnected, addAndSaveWallet, refreshSparkWallet]);

  useEffect(() => {
    createSparkWalletRef.current = createSparkWallet;
  }, [createSparkWallet]);

  const value = useMemo(
    () => ({
      isConnected,
      isConnecting,
      isCreating,
      createSparkWallet,
    }),
    [isConnected, isConnecting, isCreating, createSparkWallet],
  );

  return <SparkContext.Provider value={value}>{props.children}</SparkContext.Provider>;
}
