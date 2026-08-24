import React, { useState, useCallback } from 'react';
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { ActivityIndicator, Alert, I18nManager, InteractionManager, Platform } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockReactFlags = { hideTotalWallet: false, deactivateWalletRows: false };
jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return {
    ...actual,
    useMemo: (fn, deps) => {
      const value = actual.useMemo(fn, deps);
      if (mockReactFlags.hideTotalWallet && value && typeof value.getLabel === 'function') {
        try {
          if (value.getLabel() === require('../../loc').default.wallets.total) {
            return null;
          }
        } catch (e) {
          // wallet objects without a working getLabel stay untouched
        }
      }
      if (
        mockReactFlags.deactivateWalletRows &&
        Array.isArray(value) &&
        value.length === 3 &&
        value.every(item => item && item.title === 'Bitcoin')
      ) {
        return value.map(item => ({ ...item, wallet: null, isActivated: false }));
      }
      return value;
    },
  };
});

jest.mock('../../blue_modules/BlueElectrum', () => ({ connectMain: jest.fn() }));
jest.mock('../../blue_modules/currency', () => ({
  init: jest.fn(),
  preferredFiatCurrency: { endPointKey: 'USD' },
  BitcoinUnit: { BTC: 'BTC', SATS: 'sats' },
  satoshiToLocalCurrency: () => '0',
  satoshiToBTC: v => String(v),
}));
jest.mock('react-native-haptic-feedback', () => ({ trigger: jest.fn() }));
jest.mock('../../components/DfxServicesButtons', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  return function DfxServicesButtons() {
    return ReactModule.createElement(View, { testID: 'DfxServicesButtons' });
  };
});
const mockScanQr = jest.fn().mockResolvedValue('');
jest.mock('../../helpers/scan-qr', () => (...args) => mockScanQr(...args));
const mockIsBoltcard = jest.fn(() => false);
jest.mock('../../class/boltcard', () => ({
  isPossiblyBoltcardTapDetails: (...args) => mockIsBoltcard(...args),
}));
const mockIsPsbt = jest.fn(() => false);
const mockIsBoth = jest.fn(() => false);
const mockIsLnUrl = jest.fn(() => false);
const mockNavigationRouteFor = jest.fn();
const mockBothOnSelect = jest.fn(() => ['SendDetailsRoot', { screen: 'SendDetails' }]);
jest.mock('../../class/deeplink-schema-match', () => ({
  isPossiblyPSBTString: (...args) => mockIsPsbt(...args),
  isBothBitcoinAndLightning: (...args) => mockIsBoth(...args),
  isLnUrl: (...args) => mockIsLnUrl(...args),
  navigationRouteFor: (...args) => mockNavigationRouteFor(...args),
  isBothBitcoinAndLightningOnWalletSelect: (...args) => mockBothOnSelect(...args),
}));
jest.mock('../../hooks/usePrivateText', () => ({ usePrivateText: () => text => text }));
const mockGetClipboardContent = jest.fn().mockResolvedValue('');
jest.mock('../../blue_modules/clipboard', () => () => ({
  getClipboardContent: (...args) => mockGetClipboardContent(...args),
}));
const mockShowImagePicker = jest.fn().mockResolvedValue('photo-payload');
jest.mock('../../blue_modules/fs', () => ({
  showImagePickerAndReadImage: (...args) => mockShowImagePicker(...args),
}));
const mockShowActionSheet = jest.fn();
jest.mock('../../screen/ActionSheet', () => ({
  showActionSheetWithOptions: (...args) => mockShowActionSheet(...args),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../components/TransactionsNavigationHeader', () => {
  const ReactModule = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');
  function TransactionsNavigationHeader({ onWalletChange, wallet }) {
    return ReactModule.createElement(
      View,
      { testID: 'TransactionsNavigationHeader' },
      ReactModule.createElement(Text, { testID: 'HeaderBalance' }, String(wallet && wallet.balance)),
      ReactModule.createElement(TouchableOpacity, {
        testID: 'HeaderWalletChange',
        accessibilityRole: 'button',
        onPress: () =>
          onWalletChange &&
          onWalletChange({
            getPreferredBalanceUnit: () => 'sats',
            preferredBalanceUnit: 'sats',
            hideBalance: true,
          }),
      }),
    );
  }
  TransactionsNavigationHeader.propTypes = { onWalletChange: require('prop-types').func, wallet: require('prop-types').any };
  return TransactionsNavigationHeader;
});

const mockNavigate = jest.fn();
const mockSetParams = jest.fn();
const mockRoute = { name: 'WalletTransactions', params: {} };
let mockIsFocused = true;
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useRoute: () => mockRoute,
    useNavigation: () => ({ navigate: mockNavigate, setParams: mockSetParams }),
    useTheme: () => require('../../components/themes').BlueDarkTheme,
    useIsFocused: () => mockIsFocused,
  };
});

const mockConnect = jest.fn();
const mockDisconnect = jest.fn(() => Promise.resolve());
const mockSync = jest.fn(() => Promise.resolve());
const mockIsConnected = jest.fn(() => false);
const mockRequireSdk = jest.fn();

jest.mock('../../api/spark/spark-sdk', () => {
  class SparkSessionStaleError extends Error {
    constructor() {
      super('Spark session is no longer the one this call started with');
      this.name = 'SparkSessionStaleError';
    }
  }
  return {
    connectSparkSdk: (...args) => mockConnect(...args),
    disconnectSparkSdk: (...args) => mockDisconnect(...args),
    syncSparkWallet: (...args) => mockSync(...args),
    isSparkSdkConnected: (...args) => mockIsConnected(...args),
    SparkSessionStaleError,
    acquireSparkSessionLease: () => ({
      identity: 'pk-home-1',
      requireSdk: () => mockRequireSdk(),
    }),
    BREEZ_API_KEY_MISSING: 'BREEZ_API_KEY is not configured...',
  };
});

