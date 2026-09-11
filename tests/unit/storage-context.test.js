const React = require('react');
const { Alert, Text } = require('react-native');
const { act, render, waitFor } = require('@testing-library/react-native');
const AsyncStorage = require('@react-native-async-storage/async-storage');
const haptic = require('react-native-haptic-feedback');
const { rollbackWalletIfSaveFailed } = require('../../blue_modules/storage-context-helpers');

// storage-context.js requires BlueApp and calls getWallets / isHandoffEnabled / …
// on mount. Under Jest those methods are not functions on the required module
// (`BlueApp.getWallets is not a function`), so the provider never finishes
// mounting. Replace the module with a complete object of every field the
// provider reads. AppStorage is the real class so the saveToDisk tests below
// still exercise production persistence.
const mockBlueApp = {
  wallets: [],
  tx_metadata: {},
  cachedPassword: false,
};

const mockResetBlueApp = () => {
  mockBlueApp.wallets = [];
  mockBlueApp.tx_metadata = {};
  mockBlueApp.cachedPassword = false;
  mockBlueApp.getWallets.mockImplementation(() => mockBlueApp.wallets);
  mockBlueApp.deleteWallet.mockImplementation(wallet => {
    const id = wallet.getID();
    mockBlueApp.wallets = (mockBlueApp.wallets || []).filter(w => w.getID() !== id);
  });
  mockBlueApp.saveToDisk.mockReset().mockResolvedValue(true);
  mockBlueApp.setIsHandoffEnabled.mockReset().mockResolvedValue(undefined);
  mockBlueApp.setIsLdsDevEnabled.mockReset().mockResolvedValue(undefined);
  mockBlueApp.setIsPOSmodeEnabled.mockReset().mockResolvedValue(undefined);
  mockBlueApp.setIsDfxPOSEnabled.mockReset().mockResolvedValue(undefined);
  mockBlueApp.setIsPrivacyBlurEnabled.mockReset().mockResolvedValue(undefined);
  mockBlueApp.setIsDfxSwapEnabled.mockReset().mockResolvedValue(undefined);
  mockBlueApp.setCameraPermissionLastAskedTime.mockReset().mockResolvedValue(undefined);
  mockBlueApp.setIsHideBalanceEnabled.mockReset().mockResolvedValue(undefined);
  mockBlueApp.isHandoffEnabled.mockReset().mockResolvedValue(false);
  mockBlueApp.isLdsDevEnabled.mockReset().mockResolvedValue(false);
  mockBlueApp.isPOSmodeEnabled.mockReset().mockResolvedValue(false);
  mockBlueApp.isDfxPOSEnabled.mockReset().mockResolvedValue(false);
  mockBlueApp.isDfxSwapEnabled.mockReset().mockResolvedValue(false);
  mockBlueApp.getCameraPermissionLastAskedTime.mockReset().mockResolvedValue(0);
  mockBlueApp.isHideBalanceEnabled.mockReset().mockResolvedValue(false);
  mockBlueApp.isPrivacyBlurEnabled.mockReset().mockResolvedValue(true);
  mockBlueApp.fetchSenderPaymentCodes.mockReset().mockResolvedValue(undefined);
  mockBlueApp.fetchWalletBalances.mockReset().mockResolvedValue(undefined);
  mockBlueApp.fetchWalletTransactions.mockReset().mockResolvedValue(undefined);
  mockBlueApp.getTransactions.mockReset();
  mockBlueApp.isAdvancedModeEnabled.mockReset();
  mockBlueApp.getBalance.mockReset();
  mockBlueApp.storageIsEncrypted.mockReset();
  mockBlueApp.startAndDecrypt.mockReset();
  mockBlueApp.encryptStorage.mockReset();
  mockBlueApp.sleep.mockReset();
  mockBlueApp.setHodlHodlApiKey.mockReset();
  mockBlueApp.getHodlHodlApiKey.mockReset();
  mockBlueApp.createFakeStorage.mockReset();
  mockBlueApp.decryptStorage.mockReset();
  mockBlueApp.isPasswordInUse.mockReset();
  mockBlueApp.setIsAdvancedModeEnabled.mockReset();
  mockBlueApp.getHodlHodlSignatureKey.mockReset();
  mockBlueApp.addHodlHodlContract.mockReset();
  mockBlueApp.getHodlHodlContracts.mockReset();
  mockBlueApp.setDoNotTrack.mockReset();
  mockBlueApp.isDoNotTrackEnabled.mockReset();
  mockBlueApp.getItem.mockReset();
  mockBlueApp.setItem.mockReset();
};

