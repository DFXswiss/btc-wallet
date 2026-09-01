import React from 'react';
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { ActivityIndicator } from 'react-native';
import { fireEvent, render, act, waitFor } from '@testing-library/react-native';
import { PaymentDetails_Tags, PaymentStatus, PaymentType } from '@breeztech/breez-sdk-spark-react-native';

jest.mock('../../blue_modules/BlueElectrum', () => ({ connectMain: jest.fn() }));
jest.mock('../../blue_modules/currency', () => ({
  init: jest.fn(),
  mostRecentFetchedRate: jest.fn(() => Promise.resolve({})),
  isRateOutdated: jest.fn(() => Promise.resolve(false)),
  updateExchangeRate: jest.fn(() => Promise.resolve()),
  fiatToBTC: jest.fn(() => 0),
  btcToSatoshi: jest.fn(v => Math.round(Number(v) * 1e8)),
  satoshiToBTC: jest.fn(() => 0),
  getCurrencySymbol: jest.fn(() => '$'),
  satoshiToLocalCurrency: () => '0',
  preferredFiatCurrency: { endPointKey: 'USD' },
}));
jest.mock('../../blue_modules/notifications', () => ({
  majorTomToGroundControl: jest.fn(),
  tryToObtainPermissions: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../hooks/nfc.hook', () => {
  const startReading = jest.fn();
  const stopReading = jest.fn();
  const state = { isNfcActive: false };
  return {
    useNFC: () => ({
      get isNfcActive() {
        return state.isNfcActive;
      },
      startReading,
      stopReading,
    }),
    __nfc: { startReading, stopReading, state },
  };
});
jest.mock('../../components/QRCodeComponent', () => {
  const RN = require('react');
  const { Text, View } = require('react-native');
  const QRCodeComponent = ({ value }) => {
    return value ? RN.createElement(View, { testID: 'QRCode' }) : RN.createElement(Text, { testID: 'QRCode' }, 'this is a QR code');
  };
  QRCodeComponent.propTypes = { value: require('prop-types').string };
  return QRCodeComponent;
});
jest.mock('../../screen/send/success', () => {
  const RN = require('react');
  const { Text } = require('react-native');
  /* eslint-disable react/prop-types */
  const SuccessView = ({ amount }) =>
    RN.createElement(Text, { testID: 'SuccessView' }, amount == null ? 'paid' : String(amount));
  /* eslint-enable react/prop-types */
  return { SuccessView };
});
jest.mock('../../helpers/errors', () => ({ reportError: jest.fn() }));
jest.mock('react-native-haptic-feedback', () => ({ trigger: jest.fn() }));

jest.mock('../../BlueComponents', () => {
  const React = require('react');
  const { TouchableOpacity, View } = require('react-native');
  const actual = jest.requireActual('../../BlueComponents');
  /* eslint-disable react/prop-types */
  function BlueWalletSelect({ wallets, value, onChange }) {
    return React.createElement(
      View,
      { testID: 'WalletSelect' },
      React.createElement(TouchableOpacity, {
        testID: 'WalletSelectSame',
        accessibilityRole: 'button',
        onPress: () => {
          global.__walletSelectResult = onChange(value);
        },
      }),
      React.createElement(TouchableOpacity, {
        testID: 'WalletSelectMissing',
        accessibilityRole: 'button',
        onPress: () => {
          global.__walletSelectResult = onChange('missing-wallet-id');
        },
      }),
      wallets.map(w =>
        React.createElement(TouchableOpacity, {
          key: w.getID(),
          testID: `WalletSelect-${w.getID()}`,
          accessibilityRole: 'button',
          onPress: () => {
            global.__walletSelectResult = onChange(w.getID());
          },
        }),
      ),
    );
  }
  /* eslint-enable react/prop-types */
  return { ...actual, BlueWalletSelect };
});

const mockSetParams = jest.fn();
const mockPopToTop = jest.fn();
const mockPop = jest.fn();
const mockGetParent = jest.fn(() => ({ popToTop: mockPopToTop, pop: mockPop }));
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockReplace = jest.fn();
const mockRouteParams = { walletID: 'spark-receive-1' };
jest.mock('@react-navigation/native', () => {
  const RN = require('react');
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useRoute: () => ({ params: mockRouteParams }),
    useNavigation: () => ({
      setParams: mockSetParams,
      getParent: mockGetParent,
      navigate: mockNavigate,
      goBack: mockGoBack,
      replace: mockReplace,
    }),
    useTheme: () => require('../../components/themes').BlueDarkTheme,
    useFocusEffect: cb => {
      RN.useEffect(() => {
        const cleanup = cb();
        return typeof cleanup === 'function' ? cleanup : undefined;
      }, [cb]);
    },
  };
});

const mockSdk = {
  getInfo: jest.fn(),
  listPayments: jest.fn(),
  receivePayment: jest.fn(),
  prepareSendPayment: jest.fn(),
  sendPayment: jest.fn(),
  getLightningAddress: jest.fn(),
};

jest.mock('../../api/spark/spark-sdk', () => ({
  isSparkSdkConnected: () => true,
  SparkSessionStaleError: class SparkSessionStaleError extends Error {
    constructor() {
      super('Spark session is no longer the one this call started with');
      this.name = 'SparkSessionStaleError';
    }
  },
  acquireSparkSessionLease: () => ({
    identity: 'pk-receive-1',
    requireSdk: () => mockSdk,
  }),
}));

const SAMPLE_INVOICE =
  'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp';

const LNDReceive = require('../../screen/lnd/lndReceive').default;
const LNDCreateInvoice = require('../../screen/lnd/lndCreateInvoice').default;
const { SparkWallet } = require('../../class/wallets/spark-wallet');
const { LightningLdsWallet } = require('../../class/wallets/lightning-lds-wallet');
const { BitcoinUnit, Chain } = require('../../models/bitcoinUnits');
const { BlueStorageContext } = require('../../blue_modules/storage-context');
const loc = require('../../loc').default;
const { formatBalance } = require('../../loc');
const { reportError } = require('../../helpers/errors');
const { __nfc } = require('../../hooks/nfc.hook');
const { Platform, Image, Keyboard, TouchableWithoutFeedback, Alert, Modal } = require('react-native');
const Share = require('react-native-share');
const Lnurl = require('../../class/lnurl').default;
const haptic = require('react-native-haptic-feedback');
const NavigationService = require('../../NavigationService');
const AmountInput = require('../../components/AmountInput').default;
const { majorTomToGroundControl, tryToObtainPermissions } = require('../../blue_modules/notifications');
const BoltCard = require('../../class/boltcard').default;
const { BlueDarkTheme } = require('../../components/themes');

function paidUserInvoice() {
  return {
    payment_request: SAMPLE_INVOICE,
    ispaid: true,
    description: 'coffee',
    timestamp: 1700000000,
    expire_time: 3600,
  };
}

function paidPayment() {
  return {
    id: 'recv-1',
    paymentType: PaymentType.Receive,
    status: PaymentStatus.Completed,
    amount: 1000n,
    fees: 0n,
    timestamp: 1700000000n,
    method: {},
    details: {
      tag: PaymentDetails_Tags.Lightning,
      inner: { description: 'coffee', invoice: SAMPLE_INVOICE, destinationPubkey: 'x', htlcDetails: {} },
    },
  };
}

function makeSparkReceiveWallet(id) {
  const wallet = SparkWallet.create('pk-receive-1');
  wallet.getID = () => id;
  wallet.lnAddress = 'spark@test';
  wallet.setLabel('Spark');
  return wallet;
}

function makeLdsReceiveWallet(id) {
  return {
    type: LightningLdsWallet.type,
    chain: Chain.OFFCHAIN,
    lnAddress: 'lds@test',
    isPosMode: false,
    getID: () => id,
    getLabel: () => 'Lightning',
    getLnurl: () => 'lnurl',
    addInvoice: jest.fn().mockResolvedValue(SAMPLE_INVOICE),
    decodeInvoice: jest.fn().mockResolvedValue({ payment_hash: 'hash' }),
    getUserInvoices: jest.fn().mockResolvedValue([]),
  };
}

function renderReceive(wallet) {
  mockRouteParams.walletID = wallet.getID();
  return render(
    <BlueStorageContext.Provider
      value={{
        wallets: [wallet],
        saveToDisk: jest.fn().mockResolvedValue(undefined),
        setSelectedWallet: jest.fn(),
        fetchAndSaveWalletTransactions: jest.fn(),
      }}
    >
      <LNDReceive />
    </BlueStorageContext.Provider>,
  );
}

function renderCreateInvoiceScreen(wallet, extra = {}) {
  const { wallets, saveToDisk, setSelectedWallet, ...routeParams } = extra;
  mockRouteParams.walletID = wallet ? wallet.getID() : extra.walletID;
  Object.assign(mockRouteParams, routeParams);
  return render(
    <BlueStorageContext.Provider
      value={{
        wallets: wallets || (wallet ? [wallet] : []),
        saveToDisk: saveToDisk || jest.fn().mockResolvedValue(undefined),
        setSelectedWallet: setSelectedWallet || jest.fn(),
      }}
    >
      <LNDCreateInvoice />
    </BlueStorageContext.Provider>,
  );
}

async function createInvoice(screen) {
  fireEvent.changeText(screen.getByPlaceholderText('Amount (optional)'), '1000');
  fireEvent(screen.getByPlaceholderText('Amount (optional)'), 'blur');
  await act(async () => {
    await Promise.resolve();
  });
}

const realSetTimeout = global.setTimeout.bind(global);
const realClearTimeout = global.clearTimeout.bind(global);
const realSetInterval = global.setInterval.bind(global);
const realClearInterval = global.clearInterval.bind(global);

const invoiceTimers = {
  now: 0,
  nextHandle: 1,
  timeouts: [],
  intervals: [],
};

function restoreInvoiceTimers() {
  if (global.setTimeout.mockRestore) global.setTimeout.mockRestore();
  if (global.clearTimeout.mockRestore) global.clearTimeout.mockRestore();
  if (global.setInterval.mockRestore) global.setInterval.mockRestore();
  if (global.clearInterval.mockRestore) global.clearInterval.mockRestore();
  invoiceTimers.timeouts = [];
  invoiceTimers.intervals = [];
  invoiceTimers.now = 0;
  invoiceTimers.nextHandle = 1;
}

