import React, { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, AppStateStatus } from 'react-native';
import { BlueStorageContext } from '../../../blue_modules/storage-context';
import { HDSegwitBech32Wallet } from '../../../class';
import { SparkWallet } from '../../../class/wallets/spark-wallet';
import loc from '../../../loc';
import { connectSparkSdk, disconnectSparkSdk, isSparkSdkConnected, requireSparkSdk, syncSparkWallet } from '../spark-sdk';
import { SdkEvent_Tags, type SdkEvent } from '@breeztech/breez-sdk-spark-react-native';

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

/** Class/kind only — safe for crash-report breadcrumbs and console.error issues. */
function errorClass(e: unknown): string {
  return e instanceof Error ? e.name : typeof e;
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

export function SparkContextProvider(props: PropsWithChildren): React.JSX.Element {
  const { wallets, walletsInitialized, addAndSaveWallet, saveToDisk } = useContext(BlueStorageContext);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const connectingRef = useRef(false);
  const isCreatingRef = useRef(false);
  const sparkWalletRef = useRef<SparkWallet | undefined>(undefined);
  const createSparkWalletRef = useRef<() => Promise<SparkWallet | null>>(async () => null);

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
        const lnInfo = await requireSparkSdk().getLightningAddress();
        if (lnInfo?.lightningAddress) {
          target.lnAddress = lnInfo.lightningAddress;
        }
        await saveToDisk();
      } catch (e) {
        console.warn('SparkContext: refresh failed', e);
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
        event.tag === SdkEvent_Tags.LightningAddressChanged
      ) {
        await refreshSparkWallet();
      }
    },
    [refreshSparkWallet],
  );

  const ensureConnected = useCallback(
    async (mnemonic: string): Promise<void> => {
      if (isSparkSdkConnected()) {
        setIsConnected(true);
        return;
      }
      if (connectingRef.current) return;
      connectingRef.current = true;
      setIsConnecting(true);
      try {
        await connectSparkSdk(mnemonic, onSdkEvent);
        setIsConnected(true);
      } finally {
        connectingRef.current = false;
        setIsConnecting(false);
      }
    },
    [onSdkEvent],
  );

  // Connect once when a Spark wallet exists in storage.
  useEffect(() => {
    if (!walletsInitialized) return;
    const spark = getSparkWallet(wallets);
    if (!spark) return;

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
    // Only re-run when init flips or a Spark wallet appears/disappears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletsInitialized, !!getSparkWallet(wallets)]);

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
          .catch(e => console.warn('SparkContext: foreground sync failed', e));
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

      const sdk = requireSparkSdk();
      const info = await sdk.getInfo({ ensureSynced: false });

      // Lightning address is optional for usability; a failed lookup must not abort create.
      let lnAddress: string | undefined;
      try {
        const lnInfo = await sdk.getLightningAddress();
        lnAddress = lnInfo?.lightningAddress;
      } catch (e) {
        console.warn('SparkContext: getLightningAddress failed; wallet remains usable without lnAddress', e);
      }

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
            createSparkWalletRef.current().catch(() => {});
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