const WalletHome = require('../../screen/wallets/home').default;
const { BlueStorageContext } = require('../../blue_modules/storage-context');
const { SparkContextProvider } = require('../../api/spark/contexts/spark.context');
const { SparkWallet } = require('../../class/wallets/spark-wallet');
const { LightningLdsWallet } = require('../../class/wallets/lightning-lds-wallet');
const loc = require('../../loc').default;
const BlueApp = require('../../BlueApp');
const AppStorage = BlueApp.AppStorage;
const { __resetOutgoingPaymentForTests } = require('../../api/spark/outgoing-payment');
const Haptic = require('react-native-haptic-feedback');
const { BlueDarkTheme } = require('../../components/themes');

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const mockSdk = {
  getInfo: jest.fn().mockResolvedValue({ identityPubkey: 'pk-home-1', balanceSats: 0n }),
  getLightningAddress: jest.fn().mockResolvedValue({ lightningAddress: 'spark@breez.blitz' }),
  listPayments: jest.fn().mockResolvedValue({ payments: [] }),
};

function makeOnChain(id = 'onchain-1') {
  return {
    type: 'HDsegwitBech32',
    getID: () => id,
    getBalance: () => 0,
    getPreferredBalanceUnit: () => 'BTC',
    preferredBalanceUnit: 'BTC',
    hideBalance: false,
    allowRBF: () => true,
    allowReceive: () => true,
    allowSend: () => true,
    getUserHasBackedUpSeed: () => true,
    getSecret: () => MNEMONIC,
  };
}

function makeLds(id = 'lds-1', balance = 50) {
  return {
    type: LightningLdsWallet.type,
    getID: () => id,
    getBalance: () => balance,
    getPreferredBalanceUnit: () => 'sats',
    preferredBalanceUnit: 'sats',
    hideBalance: false,
    allowRBF: () => false,
    allowReceive: () => true,
    allowSend: () => true,
    getUserHasBackedUpSeed: () => true,
    isPosMode: false,
  };
}

function makeSpark(id = 'spark-1', balance = 0) {
  const w = SparkWallet.create('pk-home-1');
  w.getID = () => id;
  w.balance = balance;
  w.fetchBalance = jest.fn().mockResolvedValue(undefined);
  w.fetchTransactions = jest.fn().mockResolvedValue(undefined);
  w.fetchUserInvoices = jest.fn().mockResolvedValue(undefined);
  return w;
}

function makeMultisig(id = 'msig-1') {
  return {
    type: 'HDmultisig',
    getID: () => id,
    getBalance: () => 0,
    getPreferredBalanceUnit: () => 'BTC',
    preferredBalanceUnit: 'BTC',
    hideBalance: false,
    allowRBF: () => false,
    allowReceive: () => true,
    allowSend: () => true,
    getUserHasBackedUpSeed: () => true,
    howManySignaturesCanWeMake: () => 1,
  };
}

function HomeHarness(props) {
  const initialWallets = props.initialWallets;
  const [wallets, setWallets] = useState(initialWallets);
  const addAndSaveWallet = useCallback(async w => {
    setWallets(prev => [...prev, w]);
  }, []);
  const value = {
    wallets,
    walletsInitialized: true,
    saveToDisk: props.saveToDisk || jest.fn().mockResolvedValue(undefined),
    setSelectedWallet: props.setSelectedWallet || jest.fn(),
    revalidateBalancesInterval: props.revalidateBalancesInterval || jest.fn(),
    addAndSaveWallet,
  };
  return (
    <BlueStorageContext.Provider value={value}>
      <SparkContextProvider>
        <WalletHome navigation={{ navigate: mockNavigate }} />
      </SparkContextProvider>
    </BlueStorageContext.Provider>
  );
}
// Test harness — eslint react/prop-types is on for tests/.
HomeHarness.propTypes = {
  initialWallets: require('prop-types').array.isRequired,
  saveToDisk: require('prop-types').func,
  setSelectedWallet: require('prop-types').func,
  revalidateBalancesInterval: require('prop-types').func,
};

function renderHome(initialWallets) {
  return render(<HomeHarness initialWallets={initialWallets} />);
}

/** Multisig row has the first Add; Lightning is the last Add when both are empty. */
function pressLightningAdd(screen) {
  const adds = screen.getAllByText(loc._.add);
  fireEvent.press(adds[adds.length - 1]);
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetOutgoingPaymentForTests();
  mockDisconnect.mockImplementation(() => Promise.resolve());
  mockSync.mockImplementation(() => Promise.resolve());
  mockIsConnected.mockReturnValue(false);
  mockConnect.mockImplementation(async () => {
    mockIsConnected.mockReturnValue(true);
    return mockSdk;
  });
  mockRequireSdk.mockReturnValue(mockSdk);
  mockSdk.getInfo.mockResolvedValue({ identityPubkey: 'pk-home-1', balanceSats: 0n });
  mockSdk.getLightningAddress.mockResolvedValue({ lightningAddress: 'spark@breez.blitz' });
  mockSdk.listPayments.mockResolvedValue({ payments: [] });
  mockScanQr.mockResolvedValue('');
  mockIsBoltcard.mockReturnValue(false);
  mockIsPsbt.mockReturnValue(false);
  mockIsBoth.mockReturnValue(false);
  mockIsLnUrl.mockReturnValue(false);
  mockNavigationRouteFor.mockReset();
  mockBothOnSelect.mockReturnValue(['SendDetailsRoot', { screen: 'SendDetails' }]);
  mockGetClipboardContent.mockResolvedValue('');
  mockShowImagePicker.mockResolvedValue('photo-payload');
  mockShowActionSheet.mockReset();
  mockReactFlags.hideTotalWallet = false;
  mockReactFlags.deactivateWalletRows = false;
  mockIsFocused = true;
  mockRoute.params = {};
  mockRoute.name = 'WalletTransactions';
  Platform.OS = 'ios';
  I18nManager.isRTL = false;
});

