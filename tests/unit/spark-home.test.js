import React, { useState, useCallback } from 'react';
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { ActivityIndicator, Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

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
jest.mock('../../components/TransactionsNavigationHeader', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  return function TransactionsNavigationHeader() {
    return ReactModule.createElement(View, { testID: 'TransactionsNavigationHeader' });
  };
});
jest.mock('../../helpers/scan-qr', () => jest.fn());
jest.mock('../../class/boltcard', () => ({ isPossiblyBoltcardTapDetails: () => false }));
jest.mock('../../class/deeplink-schema-match', () => ({
  isPossiblyPSBTString: () => false,
  isBothBitcoinAndLightning: () => false,
  isLnUrl: () => false,
  navigationRouteFor: () => {},
}));
jest.mock('../../hooks/usePrivateText', () => ({ usePrivateText: () => text => text }));
jest.mock('../../blue_modules/clipboard', () => () => ({ getClipboardContent: jest.fn().mockResolvedValue('') }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockNavigate = jest.fn();
const mockSetParams = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useRoute: () => ({ name: 'WalletTransactions', params: {} }),
    useNavigation: () => ({ navigate: mockNavigate, setParams: mockSetParams }),
    useTheme: () => require('../../components/themes').BlueDarkTheme,
    useIsFocused: () => true,
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

function HomeHarness(props) {
  const initialWallets = props.initialWallets;
  const [wallets, setWallets] = useState(initialWallets);
  const addAndSaveWallet = useCallback(async w => {
    setWallets(prev => [...prev, w]);
  }, []);
  const value = {
    wallets,
    walletsInitialized: true,
    saveToDisk: jest.fn().mockResolvedValue(undefined),
    setSelectedWallet: jest.fn(),
    revalidateBalancesInterval: jest.fn(),
    addAndSaveWallet,
  };
  return (
    <BlueStorageContext.Provider value={value}>
      <SparkContextProvider>
        <WalletHome navigation={{}} />
      </SparkContextProvider>
    </BlueStorageContext.Provider>
  );
}
// Test harness only — no prop-types for the temporary wrapper.
HomeHarness.propTypes = {
  initialWallets: require('prop-types').array.isRequired,
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
    const screen = renderHome([makeOnChain()]);
    await waitFor(() => expect(screen.getByText(loc.wallets.lightning_wallet_label)).toBeTruthy());

    await act(async () => {
      pressLightningAdd(screen);
    });
    await waitFor(() => expect(mockConnect).toHaveBeenCalled());

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
    assert.strictEqual(setBaseURI.mock.calls.length, 0);
    assert.strictEqual(init.mock.calls.length, 0);
  });
});

describe('details screen includes Spark in the connected-to block', () => {
  const repoRoot = path.join(__dirname, '..', '..');
  const source = fs.readFileSync(path.join(repoRoot, 'screen/wallets/details.js'), 'utf8');

  it('lists SparkWallet alongside LNDHub types at the connection info check', () => {
    assert.ok(source.includes('SparkWallet.type'), 'expected Spark type in details');
    assert.ok(
      source.includes('LightningCustodianWallet.type, LightningLdsWallet.type, SparkWallet.type') || source.includes('SparkWallet.type]'),
      'expected Spark in the connected-to type list',
    );
  });

  it('keeps POS and boltcard checks LNDHub-only', () => {
    const posMatches = source.match(/showPosModeOptions && wallet\.type === LightningLdsWallet\.type/g) || [];
    assert.ok(posMatches.length >= 2, 'expected POS checks to remain LDS-only');
    assert.ok(source.includes('[LightningLdsWallet.type].includes(wallet.type) && wallet.getBoltcard()'), 'boltcard remains LDS-only');
  });
});

describe('loc keys for Spark label', () => {
  const repoRoot = path.join(__dirname, '..', '..');
  for (const locale of ['en', 'de', 'fr', 'it']) {
    it(`${locale}.json defines lightning_spark_wallet_label`, () => {
      const json = JSON.parse(fs.readFileSync(path.join(repoRoot, `loc/${locale}.json`), 'utf8'));
      assert.strictEqual(json.wallets.lightning_spark_wallet_label, 'Lightning (Spark)');
      assert.ok(json.wallets.lightning_wallet_label);
      assert.notStrictEqual(json.wallets.lightning_wallet_label, json.wallets.lightning_spark_wallet_label);
    });
  }
});