jest.mock('../../BlueApp', () => {
  const actual = jest.requireActual('../../BlueApp');
  mockBlueApp.AppStorage = actual.AppStorage;
  mockBlueApp.getWallets = jest.fn(() => mockBlueApp.wallets);
  mockBlueApp.saveToDisk = jest.fn(async () => true);
  mockBlueApp.deleteWallet = jest.fn(wallet => {
    const id = wallet.getID();
    mockBlueApp.wallets = (mockBlueApp.wallets || []).filter(w => w.getID() !== id);
  });
  mockBlueApp.setIsHandoffEnabled = jest.fn(async () => undefined);
  mockBlueApp.setIsLdsDevEnabled = jest.fn(async () => undefined);
  mockBlueApp.setIsPOSmodeEnabled = jest.fn(async () => undefined);
  mockBlueApp.setIsDfxPOSEnabled = jest.fn(async () => undefined);
  mockBlueApp.setIsPrivacyBlurEnabled = jest.fn(async () => undefined);
  mockBlueApp.setIsDfxSwapEnabled = jest.fn(async () => undefined);
  mockBlueApp.setCameraPermissionLastAskedTime = jest.fn(async () => undefined);
  mockBlueApp.setIsHideBalanceEnabled = jest.fn(async () => undefined);
  mockBlueApp.isHandoffEnabled = jest.fn(async () => false);
  mockBlueApp.isLdsDevEnabled = jest.fn(async () => false);
  mockBlueApp.isPOSmodeEnabled = jest.fn(async () => false);
  mockBlueApp.isDfxPOSEnabled = jest.fn(async () => false);
  mockBlueApp.isDfxSwapEnabled = jest.fn(async () => false);
  mockBlueApp.getCameraPermissionLastAskedTime = jest.fn(async () => 0);
  mockBlueApp.isHideBalanceEnabled = jest.fn(async () => false);
  mockBlueApp.isPrivacyBlurEnabled = jest.fn(async () => true);
  mockBlueApp.getTransactions = jest.fn();
  mockBlueApp.isAdvancedModeEnabled = jest.fn();
  mockBlueApp.fetchSenderPaymentCodes = jest.fn(async () => undefined);
  mockBlueApp.fetchWalletBalances = jest.fn(async () => undefined);
  mockBlueApp.fetchWalletTransactions = jest.fn(async () => undefined);
  mockBlueApp.getBalance = jest.fn();
  mockBlueApp.storageIsEncrypted = jest.fn();
  mockBlueApp.startAndDecrypt = jest.fn();
  mockBlueApp.encryptStorage = jest.fn();
  mockBlueApp.sleep = jest.fn();
  mockBlueApp.setHodlHodlApiKey = jest.fn();
  mockBlueApp.getHodlHodlApiKey = jest.fn();
  mockBlueApp.createFakeStorage = jest.fn();
  mockBlueApp.decryptStorage = jest.fn();
  mockBlueApp.isPasswordInUse = jest.fn();
  mockBlueApp.setIsAdvancedModeEnabled = jest.fn();
  mockBlueApp.getHodlHodlSignatureKey = jest.fn();
  mockBlueApp.addHodlHodlContract = jest.fn();
  mockBlueApp.getHodlHodlContracts = jest.fn();
  mockBlueApp.setDoNotTrack = jest.fn();
  mockBlueApp.isDoNotTrackEnabled = jest.fn();
  mockBlueApp.getItem = jest.fn();
  mockBlueApp.setItem = jest.fn();
  return mockBlueApp;
});

jest.mock('../../blue_modules/BlueElectrum', () => ({
  connectMain: jest.fn(),
  isDisabled: jest.fn().mockResolvedValue(true),
  waitTillConnected: jest.fn().mockResolvedValue(true),
  setNetworkConnected: jest.fn(),
}));

jest.mock('../../blue_modules/notifications', () => ({
  majorTomToGroundControl: jest.fn(),
}));

jest.mock('react-native-haptic-feedback', () => ({
  trigger: jest.fn(),
}));

const BlueApp = require('../../BlueApp');
const AppStorage = BlueApp.AppStorage;
const BlueElectrum = require('../../blue_modules/BlueElectrum');
const { majorTomToGroundControl } = require('../../blue_modules/notifications');
const A = require('../../blue_modules/analytics');
const NetInfo = require('@react-native-community/netinfo');
const { BlueStorageProvider, BlueStorageContext, WalletTransactionsStatus } = require('../../blue_modules/storage-context');
const AsyncStorageImpl = AsyncStorage.default || AsyncStorage;