describe('home screen Spark Lightning add path (render)', () => {
  it('creates a Spark wallet in place: spinner while creating, then Lightning (Spark)', async () => {
    let resolveConnect;
    mockConnect.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveConnect = () => {
            mockIsConnected.mockReturnValue(true);
            resolve(mockSdk);
          };
        }),
    );

    const screen = renderHome([makeOnChain()]);
    await waitFor(() => expect(screen.getByText(loc.wallets.lightning_wallet_label)).toBeTruthy());
    expect(screen.queryByText(loc.wallets.lightning_spark_wallet_label)).toBeNull();

    await act(async () => {
      pressLightningAdd(screen);
    });

    await waitFor(() => {
      expect(screen.UNSAFE_queryAllByType(ActivityIndicator).length).toBeGreaterThan(0);
    });

    await act(async () => {
      resolveConnect();
    });

    await waitFor(() => {
      expect(screen.getByText(loc.wallets.lightning_spark_wallet_label)).toBeTruthy();
    });

    const navToAddLightning = mockNavigate.mock.calls.some(
      call => (call[0] === 'WalletsRoot' && call[1]?.screen === 'AddLightning') || call[0] === 'AddLightning',
    );
    assert.strictEqual(navToAddLightning, false);
    expect(mockConnect).toHaveBeenCalled();
  });

  it('does not navigate to AddLightning when the Lightning add is pressed', async () => {
    let resolveConnect;
    mockConnect.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveConnect = () => {
            mockIsConnected.mockReturnValue(true);
            resolve(mockSdk);
          };
        }),
    );
    const screen = renderHome([makeOnChain()]);
    await waitFor(() => expect(screen.getByText(loc.wallets.lightning_wallet_label)).toBeTruthy());

    await act(async () => {
      pressLightningAdd(screen);
    });

    await waitFor(() => {
      expect(screen.UNSAFE_queryAllByType(ActivityIndicator).length).toBeGreaterThan(0);
    });
    await act(async () => {
      resolveConnect();
    });
    await waitFor(() => {
      expect(screen.getByText(loc.wallets.lightning_spark_wallet_label)).toBeTruthy();
    });
    const navToAddLightning = mockNavigate.mock.calls.some(
      call => (call[0] === 'WalletsRoot' && call[1]?.screen === 'AddLightning') || call[0] === 'AddLightning',
    );
    assert.strictEqual(navToAddLightning, false);
  });

  it('leaves existing lightningLdsWallet users on LDS without creating Spark', async () => {
    const screen = renderHome([makeOnChain(), makeLds()]);
    await waitFor(() => expect(screen.getByText(loc.wallets.lightning_wallet_label)).toBeTruthy());
    expect(screen.queryByText(loc.wallets.lightning_spark_wallet_label)).toBeNull();

    // Multisig empty → one add; lightning has LDS → no lightning add.
    expect(screen.queryAllByText(loc._.add).length).toBe(1);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('prefers LDS over Spark when both exist', async () => {
    const lds = makeLds('lds-both', 99);
    const spark = makeSpark('spark-both', 1);
    // already connected so the stored-Spark effect does not race
    mockIsConnected.mockReturnValue(true);
    const screen = renderHome([makeOnChain(), spark, lds]);
    await waitFor(() => expect(screen.getByText(loc.wallets.lightning_wallet_label)).toBeTruthy());
    expect(screen.queryByText(loc.wallets.lightning_spark_wallet_label)).toBeNull();
  });

  it('shows an alert on create failure, persists nothing, and leaves the row usable', async () => {
    mockConnect.mockRejectedValue(new Error('spark connect failed'));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const screen = renderHome([makeOnChain()]);
    await waitFor(() => expect(screen.getByText(loc.wallets.lightning_wallet_label)).toBeTruthy());

    await act(async () => {
      pressLightningAdd(screen);
    });

    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(String(alert.mock.calls[0][1])).toBe(loc.formatString(loc.wallets.lightning_spark_generic_error, { kind: 'Error' }));
    expect(String(alert.mock.calls[0][1])).not.toMatch(/spark connect failed/);
    expect(screen.queryByText(loc.wallets.lightning_spark_wallet_label)).toBeNull();
    expect(screen.getByText(loc.wallets.lightning_wallet_label)).toBeTruthy();
    expect(screen.getAllByText(loc._.add).length).toBeGreaterThanOrEqual(1);

    // Row remains operable: another press triggers create again.
    await act(async () => {
      pressLightningAdd(screen);
    });
    await waitFor(() => expect(mockConnect.mock.calls.length).toBeGreaterThanOrEqual(2));

    alert.mockRestore();
  });
});

describe('BlueApp deserializes Spark without LNDHub init', () => {
  const realmStub = {
    close() {},
    write() {},
    objectForPrimaryKey() {
      return {};
    },
    objects() {
      return {
        filtered() {
          return [];
        },
      };
    },
  };

  beforeEach(() => {
    // This file's suite-level clearAllMocks leaves Realm.open and AsyncStorage
    // methods as empty mocks; restore the same persist behaviour storage.test.js relies on.
    require('realm').open.mockImplementation(() => realmStub);
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    const store = AsyncStorage.__INTERNAL_MOCK_STORAGE__;
    AsyncStorage.setItem.mockImplementation(async (key, value) => {
      store[key] = value;
      return null;
    });
    AsyncStorage.getItem.mockImplementation(async key => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null));
  });

  afterEach(() => {
    delete SparkWallet.prototype.setBaseURI;
    delete SparkWallet.prototype.init;
  });

  it('loads a serialized Spark wallet as SparkWallet and does not run LNDHub setup', async () => {
    const spark = SparkWallet.create('pk-disk-1', 'spark@breez.blitz');
    spark.setLabel('spark-saved');
    spark.balance = 42;
    spark.sourceWalletId = 'hd-disk-binding';
    spark.sourceWalletLabel = 'On-chain saved';

    const Storage = new AppStorage();
    Storage.wallets.push(spark);
    await Storage.saveToDisk();

    const setBaseURI = jest.fn();
    const init = jest.fn();
    SparkWallet.prototype.setBaseURI = setBaseURI;
    SparkWallet.prototype.init = init;

    const Storage2 = new AppStorage();
    const loadResult = await Storage2.loadFromDisk();
    assert.ok(loadResult);
    assert.strictEqual(Storage2.wallets.length, 1);
    const restored = Storage2.wallets[0];
    assert.ok(restored instanceof SparkWallet);
    assert.strictEqual(restored.type, SparkWallet.type);
    assert.strictEqual(restored.identityPubkey, 'pk-disk-1');
    assert.strictEqual(restored.lnAddress, 'spark@breez.blitz');
    assert.strictEqual(restored.getLabel(), 'spark-saved');
    assert.strictEqual(restored.getBalance(), 42);
    assert.strictEqual(restored.getSecret(), '');
    assert.strictEqual(restored.sourceWalletId, 'hd-disk-binding');
    assert.strictEqual(restored.sourceWalletLabel, 'On-chain saved');
    assert.strictEqual(setBaseURI.mock.calls.length, 0);
    assert.strictEqual(init.mock.calls.length, 0);
  });
});

