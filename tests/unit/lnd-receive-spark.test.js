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
  fiatToBTC: jest.fn(() => 0),
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
  return {
    SuccessView: () => RN.createElement(Text, { testID: 'SuccessView' }, 'paid'),
  };
});
jest.mock('../../helpers/errors', () => ({ reportError: jest.fn() }));

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
const mockGetParent = jest.fn(() => ({ popToTop: mockPopToTop }));
const mockNavigate = jest.fn();
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
const { Chain } = require('../../models/bitcoinUnits');
const { BlueStorageContext } = require('../../blue_modules/storage-context');
const loc = require('../../loc').default;
const { reportError } = require('../../helpers/errors');
const { __nfc } = require('../../hooks/nfc.hook');
const { Platform, Image, Keyboard, TouchableWithoutFeedback } = require('react-native');
const Share = require('react-native-share');
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

function renderCreateInvoiceScreen(wallet) {
  mockRouteParams.walletID = wallet.getID();
  return render(
    <BlueStorageContext.Provider
      value={{
        wallets: [wallet],
        saveToDisk: jest.fn().mockResolvedValue(undefined),
        setSelectedWallet: jest.fn(),
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

async function advanceTimers(ms) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

function timeoutHandlesScheduledAfter(setTimeoutSpy, fromCallCount, delay) {
  const handles = [];
  for (let i = fromCallCount; i < setTimeoutSpy.mock.calls.length; i++) {
    if (setTimeoutSpy.mock.calls[i][1] === delay) {
      handles.push(setTimeoutSpy.mock.results[i].value);
    }
  }
  return handles;
}

async function assertUnmountClearsInvoicePollTimeout(wallet, getUserInvoices) {
  const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
  const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
  const setIntervalSpy = jest.spyOn(global, 'setInterval');

  const screen = renderReceive(wallet);
  const timeoutCallsBeforeInvoice = setTimeoutSpy.mock.calls.length;
  await createInvoice(screen);

  const handles = timeoutHandlesScheduledAfter(setTimeoutSpy, timeoutCallsBeforeInvoice, 1000);
  assert.strictEqual(handles.length, 1, 'expected exactly one 1000ms timeout after creating an invoice');
  const handle = handles[0];

  screen.unmount();

  expect(clearTimeoutSpy).toHaveBeenCalledWith(handle);

  const pollerCount = () => setIntervalSpy.mock.calls.filter(([, ms]) => ms === 3000).length;
  assert.strictEqual(pollerCount(), 0);

  await act(async () => {
    jest.advanceTimersByTime(4000);
    await Promise.resolve();
  });

  assert.strictEqual(pollerCount(), 0);
  expect(getUserInvoices).not.toHaveBeenCalled();

  setTimeoutSpy.mockRestore();
  clearTimeoutSpy.mockRestore();
  setIntervalSpy.mockRestore();
}

describe('LNDReceive with SparkWallet', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    __nfc.state.isNfcActive = false;
    global.__walletSelectResult = undefined;
    mockRouteParams.walletID = 'spark-receive-1';
    mockSdk.receivePayment.mockResolvedValue({ paymentRequest: SAMPLE_INVOICE, fee: 0n });
    mockSdk.listPayments.mockResolvedValue({ payments: [] });
    Share.open.mockReset();
    Share.open.mockResolvedValue({});
  });

  afterEach(() => {
    jest.useRealTimers();
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

    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(mockSdk.listPayments).toHaveBeenCalled();

    mockSdk.listPayments.mockResolvedValue({ payments: [paidPayment()] });

    await act(async () => {
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    expect(screen.getByTestId('SuccessView')).toBeTruthy();
    expect(screen.getByText(loc.send.success_done)).toBeTruthy();
    expect(fetchAndSaveWalletTransactions).toHaveBeenCalledWith('spark-receive-1');
    assert.ok(typeof wallet.getUserInvoices === 'function');
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
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    const screen = renderReceive(wallet);
    await createInvoice(screen);
    await advanceTimers(1000);

    expect(reportError).toHaveBeenCalledWith('lndReceive: prefetch invoices failed', prefetchError);
    const pollerCount = setIntervalSpy.mock.calls.filter(([, ms]) => ms === 3000).length;
    assert.strictEqual(pollerCount, 1);

    await advanceTimers(3000);
    expect(wallet.getUserInvoices).toHaveBeenCalledWith(20);
    expect(reportError).toHaveBeenCalledTimes(1);

    setIntervalSpy.mockRestore();
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
    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    mockSdk.listPayments.mockResolvedValue({ payments: [paidPayment()] });
    await act(async () => {
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
    });

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
    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    mockSdk.listPayments.mockResolvedValue({ payments: [paidPayment()] });
    await act(async () => {
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
    });

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
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const screen = renderReceive(wallet);
    await createInvoice(screen);
    await advanceTimers(1000);
    screen.unmount();

    await act(async () => {
      resolvePrefetch([]);
      await Promise.resolve();
    });

    const pollerCount = setIntervalSpy.mock.calls.filter(([, ms]) => ms === 3000).length;
    assert.strictEqual(pollerCount, 0);
    setIntervalSpy.mockRestore();
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
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams.walletID = 'spark-create-invoice-1';
    delete mockRouteParams.uri;
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
});