function installInvoiceTimers() {
  restoreInvoiceTimers();
  jest.spyOn(global, 'setTimeout').mockImplementation((cb, ms = 0, ...args) => {
    if (typeof cb !== 'function' || ms !== 1000) {
      return realSetTimeout(cb, ms, ...args);
    }
    const handle = invoiceTimers.nextHandle++;
    invoiceTimers.timeouts.push({ handle, cb, ms, args, due: invoiceTimers.now + ms });
    return handle;
  });
  jest.spyOn(global, 'clearTimeout').mockImplementation(handle => {
    const before = invoiceTimers.timeouts.length;
    invoiceTimers.timeouts = invoiceTimers.timeouts.filter(t => t.handle !== handle);
    if (invoiceTimers.timeouts.length === before) {
      return realClearTimeout(handle);
    }
  });
  jest.spyOn(global, 'setInterval').mockImplementation((cb, ms = 0, ...args) => {
    if (typeof cb !== 'function' || ms !== 3000) {
      return realSetInterval(cb, ms, ...args);
    }
    const handle = invoiceTimers.nextHandle++;
    invoiceTimers.intervals.push({ handle, cb, ms, args, due: invoiceTimers.now + ms });
    return handle;
  });
  jest.spyOn(global, 'clearInterval').mockImplementation(handle => {
    const before = invoiceTimers.intervals.length;
    invoiceTimers.intervals = invoiceTimers.intervals.filter(t => t.handle !== handle);
    if (invoiceTimers.intervals.length === before) {
      return realClearInterval(handle);
    }
  });
}

function invoiceIntervalCount() {
  return invoiceTimers.intervals.length;
}