describe('loc keys for Spark label', () => {
  const repoRoot = path.join(__dirname, '..', '..');
  for (const locale of ['en', 'de', 'fr', 'it']) {
    it(`${locale}.json defines lightning_spark_wallet_label`, () => {
      const json = JSON.parse(fs.readFileSync(path.join(repoRoot, `loc/${locale}.json`), 'utf8'));
      assert.strictEqual(json.wallets.lightning_spark_wallet_label, 'Lightning (Spark)');
      assert.ok(json.wallets.lightning_spark_source_missing.includes('{label}'));
      assert.ok(json.wallets.lightning_spark_address_unavailable);
      assert.ok(json.wallets.lightning_wallet_label);
      assert.notStrictEqual(json.wallets.lightning_wallet_label, json.wallets.lightning_spark_wallet_label);
    });
  }
});

describe('home screen wallet rows and receive/send', () => {
  it('opens the on-chain wallet asset from the main wallet row', async () => {
    const screen = renderHome([makeOnChain('onchain-row')]);
    await waitFor(() => expect(screen.getByText(loc.wallets.main_wallet_label)).toBeTruthy());
    fireEvent.press(screen.getByText(loc.wallets.main_wallet_label));
    expect(mockNavigate).toHaveBeenCalledWith('WalletsRoot', {
      screen: 'WalletAsset',
      params: { walletID: 'onchain-row' },
    });
  });

  it('opens add-multisig from the empty Bitcoin row', async () => {
    const screen = renderHome([makeOnChain()]);
    await waitFor(() => expect(screen.getAllByText(loc._.add).length).toBeGreaterThan(0));
    fireEvent.press(screen.getAllByText(loc._.add)[0]);
    expect(mockNavigate).toHaveBeenCalledWith('WalletsRoot', {
      screen: 'WalletsAddMultisig',
      params: { walletLabel: loc.multisig.default_label },
    });
  });

  it('labels a stored Spark wallet as Lightning (Spark)', async () => {
    mockIsConnected.mockReturnValue(true);
    const screen = renderHome([makeOnChain(), makeSpark('spark-stored', 1)]);
    await waitFor(() => expect(screen.getByText(loc.wallets.lightning_spark_wallet_label)).toBeTruthy());
    expect(screen.queryByText(loc.wallets.lightning_wallet_label)).toBeNull();
  });

  it('excludes dummy wallets from the header total', async () => {
    const real = makeOnChain('onchain-real');
    real.getBalance = () => 10;
    const dummy = makeOnChain('dummy-1');
    dummy.isDummy = true;
    dummy.getBalance = () => 999;
    const screen = renderHome([real, dummy]);
    await waitFor(() => expect(screen.getByTestId('HeaderBalance')).toBeTruthy());
    expect(screen.getByTestId('HeaderBalance').props.children).toBe('10');
  });

  it('opens ReceiveDetails for an on-chain-only home', async () => {
    const screen = renderHome([makeOnChain('onchain-recv')]);
    await waitFor(() => expect(screen.getByTestId('ReceiveButton')).toBeTruthy());
    fireEvent.press(screen.getByTestId('ReceiveButton'));
    expect(mockNavigate).toHaveBeenCalledWith('ReceiveDetailsRoot', {
      screen: 'ReceiveDetails',
      params: { walletID: 'onchain-recv' },
    });
  });

  it('opens ReceiveDetails for the multisig wallet when one exists', async () => {
    const screen = renderHome([makeOnChain('onchain-msig'), makeMultisig('msig-recv')]);
    await waitFor(() => expect(screen.getByTestId('ReceiveButton')).toBeTruthy());
    fireEvent.press(screen.getByTestId('ReceiveButton'));
    expect(mockNavigate).toHaveBeenCalledWith('ReceiveDetailsRoot', {
      screen: 'ReceiveDetails',
      params: { walletID: 'msig-recv' },
    });
  });

  it('opens LNDReceive for an LDS wallet that is not in POS mode', async () => {
    const lds = makeLds('lds-recv');
    lds.isPosMode = false;
    const screen = renderHome([makeOnChain(), lds]);
    await waitFor(() => expect(screen.getByTestId('ReceiveButton')).toBeTruthy());
    fireEvent.press(screen.getByTestId('ReceiveButton'));
    expect(mockNavigate).toHaveBeenCalledWith('ReceiveDetailsRoot', {
      screen: 'LNDReceive',
      params: { walletID: 'lds-recv' },
    });
  });

  it('opens PosReceive for an LDS wallet in POS mode', async () => {
    const lds = makeLds('lds-pos');
    lds.isPosMode = true;
    const screen = renderHome([makeOnChain(), lds]);
    await waitFor(() => expect(screen.getByTestId('ReceiveButton')).toBeTruthy());
    fireEvent.press(screen.getByTestId('ReceiveButton'));
    expect(mockNavigate).toHaveBeenCalledWith('ReceiveDetailsRoot', {
      screen: 'PosReceive',
      params: { walletID: 'lds-pos' },
    });
  });

  it('opens ScanCodeSend from the send button', async () => {
    const screen = renderHome([makeOnChain('onchain-send')]);
    await waitFor(() => expect(screen.getByTestId('SendButton')).toBeTruthy());
    fireEvent.press(screen.getByTestId('SendButton'));
    expect(mockNavigate).toHaveBeenCalledWith('ScanCodeSendRoot', {
      screen: 'ScanCodeSend',
      params: { walletID: 'onchain-send' },
    });
  });

  it('hides the receive button when the first wallet does not allow receive', async () => {
    const w = makeOnChain();
    w.allowReceive = () => false;
    const screen = renderHome([w]);
    await waitFor(() => expect(screen.getByText(loc.wallets.main_wallet_label)).toBeTruthy());
    expect(screen.queryByTestId('ReceiveButton')).toBeNull();
  });

  it('hides the send button when the first wallet cannot send and is not watch-only HD', async () => {
    const w = makeOnChain();
    w.allowSend = () => false;
    const screen = renderHome([w]);
    await waitFor(() => expect(screen.getByText(loc.wallets.main_wallet_label)).toBeTruthy());
    expect(screen.queryByTestId('SendButton')).toBeNull();
  });

  it('shows the send button for a watch-only HD first wallet even when allowSend is false', async () => {
    const w = makeOnChain('wo-hd');
    w.type = 'watchOnly';
    w.allowSend = () => false;
    w.isHd = () => true;
    const screen = renderHome([w]);
    await waitFor(() => expect(screen.getByTestId('SendButton')).toBeTruthy());
  });
});

