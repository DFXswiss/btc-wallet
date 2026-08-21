import React from 'react';
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { ActivityIndicator } from 'react-native';
import { fireEvent, render, act } from '@testing-library/react-native';
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
jest.mock('../../hooks/nfc.hook', () => ({
  useNFC: () => ({
    isNfcActive: false,
    startReading: jest.fn(),
    stopReading: jest.fn(),
  }),
}));
jest.mock('../../components/QRCodeComponent', () => {
  const RN = require('react');
  const { View } = require('react-native');
  return function QRCodeComponent() {
    return RN.createElement(View, { testID: 'QRCode' });
  };
});
jest.mock('../../screen/send/success', () => {
  const RN = require('react');
  const { Text } = require('react-native');
  return {
    SuccessView: () => RN.createElement(Text, { testID: 'SuccessView' }, 'paid'),
  };
});
jest.mock('../../components/navigationStyle', () => () => options => options);

const mockSetParams = jest.fn();
const mockGetParent = jest.fn(() => ({ popToTop: jest.fn() }));
const mockRouteParams = { walletID: 'spark-receive-1' };
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useRoute: () => ({ params: mockRouteParams }),
    useNavigation: () => ({
      setParams: mockSetParams,
      getParent: mockGetParent,
      navigate: jest.fn(),
    }),
    useTheme: () => require('../../components/themes').BlueDarkTheme,
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
const { SparkWallet } = require('../../class/wallets/spark-wallet');
const { LightningLdsWallet } = require('../../class/wallets/lightning-lds-wallet');
const { Chain } = require('../../models/bitcoinUnits');
const { BlueStorageContext } = require('../../blue_modules/storage-context');
const loc = require('../../loc').default;

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

async function createInvoice(screen) {
  fireEvent.changeText(screen.getByPlaceholderText('Amount (optional)'), '1000');
  fireEvent(screen.getByPlaceholderText('Amount (optional)'), 'blur');
  await act(async () => {
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
    mockRouteParams.walletID = 'spark-receive-1';
    mockSdk.receivePayment.mockResolvedValue({ paymentRequest: SAMPLE_INVOICE, fee: 0n });
    mockSdk.listPayments.mockResolvedValue({ payments: [] });
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
    }
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
});