async function advanceTimers(ms) {
  const target = invoiceTimers.now + ms;
  await act(async () => {
    let steps = 0;
    while (steps < 100) {
      steps += 1;
      const dueTimeouts = invoiceTimers.timeouts.filter(t => t.due <= target);
      const dueIntervals = invoiceTimers.intervals.filter(t => t.due <= target);
      if (dueTimeouts.length === 0 && dueIntervals.length === 0) {
        break;
      }
      invoiceTimers.now = Math.min(...dueTimeouts.concat(dueIntervals).map(t => t.due));
      for (const t of dueTimeouts) {
        invoiceTimers.timeouts = invoiceTimers.timeouts.filter(x => x.handle !== t.handle);
        t.cb(...t.args);
      }
      for (const t of dueIntervals) {
        t.due += t.ms;
        t.cb(...t.args);
      }
      await Promise.resolve();
      await Promise.resolve();
    }
    invoiceTimers.now = target;
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function assertUnmountClearsInvoicePollTimeout(wallet, getUserInvoices) {
  const screen = renderReceive(wallet);
  await createInvoice(screen);

  const timeoutHandles = invoiceTimers.timeouts.filter(t => t.ms === 1000);
  assert.strictEqual(timeoutHandles.length, 1, 'expected exactly one 1000ms timeout after creating an invoice');

  screen.unmount();

  assert.strictEqual(invoiceTimers.timeouts.filter(t => t.ms === 1000).length, 0);
  assert.strictEqual(invoiceIntervalCount(), 0);

  await advanceTimers(4000);

  assert.strictEqual(invoiceIntervalCount(), 0);
  expect(getUserInvoices).not.toHaveBeenCalled();
}

describe('LNDReceive with SparkWallet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installInvoiceTimers();
    __nfc.state.isNfcActive = false;
    global.__walletSelectResult = undefined;
    mockRouteParams.walletID = 'spark-receive-1';
    mockSdk.receivePayment.mockResolvedValue({ paymentRequest: SAMPLE_INVOICE, fee: 0n });
    mockSdk.listPayments.mockResolvedValue({ payments: [] });
    Share.open.mockReset();
    Share.open.mockResolvedValue({});
  });

  afterEach(() => {
    restoreInvoiceTimers();
  });

  it('starts invoice polling after creating a Spark invoice and marks it paid', async () => {
    const wallet = SparkWallet.create('pk-receive-1');
    wallet.getID = () => 'spark-receive-1';
    wallet.lnAddress = 'spark@test';
    wallet.setLabel('Spark');

    const saveToDisk = jest.fn().mockResolvedValue(undefined);
    const fetchAndSaveWalletTransactions = jest.fn();
    const setSelectedWallet = jest.fn();

    const screen = render(
      <BlueStorageContext.Provider
        value={{
          wallets: [wallet],
          saveToDisk,
          setSelectedWallet,
          fetchAndSaveWalletTransactions,
        }}
      >
        <LNDReceive />
      </BlueStorageContext.Provider>,
    );

    fireEvent.changeText(screen.getByPlaceholderText('Amount (optional)'), '1000');
    fireEvent(screen.getByPlaceholderText('Amount (optional)'), 'blur');

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockSdk.receivePayment).toHaveBeenCalled();

    await advanceTimers(1000);
    expect(mockSdk.listPayments).toHaveBeenCalled();

    mockSdk.listPayments.mockResolvedValue({ payments: [paidPayment()] });

    await advanceTimers(3000);

    expect(screen.getByTestId('SuccessView')).toBeTruthy();
    expect(screen.getByText(loc.send.success_done)).toBeTruthy();
    expect(fetchAndSaveWalletTransactions).toHaveBeenCalledWith('spark-receive-1');
    assert.ok(typeof wallet.getUserInvoices === 'function');
  });

  it('shows the invoice amount on success even if the editor was changed after creating it', async () => {
    const wallet = makeSparkReceiveWallet('spark-receive-1');
    const screen = renderReceive(wallet);
    await createInvoice(screen);
    fireEvent.changeText(screen.getByPlaceholderText('Amount (optional)'), '2000');
    await advanceTimers(1000);
    mockSdk.listPayments.mockResolvedValue({ payments: [paidPayment()] });
    await advanceTimers(3000);

    expect(screen.getByTestId('SuccessView')).toBeTruthy();
    expect(screen.getByText('1000')).toBeTruthy();
    expect(screen.queryByText('2000')).toBeNull();
    expect(screen.getByText(loc.send.success_done)).toBeTruthy();
    screen.unmount();
  });

  it('keeps watching the Lightning invoice after switching to on-chain and shows success when it is paid', async () => {
    const wallet = makeSparkReceiveWallet('spark-receive-1');
    wallet.depositAddress = 'bc1qtestonchain';
    const screen = renderReceive(wallet);
    await createInvoice(screen);
    await advanceTimers(1000);
    assert.strictEqual(invoiceIntervalCount(), 1);
    fireEvent.press(screen.getByTestId('SparkReceiveOnchain'));
    expect(screen.getByText('bc1qtestonchain')).toBeTruthy();
    assert.strictEqual(invoiceIntervalCount(), 1);

    mockSdk.listPayments.mockResolvedValue({ payments: [paidPayment()] });
    await advanceTimers(3000);

    expect(screen.getByTestId('SuccessView')).toBeTruthy();
    expect(screen.getByText('1000')).toBeTruthy();
    expect(screen.getByText(loc.send.success_done)).toBeTruthy();
    screen.unmount();
  });

  it('rebuilds the Lightning invoice when returning from on-chain with an amount', async () => {
    const wallet = makeSparkReceiveWallet('spark-receive-1');
    wallet.depositAddress = 'bc1qtestonchain';
    const screen = renderReceive(wallet);
    await createInvoice(screen);
    expect(mockSdk.receivePayment).toHaveBeenCalledTimes(1);
    expect(screen.getByText(SAMPLE_INVOICE)).toBeTruthy();

    fireEvent.press(screen.getByTestId('SparkReceiveOnchain'));
    expect(screen.getByText('bc1qtestonchain')).toBeTruthy();

    fireEvent.press(screen.getByTestId('SparkReceiveLightning'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockSdk.receivePayment).toHaveBeenCalledTimes(2);
    expect(screen.getByText(SAMPLE_INVOICE)).toBeTruthy();
    expect(screen.queryByText('spark@test')).toBeNull();
    screen.unmount();
  });

  it('does not create another invoice when the Lightning tab is pressed while already selected', async () => {
    const wallet = makeSparkReceiveWallet('spark-receive-1');
    const screen = renderReceive(wallet);
    await createInvoice(screen);
    expect(mockSdk.receivePayment).toHaveBeenCalledTimes(1);
    expect(screen.getByText(SAMPLE_INVOICE)).toBeTruthy();

    fireEvent.press(screen.getByTestId('SparkReceiveLightning'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockSdk.receivePayment).toHaveBeenCalledTimes(1);
    expect(screen.getByText(SAMPLE_INVOICE)).toBeTruthy();
    screen.unmount();
  });

  it('does not create an invoice when returning to Lightning with no amount', async () => {
    const wallet = makeSparkReceiveWallet('spark-receive-1');
    wallet.depositAddress = 'bc1qtestonchain';
    const screen = renderReceive(wallet);
    expect(screen.getByText('spark@test')).toBeTruthy();

    fireEvent.press(screen.getByTestId('SparkReceiveOnchain'));
    fireEvent.press(screen.getByTestId('SparkReceiveLightning'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockSdk.receivePayment).not.toHaveBeenCalled();
    expect(screen.getByText('spark@test')).toBeTruthy();
    screen.unmount();
  });

  it('stops invoice polling when the receive amount is cleared', async () => {
    const wallet = makeSparkReceiveWallet('spark-receive-1');
    const screen = renderReceive(wallet);
    await createInvoice(screen);
    await advanceTimers(1000);
    assert.strictEqual(invoiceIntervalCount(), 1);
    fireEvent.changeText(screen.getByPlaceholderText('Amount (optional)'), '');
    fireEvent(screen.getByPlaceholderText('Amount (optional)'), 'blur');
    await act(async () => {
      await Promise.resolve();
    });
    assert.strictEqual(invoiceIntervalCount(), 0);
    screen.unmount();
  });

  it('hides Use Boltcard for Spark and keeps it for an LNDHub invoice', async () => {
    const sparkScreen = renderReceive(makeSparkReceiveWallet('spark-receive-1'));
    await createInvoice(sparkScreen);
    expect(sparkScreen.queryByText('Use Boltcard')).toBeNull();
    sparkScreen.unmount();

    const ldsScreen = renderReceive(makeLdsReceiveWallet('lds-receive-1'));
    await createInvoice(ldsScreen);
    expect(ldsScreen.getByText('Use Boltcard')).toBeTruthy();
  });

  it('does not start the NFC reader for a Spark wallet on Android', async () => {
    const previousOS = Platform.OS;
    Platform.OS = 'android';
    try {
      const wallet = makeSparkReceiveWallet('spark-receive-nfc');
      const screen = renderReceive(wallet);
      await createInvoice(screen);
      await waitFor(() => expect(mockSdk.receivePayment).toHaveBeenCalled());
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(__nfc.startReading).not.toHaveBeenCalled();
      screen.unmount();
    } finally {
      Platform.OS = previousOS;
    }
  });

  it('starts the NFC reader for an LDS wallet on Android', async () => {
    const previousOS = Platform.OS;
    Platform.OS = 'android';
    try {
      const wallet = makeLdsReceiveWallet('lds-receive-nfc');
      const screen = renderReceive(wallet);
      await createInvoice(screen);
      await waitFor(() => expect(wallet.addInvoice).toHaveBeenCalled());
      await waitFor(() => expect(__nfc.startReading).toHaveBeenCalledTimes(1));
      screen.unmount();
    } finally {
      Platform.OS = previousOS;
    }
  });

  it('clears the pending poll timeout on unmount so no poller starts (Spark)', async () => {
    const wallet = makeSparkReceiveWallet('spark-receive-1');
    const getUserInvoices = jest.spyOn(wallet, 'getUserInvoices');
    await assertUnmountClearsInvoicePollTimeout(wallet, getUserInvoices);
  });

  it('clears the pending poll timeout on unmount so no poller starts (LNDHub)', async () => {
    const wallet = makeLdsReceiveWallet('lds-receive-1');
    await assertUnmountClearsInvoicePollTimeout(wallet, wallet.getUserInvoices);
  });

  it('shows a missing-address state instead of a QR when Spark has no lnAddress', () => {
    const wallet = SparkWallet.create('pk-receive-1');
    wallet.getID = () => 'spark-receive-1';
    wallet.setLabel('Spark');
    assert.strictEqual(wallet.lnAddress, undefined);

    const screen = renderReceive(wallet);
    expect(screen.queryByTestId('QRCode')).toBeNull();
    expect(screen.getByText(loc.wallets.lightning_spark_address_unavailable)).toBeTruthy();
  });

  it('defines lightning_spark_address_unavailable in en, de, fr, and it', () => {
    const repoRoot = path.join(__dirname, '..', '..');
    for (const locale of ['en', 'de', 'fr', 'it']) {
      const json = JSON.parse(fs.readFileSync(path.join(repoRoot, `loc/${locale}.json`), 'utf8'));
      assert.strictEqual(typeof json.wallets.lightning_spark_address_unavailable, 'string');
      assert.ok(json.wallets.lightning_spark_address_unavailable.length > 0);
      assert.ok(json.wallets.lightning_spark_receive_lightning);
      assert.ok(json.wallets.lightning_spark_receive_onchain);
      assert.ok(json.wallets.lightning_spark_onchain_confirmations);
    }
  });

  it('does not show the Lightning/On-chain switch on an LNDHub wallet', () => {
    const screen = renderReceive(makeLdsReceiveWallet('lds-receive-1'));
    expect(screen.queryByTestId('SparkReceiveMethodSwitch')).toBeNull();
  });

  it('shows the on-chain deposit address as QR and copyable text', async () => {
    const address = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
    const wallet = makeSparkReceiveWallet('spark-receive-1');
    wallet.depositAddress = address;
    const screen = renderReceive(wallet);

    fireEvent.press(screen.getByTestId('SparkReceiveOnchain'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('QRCode')).toBeTruthy();
    expect(screen.getByText(address)).toBeTruthy();
    expect(screen.getByText(loc.wallets.lightning_spark_onchain_confirmations)).toBeTruthy();
    expect(screen.queryByPlaceholderText('Amount (optional)')).toBeNull();
    expect(mockSdk.receivePayment).not.toHaveBeenCalled();
  });

  it('loads the deposit address through the wallet when none is cached', async () => {
    const address = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
    mockSdk.receivePayment.mockResolvedValue({ paymentRequest: address, fee: 0n });
    const wallet = makeSparkReceiveWallet('spark-receive-1');
    assert.strictEqual(wallet.depositAddress, undefined);
    const screen = renderReceive(wallet);

    fireEvent.press(screen.getByTestId('SparkReceiveOnchain'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('QRCode')).toBeTruthy();
    expect(screen.getByText(address)).toBeTruthy();
    expect(mockSdk.receivePayment).toHaveBeenCalled();
    assert.strictEqual(wallet.depositAddress, address);
  });

  it('shows a missing-address state instead of a QR when the on-chain address is absent', async () => {
    mockSdk.receivePayment.mockResolvedValue({ paymentRequest: '', fee: 0n });
    const wallet = makeSparkReceiveWallet('spark-receive-1');
    const screen = renderReceive(wallet);

    fireEvent.press(screen.getByTestId('SparkReceiveOnchain'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByTestId('QRCode')).toBeNull();
    expect(screen.getByText(loc.wallets.lightning_spark_address_unavailable)).toBeTruthy();
  });

  it('clears the loading state and shows the error when addInvoice rejects', async () => {
    const wallet = makeLdsReceiveWallet('lds-receive-err');
    wallet.addInvoice.mockRejectedValue(new Error('invoice failed'));
    const alertSpy = jest.spyOn(global, 'alert').mockImplementation(() => {});

    const screen = renderReceive(wallet);
    await createInvoice(screen);
    await act(async () => {
      await Promise.resolve();
    });

    expect(alertSpy).toHaveBeenCalledWith('invoice failed');
    expect(screen.getByTestId('QRCode')).toBeTruthy();
    expect(screen.UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
    alertSpy.mockRestore();
  });

  it('reports a failing invoice poll once per generation and ignores later ticks', async () => {
    const pollError = new Error('poll failed');
    const wallet = makeLdsReceiveWallet('lds-receive-poll-err');
    wallet.getUserInvoices.mockImplementation(limit => {
      if (limit === 1) return Promise.resolve([]);
      return Promise.reject(pollError);
    });

    const screen = renderReceive(wallet);
    await createInvoice(screen);
    await advanceTimers(1000);

    for (let tick = 0; tick < 3; tick++) {
      await advanceTimers(3000);
    }

    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith('lndReceive: invoice poll failed', pollError);
    expect(wallet.getUserInvoices.mock.calls.filter(call => call[0] === 20).length).toBe(3);
    screen.unmount();
  });

  it('keeps polling after a rejected tick and still marks a later paid invoice', async () => {
    const pollError = new Error('poll failed');
    const wallet = makeLdsReceiveWallet('lds-receive-poll-recover');
    let pollTicks = 0;
    wallet.getUserInvoices.mockImplementation(limit => {
      if (limit === 1) return Promise.resolve([]);
      pollTicks += 1;
      if (pollTicks === 1) return Promise.reject(pollError);
      return Promise.resolve([paidUserInvoice()]);
    });

    const screen = renderReceive(wallet);
    await createInvoice(screen);
    await advanceTimers(1000);
    await advanceTimers(3000);

    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith('lndReceive: invoice poll failed', pollError);
    expect(screen.queryByTestId('SuccessView')).toBeNull();

    await advanceTimers(3000);

    expect(screen.getByTestId('SuccessView')).toBeTruthy();
    expect(screen.getByText(loc.send.success_done)).toBeTruthy();
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it('starts the invoice poller even when the prefetch rejects', async () => {
    const prefetchError = new Error('prefetch failed');
    const wallet = makeLdsReceiveWallet('lds-receive-prefetch-err');
    wallet.getUserInvoices.mockImplementation(limit => {
      if (limit === 1) return Promise.reject(prefetchError);
      return Promise.resolve([]);
    });
    const screen = renderReceive(wallet);
    await createInvoice(screen);
    await advanceTimers(1000);

    expect(reportError).toHaveBeenCalledWith('lndReceive: prefetch invoices failed', prefetchError);
    assert.strictEqual(invoiceIntervalCount(), 1);

    await advanceTimers(3000);
    expect(wallet.getUserInvoices).toHaveBeenCalledWith(20);
    expect(reportError).toHaveBeenCalledTimes(1);

    screen.unmount();
  });

  it('pops to the top of the parent stack from the paid Done button', async () => {
    const wallet = SparkWallet.create('pk-receive-1');
    wallet.getID = () => 'spark-receive-1';
    wallet.lnAddress = 'spark@test';
    wallet.setLabel('Spark');

    const screen = render(
      <BlueStorageContext.Provider
        value={{
          wallets: [wallet],
          saveToDisk: jest.fn().mockResolvedValue(undefined),
          setSelectedWallet: jest.fn(),
          fetchAndSaveWalletTransactions: jest.fn(),
        }}
      >
        <LNDReceive />
      </BlueStorageContext.Provider>,
    );

    fireEvent.changeText(screen.getByPlaceholderText('Amount (optional)'), '1000');
    fireEvent(screen.getByPlaceholderText('Amount (optional)'), 'blur');
    await act(async () => {
      await Promise.resolve();
    });
    await advanceTimers(1000);
    mockSdk.listPayments.mockResolvedValue({ payments: [paidPayment()] });
    await advanceTimers(3000);

    fireEvent.press(screen.getByText(loc.send.success_done));
    expect(mockPopToTop).toHaveBeenCalledTimes(1);
  });

  it('does not call popToTop when the parent navigator is missing', async () => {
    mockGetParent.mockReturnValueOnce(undefined);
    const wallet = SparkWallet.create('pk-receive-1');
    wallet.getID = () => 'spark-receive-1';
    wallet.lnAddress = 'spark@test';
    wallet.setLabel('Spark');
    const screen = renderReceive(wallet);

    fireEvent.changeText(screen.getByPlaceholderText('Amount (optional)'), '1000');
    fireEvent(screen.getByPlaceholderText('Amount (optional)'), 'blur');
    await act(async () => {
      await Promise.resolve();
    });
    await advanceTimers(1000);
    mockSdk.listPayments.mockResolvedValue({ payments: [paidPayment()] });
    await advanceTimers(3000);

    fireEvent.press(screen.getByText(loc.send.success_done));
    expect(mockPopToTop).not.toHaveBeenCalled();
  });

  it('marks an invoice paid even when the paid invoice has no description', async () => {
    const wallet = makeLdsReceiveWallet('lds-receive-nodesc');
    wallet.getUserInvoices.mockImplementation(limit => {
      if (limit === 1) return Promise.resolve([]);
      return Promise.resolve([{ ...paidUserInvoice(), description: undefined }]);
    });
    const screen = renderReceive(wallet);
    await createInvoice(screen);
    await advanceTimers(1000);
    await advanceTimers(3000);

    expect(screen.getByTestId('SuccessView')).toBeTruthy();
    expect(screen.getByText(loc.send.success_done)).toBeTruthy();
  });

  it('creates a new invoice when the polled invoice has expired', async () => {
    const wallet = makeLdsReceiveWallet('lds-receive-expired');
    let addCalls = 0;
    wallet.addInvoice.mockImplementation(async () => {
      addCalls += 1;
      return addCalls === 1 ? SAMPLE_INVOICE : 'lnbc-replacement';
    });
    wallet.getUserInvoices.mockImplementation(limit => {
      if (limit === 1) return Promise.resolve([]);
      return Promise.resolve([
        {
          payment_request: SAMPLE_INVOICE,
          ispaid: false,
          timestamp: 1,
          expire_time: 1,
        },
      ]);
    });
    const screen = renderReceive(wallet);
    await createInvoice(screen);
    await advanceTimers(1000);
    await advanceTimers(3000);
    await act(async () => {
      await Promise.resolve();
    });

    expect(wallet.addInvoice).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('SuccessView')).toBeNull();
  });

  it('ignores a poll result after the poller generation has been cancelled', async () => {
    const wallet = makeLdsReceiveWallet('lds-receive-stale-poll');
    let resolvePoll;
    wallet.getUserInvoices.mockImplementation(limit => {
      if (limit === 1) return Promise.resolve([]);
      return new Promise(resolve => {
        resolvePoll = resolve;
      });
    });
    const screen = renderReceive(wallet);
    await createInvoice(screen);
    await advanceTimers(1000);
    await advanceTimers(3000);

    screen.unmount();
    await act(async () => {
      resolvePoll([paidUserInvoice()]);
      await Promise.resolve();
    });

    expect(reportError).not.toHaveBeenCalled();
  });

  it('ignores a poll error after the poller generation has been cancelled', async () => {
    const wallet = makeLdsReceiveWallet('lds-receive-stale-err');
    let rejectPoll;
    wallet.getUserInvoices.mockImplementation(limit => {
      if (limit === 1) return Promise.resolve([]);
      return new Promise((_resolve, reject) => {
        rejectPoll = reject;
      });
    });
    const screen = renderReceive(wallet);
    await createInvoice(screen);
    await advanceTimers(1000);
    await advanceTimers(3000);

    screen.unmount();
    await act(async () => {
      rejectPoll(new Error('late poll'));
      await Promise.resolve();
    });

    expect(reportError).not.toHaveBeenCalled();
  });

  it('skips a poll tick while a previous tick is still in flight', async () => {
    const wallet = makeLdsReceiveWallet('lds-receive-overlap');
    let resolvePoll;
    let pollStarts = 0;
    wallet.getUserInvoices.mockImplementation(limit => {
      if (limit === 1) return Promise.resolve([]);
      pollStarts += 1;
      return new Promise(resolve => {
        resolvePoll = resolve;
      });
    });
    const screen = renderReceive(wallet);
    await createInvoice(screen);
    await advanceTimers(1000);
    await advanceTimers(3000);
    expect(pollStarts).toBe(1);

    await advanceTimers(3000);
    expect(pollStarts).toBe(1);

    await act(async () => {
      resolvePoll([]);
      await Promise.resolve();
    });
    await advanceTimers(3000);
    expect(pollStarts).toBe(2);
    screen.unmount();
  });

  it('ignores a prefetch that finishes after unmount', async () => {
    const wallet = makeLdsReceiveWallet('lds-receive-stale-prefetch');
    let resolvePrefetch;
    wallet.getUserInvoices.mockImplementation(limit => {
      if (limit === 1) {
        return new Promise(resolve => {
          resolvePrefetch = resolve;
        });
      }
      return Promise.resolve([]);
    });
    const screen = renderReceive(wallet);
    await createInvoice(screen);
    await advanceTimers(1000);
    screen.unmount();

    await act(async () => {
      resolvePrefetch([]);
      await Promise.resolve();
    });

    assert.strictEqual(invoiceIntervalCount(), 0);
  });

  it('creates an invoice with the typed description when the description field blurs', async () => {
    const wallet = makeLdsReceiveWallet('lds-receive-desc-blur');
    const screen = renderReceive(wallet);
    fireEvent.changeText(screen.getByPlaceholderText('Amount (optional)'), '1000');
    fireEvent.changeText(screen.getByPlaceholderText(`${loc.receive.details_label} (optional)`), 'coffee');
    fireEvent(screen.getByPlaceholderText(`${loc.receive.details_label} (optional)`), 'blur');
    await act(async () => {
      await Promise.resolve();
    });

    expect(wallet.addInvoice).toHaveBeenCalledWith(1000, 'coffee');
  });

  it('does not create an invoice when the amount is empty', async () => {
    const wallet = makeLdsReceiveWallet('lds-receive-zero');
    const screen = renderReceive(wallet);
    fireEvent(screen.getByPlaceholderText('Amount (optional)'), 'blur');
    await act(async () => {
      await Promise.resolve();
    });

    expect(wallet.addInvoice).not.toHaveBeenCalled();
    expect(screen.UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
  });

  it('does not start a second invoice create while one is already in flight', async () => {
    const wallet = makeLdsReceiveWallet('lds-receive-inflight');
    let resolveInvoice;
    wallet.addInvoice.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveInvoice = resolve;
        }),
    );
    const screen = renderReceive(wallet);
    fireEvent.changeText(screen.getByPlaceholderText('Amount (optional)'), '1000');
    fireEvent(screen.getByPlaceholderText('Amount (optional)'), 'blur');
    fireEvent.press(screen.getByText(loc.send.input_done));
    await act(async () => {
      await Promise.resolve();
    });

    expect(wallet.addInvoice).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveInvoice(SAMPLE_INVOICE);
      await Promise.resolve();
    });
  });

  it('alerts the string form of a non-Error addInvoice rejection', async () => {
    const wallet = makeLdsReceiveWallet('lds-receive-string-err');
    wallet.addInvoice.mockRejectedValue('nope');
    const alertSpy = jest.spyOn(global, 'alert').mockImplementation(() => {});
    const screen = renderReceive(wallet);
    await createInvoice(screen);
    await act(async () => {
      await Promise.resolve();
    });

    expect(alertSpy).toHaveBeenCalledWith('nope');
    alertSpy.mockRestore();
  });

  it('stops an active NFC reader before creating an invoice', async () => {
    __nfc.state.isNfcActive = true;
    const wallet = makeLdsReceiveWallet('lds-receive-nfc-stop');
    const screen = renderReceive(wallet);
    await createInvoice(screen);
    await act(async () => {
      await Promise.resolve();
    });

    expect(__nfc.stopReading).toHaveBeenCalled();
  });

  it('alerts when a Boltcard withdraw reports an error', async () => {
    const previousOS = Platform.OS;
    Platform.OS = 'android';
    const alertSpy = jest.spyOn(global, 'alert').mockImplementation(() => {});
    const widthdraw = jest.spyOn(BoltCard, 'widthdraw').mockResolvedValue({ isError: true, reason: 'card failed' });
    try {
      const wallet = makeLdsReceiveWallet('lds-receive-nfc-err');
      const screen = renderReceive(wallet);
      await createInvoice(screen);
      await waitFor(() => expect(__nfc.startReading).toHaveBeenCalledTimes(1));
      const onRead = __nfc.startReading.mock.calls[0][0];
      await act(async () => {
        await onRead('lnurlw://card.example/withdraw');
      });
      expect(widthdraw).toHaveBeenCalledWith('lnurlw://card.example/withdraw', SAMPLE_INVOICE);
      expect(alertSpy).toHaveBeenCalledWith('card failed');
      expect(__nfc.stopReading).toHaveBeenCalled();
      screen.unmount();
    } finally {
      widthdraw.mockRestore();
      alertSpy.mockRestore();
      Platform.OS = previousOS;
    }
  });

  it('does not alert when a Boltcard withdraw succeeds', async () => {
    const previousOS = Platform.OS;
    Platform.OS = 'android';
    const alertSpy = jest.spyOn(global, 'alert').mockImplementation(() => {});
    const widthdraw = jest.spyOn(BoltCard, 'widthdraw').mockResolvedValue({ isError: false, reason: undefined });
    try {
      const wallet = makeLdsReceiveWallet('lds-receive-nfc-ok');
      const screen = renderReceive(wallet);
      await createInvoice(screen);
      await waitFor(() => expect(__nfc.startReading).toHaveBeenCalledTimes(1));
      const onRead = __nfc.startReading.mock.calls[0][0];
      await act(async () => {
        await onRead('lnurlw://card.example/withdraw');
      });
      expect(widthdraw).toHaveBeenCalled();
      expect(alertSpy).not.toHaveBeenCalled();
      screen.unmount();
    } finally {
      widthdraw.mockRestore();
      alertSpy.mockRestore();
      Platform.OS = previousOS;
    }
  });

  it('ignores an NFC payload that is not a Boltcard withdraw URL', async () => {
    const previousOS = Platform.OS;
    Platform.OS = 'android';
    const alertSpy = jest.spyOn(global, 'alert').mockImplementation(() => {});
    const widthdraw = jest.spyOn(BoltCard, 'widthdraw').mockResolvedValue({ isError: false });
    try {
      const wallet = makeLdsReceiveWallet('lds-receive-nfc-skip');
      const screen = renderReceive(wallet);
      await createInvoice(screen);
      await waitFor(() => expect(__nfc.startReading).toHaveBeenCalledTimes(1));
      const onRead = __nfc.startReading.mock.calls[0][0];
      await act(async () => {
        await onRead('https://example.com/not-a-card');
      });
      expect(widthdraw).not.toHaveBeenCalled();
      expect(alertSpy).not.toHaveBeenCalled();
      screen.unmount();
    } finally {
      widthdraw.mockRestore();
      alertSpy.mockRestore();
      Platform.OS = previousOS;
    }
  });

  it('starts the iOS NFC reader from Use Boltcard and stops a previous session first', async () => {
    const wallet = makeLdsReceiveWallet('lds-receive-ios-nfc');
    const screen = renderReceive(wallet);
    await createInvoice(screen);
    expect(screen.getByText('Use Boltcard')).toBeTruthy();

    __nfc.state.isNfcActive = true;
    screen.rerender(
      <BlueStorageContext.Provider
        value={{
          wallets: [wallet],
          saveToDisk: jest.fn().mockResolvedValue(undefined),
          setSelectedWallet: jest.fn(),
          fetchAndSaveWalletTransactions: jest.fn(),
        }}
      >
        <LNDReceive />
      </BlueStorageContext.Provider>,
    );

    fireEvent.press(screen.getByText('Use Boltcard'));
    expect(__nfc.stopReading).toHaveBeenCalled();
    expect(__nfc.startReading).toHaveBeenCalledTimes(1);
  });

  it('shows the on-chain spinner while the deposit address is loading', async () => {
    const wallet = makeSparkReceiveWallet('spark-receive-1');
    let resolveAddress;
    wallet.getDepositAddress = jest.fn(
      () =>
        new Promise(resolve => {
          resolveAddress = resolve;
        }),
    );
    const screen = renderReceive(wallet);
    fireEvent.press(screen.getByTestId('SparkReceiveOnchain'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.UNSAFE_queryAllByType(ActivityIndicator).length).toBeGreaterThan(0);
    await act(async () => {
      resolveAddress('bc1qloaded');
      await Promise.resolve();
    });
    await waitFor(() => screen.getByText('bc1qloaded'));
  });

  it('does not apply a deposit address that arrives after leaving on-chain receive', async () => {
    const wallet = makeSparkReceiveWallet('spark-receive-1');
    let resolveAddress;
    wallet.getDepositAddress = jest.fn(
      () =>
        new Promise(resolve => {
          resolveAddress = resolve;
        }),
    );
    const screen = renderReceive(wallet);
    fireEvent.press(screen.getByTestId('SparkReceiveOnchain'));
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.press(screen.getByTestId('SparkReceiveLightning'));
    await act(async () => {
      resolveAddress('bc1qlate');
      await Promise.resolve();
    });

    expect(screen.queryByText('bc1qlate')).toBeNull();
    expect(screen.getByPlaceholderText('Amount (optional)')).toBeTruthy();
  });

  it('shows a missing-address state when getDepositAddress rejects', async () => {
    const wallet = makeSparkReceiveWallet('spark-receive-1');
    wallet.getDepositAddress = jest.fn().mockRejectedValue(new Error('no address'));
    const screen = renderReceive(wallet);
    fireEvent.press(screen.getByTestId('SparkReceiveOnchain'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByTestId('QRCode')).toBeNull();
    expect(screen.getByText(loc.wallets.lightning_spark_address_unavailable)).toBeTruthy();
    expect(screen.UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
  });

  it('does not apply a rejected deposit address after leaving on-chain receive', async () => {
    const wallet = makeSparkReceiveWallet('spark-receive-1');
    let rejectAddress;
    wallet.getDepositAddress = jest.fn(
      () =>
        new Promise((_resolve, reject) => {
          rejectAddress = reject;
        }),
    );
    const screen = renderReceive(wallet);
    fireEvent.press(screen.getByTestId('SparkReceiveOnchain'));
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.press(screen.getByTestId('SparkReceiveLightning'));
    await act(async () => {
      rejectAddress(new Error('late fail'));
      await Promise.resolve();
    });

    expect(screen.getByPlaceholderText('Amount (optional)')).toBeTruthy();
    expect(screen.queryByText(loc.wallets.lightning_spark_address_unavailable)).toBeNull();
  });

  it('shares the on-chain address and swallows a rejected share', async () => {
    const address = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
    const wallet = makeSparkReceiveWallet('spark-receive-1');
    wallet.depositAddress = address;
    const screen = renderReceive(wallet);
    fireEvent.press(screen.getByTestId('SparkReceiveOnchain'));
    await act(async () => {
      await Promise.resolve();
    });

    const shareIcon = screen.UNSAFE_getAllByType(Image).find(node => node.props.resizeMode === 'stretch');
    Share.open.mockRejectedValueOnce(new Error('share cancelled'));
    fireEvent.press(shareIcon.parent);
    await act(async () => {
      await Promise.resolve();
    });
    expect(Share.open).toHaveBeenCalledWith({ message: address });
  });

  it('shares an empty message when the Lightning copy text is missing', async () => {
    const wallet = makeLdsReceiveWallet('lds-receive-noshare');
    wallet.lnAddress = undefined;
    const screen = renderReceive(wallet);
    expect(screen.getByTestId('QRCode')).toBeTruthy();

    const shareIcon = screen.UNSAFE_getAllByType(Image).find(node => node.props.resizeMode === 'stretch');
    fireEvent.press(shareIcon.parent);
    await act(async () => {
      await Promise.resolve();
    });
    expect(Share.open).toHaveBeenCalledWith({ message: '' });
  });

  it('shares the invoice once one has been created', async () => {
    const wallet = makeLdsReceiveWallet('lds-receive-share-inv');
    const screen = renderReceive(wallet);
    await createInvoice(screen);
    await act(async () => {
      await Promise.resolve();
    });

    const shareIcon = screen.UNSAFE_getAllByType(Image).find(node => node.props.resizeMode === 'stretch');
    fireEvent.press(shareIcon.parent);
    await act(async () => {
      await Promise.resolve();
    });
    expect(Share.open).toHaveBeenCalledWith({ message: SAMPLE_INVOICE });
  });

  it('returns ReceiveDetails when the selected wallet is on-chain', () => {
    const spark = makeSparkReceiveWallet('spark-receive-1');
    const onchain = {
      type: 'HDsegwitBech32',
      chain: Chain.ONCHAIN,
      getID: () => 'onchain-1',
      getLabel: () => 'Onchain',
    };
    mockRouteParams.walletID = spark.getID();
    const screen = render(
      <BlueStorageContext.Provider
        value={{
          wallets: [spark, onchain],
          saveToDisk: jest.fn().mockResolvedValue(undefined),
          setSelectedWallet: jest.fn(),
          fetchAndSaveWalletTransactions: jest.fn(),
        }}
      >
        <LNDReceive />
      </BlueStorageContext.Provider>,
    );

    fireEvent.press(screen.getByTestId('WalletSelect-onchain-1'));
    expect(global.__walletSelectResult).toEqual({ name: 'ReceiveDetails', params: { walletID: 'onchain-1' } });
    expect(mockSetParams).not.toHaveBeenCalled();
  });

  it('updates the route when switching to another Lightning wallet', () => {
    const spark = makeSparkReceiveWallet('spark-receive-1');
    const other = makeLdsReceiveWallet('lds-other');
    mockRouteParams.walletID = spark.getID();
    const screen = render(
      <BlueStorageContext.Provider
        value={{
          wallets: [spark, other],
          saveToDisk: jest.fn().mockResolvedValue(undefined),
          setSelectedWallet: jest.fn(),
          fetchAndSaveWalletTransactions: jest.fn(),
        }}
      >
        <LNDReceive />
      </BlueStorageContext.Provider>,
    );

    fireEvent.press(screen.getByTestId('WalletSelect-lds-other'));
    expect(mockSetParams).toHaveBeenCalledWith({ walletID: 'lds-other' });
    expect(global.__walletSelectResult).toBeUndefined();
  });

  it('does nothing when the selected wallet is the current one', () => {
    const screen = renderReceive(makeSparkReceiveWallet('spark-receive-1'));
    fireEvent.press(screen.getByTestId('WalletSelectSame'));
    expect(mockSetParams).not.toHaveBeenCalled();
    expect(global.__walletSelectResult).toBeUndefined();
  });

  it('does nothing when the selected wallet id is not in the wallet list', () => {
    const screen = renderReceive(makeSparkReceiveWallet('spark-receive-1'));
    fireEvent.press(screen.getByTestId('WalletSelectMissing'));
    expect(mockSetParams).not.toHaveBeenCalled();
    expect(global.__walletSelectResult).toBeUndefined();
  });

  it('does nothing when the current wallet is missing and the same undefined id is selected again', () => {
    mockRouteParams.walletID = 'absent';
    const screen = render(
      <BlueStorageContext.Provider
        value={{
          wallets: [makeSparkReceiveWallet('spark-receive-1')],
          saveToDisk: jest.fn().mockResolvedValue(undefined),
          setSelectedWallet: jest.fn(),
          fetchAndSaveWalletTransactions: jest.fn(),
        }}
      >
        <LNDReceive />
      </BlueStorageContext.Provider>,
    );
    fireEvent.press(screen.getByTestId('WalletSelectSame'));
    expect(mockSetParams).not.toHaveBeenCalled();
  });

  it('cycles the amount unit from sats to the local currency symbol', () => {
    const screen = renderReceive(makeSparkReceiveWallet('spark-receive-1'));
    expect(screen.queryByText('$')).toBeNull();
    fireEvent.press(screen.getByLabelText(loc._.change_input_currency));
    expect(screen.getByText('$')).toBeTruthy();
  });

  it('dismisses the keyboard when the screen background is pressed', () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    const screen = renderReceive(makeSparkReceiveWallet('spark-receive-1'));
    fireEvent.press(screen.UNSAFE_getByType(TouchableWithoutFeedback));
    expect(dismiss).toHaveBeenCalled();
    dismiss.mockRestore();
  });

  it('fetches a deposit address when the cached value is not a string', async () => {
    const address = 'bc1qfromfetch';
    mockSdk.receivePayment.mockResolvedValue({ paymentRequest: address, fee: 0n });
    const wallet = makeSparkReceiveWallet('spark-receive-1');
    wallet.depositAddress = null;
    const screen = renderReceive(wallet);
    fireEvent.press(screen.getByTestId('SparkReceiveOnchain'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockSdk.receivePayment).toHaveBeenCalled();
    expect(screen.getByText(address)).toBeTruthy();
  });

  it('titles the navigation header Receive and goes back from the close button', () => {
    const goBack = jest.fn();
    const options = LNDReceive.navigationOptions(BlueDarkTheme)({
      navigation: { goBack, getParent: () => ({ popToTop: jest.fn() }) },
      route: {},
    });
    expect(options.title).toBe(loc.receive.header);
    const close = render(options.headerRight());
    fireEvent.press(close.getByTestId('NavigationCloseButton'));
    expect(goBack).toHaveBeenCalled();
    close.unmount();
  });

  it('exposes LNDReceive as the route name', () => {
    expect(LNDReceive.routeName).toBe('LNDReceive');
  });

  it('selects the route wallet when the displayed wallet reports a different id', () => {
    let calls = 0;
    const displayed = makeSparkReceiveWallet('displayed');
    displayed.getID = () => {
      calls += 1;
      return calls === 1 ? 'spark-receive-1' : 'stale-id';
    };
    const matching = makeSparkReceiveWallet('spark-receive-1');
    const setSelectedWallet = jest.fn();
    mockRouteParams.walletID = 'spark-receive-1';
    render(
      <BlueStorageContext.Provider
        value={{
          wallets: [displayed, matching],
          saveToDisk: jest.fn().mockResolvedValue(undefined),
          setSelectedWallet,
          fetchAndSaveWalletTransactions: jest.fn(),
        }}
      >
        <LNDReceive />
      </BlueStorageContext.Provider>,
    );

    expect(setSelectedWallet).toHaveBeenCalledWith('spark-receive-1');
  });

  it('does not select a wallet when the route id is missing after a stale displayed wallet', () => {
    let calls = 0;
    const displayed = makeSparkReceiveWallet('displayed');
    displayed.getID = () => {
      calls += 1;
      return calls === 1 ? 'spark-receive-1' : 'stale-id';
    };
    const setSelectedWallet = jest.fn();
    mockRouteParams.walletID = 'spark-receive-1';
    render(
      <BlueStorageContext.Provider
        value={{
          wallets: [displayed],
          saveToDisk: jest.fn().mockResolvedValue(undefined),
          setSelectedWallet,
          fetchAndSaveWalletTransactions: jest.fn(),
        }}
      >
        <LNDReceive />
      </BlueStorageContext.Provider>,
    );

    expect(setSelectedWallet).not.toHaveBeenCalled();
  });
});

describe('LNDCreateInvoice with SparkWallet', () => {
  const WITHDRAW_URL = 'https://lnurl.example.com/withdraw';

  function makeCreateWallet(id = 'spark-create-invoice-1') {
    const wallet = SparkWallet.create('pk-receive-1');
    wallet.getID = () => id;
    wallet.setLabel('Spark');
    wallet.setUserHasSavedExport(true);
    wallet.lnAddress = 'spark@test';
    wallet.addInvoice = jest.fn().mockResolvedValue(SAMPLE_INVOICE);
    wallet.decodeInvoice = jest.fn().mockResolvedValue({ payment_hash: 'ph-1' });
    wallet.fetchUserInvoices = jest.fn().mockResolvedValue(undefined);
    return wallet;
  }

  function withdrawPayload(overrides = {}) {
    return {
      tag: Lnurl.TAG_WITHDRAW_REQUEST,
      k1: 'k1-secret',
      callback: 'https://lnurl.example.com/cb',
      minWithdrawable: 100_000,
      maxWithdrawable: 5_000_000,
      defaultDescription: 'withdraw',
      ...overrides,
    };
  }

  function jsonResponse(body, status = 200) {
    return {
      status,
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    global.__walletSelectResult = undefined;
    mockRouteParams.walletID = 'spark-create-invoice-1';
    delete mockRouteParams.uri;
    AmountInput.conversionCache = {};
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    jest.spyOn(NavigationService, 'navigate').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('does not render the QR placeholder when the wallet has no Lightning address', async () => {
    const wallet = SparkWallet.create('pk-receive-1');
    wallet.getID = () => 'spark-create-invoice-1';
    wallet.setLabel('Spark');
    wallet.setUserHasSavedExport(true);
    assert.strictEqual(wallet.lnAddress, undefined);

    const screen = renderCreateInvoiceScreen(wallet);
    await waitFor(() => screen.getByText(loc.receive.details_setAmount));

    expect(screen.queryByTestId('QRCode')).toBeNull();
    expect(screen.queryByText('this is a QR code')).toBeNull();
  });

  it('renders the Lightning address QR and copyable text', async () => {
    const wallet = makeCreateWallet();
    const screen = renderCreateInvoiceScreen(wallet);

    await waitFor(() => screen.getByTestId('QRCode'));
    expect(screen.getByText('spark@test')).toBeTruthy();
  });

  it('goes back and alerts when no Lightning wallet is available', () => {
    renderCreateInvoiceScreen(null, { walletID: 'missing', wallets: [] });

    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(haptic.trigger).toHaveBeenCalledWith('notificationError', { ignoreAndroidSystemSettings: false });
    expect(Alert.alert).toHaveBeenCalledWith(loc.alert.default, loc.wallets.add_ln_wallet_first);
  });

  it('falls back to BTC when the wallet has no preferred unit', async () => {
    const wallet = makeCreateWallet();
    wallet.getPreferredBalanceUnit = () => undefined;
    const screen = renderCreateInvoiceScreen(wallet);

    await waitFor(() => screen.getByText(loc.receive.details_setAmount));
    fireEvent.press(screen.getByTestId('SetCustomAmountButton'));
    expect(screen.getByText(' ' + loc.units[BitcoinUnit.BTC])).toBeTruthy();
  });

  it('reports when preparing receive details fails', async () => {
    const wallet = makeCreateWallet();
    const saveError = new Error('disk full');
    const saveToDisk = jest.fn().mockRejectedValue(saveError);
    renderCreateInvoiceScreen(wallet, { saveToDisk });

    await waitFor(() => expect(reportError).toHaveBeenCalledWith('lndCreateInvoice: failed to prepare receive details', saveError));
  });

  it('creates a SATS invoice from the custom amount modal and subscribes to the payment hash', async () => {
    const wallet = makeCreateWallet();
    const screen = renderCreateInvoiceScreen(wallet);

    await waitFor(() => screen.getByTestId('SetCustomAmountButton'));
    fireEvent.press(screen.getByTestId('SetCustomAmountButton'));
    fireEvent.changeText(screen.getByTestId('BitcoinAmountInput'), '1000');
    fireEvent.changeText(screen.getByPlaceholderText(loc.receive.details_label), 'coffee');
    await act(async () => {
      fireEvent.press(screen.getByTestId('CustomAmountSaveButton'));
      await Promise.resolve();
    });

    expect(wallet.addInvoice).toHaveBeenCalledWith(1000, 'coffee');
    expect(tryToObtainPermissions).toHaveBeenCalled();
    expect(majorTomToGroundControl).toHaveBeenCalledWith([], ['ph-1'], []);
    expect(haptic.trigger).toHaveBeenCalledWith('notificationSuccess', { ignoreAndroidSystemSettings: false });
    expect(mockNavigate).toHaveBeenCalledWith('LNDViewInvoice', { invoice: SAMPLE_INVOICE, walletID: wallet.getID() });
  });

  it('converts a BTC custom amount to sats before creating the invoice', async () => {
    const wallet = makeCreateWallet();
    const screen = renderCreateInvoiceScreen(wallet);

    await waitFor(() => screen.getByTestId('SetCustomAmountButton'));
    fireEvent.press(screen.getByTestId('SetCustomAmountButton'));
    fireEvent.press(screen.getByTestId('changeAmountUnitButton'));
    fireEvent.press(screen.getByTestId('changeAmountUnitButton'));
    fireEvent.changeText(screen.getByTestId('BitcoinAmountInput'), '0.001');
    await act(async () => {
      fireEvent.press(screen.getByTestId('CustomAmountSaveButton'));
      await Promise.resolve();
    });

    expect(wallet.addInvoice).toHaveBeenCalledWith(100000, '');
  });

  it('uses cached sats for a LOCAL_CURRENCY custom amount when the cache hits', async () => {
    AmountInput.setCachedSatoshis('12.34', 2500);
    const wallet = makeCreateWallet();
    const screen = renderCreateInvoiceScreen(wallet);

    await waitFor(() => screen.getByTestId('SetCustomAmountButton'));
    fireEvent.press(screen.getByTestId('SetCustomAmountButton'));
    fireEvent.press(screen.getByTestId('changeAmountUnitButton'));
    fireEvent.changeText(screen.getByTestId('BitcoinAmountInput'), '12.34');
    await act(async () => {
      fireEvent.press(screen.getByTestId('CustomAmountSaveButton'));
      await Promise.resolve();
    });

    expect(wallet.addInvoice).toHaveBeenCalledWith(2500, '');
  });

  it('falls back to fiatToBTC when a LOCAL_CURRENCY amount is not cached', async () => {
    const wallet = makeCreateWallet();
    const screen = renderCreateInvoiceScreen(wallet);

    await waitFor(() => screen.getByTestId('SetCustomAmountButton'));
    fireEvent.press(screen.getByTestId('SetCustomAmountButton'));
    fireEvent.press(screen.getByTestId('changeAmountUnitButton'));
    fireEvent.changeText(screen.getByTestId('BitcoinAmountInput'), '9.99');
    await act(async () => {
      fireEvent.press(screen.getByTestId('CustomAmountSaveButton'));
      await Promise.resolve();
    });

    expect(wallet.addInvoice).toHaveBeenCalledWith(0, '');
  });

  it('alerts the addInvoice error and leaves the custom-amount modal usable', async () => {
    const wallet = makeCreateWallet();
    wallet.addInvoice.mockImplementation(() => Promise.reject(new Error('node down')));
    const screen = renderCreateInvoiceScreen(wallet);

    await waitFor(() => screen.getByText(loc.receive.details_setAmount));
    fireEvent.press(screen.getByText(loc.receive.details_setAmount));
    fireEvent.changeText(screen.getByTestId('BitcoinAmountInput'), '1000');
    await act(async () => {
      fireEvent.press(screen.getByTestId('CustomAmountSaveButton'));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(wallet.addInvoice).toHaveBeenCalled());
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith(loc.alert.default, 'node down'));
    expect(haptic.trigger).toHaveBeenCalledWith('notificationError', { ignoreAndroidSystemSettings: false });
    // createInvoice does not dismiss the modal on error; SetCustomAmountButton sits
    // behind the open Modal and is not queryable. The Create button in the modal is.
    expect(screen.getByTestId('CustomAmountSaveButton')).toBeTruthy();
  });

  it('refetches user invoices after creating one', async () => {
    const wallet = makeCreateWallet();
    const saveToDisk = jest.fn().mockResolvedValue(undefined);
    const screen = renderCreateInvoiceScreen(wallet, { saveToDisk });

    await waitFor(() => screen.getByTestId('SetCustomAmountButton'));
    fireEvent.press(screen.getByTestId('SetCustomAmountButton'));
    fireEvent.changeText(screen.getByTestId('BitcoinAmountInput'), '1000');
    const scheduled = [];
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((cb, ms, ...rest) => {
      if (typeof cb === 'function' && ms === 1000) {
        scheduled.push(cb);
        return 1000;
      }
      return realSetTimeout(cb, ms, ...rest);
    });
    try {
      await act(async () => {
        fireEvent.press(screen.getByTestId('CustomAmountSaveButton'));
        await Promise.resolve();
      });
      expect(scheduled).toHaveLength(1);
      await act(async () => {
        await scheduled[0]();
      });
      expect(wallet.fetchUserInvoices).toHaveBeenCalledWith(1);
      expect(saveToDisk.mock.calls.length).toBeGreaterThan(1);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it('shares the Lightning address and swallows a share rejection', async () => {
    Share.open.mockRejectedValueOnce(new Error('share cancelled'));
    const wallet = makeCreateWallet();
    const screen = renderCreateInvoiceScreen(wallet);

    await waitFor(() => screen.getByText(loc.receive.details_share));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.receive.details_share));
      await Promise.resolve();
    });

    expect(Share.open).toHaveBeenCalledWith({ message: 'spark@test' });
    expect(screen.getByText(loc.receive.details_share)).toBeTruthy();
  });

  it('shares the Lightning address when Share.open resolves', async () => {
    Share.open.mockResolvedValueOnce({});
    const wallet = makeCreateWallet();
    const screen = renderCreateInvoiceScreen(wallet);

    await waitFor(() => screen.getByText(loc.receive.details_share));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.receive.details_share));
      await Promise.resolve();
    });

    expect(Share.open).toHaveBeenCalledWith({ message: 'spark@test' });
  });

  it('dismisses the custom amount modal from the Android back handler', async () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    const wallet = makeCreateWallet();
    const screen = renderCreateInvoiceScreen(wallet);

    await waitFor(() => screen.getByTestId('SetCustomAmountButton'));
    fireEvent.press(screen.getByTestId('SetCustomAmountButton'));
    expect(screen.getByTestId('CustomAmountSaveButton')).toBeTruthy();
    fireEvent(screen.UNSAFE_getByType(Modal), 'requestClose');
    expect(dismiss).toHaveBeenCalled();
  });

  it('dismisses the keyboard from the description field submit', async () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    const wallet = makeCreateWallet();
    const screen = renderCreateInvoiceScreen(wallet);

    await waitFor(() => screen.getByTestId('SetCustomAmountButton'));
    fireEvent.press(screen.getByTestId('SetCustomAmountButton'));
    fireEvent(screen.getByPlaceholderText(loc.receive.details_label), 'submitEditing');
    expect(dismiss).toHaveBeenCalled();
  });

  it('renders the custom amount modal with android KeyboardAvoidingView and iPad disabled', async () => {
    const previousOS = Platform.OS;
    const previousIsPad = Platform.isPad;
    Platform.OS = 'android';
    Platform.isPad = true;
    try {
      const wallet = makeCreateWallet();
      const screen = renderCreateInvoiceScreen(wallet);
      await waitFor(() => screen.getByTestId('SetCustomAmountButton'));
      fireEvent.press(screen.getByTestId('SetCustomAmountButton'));
      expect(screen.getByTestId('CustomAmountSaveButton')).toBeTruthy();
    } finally {
      Platform.OS = previousOS;
      Platform.isPad = previousIsPad;
    }
  });

  it('prompts to save the export and continues on yes', async () => {
    Alert.alert.mockImplementation((title, message, buttons) => {
      if (buttons && buttons[0]) buttons[0].onPress();
    });
    const wallet = makeCreateWallet();
    wallet.setUserHasSavedExport(false);
    const screen = renderCreateInvoiceScreen(wallet);

    await waitFor(() => screen.getByText(loc.receive.details_setAmount));
    expect(Alert.alert).toHaveBeenCalled();
    expect(wallet.getUserHasSavedExport()).toBe(true);
  });

  it('opens wallet export when the backup reminder is declined', () => {
    Alert.alert.mockImplementation((title, message, buttons) => {
      if (buttons && buttons[1]) buttons[1].onPress();
    });
    const wallet = makeCreateWallet();
    wallet.setUserHasSavedExport(false);
    renderCreateInvoiceScreen(wallet);

    expect(mockPop).toHaveBeenCalled();
    expect(NavigationService.navigate).toHaveBeenCalledWith('WalletExportRoot', {
      screen: 'WalletExport',
      params: { walletID: wallet.getID() },
    });
  });

  it('switches the ref to the route wallet when the displayed wallet reports a different id', async () => {
    const displayed = makeCreateWallet('displayed');
    const matching = makeCreateWallet('spark-create-invoice-1');
    const setSelectedWallet = jest.fn();
    mockRouteParams.walletID = 'displayed';
    const screen = render(
      <BlueStorageContext.Provider
        value={{
          wallets: [displayed, matching],
          saveToDisk: jest.fn().mockResolvedValue(undefined),
          setSelectedWallet,
        }}
      >
        <LNDCreateInvoice />
      </BlueStorageContext.Provider>,
    );
    await waitFor(() => screen.getByText(loc.receive.details_setAmount));

    mockRouteParams.walletID = 'spark-create-invoice-1';
    screen.rerender(
      <BlueStorageContext.Provider
        value={{
          wallets: [displayed, matching],
          saveToDisk: jest.fn().mockResolvedValue(undefined),
          setSelectedWallet,
        }}
      >
        <LNDCreateInvoice />
      </BlueStorageContext.Provider>,
    );

    await waitFor(() => expect(setSelectedWallet).toHaveBeenCalledWith('spark-create-invoice-1'));
  });

  it('leaves the current wallet in place when the new route id cannot be found', async () => {
    const wallet = makeCreateWallet();
    const setSelectedWallet = jest.fn();
    mockRouteParams.walletID = wallet.getID();
    const screen = renderCreateInvoiceScreen(wallet, { setSelectedWallet });
    await waitFor(() => screen.getByText(loc.receive.details_setAmount));
    setSelectedWallet.mockClear();

    mockRouteParams.walletID = 'missing-wallet';
    screen.rerender(
      <BlueStorageContext.Provider
        value={{
          wallets: [wallet],
          saveToDisk: jest.fn().mockResolvedValue(undefined),
          setSelectedWallet,
        }}
      >
        <LNDCreateInvoice />
      </BlueStorageContext.Provider>,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(setSelectedWallet).not.toHaveBeenCalledWith('missing-wallet');
  });

  it('ignores a missing wallet pick and hands an on-chain pick to ReceiveDetails', async () => {
    const lightning = makeCreateWallet();
    const onchain = {
      getID: () => 'onchain-1',
      chain: Chain.ONCHAIN,
      getLabel: () => 'Onchain',
    };
    const other = makeCreateWallet('spark-create-2');
    const screen = renderCreateInvoiceScreen(lightning, { wallets: [lightning, other, onchain] });

    await waitFor(() => screen.getByTestId('WalletSelect'));
    fireEvent.press(screen.getByTestId('WalletSelectMissing'));
    assert.strictEqual(global.__walletSelectResult, undefined);

    fireEvent.press(screen.getByTestId('WalletSelect-onchain-1'));
    assert.deepStrictEqual(global.__walletSelectResult, { name: 'ReceiveDetails', params: { walletID: 'onchain-1' } });
  });

  it('updates the route when the picker chooses another Lightning wallet', async () => {
    const lightning = makeCreateWallet();
    const other = makeCreateWallet('spark-create-2');
    const screen = renderCreateInvoiceScreen(lightning, { wallets: [lightning, other] });

    await waitFor(() => screen.getByTestId('WalletSelect-spark-create-2'));
    fireEvent.press(screen.getByTestId('WalletSelect-spark-create-2'));
    expect(mockSetParams).toHaveBeenCalledWith({ walletID: 'spark-create-2' });
  });

  it('navigates to LNURL auth when the scanned tag is login', async () => {
    const loginLnurl = Lnurl.encode('https://example.com/lnurl?tag=login&k1=aa');
    const wallet = makeCreateWallet();
    renderCreateInvoiceScreen(wallet, { uri: loginLnurl, walletID: undefined, wallets: [wallet] });

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('LnurlAuth', {
        lnurl: loginLnurl,
        walletID: wallet.getID(),
      }),
    );
  });

  it('replaces the screen with ScanLndInvoice when the LNURL is a pay request', async () => {
    const payLnurl = Lnurl.encode(WITHDRAW_URL);
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ tag: Lnurl.TAG_PAY_REQUEST }));
    const wallet = makeCreateWallet();
    renderCreateInvoiceScreen(wallet, { uri: payLnurl, walletID: wallet.getID() });

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith('SendDetailsRoot', {
        screen: 'ScanLndInvoice',
        params: { uri: payLnurl, walletID: wallet.getID() },
      }),
    );
  });

  it('passes the route walletID to ScanLndInvoice when the LNURL is a pay request', async () => {
    const payLnurl = Lnurl.encode(WITHDRAW_URL);
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ tag: Lnurl.TAG_PAY_REQUEST }));
    const wallet = makeCreateWallet();
    renderCreateInvoiceScreen(wallet, { uri: payLnurl, walletID: 'route-wallet-id', wallets: [wallet] });

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith('SendDetailsRoot', {
        screen: 'ScanLndInvoice',
        params: { uri: payLnurl, walletID: 'route-wallet-id' },
      }),
    );
  });

  it('falls back to wallet.current.getID for ScanLndInvoice when the route walletID is missing', async () => {
    const payLnurl = Lnurl.encode(WITHDRAW_URL);
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ tag: Lnurl.TAG_PAY_REQUEST }));
    const wallet = makeCreateWallet();
    renderCreateInvoiceScreen(wallet, { uri: payLnurl, walletID: undefined, wallets: [wallet] });

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith('SendDetailsRoot', {
        screen: 'ScanLndInvoice',
        params: { uri: payLnurl, walletID: wallet.getID() },
      }),
    );
  });

  it('alerts when the LNURL is an onion URL', async () => {
    const onionLnurl = Lnurl.encode('http://abc.onion/withdraw');
    const wallet = makeCreateWallet();
    const screen = renderCreateInvoiceScreen(wallet, { uri: onionLnurl });

    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith(loc.alert.default, loc.settings.tor_unsupported));
    expect(haptic.trigger).toHaveBeenCalledWith('notificationError', { ignoreAndroidSystemSettings: false });
    await waitFor(() => screen.getByText(loc.receive.details_setAmount));
  });

  it('alerts when the LNURL server returns a non-success status', async () => {
    const lnurl = Lnurl.encode(WITHDRAW_URL);
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse('Bad response from server', 500));
    const wallet = makeCreateWallet();
    renderCreateInvoiceScreen(wallet, { uri: lnurl });

    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith(loc.alert.default, 'Bad response from server'));
  });

  it('alerts when the LNURL server replies with status ERROR', async () => {
    const lnurl = Lnurl.encode(WITHDRAW_URL);
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ status: 'ERROR', reason: 'nope' }));
    const wallet = makeCreateWallet();
    renderCreateInvoiceScreen(wallet, { uri: lnurl });

    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith(loc.alert.default, 'Reply from server: nope'));
  });

  it('alerts when the LNURL tag is not a withdraw request', async () => {
    const lnurl = Lnurl.encode(WITHDRAW_URL);
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ tag: 'channelRequest' }));
    const wallet = makeCreateWallet();
    renderCreateInvoiceScreen(wallet, { uri: lnurl });

    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith(loc.alert.default, 'Unsupported lnurl'));
  });

  it('creates a withdraw invoice and appends k1 to a callback without a query string', async () => {
    const lnurl = Lnurl.encode(WITHDRAW_URL);
    const payload = withdrawPayload();
    jest.spyOn(global, 'fetch').mockImplementation(async url => {
      if (String(url).includes('k1=')) {
        return jsonResponse({ status: 'OK' });
      }
      return jsonResponse(payload);
    });
    const wallet = makeCreateWallet();
    renderCreateInvoiceScreen(wallet, { uri: lnurl });

    await waitFor(() => expect(wallet.addInvoice).toHaveBeenCalledWith(5000, 'withdraw'));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('LNDViewInvoice', expect.any(Object)));
    const callbackUrl = global.fetch.mock.calls.find(call => String(call[0]).includes('k1='))[0];
    assert.ok(String(callbackUrl).startsWith('https://lnurl.example.com/cb?k1=k1-secret&pr='));
  });

  it('appends k1 with an ampersand when the withdraw callback already has a query', async () => {
    const lnurl = Lnurl.encode(WITHDRAW_URL);
    const payload = withdrawPayload({ callback: 'https://lnurl.example.com/cb?foo=1' });
    jest.spyOn(global, 'fetch').mockImplementation(async url => {
      if (String(url).includes('k1=')) {
        return jsonResponse({ status: 'OK' });
      }
      return jsonResponse(payload);
    });
    const wallet = makeCreateWallet();
    renderCreateInvoiceScreen(wallet, { uri: lnurl });

    await waitFor(() => expect(wallet.addInvoice).toHaveBeenCalled());
    const callbackUrl = global.fetch.mock.calls.find(call => String(call[0]).includes('k1='))[0];
    assert.ok(String(callbackUrl).startsWith('https://lnurl.example.com/cb?foo=1&k1=k1-secret&pr='));
  });

  it('alerts the callback body when the withdraw callback returns a non-success status', async () => {
    const lnurl = Lnurl.encode(WITHDRAW_URL);
    jest.spyOn(global, 'fetch').mockImplementation(async url => {
      if (String(url).includes('k1=')) {
        return jsonResponse('callback failed', 400);
      }
      return jsonResponse(withdrawPayload());
    });
    const wallet = makeCreateWallet();
    renderCreateInvoiceScreen(wallet, { uri: lnurl });

    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith(loc.alert.default, 'callback failed'));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('alerts when the withdraw callback JSON has status ERROR', async () => {
    const lnurl = Lnurl.encode(WITHDRAW_URL);
    jest.spyOn(global, 'fetch').mockImplementation(async url => {
      if (String(url).includes('k1=')) {
        return jsonResponse({ status: 'ERROR', reason: 'empty' });
      }
      return jsonResponse(withdrawPayload());
    });
    const wallet = makeCreateWallet();
    renderCreateInvoiceScreen(wallet, { uri: lnurl });

    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith(loc.alert.default, 'Reply from server: empty'));
  });

  it('alerts the SATS minimum when the custom amount is below the withdraw min', async () => {
    const lnurl = Lnurl.encode(WITHDRAW_URL);
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(withdrawPayload()));
    const wallet = makeCreateWallet();
    wallet.addInvoice.mockRejectedValue(new Error('skip auto create'));
    const screen = renderCreateInvoiceScreen(wallet, { uri: lnurl });

    await waitFor(() => screen.getByText(loc.receive.details_setAmount));
    fireEvent.press(screen.getByTestId('SetCustomAmountButton'));
    expect(screen.getByTestId('BitcoinAmountInput').props.editable).not.toBe(false);
    fireEvent.changeText(screen.getByTestId('BitcoinAmountInput'), '1');
    await act(async () => {
      fireEvent.press(screen.getByTestId('CustomAmountSaveButton'));
      await Promise.resolve();
    });

    expect(Alert.alert).toHaveBeenCalledWith(loc.alert.default, loc.formatString(loc.receive.minSats, { min: 100 }));
    expect(haptic.trigger).toHaveBeenCalledWith('notificationError', { ignoreAndroidSystemSettings: false });
  });

  it('alerts the SATS maximum when the custom amount is above the withdraw max', async () => {
    const lnurl = Lnurl.encode(WITHDRAW_URL);
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(withdrawPayload()));
    const wallet = makeCreateWallet();
    wallet.addInvoice.mockRejectedValue(new Error('skip auto create'));
    const screen = renderCreateInvoiceScreen(wallet, { uri: lnurl });

    await waitFor(() => screen.getByText(loc.receive.details_setAmount));
    fireEvent.press(screen.getByTestId('SetCustomAmountButton'));
    fireEvent.changeText(screen.getByTestId('BitcoinAmountInput'), '9000');
    await act(async () => {
      fireEvent.press(screen.getByTestId('CustomAmountSaveButton'));
      await Promise.resolve();
    });

    expect(Alert.alert).toHaveBeenCalledWith(loc.alert.default, loc.formatString(loc.receive.maxSats, { max: 5000 }));
  });

  it('alerts the converted minimum when the unit is not SATS', async () => {
    const lnurl = Lnurl.encode(WITHDRAW_URL);
    const wallet = makeCreateWallet();
    wallet.getPreferredBalanceUnit = () => BitcoinUnit.BTC;
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(withdrawPayload()));
    renderCreateInvoiceScreen(wallet, { uri: lnurl });

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        loc.alert.default,
        loc.formatString(loc.receive.minSatsFull, { min: 100, currency: formatBalance(100, BitcoinUnit.BTC) }),
      ),
    );
  });

  it('alerts the converted maximum when a BTC amount is above the withdraw max', async () => {
    const lnurl = Lnurl.encode(WITHDRAW_URL);
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(withdrawPayload()));
    const wallet = makeCreateWallet();
    wallet.addInvoice.mockRejectedValue(new Error('skip auto create'));
    const screen = renderCreateInvoiceScreen(wallet, { uri: lnurl });

    await waitFor(() => screen.getByText(loc.receive.details_setAmount));
    fireEvent.press(screen.getByTestId('SetCustomAmountButton'));
    fireEvent.press(screen.getByTestId('changeAmountUnitButton'));
    fireEvent.press(screen.getByTestId('changeAmountUnitButton'));
    fireEvent.changeText(screen.getByTestId('BitcoinAmountInput'), '1');
    await act(async () => {
      fireEvent.press(screen.getByTestId('CustomAmountSaveButton'));
      await Promise.resolve();
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      loc.alert.default,
      loc.formatString(loc.receive.maxSatsFull, { max: 5000, currency: formatBalance(5000, BitcoinUnit.BTC) }),
    );
  });

  it('runs the BTC branch when converting a withdraw amount out of sats', async () => {
    const lnurl = Lnurl.encode(WITHDRAW_URL);
    const wallet = makeCreateWallet();
    wallet.getPreferredBalanceUnit = () => BitcoinUnit.BTC;
    jest.spyOn(global, 'fetch').mockImplementation(async url => {
      if (String(url).includes('k1=')) return jsonResponse({ status: 'OK' });
      return jsonResponse(withdrawPayload({ minWithdrawable: 0, maxWithdrawable: 5_000_000 }));
    });
    renderCreateInvoiceScreen(wallet, { uri: lnurl });

    await waitFor(() => expect(wallet.addInvoice).toHaveBeenCalled());
    const amountArg = wallet.addInvoice.mock.calls[0][0];
    assert.strictEqual(amountArg, 0);
  });

  it('converts the withdraw amount to local currency and caches the sats', async () => {
    const lnurl = Lnurl.encode(WITHDRAW_URL);
    const wallet = makeCreateWallet();
    wallet.getPreferredBalanceUnit = () => BitcoinUnit.LOCAL_CURRENCY;
    jest.spyOn(global, 'fetch').mockImplementation(async url => {
      if (String(url).includes('k1=')) return jsonResponse({ status: 'OK' });
      return jsonResponse(withdrawPayload({ minWithdrawable: 0 }));
    });
    renderCreateInvoiceScreen(wallet, { uri: lnurl });

    await waitFor(() => expect(wallet.addInvoice).toHaveBeenCalled());
    // Default export is the styled wrapper; conversionCache lives on the class.
    // setCachedSatoshis writes there — assert through the same helper the screen uses.
    assert.strictEqual(AmountInput.getCachedSatoshis('0'), '5000');
    expect(wallet.addInvoice).toHaveBeenCalledWith('5000', 'withdraw');
  });

  it('treats a missing minWithdrawable as zero so the max amount is still accepted', async () => {
    const lnurl = Lnurl.encode(WITHDRAW_URL);
    jest.spyOn(global, 'fetch').mockImplementation(async url => {
      if (String(url).includes('k1=')) return jsonResponse({ status: 'OK' });
      return jsonResponse(withdrawPayload({ minWithdrawable: undefined, maxWithdrawable: 5_000_000 }));
    });
    const wallet = makeCreateWallet();
    renderCreateInvoiceScreen(wallet, { uri: lnurl });

    await waitFor(() => expect(wallet.addInvoice).toHaveBeenCalledWith(5000, 'withdraw'));
    expect(mockNavigate).toHaveBeenCalledWith('LNDViewInvoice', expect.any(Object));
  });

  it('disables the amount field when the withdraw amount is fixed', async () => {
    const lnurl = Lnurl.encode(WITHDRAW_URL);
    const wallet = makeCreateWallet();
    wallet.addInvoice.mockRejectedValue(new Error('skip auto create'));
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(
        withdrawPayload({
          minWithdrawable: 5_000_000,
          maxWithdrawable: 5_000_000,
        }),
      ),
    );
    const screen = renderCreateInvoiceScreen(wallet, { uri: lnurl });
    await waitFor(() => screen.getByText(loc.receive.details_setAmount));
    fireEvent.press(screen.getByTestId('SetCustomAmountButton'));
    expect(screen.getByTestId('BitcoinAmountInput').props.editable).toBe(false);
  });

  it('titles the navigation header Receive and goes back from the close button', () => {
    const goBack = jest.fn();
    const options = LNDCreateInvoice.navigationOptions(BlueDarkTheme)({
      navigation: { goBack },
      route: {},
    });
    expect(options.title).toBe(loc.receive.header);
    const close = render(options.headerRight());
    fireEvent.press(close.getByTestId('NavigationCloseButton'));
    expect(goBack).toHaveBeenCalled();
    close.unmount();
  });

  it('exposes LNDCreateInvoice as the route name', () => {
    expect(LNDCreateInvoice.routeName).toBe('LNDCreateInvoice');
  });
});