describe('home screen scan and barcode', () => {
  it('does not navigate when the scan helper returns an empty value', async () => {
    mockScanQr.mockResolvedValue('');
    const screen = renderHome([makeOnChain()]);
    await waitFor(() => expect(screen.getByText(loc.send.details_scan)).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByText(loc.send.details_scan));
    });
    expect(mockScanQr).toHaveBeenCalledWith(mockNavigate, 'WalletTransactions', false);
    expect(mockNavigate).not.toHaveBeenCalledWith('TappedCardDetails', expect.anything());
  });

  it('opens TappedCardDetails when the payload looks like boltcard tap details', async () => {
    mockIsBoltcard.mockReturnValue(true);
    mockScanQr.mockResolvedValue('boltcard-payload');
    const screen = renderHome([makeOnChain()]);
    await waitFor(() => expect(screen.getByText(loc.send.details_scan)).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByText(loc.send.details_scan));
    });
    expect(mockNavigate).toHaveBeenCalledWith('TappedCardDetails', { tappedCardDetails: 'boltcard-payload' });
  });

  it('imports a valid PSBT into the multisig signer when that wallet can sign', async () => {
    const bitcoin = require('bitcoinjs-lib');
    const psbtBase64 = new bitcoin.Psbt().toBase64();
    mockIsPsbt.mockReturnValue(true);
    mockScanQr.mockResolvedValue(psbtBase64);
    const screen = renderHome([makeOnChain(), makeMultisig('msig-psbt')]);
    await waitFor(() => expect(screen.getByText(loc.send.details_scan)).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByText(loc.send.details_scan));
    });
    expect(mockNavigate).toHaveBeenCalledWith('SendDetailsRoot', {
      screen: 'PsbtMultisig',
      params: { psbtBase64, walletID: 'msig-psbt' },
    });
  });

  it('parses a valid PSBT but does not navigate when no multisig wallet exists', async () => {
    const bitcoin = require('bitcoinjs-lib');
    mockIsPsbt.mockReturnValue(true);
    mockScanQr.mockResolvedValue(new bitcoin.Psbt().toBase64());
    const screen = renderHome([makeOnChain()]);
    await waitFor(() => expect(screen.getByText(loc.send.details_scan)).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByText(loc.send.details_scan));
    });
    expect(mockNavigate).not.toHaveBeenCalledWith('SendDetailsRoot', expect.objectContaining({ screen: 'PsbtMultisig' }));
  });

  it('does not import a valid PSBT when the multisig wallet cannot sign', async () => {
    const bitcoin = require('bitcoinjs-lib');
    const psbtBase64 = new bitcoin.Psbt().toBase64();
    mockIsPsbt.mockReturnValue(true);
    mockScanQr.mockResolvedValue(psbtBase64);
    const msig = makeMultisig('msig-zero');
    msig.howManySignaturesCanWeMake = () => 0;
    const screen = renderHome([makeOnChain(), msig]);
    await waitFor(() => expect(screen.getByText(loc.send.details_scan)).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByText(loc.send.details_scan));
    });
    expect(mockNavigate).not.toHaveBeenCalledWith('SendDetailsRoot', expect.objectContaining({ screen: 'PsbtMultisig' }));
  });

  it('swallows an invalid PSBT payload', async () => {
    mockIsPsbt.mockReturnValue(true);
    mockScanQr.mockResolvedValue('not-a-psbt');
    const screen = renderHome([makeOnChain(), makeMultisig('msig-bad')]);
    await waitFor(() => expect(screen.getByText(loc.send.details_scan)).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByText(loc.send.details_scan));
    });
    expect(mockNavigate).not.toHaveBeenCalledWith('SendDetailsRoot', expect.objectContaining({ screen: 'PsbtMultisig' }));
  });

  it('routes a combined bitcoin+lightning payload through the on-chain wallet when no lightning wallet exists', async () => {
    mockIsBoth.mockReturnValue({ bitcoin: 'bitcoin:addr', lndInvoice: 'lnbc1' });
    mockBothOnSelect.mockReturnValue(['SendDetailsRoot', { screen: 'SendDetails', params: { uri: 'bitcoin:addr' } }]);
    mockScanQr.mockResolvedValue('combined-onchain');
    const screen = renderHome([makeOnChain('onchain-both')]);
    await waitFor(() => expect(screen.getByText(loc.send.details_scan)).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByText(loc.send.details_scan));
    });
    expect(mockBothOnSelect.mock.calls[0][0].getID()).toBe('onchain-both');
    expect(mockNavigate).toHaveBeenCalledWith('SendDetailsRoot', { screen: 'SendDetails', params: { uri: 'bitcoin:addr' } });
  });

  it('routes a combined bitcoin+lightning payload through the lightning wallet when present', async () => {
    mockIsBoth.mockReturnValue({ bitcoin: 'bitcoin:addr', lndInvoice: 'lnbc1' });
    mockBothOnSelect.mockReturnValue(['SendDetailsRoot', { screen: 'ScanLndInvoice', params: { uri: 'lnbc1' } }]);
    mockScanQr.mockResolvedValue('bitcoin:addr&lightning=lnbc1');
    const lds = makeLds('lds-both-scan');
    const screen = renderHome([makeOnChain(), lds]);
    await waitFor(() => expect(screen.getByText(loc.send.details_scan)).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByText(loc.send.details_scan));
    });
    expect(mockBothOnSelect).toHaveBeenCalled();
    expect(Haptic.trigger).toHaveBeenCalledWith('impactLight', { ignoreAndroidSystemSettings: false });
    expect(mockNavigate).toHaveBeenCalledWith('SendDetailsRoot', { screen: 'ScanLndInvoice', params: { uri: 'lnbc1' } });
  });

  it('forwards an LNURL to LnurlNavigationForwarder with the first wallet id', async () => {
    mockIsLnUrl.mockReturnValue(true);
    mockScanQr.mockResolvedValue('LNURL1HOME');
    const screen = renderHome([makeOnChain('onchain-lnurl')]);
    await waitFor(() => expect(screen.getByText(loc.send.details_scan)).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByText(loc.send.details_scan));
    });
    expect(mockNavigate).toHaveBeenCalledWith('SendDetailsRoot', {
      screen: 'LnurlNavigationForwarder',
      params: { lnurl: 'LNURL1HOME', walletID: 'onchain-lnurl' },
    });
  });

  it('hands an unmatched payload to navigationRouteFor and navigates with the completion route', async () => {
    mockNavigationRouteFor.mockImplementation((_event, completion) => {
      completion(['SendDetailsRoot', { screen: 'SendDetails', params: { uri: 'bc1qhome' } }]);
    });
    mockScanQr.mockResolvedValue('bc1qhome');
    const screen = renderHome([makeOnChain()]);
    await waitFor(() => expect(screen.getByText(loc.send.details_scan)).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByText(loc.send.details_scan));
    });
    expect(mockNavigationRouteFor).toHaveBeenCalledWith({ url: 'bc1qhome' }, expect.any(Function));
    expect(Haptic.trigger).toHaveBeenCalledWith('impactLight', { ignoreAndroidSystemSettings: false });
    expect(mockNavigate).toHaveBeenCalledWith('SendDetailsRoot', { screen: 'SendDetails', params: { uri: 'bc1qhome' } });
  });
});

