import React, { createContext, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import { useAsyncStorage } from '@react-native-async-storage/async-storage';
import { FiatUnit } from '../models/fiatUnit';
import Notifications from '../blue_modules/notifications';
import { fetch as fetchNetInfo } from '@react-native-community/netinfo';
import { STORAGE_KEY as LOC_STORAGE_KEY } from '../loc';
import { isTorDaemonDisabled, setIsTorDaemonDisabled } from './environment';
const BlueApp = require('../BlueApp');
const BlueElectrum = require('./BlueElectrum');
const currency = require('../blue_modules/currency');
const A = require('../blue_modules/analytics');

const _lastTimeTriedToRefetchWallet = {}; // hashmap of timestamps we _started_ refetching some wallet

export const WalletTransactionsStatus = { NONE: false, ALL: true };
export const BlueStorageContext = createContext();
export const BlueStorageProvider = ({ children }) => {
  const [wallets, setWallets] = useState([]);
  const [selectedWallet, setSelectedWallet] = useState('');
  const [walletTransactionUpdateStatus, setWalletTransactionUpdateStatus] = useState(WalletTransactionsStatus.NONE);
  const [walletsInitialized, setWalletsInitialized] = useState(false);
  const [preferredFiatCurrency, _setPreferredFiatCurrency] = useState(FiatUnit.USD);
  const [language, _setLanguage] = useState();
  const getPreferredCurrencyAsyncStorage = useAsyncStorage(currency.PREFERRED_CURRENCY).getItem;
  const getLanguageAsyncStorage = useAsyncStorage(LOC_STORAGE_KEY).getItem;
  const [isHandOffUseEnabled, setIsHandOffUseEnabled] = useState(false);
  const [ldsDEV, setLdsDEV] = useState(false);
  const [isPosMode, setIsPosMode] = useState(false);
  const [isDfxPos, setIsDfxPos] = useState(false);
  const [isDfxSwap, setIsDfxSwap] = useState(false);
  const [isElectrumDisabled, setIsElectrumDisabled] = useState(true);
  const [isTorDisabled, setIsTorDisabled] = useState(false);
  const [isPrivacyBlurEnabled, setIsPrivacyBlurEnabled] = useState(true);
  const [lastSuccessfulBalanceRefresh, setLastSuccessfulBalanceRefresh] = useState(Date.now());
  const balanceRefreshInterval = useRef(null);

  useEffect(() => {
    BlueElectrum.isDisabled().then(setIsElectrumDisabled);
    isTorDaemonDisabled().then(setIsTorDisabled);
  }, []);

  useEffect(() => {
    setIsTorDaemonDisabled(isTorDisabled);
  }, [isTorDisabled]);

  const setIsHandOffUseEnabledAsyncStorage = value => {
    setIsHandOffUseEnabled(value);
    return BlueApp.setIsHandoffEnabled(value);
  };
 
  const setLdsDEVAsyncStorage = value => {
    setLdsDEV(value);
    return BlueApp.setIsLdsDevEnabled(value);
  };

  const setIsPosModeAsyncStorage = value => {
    setIsPosMode(value);
    return BlueApp.setIsPOSmodeEnabled(value);
  }

  const setIsDfxPosAsyncStorage = value => {
    setIsDfxPos(value);
    return BlueApp.setIsDfxPOSEnabled(value);
  }

  const setIsDfxSwapAsyncStorage = value => {
    setIsDfxSwap(value);
    return BlueApp.setIsDfxSwapEnabled(value);
  }

  const saveToDisk = async (force = false) => {
    if (BlueApp.getWallets().length === 0 && !force) {
      console.log('not saving empty wallets array');
      return;
    }
    BlueApp.tx_metadata = txMetadata;
    await BlueApp.saveToDisk();
    setWallets([...BlueApp.getWallets()]);
    txMetadata = BlueApp.tx_metadata;
  };

  useEffect(() => {
    setWallets(BlueApp.getWallets());
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const enabledHandoff = await BlueApp.isHandoffEnabled();
        setIsHandOffUseEnabled(!!enabledHandoff);
        const enabledLdsDev = await BlueApp.isLdsDevEnabled();
        setLdsDEV(!!enabledLdsDev);
        const enabledPosMode = await BlueApp.isPOSmodeEnabled();
        setIsPosMode(!!enabledPosMode);
        const enabledDfxPos = await BlueApp.isDfxPOSEnabled();
        setIsDfxPos(!!enabledDfxPos);
        const enabledDfxSwap = await BlueApp.isDfxSwapEnabled();
        setIsDfxSwap(!!enabledDfxSwap);
      } catch (_e) {
        setIsHandOffUseEnabledAsyncStorage(false);
        setIsHandOffUseEnabled(false);
        setLdsDEVAsyncStorage(false);
        setLdsDEV(false);
        setIsPosModeAsyncStorage(false);
        setIsPosMode(false);
        setIsDfxPosAsyncStorage(false);
        setIsDfxPos(false);
        setIsDfxSwapAsyncStorage(false);
        setIsDfxSwap(false);
      }
    })();
  }, []);

  const getPreferredCurrency = async () => {
    const item = await getPreferredCurrencyAsyncStorage();
    _setPreferredFiatCurrency(item);
  };

  const setPreferredFiatCurrency = () => {
    getPreferredCurrency();
  };

  const getLanguage = async () => {
    const item = await getLanguageAsyncStorage();
    _setLanguage(item);
  };

  const setLanguage = () => {
    getLanguage();
  };

  useEffect(() => {
    getPreferredCurrency();
    getLanguageAsyncStorage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetWallets = () => {
    setWallets(BlueApp.getWallets());
  };

  const setWalletsWithNewOrder = wlts => {
    BlueApp.wallets = wlts;
    saveToDisk();
  };

  const refreshAllWalletTransactions = async () => {
    console.log('refreshAllWalletTransactions');
    if (!BlueApp.wallets.length) return;

    let noErr = true;
    try {
      setWalletTransactionUpdateStatus(WalletTransactionsStatus.ALL);

      await BlueElectrum.waitTillConnected();
      await fetchSenderPaymentCodes();

      await Promise.all(
        BlueApp.wallets.map(async wallet => {
          await wallet.fetchBalance();
          await wallet.fetchTransactions();
          if (wallet.fetchPendingTransactions) {
            await wallet.fetchPendingTransactions();
          }
          if (wallet.fetchUserInvoices) {
            await wallet.fetchUserInvoices();
          }
        }),
      );
      setLastSuccessfulBalanceRefresh(Date.now());
    } catch (err) {
      noErr = false;
      console.warn(err);
    } finally {
      setWalletTransactionUpdateStatus(WalletTransactionsStatus.NONE);
    }
    if (noErr) await saveToDisk(); // caching
  };

  const fetchAndSaveWalletTransactions = async walletID => {
    const index = wallets.findIndex(wallet => wallet.getID() === walletID);
    let noErr = true;
    try {
      // 5sec debounce:
      setWalletTransactionUpdateStatus(walletID);
      if (+new Date() - _lastTimeTriedToRefetchWallet[walletID] < 5000) {
        console.log('re-fetch wallet happens too fast; NOP');
        return;
      }
      _lastTimeTriedToRefetchWallet[walletID] = +new Date();

      await BlueElectrum.waitTillConnected();
      await fetchWalletBalances(index);
      await fetchWalletTransactions(index);
    } catch (err) {
      noErr = false;
      console.warn(err);
    } finally {
      setWalletTransactionUpdateStatus(WalletTransactionsStatus.NONE);
    }
    if (noErr) await saveToDisk(); // caching
  };

  const clearBalanceRefreshInterval = () => {
    if (balanceRefreshInterval.current) {
      clearInterval(balanceRefreshInterval.current);
      balanceRefreshInterval.current = null;
    }
  };

  const setBalanceRefreshInterval = () => {
    if (!wallets) return;
    clearBalanceRefreshInterval();
    refreshAllWalletTransactions().catch(console.error);
    balanceRefreshInterval.current = setInterval(() => {
      refreshAllWalletTransactions().catch(console.error);
    }, 20 * 1000);
  };

  const revalidateBalancesInterval = async () => {
    const isElectrumDisabled = await BlueElectrum.isDisabled();
    if (isElectrumDisabled) return;

    const timeSinceLastRefresh = Date.now() - lastSuccessfulBalanceRefresh;
    if (timeSinceLastRefresh < 60 * 1000) return;

    const netInfo = await fetchNetInfo();
    BlueElectrum.setNetworkConnected(state.isConnected);
    if (!netInfo.isConnected) return;

    setBalanceRefreshInterval();
  };

  const addWallet = wallet => {
    BlueApp.wallets.push(wallet);
    setWallets([...BlueApp.getWallets()]);
  };

  const deleteWallet = wallet => {
    BlueApp.deleteWallet(wallet);
    setWallets([...BlueApp.getWallets()]);
  };

  const addAndSaveWallet = async w => {
    if (wallets.some(i => i.getID() === w.getID())) {
      ReactNativeHapticFeedback.trigger('notificationError', { ignoreAndroidSystemSettings: false });
      Alert.alert('', 'This wallet has been previously imported.');
      return;
    }
    ReactNativeHapticFeedback.trigger('notificationSuccess', { ignoreAndroidSystemSettings: false });
    w.setUserHasSavedExport(true);
    w.setUserHasBackedUpSeed(true);
    addWallet(w);
    await saveToDisk();
    A(A.ENUM.CREATED_WALLET);
    Notifications.majorTomToGroundControl(w.getAllExternalAddresses(), [], []);
    // start balance fetching at the background
    await w.fetchBalance();
    setWallets([...BlueApp.getWallets()]);
  };

  let txMetadata = BlueApp.tx_metadata || {};
  const getTransactions = BlueApp.getTransactions;
  const isAdvancedModeEnabled = BlueApp.isAdvancedModeEnabled;

  const fetchSenderPaymentCodes = BlueApp.fetchSenderPaymentCodes;
  const fetchWalletBalances = BlueApp.fetchWalletBalances;
  const fetchWalletTransactions = BlueApp.fetchWalletTransactions;
  const getBalance = BlueApp.getBalance;
  const isStorageEncrypted = BlueApp.storageIsEncrypted;
  const startAndDecrypt = BlueApp.startAndDecrypt;
  const encryptStorage = BlueApp.encryptStorage;
  const sleep = BlueApp.sleep;
  const setHodlHodlApiKey = BlueApp.setHodlHodlApiKey;
  const getHodlHodlApiKey = BlueApp.getHodlHodlApiKey;
  const createFakeStorage = BlueApp.createFakeStorage;
  const decryptStorage = BlueApp.decryptStorage;
  const isPasswordInUse = BlueApp.isPasswordInUse;
  const cachedPassword = BlueApp.cachedPassword;
  const setIsAdvancedModeEnabled = BlueApp.setIsAdvancedModeEnabled;
  const getHodlHodlSignatureKey = BlueApp.getHodlHodlSignatureKey;
  const addHodlHodlContract = BlueApp.addHodlHodlContract;
  const getHodlHodlContracts = BlueApp.getHodlHodlContracts;
  const setDoNotTrack = BlueApp.setDoNotTrack;
  const isDoNotTrackEnabled = BlueApp.isDoNotTrackEnabled;
  const getItem = BlueApp.getItem;
  const setItem = BlueApp.setItem;

  return (
    <BlueStorageContext.Provider
      value={{
        wallets,
        setWalletsWithNewOrder,
        txMetadata,
        saveToDisk,
        getTransactions,
        selectedWallet,
        setSelectedWallet,
        addWallet,
        deleteWallet,
        addAndSaveWallet,
        setItem,
        getItem,
        getHodlHodlContracts,
        isAdvancedModeEnabled,
        fetchWalletBalances,
        fetchWalletTransactions,
        fetchAndSaveWalletTransactions,
        isStorageEncrypted,
        getHodlHodlSignatureKey,
        encryptStorage,
        startAndDecrypt,
        cachedPassword,
        addHodlHodlContract,
        getBalance,
        walletsInitialized,
        setWalletsInitialized,
        refreshAllWalletTransactions,
        sleep,
        setHodlHodlApiKey,
        createFakeStorage,
        resetWallets,
        getHodlHodlApiKey,
        decryptStorage,
        isPasswordInUse,
        setIsAdvancedModeEnabled,
        setPreferredFiatCurrency,
        preferredFiatCurrency,
        setLanguage,
        language,
        isHandOffUseEnabled,
        setIsHandOffUseEnabledAsyncStorage,
        walletTransactionUpdateStatus,
        setWalletTransactionUpdateStatus,
        setDoNotTrack,
        isDoNotTrackEnabled,
        isElectrumDisabled,
        setIsElectrumDisabled,
        isTorDisabled,
        setIsTorDisabled,
        isPrivacyBlurEnabled,
        setIsPrivacyBlurEnabled,
        lastSuccessfulBalanceRefresh,
        setBalanceRefreshInterval,
        clearBalanceRefreshInterval,
        revalidateBalancesInterval,
        // Feature flags
        ldsDEV,
        setLdsDEVAsyncStorage,
        isPosMode,
        setIsPosModeAsyncStorage,
        isDfxPos,
        setIsDfxPosAsyncStorage,
        isDfxSwap,
        setIsDfxSwapAsyncStorage,
      }}
    >
      {children}
    </BlueStorageContext.Provider>
  );
};
