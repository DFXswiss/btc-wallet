import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, AppStateStatus } from 'react-native';
import createHash from 'create-hash';
import { SdkEvent_Tags, type SdkEvent } from '@breeztech/breez-sdk-spark-react-native';
import { BlueStorageContext } from '../../../blue_modules/storage-context';
import { SparkWallet } from '../../../class/wallets/spark-wallet';
import Lnurl from '../../../class/lnurl';
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
import { BIP39_HD_WALLET_TYPES, sparkIdentityKey, sparkMnemonicFromWallet, type OnChainMnemonicWallet } from '../spark-seed';
import { applyOutgoingSdkEvent, getOutgoingPayment, subscribeOutgoingPayment, type OutgoingPayment } from '../outgoing-payment';

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

/** How long creating a Spark wallet waits for the sync before it; a sync still running afterwards is not awaited. */
export const SYNC_BEFORE_CREATE_TIMEOUT_MS = 30000;

/** Syncs the connected wallet before it is created; false when the sync failed or did not finish in time. */
async function syncBeforeCreate(): Promise<boolean> {
  const sync = syncSparkWallet().then(
    () => true,
    (e: unknown) => {
      console.warn('SparkContext: sync before create failed', errorClass(e));
      return false;
    },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>(resolve => {
    timer = setTimeout(() => resolve(false), SYNC_BEFORE_CREATE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([sync, timeout]);
  } finally {
    clearTimeout(timer);
  }
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
      lease.assertLive();
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
  createSparkWallet: (source?: OnChainMnemonicWallet) => Promise<SparkWallet | null>;
  /** Signs an LNURL-auth k1 with the Spark identity key: DER signature over the raw k1 bytes and the pubkey, hex. */
  signLnurlAuthK1: (k1Hex: string) => Promise<{ sig: string; key: string }>;
  outgoingPayment: OutgoingPayment | null;
}

const SparkContext = createContext<SparkContextInterface | undefined>(undefined);

export function useSparkContext(): SparkContextInterface {
  const ctx = useContext(SparkContext);
  if (!ctx) {
    throw new Error('useSparkContext must be used within SparkContextProvider');
  }
  return ctx;
}

class SparkSourceWalletMissingError extends Error {
  readonly label?: string;
  constructor(label?: string) {
    super('Spark source wallet is missing');
    this.name = 'SparkSourceWalletMissingError';
    this.label = label;
  }
}

function userFacingError(e: unknown): string {
  if (e instanceof SparkSourceWalletMissingError) {
    return loc.formatString(loc.wallets.lightning_spark_source_missing, {
      label: e.label || loc.wallets.main_wallet_label,
    });
  }
  return loc.formatString(loc.wallets.lightning_spark_generic_error, { kind: errorClass(e) });
}

export type { OnChainMnemonicWallet };

function sourceWalletIdOf(wallet: OnChainMnemonicWallet): string | undefined {
  if (typeof wallet.getID !== 'function') return undefined;
  try {
    const id = wallet.getID();
    return id ? String(id) : undefined;
  } catch {
    return undefined;
  }
}

/** A new Spark wallet always derives from the main wallet; none when the main wallet has no recovery phrase. */
export function defaultSparkSourceWallet<T extends { type: string }>(wallets: T[]): T | undefined {
  const main = wallets[0];
  return main && BIP39_HD_WALLET_TYPES.has(main.type) ? main : undefined;
}

function resolveOnChainWallet(
  wallets: OnChainMnemonicWallet[],
  sourceWalletId?: string,
  sourceWalletLabel?: string,
): OnChainMnemonicWallet {
  if (sourceWalletId) {
    const bound = wallets.find(w => sourceWalletIdOf(w) === sourceWalletId);
    if (!bound) {
      throw new SparkSourceWalletMissingError(sourceWalletLabel);
    }
    return bound;
  }
  const hd = defaultSparkSourceWallet(wallets);
  if (!hd) {
    throw new Error('On-chain wallet is required to create a Spark Lightning wallet');
  }
  return hd;
}

function getSparkMnemonic(wallets: OnChainMnemonicWallet[], sourceWalletId?: string, sourceWalletLabel?: string): string {
  return sparkMnemonicFromWallet(resolveOnChainWallet(wallets, sourceWalletId, sourceWalletLabel));
}

function getSparkWallet(wallets: { type: string }[]): SparkWallet | undefined {
  return wallets.find((w): w is SparkWallet => w.type === SparkWallet.type);
}

/** The alert shown when Lightning cannot be started or created, with a retry. */
function alertSparkStartFailure(e: unknown, retry: () => void): void {
  Alert.alert(loc.wallets.lightning_spark_wallet_label, userFacingError(e), [
    { text: loc._.cancel, style: 'cancel' },
    { text: loc._.repeat, onPress: retry },
  ]);
}

// A function rather than an inline assignment: the React Compiler lint rejects mutating the wallet inside the provider.
function writeLightningAddress(wallet: SparkWallet, address: string): void {
  wallet.lnAddress = address;
}

export function SparkContextProvider(props: PropsWithChildren): React.JSX.Element {
  const { wallets, walletsInitialized, addAndSaveWallet, saveToDisk, deleteWallet } = useContext(BlueStorageContext);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [outgoingPayment, setOutgoingPayment] = useState<OutgoingPayment | null>(getOutgoingPayment);
  const connectingCountRef = useRef(0);
  const isCreatingRef = useRef(false);
  const sparkWalletRef = useRef<SparkWallet | undefined>(undefined);
  const walletsRef = useRef(wallets);
  const lnAddressRegisterAttemptedRef = useRef(false);
  const createSparkWalletRef = useRef<((source?: OnChainMnemonicWallet) => Promise<SparkWallet | null>) | undefined>(undefined);
  const connectExistingSparkRef = useRef<((isStale?: () => boolean) => Promise<void>) | undefined>(undefined);

  useEffect(() => {
    walletsRef.current = wallets;
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
        lease.assertLive();
        if (lnInfo?.lightningAddress) {
          writeLightningAddress(target, lnInfo.lightningAddress);
        } else if (!target.lnAddress && !lnAddressRegisterAttemptedRef.current && target.identityPubkey) {
          lnAddressRegisterAttemptedRef.current = true;
          try {
            const registered = await registerLightningAddressOnce(target.identityPubkey, loc.wallets.lightning_spark_wallet_label, lease);
            lease.assertLive();
            if (registered) {
              writeLightningAddress(target, registered);
            }
          } catch (e) {
            if (e instanceof SparkSessionStaleError) {
              // Same wallet identity: the connect effect does not re-run, so retry must be re-enabled here.
              lnAddressRegisterAttemptedRef.current = false;
            }
            throw e;
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

  useEffect(() => subscribeOutgoingPayment(setOutgoingPayment), []);

  const onSdkEvent = useCallback(
    async (event: SdkEvent) => {
      applyOutgoingSdkEvent(event);
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
      } catch (e) {
        setIsConnected(false);
        throw e;
      } finally {
        connectingCountRef.current -= 1;
        if (connectingCountRef.current === 0) {
          setIsConnecting(false);
        }
      }
    },
    [onSdkEvent],
  );

  const reconnectSpark = useCallback(async (): Promise<void> => {
    const spark = getSparkWallet(walletsRef.current);
    if (!spark) return;
    const mnemonic = getSparkMnemonic(walletsRef.current, spark.sourceWalletId, spark.sourceWalletLabel);
    await ensureConnected(mnemonic);
    await refreshSparkWallet(spark);
  }, [ensureConnected, refreshSparkWallet]);

  /** Connects the stored Spark wallet; a failure is reported unless `isStale` says the attempt was replaced. */
  const connectExistingSpark = useCallback(
    async (isStale: () => boolean = () => false): Promise<void> => {
      try {
        await reconnectSpark();
      } catch (e: unknown) {
        if (isStale()) return;
        // console.error is forwarded to crash reports; never log the raw message
        // because connect receives the Spark child phrase and API key, and the error
        // text can repeat those inputs. Log only a fixed tag and the error class.
        console.error('SparkContext: failed to connect', errorClass(e));
        setIsConnected(false);
        // Missing API key must fail loudly — never leave a silent broken Lightning tab.
        alertSparkStartFailure(e, () => {
          connectExistingSparkRef.current?.().catch(() => {});
        });
      }
    },
    [reconnectSpark],
  );

  const sparkIdentity = getSparkWallet(wallets)?.identityPubkey ?? '';

  // Connect when a Spark wallet exists, and again when that wallet is replaced.
  useEffect(() => {
    lnAddressRegisterAttemptedRef.current = false;
    if (!walletsInitialized) return;
    const spark = getSparkWallet(walletsRef.current);
    if (!spark) {
      // Wallet gone: drop the native session. Do not disconnect in the cleanup
      // of a run that still had a wallet — a re-run must not tear the session down.
      setIsConnected(false);
      disconnectSparkSdk().catch(() => {});
      return;
    }

    let cancelled = false;
    connectExistingSpark(() => cancelled);

    return () => {
      cancelled = true;
    };
    // Re-run when init flips or the stored Spark identity changes (wallet set swap).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletsInitialized, sparkIdentity]);

  // Teardown once when the provider unmounts (app session end).
  useEffect(() => {
    return () => {
      disconnectSparkSdk().catch(() => {});
    };
  }, []);

  // sync_wallet when returning to foreground — no polling.
  // If the first connect failed, the SDK is down and a foreground is the retry path.
  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state !== 'active') return;
      if (isSparkSdkConnected()) {
        syncSparkWallet()
          .then(() => refreshSparkWallet())
          .catch(e => console.warn('SparkContext: foreground sync failed', errorClass(e)));
        return;
      }
      if (!getSparkWallet(walletsRef.current)) return;
      reconnectSpark().catch(e => console.warn('SparkContext: foreground reconnect failed', errorClass(e)));
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [refreshSparkWallet, reconnectSpark]);

  const createSparkWallet = useCallback(
    async (source?: OnChainMnemonicWallet): Promise<SparkWallet | null> => {
      const existing = getSparkWallet(walletsRef.current);
      if (existing) return existing;
      if (isCreatingRef.current) return null;

      isCreatingRef.current = true;
      setIsCreating(true);
      let created: SparkWallet | undefined;
      try {
        const sourceWallet = source ?? resolveOnChainWallet(walletsRef.current);
        const mnemonic = sparkMnemonicFromWallet(sourceWallet);
        const sourceId = sourceWalletIdOf(sourceWallet);
        if (!sourceId) {
          throw new Error('On-chain wallet is required to create a Spark wallet');
        }
        await ensureConnected(mnemonic);

        const lease = acquireSparkSessionLease();
        // A seed that used Spark before brings back its balance and address; a failed sync leaves them to the next one.
        const synced = await syncBeforeCreate();
        lease.assertLive();
        const info = await lease.requireSdk().getInfo({ ensureSynced: false });
        const session = lease.requireSdk();

        // Lightning address is optional; a failed lookup or name conflict must not abort create.
        let lnAddress: string | undefined;
        try {
          const lnInfo = await session.getLightningAddress();
          lease.assertLive();
          lnAddress = lnInfo?.lightningAddress;
          // Unsynced, the lookup may miss an address the seed already has, and registering would add a second one.
          if (!lnAddress && synced) {
            lnAddress = await registerLightningAddressOnce(info.identityPubkey, loc.wallets.lightning_spark_wallet_label, lease);
          }
        } catch (e) {
          if (e instanceof SparkSessionStaleError) {
            throw e;
          }
          console.warn('SparkContext: getLightningAddress failed; wallet remains usable without lnAddress', errorClass(e));
        }
        lnAddressRegisterAttemptedRef.current = true;

        lease.assertLive();
        created = SparkWallet.create(info.identityPubkey, lnAddress);
        // Never write the recovery phrase into the Spark wallet record.
        created.secret = '';
        created.balance = Number(info.balanceSats);
        created.sourceWalletId = sourceId;
        created.sourceWalletLabel = sourceWallet.getLabel?.() || undefined;

        await addAndSaveWallet(created);
        await refreshSparkWallet(created);
        return created;
      } catch (e: unknown) {
        const leftover = getSparkWallet(walletsRef.current) ?? created;
        if (leftover && typeof deleteWallet === 'function') {
          deleteWallet(leftover);
        }
        await disconnectSparkSdk().catch(() => {});
        setIsConnected(false);
        alertSparkStartFailure(e, () => {
          createSparkWalletRef.current?.(source).catch(() => {});
        });
        return null;
      } finally {
        isCreatingRef.current = false;
        setIsCreating(false);
      }
    },
    [ensureConnected, addAndSaveWallet, refreshSparkWallet, deleteWallet],
  );

  const signLnurlAuthK1 = useCallback(async (k1Hex: string): Promise<{ sig: string; key: string }> => {
    const spark = getSparkWallet(walletsRef.current);
    if (!spark?.identityPubkey) throw new Error(loc.wallets.lightning_spark_lnurl_auth_unsupported);
    const { privateKey } = sparkIdentityKey(getSparkMnemonic(walletsRef.current, spark.sourceWalletId, spark.sourceWalletLabel));
    const signed = Lnurl.signK1(k1Hex, privateKey);
    // Sign only with the key whose public key is the identity inside the wallet's Spark address.
    if (signed.key !== spark.identityPubkey) throw new Error(loc.wallets.lightning_spark_lnurl_auth_unsupported);
    return signed;
  }, []);

  useEffect(() => {
    createSparkWalletRef.current = createSparkWallet;
  }, [createSparkWallet]);

  useEffect(() => {
    connectExistingSparkRef.current = connectExistingSpark;
  }, [connectExistingSpark]);

  const value = useMemo(
    () => ({
      isConnected,
      isConnecting,
      isCreating,
      createSparkWallet,
      signLnurlAuthK1,
      outgoingPayment,
    }),
    [isConnected, isConnecting, isCreating, createSparkWallet, signLnurlAuthK1, outgoingPayment],
  );

  return <SparkContext.Provider value={value}>{props.children}</SparkContext.Provider>;
}
