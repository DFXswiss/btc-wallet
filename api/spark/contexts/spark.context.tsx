import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, AppStateStatus } from 'react-native';
import { SdkEvent_Tags, type SdkEvent } from '@breeztech/breez-sdk-spark-react-native';
import { BlueStorageContext } from '../../../blue_modules/storage-context';
import { HDLegacyBreadwalletWallet, HDLegacyP2PKHWallet, HDSegwitBech32Wallet, HDSegwitP2SHWallet } from '../../../class';
import { SparkWallet } from '../../../class/wallets/spark-wallet';
import loc from '../../../loc';
import {
  acquireSparkSessionLease,
  connectSparkSdk,
  disconnectSparkSdk,
  isSparkSdkConnected,
  SparkSessionStaleError,
  syncSparkWallet,
} from '../spark-sdk';
import { deriveSparkMnemonic } from '../spark-seed';
import { applyOutgoingSdkEvent, getOutgoingPayment, subscribeOutgoingPayment, type OutgoingPayment } from '../outgoing-payment';

const BIP39_HD_WALLET_TYPES = new Set([
  HDSegwitBech32Wallet.type,
  HDSegwitP2SHWallet.type,
  HDLegacyP2PKHWallet.type,
  HDLegacyBreadwalletWallet.type,
]);

/** Class/kind only — safe for crash-report breadcrumbs and console.error issues. */
function errorClass(e: unknown): string {
  return e instanceof Error ? e.name : typeof e;
}

export interface SparkContextInterface {
  isConnected: boolean;
  isConnecting: boolean;
  isCreating: boolean;
  createSparkWallet: () => Promise<SparkWallet | null>;
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

type OnChainMnemonicWallet = {
  type: string;
  getSecret: () => string;
  getPassphrase?: () => string | undefined;
  getID?: () => string;
  getLabel?: () => string;
};

function sourceWalletIdOf(wallet: OnChainMnemonicWallet): string | undefined {
  if (typeof wallet.getID !== 'function') return undefined;
  try {
    const id = wallet.getID();
    return id ? String(id) : undefined;
  } catch {
    return undefined;
  }
}

function sparkMnemonicFromWallet(hd: OnChainMnemonicWallet): string {
  if (!BIP39_HD_WALLET_TYPES.has(hd.type)) {
    throw new Error('On-chain recovery phrase is not available');
  }
  const secret = hd.getSecret();
  if (!secret) {
    throw new Error('On-chain recovery phrase is not available');
  }
  return deriveSparkMnemonic(secret, hd.getPassphrase?.() || undefined);
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
  const hd = wallets.find(w => w.type === HDSegwitBech32Wallet.type) || wallets.find(w => BIP39_HD_WALLET_TYPES.has(w.type));
  if (!hd) {
    throw new Error('On-chain wallet is required to create a Spark Lightning wallet');
  }
  return hd;
}

function getSparkMnemonic(wallets: OnChainMnemonicWallet[], sourceWalletId?: string, sourceWalletLabel?: string): string {
  return sparkMnemonicFromWallet(resolveOnChainWallet(wallets, sourceWalletId, sourceWalletLabel));
}

function getSparkWallet(wallets: { type: string }[]): SparkWallet | undefined {
  return wallets.find(w => w.type === SparkWallet.type) as SparkWallet | undefined;
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
  const createSparkWalletRef = useRef<(() => Promise<SparkWallet | null>) | undefined>(undefined);
  const connectExistingSparkRef = useRef<(() => Promise<void>) | undefined>(undefined);

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

  const connectExistingSpark = useCallback(async (): Promise<void> => {
    try {
      await reconnectSpark();
    } catch (e: unknown) {
      // console.error is forwarded to crash reports; never log the raw message
      // because connect receives the Spark child phrase and API key, and the error
      // text can repeat those inputs. Log only a fixed tag and the error class.
      console.error('SparkContext: failed to connect', errorClass(e));
      setIsConnected(false);
      Alert.alert(loc.wallets.lightning_spark_wallet_label, userFacingError(e), [
        { text: loc._.cancel, style: 'cancel' },
        {
          text: loc._.repeat,
          onPress: () => {
            const reconnect = connectExistingSparkRef.current;
            if (reconnect) {
              reconnect().catch(() => {});
            }
          },
        },
      ]);
    }
  }, [reconnectSpark]);

  const sparkIdentity = getSparkWallet(wallets)?.identityPubkey ?? '';

  // Connect when a Spark wallet exists, and again when that wallet is replaced.
  useEffect(() => {
    if (!walletsInitialized) return;
    const spark = getSparkWallet(walletsRef.current);
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
        await reconnectSpark();
      } catch (e: unknown) {
        if (cancelled) return;
        // console.error is forwarded to crash reports; never log the raw message
        // because connect receives the Spark child phrase and API key, and the error
        // text can repeat those inputs. Log only a fixed tag and the error class.
        console.error('SparkContext: failed to connect', errorClass(e));
        setIsConnected(false);
        // Missing API key must fail loudly — never leave a silent broken Lightning tab.
        Alert.alert(loc.wallets.lightning_spark_wallet_label, userFacingError(e), [
          { text: loc._.cancel, style: 'cancel' },
          {
            text: loc._.repeat,
            onPress: () => {
              const reconnect = connectExistingSparkRef.current;
              if (reconnect) {
                reconnect().catch(() => {});
              }
            },
          },
        ]);
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
    return () => {
      // RN's test mock may not return a subscription object.
      if (sub && typeof sub.remove === 'function') {
        sub.remove();
      }
    };
  }, [refreshSparkWallet, reconnectSpark]);

  const createSparkWallet = useCallback(async (): Promise<SparkWallet | null> => {
    if (getSparkWallet(wallets)) {
      return getSparkWallet(wallets) as SparkWallet;
    }
    if (isCreatingRef.current) return null;

    isCreatingRef.current = true;
    setIsCreating(true);
    let created: SparkWallet | undefined;
    try {
      const source = resolveOnChainWallet(walletsRef.current);
      const mnemonic = sparkMnemonicFromWallet(source);
      const sourceId = sourceWalletIdOf(source);
      if (!sourceId) {
        throw new Error('On-chain wallet is required to create a Spark wallet');
      }
      await ensureConnected(mnemonic);

      const lease = acquireSparkSessionLease();
      const info = await lease.requireSdk().getInfo({ ensureSynced: false });
      lease.requireSdk();
      created = SparkWallet.create(info.identityPubkey);
      // Never write the recovery phrase into the Spark wallet record.
      created.secret = '';
      created.balance = Number(info.balanceSats);
      created.sourceWalletId = sourceId;
      created.sourceWalletLabel = source.getLabel?.() || undefined;

      await addAndSaveWallet(created);
      await refreshSparkWallet(created);
      return created;
    } catch (e: unknown) {
      const leftover = getSparkWallet(walletsRef.current) ?? created;
      if (leftover && typeof deleteWallet === 'function') {
        deleteWallet(leftover);
      }
      await Promise.resolve(disconnectSparkSdk()).catch(() => {});
      setIsConnected(false);
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
  }, [wallets, ensureConnected, addAndSaveWallet, refreshSparkWallet, deleteWallet]);

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
      outgoingPayment,
    }),
    [isConnected, isConnecting, isCreating, createSparkWallet, outgoingPayment],
  );

  return <SparkContext.Provider value={value}>{props.children}</SparkContext.Provider>;
}