describe('home screen send long-press action sheet', () => {
  it('offers choose-photo, scan and clipboard on iOS when the clipboard has content', async () => {
    mockGetClipboardContent.mockResolvedValue('  clipboard-qr  ');
    const screen = renderHome([makeOnChain()]);
    await waitFor(() => expect(screen.getByTestId('SendButton')).toBeTruthy());
    await act(async () => {
      fireEvent(screen.getByTestId('SendButton'), 'onLongPress');
    });
    expect(mockShowActionSheet).toHaveBeenCalled();
    const [opts, callback] = mockShowActionSheet.mock.calls[0];
    expect(opts.options).toEqual([loc._.cancel, loc.wallets.list_long_choose, loc.wallets.list_long_scan, loc.wallets.list_long_clipboard]);

    const photoIndex = 1;
    const scanIndex = 2;
    const clipboardIndex = 3;
    await act(async () => {
      callback(photoIndex);
    });
    expect(mockShowImagePicker).toHaveBeenCalled();

    await act(async () => {
      callback(scanIndex);
    });
    expect(mockNavigate).toHaveBeenCalledWith('ScanQRCodeRoot', {
      screen: 'ScanQRCode',
      params: {
        launchedBy: 'WalletTransactions',
        onBarScanned: expect.any(Function),
        showFileImportButton: false,
      },
    });

    mockIsBoltcard.mockReturnValue(true);
    mockGetClipboardContent.mockResolvedValue('clip-bolt');
    await act(async () => {
      callback(clipboardIndex);
    });
    expect(mockNavigate).toHaveBeenCalledWith('TappedCardDetails', { tappedCardDetails: 'clip-bolt' });
  });

  it('omits the clipboard row on iOS when the clipboard is empty', async () => {
    mockGetClipboardContent.mockResolvedValue('   ');
    const screen = renderHome([makeOnChain()]);
    await waitFor(() => expect(screen.getByTestId('SendButton')).toBeTruthy());
    await act(async () => {
      fireEvent(screen.getByTestId('SendButton'), 'onLongPress');
    });
    const [opts, callback] = mockShowActionSheet.mock.calls[0];
    expect(opts.options).toEqual([loc._.cancel, loc.wallets.list_long_choose, loc.wallets.list_long_scan]);
    const cancelIndex = 0;
    await act(async () => {
      callback(cancelIndex);
    });
    expect(mockShowImagePicker).not.toHaveBeenCalled();
  });

  it('runs choose, scan, cancel and clipboard from the Android action sheet', async () => {
    Platform.OS = 'android';
    mockGetClipboardContent.mockResolvedValue('android-clip');
    mockIsLnUrl.mockReturnValue(true);
    const screen = renderHome([makeOnChain('android-home')]);
    await waitFor(() => expect(screen.getByTestId('SendButton')).toBeTruthy());
    await act(async () => {
      fireEvent(screen.getByTestId('SendButton'), 'onLongPress');
    });
    const [opts] = mockShowActionSheet.mock.calls[0];
    expect(opts.buttons.map(b => b.text)).toEqual([
      loc._.cancel,
      loc.wallets.list_long_choose,
      loc.wallets.list_long_scan,
      loc.wallets.list_long_clipboard,
    ]);
    await act(async () => {
      opts.buttons[0].onPress();
    });
    await act(async () => {
      opts.buttons[1].onPress();
    });
    expect(mockShowImagePicker).toHaveBeenCalled();
    await act(async () => {
      opts.buttons[2].onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('ScanQRCodeRoot', expect.objectContaining({ screen: 'ScanQRCode' }));
    await act(async () => {
      opts.buttons[3].onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('SendDetailsRoot', {
      screen: 'LnurlNavigationForwarder',
      params: { lnurl: 'android-clip', walletID: 'android-home' },
    });
  });

  it('omits the clipboard button on Android when the clipboard is empty', async () => {
    Platform.OS = 'android';
    mockGetClipboardContent.mockResolvedValue('');
    const screen = renderHome([makeOnChain()]);
    await waitFor(() => expect(screen.getByTestId('SendButton')).toBeTruthy());
    await act(async () => {
      fireEvent(screen.getByTestId('SendButton'), 'onLongPress');
    });
    const [opts] = mockShowActionSheet.mock.calls[0];
    expect(opts.buttons.map(b => b.text)).toEqual([loc._.cancel, loc.wallets.list_long_choose, loc.wallets.list_long_scan]);
  });

  it('does not show an action sheet on a platform that is neither ios nor android', async () => {
    Platform.OS = 'web';
    const screen = renderHome([makeOnChain()]);
    await waitFor(() => expect(screen.getByTestId('SendButton')).toBeTruthy());
    await act(async () => {
      fireEvent(screen.getByTestId('SendButton'), 'onLongPress');
    });
    expect(mockShowActionSheet).not.toHaveBeenCalled();
  });
});

describe('home screen Android chrome and backup seed', () => {
  it('opens BackupExplanation from the warning backup button', async () => {
    Platform.OS = 'android';
    mockRoute.params = { showsBackupSeed: true, backupWarning: true };
    const screen = renderHome([makeOnChain()]);
    await waitFor(() => expect(screen.getByTestId('backupSeed')).toBeTruthy());
    expect(screen.getByText(loc.wallets.backupSeedWarning)).toBeTruthy();
    fireEvent.press(screen.getByTestId('backupSeed'));
    expect(mockNavigate).toHaveBeenCalledWith('BackupSeedRoot', { screenName: 'BackupExplanation' });
  });

  it('opens BackupExplanation from the non-warning backup button', async () => {
    Platform.OS = 'android';
    mockRoute.params = { showsBackupSeed: true, backupWarning: false };
    const screen = renderHome([makeOnChain()]);
    await waitFor(() => expect(screen.getByTestId('backupSeed')).toBeTruthy());
    expect(screen.getByText(loc.wallets.backupSeed)).toBeTruthy();
    fireEvent.press(screen.getByTestId('backupSeed'));
    expect(mockNavigate).toHaveBeenCalledWith('BackupSeedRoot', { screenName: 'BackupExplanation' });
  });

  it('hides the backup button when showsBackupSeed is not set', async () => {
    Platform.OS = 'android';
    mockRoute.params = {};
    const screen = renderHome([makeOnChain()]);
    await waitFor(() => expect(screen.getByTestId('Settings')).toBeTruthy());
    expect(screen.queryByTestId('backupSeed')).toBeNull();
  });

  it('opens Settings from the in-page header', async () => {
    Platform.OS = 'android';
    const screen = renderHome([makeOnChain()]);
    await waitFor(() => expect(screen.getByTestId('Settings')).toBeTruthy());
    fireEvent.press(screen.getByTestId('Settings'));
    expect(mockNavigate).toHaveBeenCalledWith('Settings');
  });
});

describe('home screen setParams, focus and header wallet change', () => {
  it('asks the navigator to show a backup warning when the seed is unbacked and the total is positive', async () => {
    const w = makeOnChain('onchain-backup');
    w.getUserHasBackedUpSeed = () => false;
    w.getBalance = () => 15;
    renderHome([w]);
    await waitFor(() =>
      expect(mockSetParams).toHaveBeenCalledWith({
        walletID: 'onchain-backup',
        showsBackupSeed: true,
        backupWarning: true,
      }),
    );
  });

  it('asks the navigator to hide the backup chip when the seed is already backed up and the total is zero', async () => {
    const w = makeOnChain('onchain-backed');
    w.getUserHasBackedUpSeed = () => true;
    w.getBalance = () => 0;
    renderHome([w]);
    await waitFor(() =>
      expect(mockSetParams).toHaveBeenCalledWith({
        walletID: 'onchain-backed',
        showsBackupSeed: false,
        backupWarning: false,
      }),
    );
  });

  it('revalidates balances while the screen is focused', async () => {
    mockIsFocused = true;
    const revalidateBalancesInterval = jest.fn();
    const screen = render(<HomeHarness initialWallets={[makeOnChain()]} revalidateBalancesInterval={revalidateBalancesInterval} />);
    await waitFor(() => expect(screen.getByText(loc.wallets.main_wallet_label)).toBeTruthy());
    expect(revalidateBalancesInterval).toHaveBeenCalled();
    screen.unmount();
  });

  it('does not revalidate balances while the screen is not focused', async () => {
    mockIsFocused = false;
    const revalidateBalancesInterval = jest.fn();
    const screen = render(<HomeHarness initialWallets={[makeOnChain()]} revalidateBalancesInterval={revalidateBalancesInterval} />);
    await waitFor(() => expect(screen.getByText(loc.wallets.main_wallet_label)).toBeTruthy());
    expect(revalidateBalancesInterval).not.toHaveBeenCalled();
    screen.unmount();
  });

  it('writes preferred unit and hide-balance from the header onto every wallet', async () => {
    jest.spyOn(InteractionManager, 'runAfterInteractions').mockImplementation(cb => {
      cb();
      return { then: fn => fn(), done: jest.fn(), cancel: jest.fn() };
    });
    const saveToDisk = jest.fn().mockResolvedValue(undefined);
    const w1 = makeOnChain('onchain-unit');
    const w2 = makeLds('lds-unit');
    const screen = render(<HomeHarness initialWallets={[w1, w2]} saveToDisk={saveToDisk} />);
    await waitFor(() => expect(screen.getByTestId('HeaderWalletChange')).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByTestId('HeaderWalletChange'));
    });
    await waitFor(() => expect(saveToDisk).toHaveBeenCalled());
    expect(w1.preferredBalanceUnit).toBe('sats');
    expect(w1.hideBalance).toBe(true);
    expect(w2.preferredBalanceUnit).toBe('sats');
    expect(w2.hideBalance).toBe(true);
  });

  it('selects the first wallet on mount', async () => {
    const setSelectedWallet = jest.fn();
    render(<HomeHarness initialWallets={[makeOnChain('sel-home')]} setSelectedWallet={setSelectedWallet} />);
    await waitFor(() => expect(setSelectedWallet).toHaveBeenCalledWith('sel-home'));
  });

  it('skips writing backup params when the aggregated total wallet is missing', async () => {
    mockReactFlags.hideTotalWallet = true;
    const screen = renderHome([makeOnChain('no-total')]);
    await waitFor(() => expect(screen.getByText(loc.wallets.main_wallet_label)).toBeTruthy());
    expect(mockSetParams).not.toHaveBeenCalled();
    screen.unmount();
  });

  it('shows Coming soon on dummy rows whose activation flag is off', async () => {
    mockReactFlags.deactivateWalletRows = true;
    const screen = renderHome([makeOnChain('coming-soon')]);
    await waitFor(() => expect(screen.getAllByText(loc.wallets.coming_soon).length).toBe(3));
    screen.unmount();
  });
});

describe('home screen navigationOptions', () => {
  it('hides the native header on Android', () => {
    const previous = Platform.OS;
    Platform.OS = 'android';
    try {
      const options = WalletHome.navigationOptions(BlueDarkTheme)({
        navigation: { navigate: mockNavigate },
        route: { params: {} },
      });
      expect(options.headerShown).toBe(false);
      expect(options.gestureEnabled).toBe(false);
    } finally {
      Platform.OS = previous;
    }
  });

  it('opens BackupExplanation from the iOS header when backup is warned', () => {
    Platform.OS = 'ios';
    const options = WalletHome.navigationOptions(BlueDarkTheme)({
      navigation: { navigate: mockNavigate },
      route: { params: { showsBackupSeed: true, backupWarning: true } },
    });
    const left = render(options.headerLeft());
    expect(left.getByText(loc.wallets.backupSeedWarning)).toBeTruthy();
    fireEvent.press(left.getByTestId('backupSeed'));
    expect(mockNavigate).toHaveBeenCalledWith('BackupSeedRoot', { screenName: 'BackupExplanation' });
    left.unmount();
  });

  it('opens BackupExplanation from the iOS header when backup is not warned', () => {
    Platform.OS = 'ios';
    const options = WalletHome.navigationOptions(BlueDarkTheme)({
      navigation: { navigate: mockNavigate },
      route: { params: { showsBackupSeed: true, backupWarning: false } },
    });
    const left = render(options.headerLeft());
    expect(left.getByText(loc.wallets.backupSeed)).toBeTruthy();
    fireEvent.press(left.getByTestId('backupSeed'));
    expect(mockNavigate).toHaveBeenCalledWith('BackupSeedRoot', { screenName: 'BackupExplanation' });
    left.unmount();
  });

  it('renders no iOS backup header when showsBackupSeed is not set', () => {
    Platform.OS = 'ios';
    const options = WalletHome.navigationOptions(BlueDarkTheme)({
      navigation: { navigate: mockNavigate },
      route: { params: {} },
    });
    expect(options.headerLeft()).toBeNull();
  });

  it('opens Settings from the iOS header', () => {
    Platform.OS = 'ios';
    const options = WalletHome.navigationOptions(BlueDarkTheme)({
      navigation: { navigate: mockNavigate },
      route: { params: {} },
    });
    const right = render(options.headerRight());
    fireEvent.press(right.getByTestId('Settings'));
    expect(mockNavigate).toHaveBeenCalledWith('Settings');
    right.unmount();
  });
});

describe('home screen module-level branches', () => {
  it('loads with a window whose width/26 is at most 22', () => {
    let loaded;
    jest.isolateModules(() => {
      const RN = require('react-native');
      const spy = jest.spyOn(RN.Dimensions, 'get').mockReturnValue({ width: 260, height: 800, scale: 1, fontScale: 1 });
      try {
        loaded = require('../../screen/wallets/home').default;
      } finally {
        spy.mockRestore();
      }
    });
    expect(typeof loaded).toBe('function');
  });

  it('loads with a window whose width/26 is above 22', () => {
    let loaded;
    jest.isolateModules(() => {
      const RN = require('react-native');
      const spy = jest.spyOn(RN.Dimensions, 'get').mockReturnValue({ width: 2000, height: 800, scale: 1, fontScale: 1 });
      try {
        loaded = require('../../screen/wallets/home').default;
      } finally {
        spy.mockRestore();
      }
    });
    expect(typeof loaded).toBe('function');
  });

  it('loads with RTL writing direction', () => {
    let loaded;
    jest.isolateModules(() => {
      require('react-native').I18nManager.isRTL = true;
      loaded = require('../../screen/wallets/home').default;
      require('react-native').I18nManager.isRTL = false;
    });
    expect(typeof loaded).toBe('function');
  });
});