const prepareStorage = () => {
  const storage = new AppStorage();
  const realmKeyValue = {
    close: jest.fn(),
    create: jest.fn(),
    write: jest.fn(),
  };

  jest.spyOn(storage, 'getRealm').mockResolvedValue(null);
  jest.spyOn(storage, 'openRealmKeyValue').mockResolvedValue(realmKeyValue);
  jest.spyOn(storage, 'setItem').mockResolvedValue(undefined);

  return storage;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('AppStorage.saveToDisk', () => {
  it('returns true when the wallet data is persisted', async () => {
    const storage = prepareStorage();

    await expect(storage.saveToDisk()).resolves.toBe(true);
    expect(storage.setItem).toHaveBeenCalledTimes(2);
  });

  it('returns false instead of rejecting when persistence fails', async () => {
    const storage = prepareStorage();
    const persistenceError = new Error('storage unavailable');
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    storage.setItem.mockRejectedValueOnce(persistenceError);

    await expect(storage.saveToDisk()).resolves.toBe(false);
    expect(consoleError).toHaveBeenCalledWith('saveToDisk: failed to persist wallet data', persistenceError);
  });
});

describe('rollbackWalletIfSaveFailed', () => {
  it('keeps a saved wallet and removes a wallet whose save failed', async () => {
    const persist = jest.fn().mockResolvedValue(true);
    const removeSavedWallet = jest.fn();
    await rollbackWalletIfSaveFailed(true, removeSavedWallet, persist);
    expect(removeSavedWallet).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();

    const removeFailedWallet = jest.fn();
    await expect(rollbackWalletIfSaveFailed(false, removeFailedWallet, persist)).rejects.toThrow(
      'Failed to save wallet to storage. The wallet was not added.',
    );
    expect(removeFailedWallet).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('drops the wallet from the persisted store when the first save fails after writing data', async () => {
    const storage = prepareStorage();
    const persisted = {};
    let failFlagWrite = false;
    storage.setItem.mockImplementation(async (key, value) => {
      if (failFlagWrite && key === AppStorage.FLAG_ENCRYPTED) {
        failFlagWrite = false;
        throw new Error('flag write failed');
      }
      persisted[key] = value;
    });

    const wallet = {
      getID: () => 'w1',
      prepareForSerialization() {},
      type: 'stub',
    };
    storage.wallets.push(wallet);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    failFlagWrite = true;
    const saved = await storage.saveToDisk();
    expect(saved).toBe(false);
    expect(JSON.parse(persisted.data).wallets).toHaveLength(1);

    await expect(
      rollbackWalletIfSaveFailed(
        saved,
        () => storage.deleteWallet(wallet),
        () => storage.saveToDisk(),
      ),
    ).rejects.toThrow('The wallet was not added.');

    expect(JSON.parse(persisted.data).wallets).toHaveLength(0);
    expect(storage.wallets).toHaveLength(0);
    expect(consoleError).toHaveBeenCalled();
  });

  it('does not claim the wallet was not added when the rollback save also fails', async () => {
    const removeWallet = jest.fn();
    const persist = jest.fn().mockResolvedValue(false);
    await expect(rollbackWalletIfSaveFailed(false, removeWallet, persist)).rejects.toThrow(/^Failed to save wallet to storage\.$/);
    expect(removeWallet).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('does not claim the wallet was not added when the rollback save throws', async () => {
    const persist = jest.fn().mockRejectedValue(new Error('disk full'));
    await expect(rollbackWalletIfSaveFailed(false, jest.fn(), persist)).rejects.toThrow(/^Failed to save wallet to storage\.$/);
  });
});

let latestCtx;
let walletSeq = 0;
let intervalCallbacks = [];

const Probe = () => {
  latestCtx = React.useContext(BlueStorageContext);
  const count = latestCtx.wallets ? latestCtx.wallets.length : 'none';
  return <Text testID="storage-probe">{String(count)}</Text>;
};

function makeWallet(overrides = {}) {
  walletSeq += 1;
  const id = overrides.id || `wallet-${walletSeq}`;
  return {
    getID: () => id,
    fetchBalance: jest.fn().mockResolvedValue(undefined),
    fetchTransactions: jest.fn().mockResolvedValue(undefined),
    setUserHasSavedExport: jest.fn(),
    setUserHasBackedUpSeed: jest.fn(),
    getAllExternalAddresses: jest.fn().mockReturnValue([`addr-${id}`]),
    ...overrides,
  };
}

async function renderProvider() {
  latestCtx = null;
  const screen = render(
    <BlueStorageProvider>
      <Probe />
    </BlueStorageProvider>,
  );
  // Probe writes latestCtx during render. The boot IIFE is async and may take
  // the try or the catch — neither path is a universal signal, so the helper
  // does not wait on a BlueApp method from that chain.
  await waitFor(() => expect(latestCtx).toBeTruthy());
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return screen;
}

describe('BlueStorageProvider', () => {
  beforeEach(async () => {
    latestCtx = null;
    intervalCallbacks = [];
    mockResetBlueApp();
    await AsyncStorageImpl.clear();
    BlueElectrum.isDisabled.mockReset();
    BlueElectrum.isDisabled.mockResolvedValue(true);
    BlueElectrum.waitTillConnected.mockReset();
    BlueElectrum.waitTillConnected.mockResolvedValue(true);
    BlueElectrum.setNetworkConnected.mockReset();
    NetInfo.fetch.mockReset();
    NetInfo.fetch.mockResolvedValue({ isConnected: true });
    majorTomToGroundControl.mockClear();
    A.mockClear();
    haptic.trigger.mockClear();

    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    jest.spyOn(global, 'setInterval').mockImplementation(fn => {
      intervalCallbacks.push(fn);
      return 101;
    });
    jest.spyOn(global, 'clearInterval').mockImplementation(() => {});
  });

  afterEach(() => {
    if (latestCtx && latestCtx.clearBalanceRefreshInterval) {
      latestCtx.clearBalanceRefreshInterval();
    }
    jest.useRealTimers();
    BlueApp.wallets = [];
    BlueApp.tx_metadata = {};
  });

  it('exports NONE as false and ALL as true', () => {
    expect(WalletTransactionsStatus.NONE).toBe(false);
    expect(WalletTransactionsStatus.ALL).toBe(true);
  });

  it('loads persisted boot flags and applies boolean coercion', async () => {
    BlueApp.isHandoffEnabled.mockResolvedValue(1);
    BlueApp.isLdsDevEnabled.mockResolvedValue('yes');
    BlueApp.isPOSmodeEnabled.mockResolvedValue(true);
    BlueApp.isDfxPOSEnabled.mockResolvedValue('1');
    BlueApp.isDfxSwapEnabled.mockResolvedValue(true);
    BlueApp.getCameraPermissionLastAskedTime.mockResolvedValue(42);
    BlueApp.isHideBalanceEnabled.mockResolvedValue('1');
    BlueApp.isPrivacyBlurEnabled.mockResolvedValue(0);

    await renderProvider();

    await waitFor(() => expect(latestCtx.isHandOffUseEnabled).toBe(true));
    expect(latestCtx.ldsDEV).toBe(true);
    expect(latestCtx.isPosMode).toBe(true);
    expect(latestCtx.isDfxPos).toBe(true);
    expect(latestCtx.isDfxSwap).toBe(true);
    expect(latestCtx.cameraPermissionLastAskedTime).toBe(42);
    expect(latestCtx.hideBalance).toBe(true);
    expect(latestCtx.isPrivacyBlurEnabled).toBe(false);
  });

  it('resets feature flags in memory on a boot-flag read failure and leaves privacy blur on', async () => {
    BlueApp.isHandoffEnabled.mockRejectedValue(new Error('keychain unavailable'));

    await renderProvider();

    await waitFor(() => expect(BlueApp.setIsHandoffEnabled).toHaveBeenCalledWith(false));
    expect(BlueApp.setIsLdsDevEnabled).toHaveBeenCalledWith(false);
    expect(BlueApp.setIsPOSmodeEnabled).toHaveBeenCalledWith(false);
    expect(BlueApp.setIsDfxPOSEnabled).toHaveBeenCalledWith(false);
    expect(BlueApp.setIsDfxSwapEnabled).toHaveBeenCalledWith(false);
    expect(BlueApp.setIsPrivacyBlurEnabled).not.toHaveBeenCalled();
    expect(latestCtx.isHandOffUseEnabled).toBe(false);
    expect(latestCtx.ldsDEV).toBe(false);
    expect(latestCtx.isPosMode).toBe(false);
    expect(latestCtx.isDfxPos).toBe(false);
    expect(latestCtx.isDfxSwap).toBe(false);
    expect(latestCtx.isPrivacyBlurEnabled).toBe(true);
  });

  it('applies BlueElectrum.isDisabled to isElectrumDisabled after mount', async () => {
    BlueElectrum.isDisabled.mockResolvedValue(false);
    await renderProvider();
    await waitFor(() => expect(latestCtx.isElectrumDisabled).toBe(false));
  });

  it('uses an empty object for txMetadata when BlueApp.tx_metadata is missing', async () => {
    BlueApp.tx_metadata = null;
    await renderProvider();
    expect(latestCtx.txMetadata).toEqual({});
  });

  it('reuses BlueApp.tx_metadata when it is already an object', async () => {
    const metadata = { txid: { memo: 'note' } };
    BlueApp.tx_metadata = metadata;
    await renderProvider();
    expect(latestCtx.txMetadata).toBe(metadata);
  });

  it('wires BlueApp helpers onto the context by identity', async () => {
    await renderProvider();
    expect(latestCtx.getTransactions).toBe(BlueApp.getTransactions);
    expect(latestCtx.isAdvancedModeEnabled).toBe(BlueApp.isAdvancedModeEnabled);
    expect(latestCtx.fetchWalletBalances).toBe(BlueApp.fetchWalletBalances);
    expect(latestCtx.fetchWalletTransactions).toBe(BlueApp.fetchWalletTransactions);
    expect(latestCtx.getBalance).toBe(BlueApp.getBalance);
    expect(latestCtx.isStorageEncrypted).toBe(BlueApp.storageIsEncrypted);
    expect(latestCtx.startAndDecrypt).toBe(BlueApp.startAndDecrypt);
    expect(latestCtx.encryptStorage).toBe(BlueApp.encryptStorage);
    expect(latestCtx.sleep).toBe(BlueApp.sleep);
    expect(latestCtx.setHodlHodlApiKey).toBe(BlueApp.setHodlHodlApiKey);
    expect(latestCtx.getHodlHodlApiKey).toBe(BlueApp.getHodlHodlApiKey);
    expect(latestCtx.createFakeStorage).toBe(BlueApp.createFakeStorage);
    expect(latestCtx.decryptStorage).toBe(BlueApp.decryptStorage);
    expect(latestCtx.isPasswordInUse).toBe(BlueApp.isPasswordInUse);
    expect(latestCtx.cachedPassword).toBe(BlueApp.cachedPassword);
    expect(latestCtx.setIsAdvancedModeEnabled).toBe(BlueApp.setIsAdvancedModeEnabled);
    expect(latestCtx.getHodlHodlSignatureKey).toBe(BlueApp.getHodlHodlSignatureKey);
    expect(latestCtx.addHodlHodlContract).toBe(BlueApp.addHodlHodlContract);
    expect(latestCtx.getHodlHodlContracts).toBe(BlueApp.getHodlHodlContracts);
    expect(latestCtx.setDoNotTrack).toBe(BlueApp.setDoNotTrack);
    expect(latestCtx.isDoNotTrackEnabled).toBe(BlueApp.isDoNotTrackEnabled);
    expect(latestCtx.getItem).toBe(BlueApp.getItem);
    expect(latestCtx.setItem).toBe(BlueApp.setItem);
  });

  it('returns true from saveToDisk without persisting when there are no wallets and force is not set', async () => {
    await renderProvider();
    BlueApp.saveToDisk.mockClear();

    let saved;
    await act(async () => {
      saved = await latestCtx.saveToDisk();
    });
    expect(saved).toBe(true);
    expect(BlueApp.saveToDisk).not.toHaveBeenCalled();

    await act(async () => {
      saved = await latestCtx.saveToDisk(false);
    });
    expect(saved).toBe(true);
    expect(BlueApp.saveToDisk).not.toHaveBeenCalled();
  });

  it('persists through saveToDisk(true) even when there are no wallets', async () => {
    await renderProvider();
    BlueApp.saveToDisk.mockClear();

    let saved;
    await act(async () => {
      saved = await latestCtx.saveToDisk(true);
    });
    expect(saved).toBe(true);
    expect(BlueApp.saveToDisk).toHaveBeenCalledTimes(1);
  });

  it('persists through saveToDisk when wallets exist and copies tx metadata onto BlueApp', async () => {
    const wallet = makeWallet();
    BlueApp.wallets = [wallet];
    BlueApp.tx_metadata = { existing: true };
    await renderProvider();
    BlueApp.saveToDisk.mockClear();

    let saved;
    await act(async () => {
      saved = await latestCtx.saveToDisk();
    });
    expect(saved).toBe(true);
    expect(BlueApp.saveToDisk).toHaveBeenCalledTimes(1);
    expect(BlueApp.tx_metadata).toEqual({ existing: true });
    expect(latestCtx.wallets).toEqual([wallet]);
  });

  it('persists handoff, LDS-dev, POS, DFX POS and DFX swap through their setters', async () => {
    await renderProvider();

    await act(async () => {
      await latestCtx.setIsHandOffUseEnabledAsyncStorage(true);
      await latestCtx.setLdsDEVAsyncStorage(true);
      await latestCtx.setIsPosModeAsyncStorage(true);
      await latestCtx.setIsDfxPosAsyncStorage(true);
      await latestCtx.setIsDfxSwapAsyncStorage(true);
    });

    expect(latestCtx.isHandOffUseEnabled).toBe(true);
    expect(latestCtx.ldsDEV).toBe(true);
    expect(latestCtx.isPosMode).toBe(true);
    expect(latestCtx.isDfxPos).toBe(true);
    expect(latestCtx.isDfxSwap).toBe(true);
    expect(BlueApp.setIsHandoffEnabled).toHaveBeenCalledWith(true);
    expect(BlueApp.setIsLdsDevEnabled).toHaveBeenCalledWith(true);
    expect(BlueApp.setIsPOSmodeEnabled).toHaveBeenCalledWith(true);
    expect(BlueApp.setIsDfxPOSEnabled).toHaveBeenCalledWith(true);
    expect(BlueApp.setIsDfxSwapEnabled).toHaveBeenCalledWith(true);
  });

  it('persists privacy blur and keeps the new value when the write succeeds', async () => {
    await renderProvider();

    await act(async () => {
      await latestCtx.setIsPrivacyBlurEnabledAsyncStorage(false);
    });

    expect(latestCtx.isPrivacyBlurEnabled).toBe(false);
    expect(BlueApp.setIsPrivacyBlurEnabled).toHaveBeenCalledWith(false);
  });

  it('reverts privacy blur and rethrows when the write fails', async () => {
    await renderProvider();
    BlueApp.setIsPrivacyBlurEnabled.mockRejectedValueOnce(new Error('disk full'));

    await act(async () => {
      await expect(latestCtx.setIsPrivacyBlurEnabledAsyncStorage(false)).rejects.toThrow('disk full');
    });

    expect(latestCtx.isPrivacyBlurEnabled).toBe(true);
  });

  it('persists the camera-permission timestamp through its setter', async () => {
    await renderProvider();

    await act(async () => {
      await latestCtx.setCameraPermissionLastAskedTimeAsyncStorage(99);
    });

    expect(latestCtx.cameraPermissionLastAskedTime).toBe(99);
    expect(BlueApp.setCameraPermissionLastAskedTime).toHaveBeenCalledWith(99);
  });

  it('loads preferred fiat currency from async storage via setPreferredFiatCurrency', async () => {
    await AsyncStorageImpl.setItem('preferredCurrency', 'EUR');
    await renderProvider();

    await act(async () => {
      latestCtx.setPreferredFiatCurrency();
    });

    await waitFor(() => expect(latestCtx.preferredFiatCurrency).toBe('EUR'));
  });

  it('loads the language from async storage via setLanguage', async () => {
    await AsyncStorageImpl.setItem('lang', 'de');
    await renderProvider();

    await act(async () => {
      latestCtx.setLanguage();
    });

    await waitFor(() => expect(latestCtx.language).toBe('de'));
  });

  it('replaces context wallets with BlueApp.getWallets on resetWallets', async () => {
    const wallet = makeWallet();
    await renderProvider();

    await act(async () => {
      latestCtx.addWallet(wallet);
    });
    expect(latestCtx.wallets).toHaveLength(1);

    BlueApp.wallets = [];
    await act(async () => {
      latestCtx.resetWallets();
    });
    expect(latestCtx.wallets).toEqual([]);
  });

  it('writes the new wallet order to BlueApp and persists it', async () => {
    const first = makeWallet();
    const second = makeWallet();
    BlueApp.wallets = [first, second];
    await renderProvider();
    BlueApp.saveToDisk.mockClear();

    const reordered = [second, first];
    await act(async () => {
      latestCtx.setWalletsWithNewOrder(reordered);
    });
    await waitFor(() => expect(BlueApp.saveToDisk).toHaveBeenCalled());
    expect(BlueApp.wallets).toBe(reordered);
  });

  it('returns immediately from refreshAllWalletTransactions when there are no wallets', async () => {
    await renderProvider();
    BlueApp.saveToDisk.mockClear();
    BlueElectrum.waitTillConnected.mockClear();

    await act(async () => {
      await latestCtx.refreshAllWalletTransactions();
    });

    expect(BlueElectrum.waitTillConnected).not.toHaveBeenCalled();
    expect(BlueApp.saveToDisk).not.toHaveBeenCalled();
    expect(latestCtx.walletTransactionUpdateStatus).toBe(WalletTransactionsStatus.NONE);
  });

  it('sets ALL while refreshAllWalletTransactions runs and NONE when it finishes', async () => {
    const pending = makeWallet({
      fetchPendingTransactions: jest.fn().mockResolvedValue(undefined),
    });
    const invoiced = makeWallet({
      fetchUserInvoices: jest.fn().mockResolvedValue(undefined),
    });
    BlueApp.wallets = [pending, invoiced];
    await renderProvider();

    let resolveConnected;
    BlueElectrum.waitTillConnected.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveConnected = resolve;
        }),
    );

    let refreshPromise;
    await act(async () => {
      refreshPromise = latestCtx.refreshAllWalletTransactions();
    });
    expect(latestCtx.walletTransactionUpdateStatus).toBe(WalletTransactionsStatus.ALL);

    await act(async () => {
      resolveConnected(true);
      await refreshPromise;
    });

    expect(latestCtx.walletTransactionUpdateStatus).toBe(WalletTransactionsStatus.NONE);
    expect(pending.fetchBalance).toHaveBeenCalledTimes(1);
    expect(pending.fetchTransactions).toHaveBeenCalledTimes(1);
    expect(pending.fetchPendingTransactions).toHaveBeenCalledTimes(1);
    expect(invoiced.fetchUserInvoices).toHaveBeenCalledTimes(1);
    expect(BlueApp.fetchSenderPaymentCodes).toHaveBeenCalled();
    expect(BlueApp.saveToDisk).toHaveBeenCalled();
  });

  it('skips saveToDisk and warns when refreshAllWalletTransactions fails', async () => {
    const wallet = makeWallet();
    BlueApp.wallets = [wallet];
    await renderProvider();
    BlueApp.saveToDisk.mockClear();
    const failure = new Error('electrum down');
    BlueElectrum.waitTillConnected.mockRejectedValueOnce(failure);

    await act(async () => {
      await latestCtx.refreshAllWalletTransactions();
    });

    expect(BlueApp.saveToDisk).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith('refreshAllWalletTransactions: failed, retrying on next interval', failure);
    expect(latestCtx.walletTransactionUpdateStatus).toBe(WalletTransactionsStatus.NONE);
  });

  it('fetches a single wallet, then persists, via fetchAndSaveWalletTransactions', async () => {
    const wallet = makeWallet();
    await renderProvider();
    await act(async () => {
      latestCtx.addWallet(wallet);
    });
    BlueApp.saveToDisk.mockClear();
    BlueElectrum.waitTillConnected.mockClear();
    BlueApp.fetchWalletBalances.mockClear();
    BlueApp.fetchWalletTransactions.mockClear();

    await act(async () => {
      await latestCtx.fetchAndSaveWalletTransactions(wallet.getID());
    });

    expect(BlueElectrum.waitTillConnected).toHaveBeenCalledTimes(1);
    expect(BlueApp.fetchWalletBalances).toHaveBeenCalledWith(0);
    expect(BlueApp.fetchWalletTransactions).toHaveBeenCalledWith(0);
    expect(BlueApp.saveToDisk).toHaveBeenCalledTimes(1);
    expect(latestCtx.walletTransactionUpdateStatus).toBe(WalletTransactionsStatus.NONE);
  });

  it('skips a second fetchAndSaveWalletTransactions for the same wallet inside 5 seconds', async () => {
    const wallet = makeWallet();
    await renderProvider();
    await act(async () => {
      latestCtx.addWallet(wallet);
    });
    BlueApp.saveToDisk.mockClear();
    BlueElectrum.waitTillConnected.mockClear();

    await act(async () => {
      await latestCtx.fetchAndSaveWalletTransactions(wallet.getID());
    });
    await act(async () => {
      await latestCtx.fetchAndSaveWalletTransactions(wallet.getID());
    });

    expect(BlueElectrum.waitTillConnected).toHaveBeenCalledTimes(1);
    expect(BlueApp.saveToDisk).toHaveBeenCalledTimes(1);
  });

  it('passes index -1 into fetch helpers when the wallet id is unknown', async () => {
    await renderProvider();
    BlueApp.fetchWalletBalances.mockClear();
    BlueApp.fetchWalletTransactions.mockClear();

    await act(async () => {
      await latestCtx.fetchAndSaveWalletTransactions('missing-id');
    });

    expect(BlueApp.fetchWalletBalances).toHaveBeenCalledWith(-1);
    expect(BlueApp.fetchWalletTransactions).toHaveBeenCalledWith(-1);
  });

  it('skips saveToDisk and warns when fetchAndSaveWalletTransactions fails', async () => {
    const wallet = makeWallet();
    await renderProvider();
    await act(async () => {
      latestCtx.addWallet(wallet);
    });
    BlueApp.saveToDisk.mockClear();
    const failure = new Error('timeout');
    BlueElectrum.waitTillConnected.mockRejectedValueOnce(failure);

    await act(async () => {
      await latestCtx.fetchAndSaveWalletTransactions(wallet.getID());
    });

    expect(BlueApp.saveToDisk).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith('fetchAndSaveWalletTransactions: wallet index 0 failed, retrying on next refresh', failure);
  });

  it('does not start a balance interval when wallets is falsy', async () => {
    await renderProvider();
    BlueApp.wallets = null;
    await act(async () => {
      latestCtx.resetWallets();
    });
    intervalCallbacks = [];
    global.setInterval.mockClear();

    await act(async () => {
      latestCtx.setBalanceRefreshInterval();
    });

    expect(global.setInterval).not.toHaveBeenCalled();
    BlueApp.wallets = [];
  });

  it('starts a 20s interval and logs when the initial refresh rejects', async () => {
    const wallet = makeWallet();
    BlueApp.wallets = [wallet];
    await renderProvider();
    BlueApp.saveToDisk.mockRejectedValue(new Error('disk'));

    await act(async () => {
      latestCtx.setBalanceRefreshInterval();
    });

    expect(global.setInterval).toHaveBeenCalledWith(expect.any(Function), 20 * 1000);
    expect(console.error).toHaveBeenCalledWith('setBalanceRefreshInterval: initial refresh rejected', expect.any(Error));
  });

  it('logs when a scheduled balance refresh rejects', async () => {
    const wallet = makeWallet();
    BlueApp.wallets = [wallet];
    await renderProvider();
    BlueApp.saveToDisk.mockResolvedValue(true);

    global.setInterval.mockRestore();
    global.clearInterval.mockRestore();
    jest.useFakeTimers();

    await act(async () => {
      latestCtx.setBalanceRefreshInterval();
    });
    console.error.mockClear();
    BlueApp.saveToDisk.mockRejectedValue(new Error('disk later'));

    await act(async () => {
      await jest.advanceTimersByTimeAsync(20 * 1000);
    });

    expect(console.error).toHaveBeenCalledWith('setBalanceRefreshInterval: scheduled refresh rejected', expect.any(Error));
    expect(console.error).not.toHaveBeenCalledWith('setBalanceRefreshInterval: initial refresh rejected', expect.any(Error));
  });

  it('clears an existing interval before starting a new one and no-ops a second clear', async () => {
    const wallet = makeWallet();
    BlueApp.wallets = [wallet];
    await renderProvider();
    // waitFor in renderProvider uses setInterval/clearInterval; drop those calls
    // so the assertions only count what setBalanceRefreshInterval does.
    global.clearInterval.mockClear();
    global.setInterval.mockClear();

    await act(async () => {
      latestCtx.setBalanceRefreshInterval();
    });
    expect(global.clearInterval).not.toHaveBeenCalled();

    await act(async () => {
      latestCtx.setBalanceRefreshInterval();
    });
    expect(global.clearInterval).toHaveBeenCalledWith(101);

    await act(async () => {
      latestCtx.clearBalanceRefreshInterval();
    });
    expect(global.clearInterval).toHaveBeenCalledTimes(2);

    await act(async () => {
      latestCtx.clearBalanceRefreshInterval();
    });
    expect(global.clearInterval).toHaveBeenCalledTimes(2);
  });

  it('returns from revalidateBalancesInterval without touching Electrum when there are no wallets', async () => {
    await renderProvider();
    BlueElectrum.isDisabled.mockClear();

    await act(async () => {
      await latestCtx.revalidateBalancesInterval();
    });

    expect(BlueElectrum.isDisabled).not.toHaveBeenCalled();
  });

  it('returns from revalidateBalancesInterval when Electrum is disabled', async () => {
    BlueApp.wallets = [makeWallet()];
    BlueElectrum.isDisabled.mockResolvedValue(true);
    await renderProvider();
    NetInfo.fetch.mockClear();

    await act(async () => {
      await latestCtx.revalidateBalancesInterval();
    });

    expect(NetInfo.fetch).not.toHaveBeenCalled();
  });

  it('returns from revalidateBalancesInterval when the last refresh was within 40 seconds', async () => {
    BlueApp.wallets = [makeWallet()];
    BlueElectrum.isDisabled.mockResolvedValue(false);
    await renderProvider();
    NetInfo.fetch.mockClear();

    await act(async () => {
      await latestCtx.revalidateBalancesInterval();
    });

    expect(NetInfo.fetch).not.toHaveBeenCalled();
  });

  it('marks Electrum disconnected and skips the interval when netinfo reports offline', async () => {
    BlueApp.wallets = [makeWallet()];
    BlueElectrum.isDisabled.mockResolvedValue(false);
    await renderProvider();
    jest.spyOn(Date, 'now').mockReturnValue(latestCtx.lastSuccessfulBalanceRefresh + 41 * 1000);
    NetInfo.fetch.mockResolvedValue({ isConnected: false });
    global.setInterval.mockClear();

    await act(async () => {
      await latestCtx.revalidateBalancesInterval();
    });

    expect(BlueElectrum.setNetworkConnected).toHaveBeenCalledWith(false);
    expect(global.setInterval).not.toHaveBeenCalled();
  });

  it('marks Electrum connected and starts the interval when netinfo reports online', async () => {
    BlueApp.wallets = [makeWallet()];
    BlueElectrum.isDisabled.mockResolvedValue(false);
    await renderProvider();
    jest.spyOn(Date, 'now').mockReturnValue(latestCtx.lastSuccessfulBalanceRefresh + 41 * 1000);
    NetInfo.fetch.mockResolvedValue({ isConnected: true });
    global.setInterval.mockClear();

    await act(async () => {
      await latestCtx.revalidateBalancesInterval();
    });

    expect(BlueElectrum.setNetworkConnected).toHaveBeenCalledWith(true);
    expect(global.setInterval).toHaveBeenCalled();
  });

  it('treats a null netinfo isConnected as online so connectMain is not gated off', async () => {
    BlueApp.wallets = [makeWallet()];
    BlueElectrum.isDisabled.mockResolvedValue(false);
    await renderProvider();
    jest.spyOn(Date, 'now').mockReturnValue(latestCtx.lastSuccessfulBalanceRefresh + 41 * 1000);
    NetInfo.fetch.mockResolvedValue({ isConnected: null });
    global.setInterval.mockClear();

    await act(async () => {
      await latestCtx.revalidateBalancesInterval();
    });

    expect(BlueElectrum.setNetworkConnected).toHaveBeenCalledWith(true);
    expect(global.setInterval).toHaveBeenCalled();
  });

  it('logs when revalidateBalancesInterval itself throws', async () => {
    BlueApp.wallets = [makeWallet()];
    await renderProvider();
    const failure = new Error('disabled-read failed');
    BlueElectrum.isDisabled.mockReset();
    BlueElectrum.isDisabled.mockRejectedValue(failure);

    await act(async () => {
      await latestCtx.revalidateBalancesInterval();
    });

    expect(console.error).toHaveBeenCalledWith('revalidateBalancesInterval: failed', failure);
  });

  it('adds a new wallet and ignores a second add of the same id', async () => {
    const wallet = makeWallet();
    await renderProvider();

    await act(async () => {
      latestCtx.addWallet(wallet);
    });
    expect(BlueApp.wallets).toEqual([wallet]);
    expect(latestCtx.wallets).toEqual([wallet]);

    await act(async () => {
      latestCtx.addWallet(wallet);
    });
    expect(BlueApp.wallets).toHaveLength(1);
  });

  it('removes a wallet from BlueApp and the context via deleteWallet', async () => {
    const wallet = makeWallet();
    await renderProvider();
    await act(async () => {
      latestCtx.addWallet(wallet);
    });

    await act(async () => {
      latestCtx.deleteWallet(wallet);
    });

    expect(BlueApp.wallets).toHaveLength(0);
    expect(latestCtx.wallets).toHaveLength(0);
  });

  it('alerts and skips persist when addAndSaveWallet sees a wallet already in context', async () => {
    const wallet = makeWallet();
    await renderProvider();
    await act(async () => {
      latestCtx.addWallet(wallet);
    });
    BlueApp.saveToDisk.mockClear();

    await act(async () => {
      await latestCtx.addAndSaveWallet(wallet);
    });

    expect(haptic.trigger).toHaveBeenCalledWith('notificationError', { ignoreAndroidSystemSettings: false });
    expect(Alert.alert).toHaveBeenCalledWith('', 'This wallet has been previously imported.');
    expect(BlueApp.saveToDisk).not.toHaveBeenCalled();
    expect(majorTomToGroundControl).not.toHaveBeenCalled();
  });

  it('saves a new wallet, notifies Ground Control and records CREATED_WALLET', async () => {
    const wallet = makeWallet();
    await renderProvider();
    BlueApp.saveToDisk.mockClear();

    await act(async () => {
      await latestCtx.addAndSaveWallet(wallet);
      await Promise.resolve();
    });

    expect(haptic.trigger).toHaveBeenCalledWith('notificationSuccess', { ignoreAndroidSystemSettings: false });
    expect(wallet.setUserHasSavedExport).toHaveBeenCalledWith(true);
    expect(wallet.setUserHasBackedUpSeed).toHaveBeenCalledWith(true);
    expect(BlueApp.wallets).toEqual([wallet]);
    expect(BlueApp.saveToDisk).toHaveBeenCalled();
    expect(A).toHaveBeenCalledWith(A.ENUM.CREATED_WALLET);
    expect(majorTomToGroundControl).toHaveBeenCalledWith([`addr-${wallet.getID()}`], [], []);
    expect(wallet.fetchBalance).toHaveBeenCalled();
    expect(wallet.fetchTransactions).toHaveBeenCalled();
  });

  it('removes the wallet and rethrows when addAndSaveWallet persistence throws', async () => {
    const wallet = makeWallet();
    await renderProvider();
    BlueApp.saveToDisk.mockRejectedValueOnce(new Error('write failed'));

    await act(async () => {
      await expect(latestCtx.addAndSaveWallet(wallet)).rejects.toThrow('write failed');
    });

    expect(BlueApp.wallets).toHaveLength(0);
    expect(A).not.toHaveBeenCalled();
    expect(majorTomToGroundControl).not.toHaveBeenCalled();
  });

  it('rolls the wallet back when addAndSaveWallet persistence returns false', async () => {
    const wallet = makeWallet();
    await renderProvider();
    BlueApp.saveToDisk.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await act(async () => {
      await expect(latestCtx.addAndSaveWallet(wallet)).rejects.toThrow('The wallet was not added.');
    });

    expect(BlueApp.wallets).toHaveLength(0);
    expect(A).not.toHaveBeenCalled();
  });

  it('warns when addAndSaveWallet fetchBalance fails after a successful save', async () => {
    const failure = new Error('balance endpoint');
    const wallet = makeWallet({
      fetchBalance: jest.fn().mockRejectedValue(failure),
    });
    await renderProvider();

    await act(async () => {
      await latestCtx.addAndSaveWallet(wallet);
      await Promise.resolve();
    });

    expect(console.warn).toHaveBeenCalledWith('addAndSaveWallet: fetchBalance failed', failure);
    expect(BlueApp.wallets).toEqual([wallet]);
    expect(A).toHaveBeenCalledWith(A.ENUM.CREATED_WALLET);
  });

  it('toggles hideBalance and persists each new value', async () => {
    await renderProvider();

    await act(async () => {
      latestCtx.toggleHideBalance();
    });
    expect(latestCtx.hideBalance).toBe(true);
    expect(BlueApp.setIsHideBalanceEnabled).toHaveBeenCalledWith(true);

    await act(async () => {
      latestCtx.toggleHideBalance();
    });
    expect(latestCtx.hideBalance).toBe(false);
    expect(BlueApp.setIsHideBalanceEnabled).toHaveBeenCalledWith(false);
  });

  it('exposes setters for selectedWallet, walletsInitialized, electrum-disabled and tx-update status', async () => {
    await renderProvider();

    await act(async () => {
      latestCtx.setSelectedWallet('w-1');
      latestCtx.setWalletsInitialized(true);
      latestCtx.setIsElectrumDisabled(false);
      latestCtx.setWalletTransactionUpdateStatus('w-1');
    });

    expect(latestCtx.selectedWallet).toBe('w-1');
    expect(latestCtx.walletsInitialized).toBe(true);
    expect(latestCtx.isElectrumDisabled).toBe(false);
    expect(latestCtx.walletTransactionUpdateStatus).toBe('w-1');
  });
});
