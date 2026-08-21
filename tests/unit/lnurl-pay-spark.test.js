import React from 'react';
import assert from 'assert';
import { fireEvent, render, waitFor, act } from '@testing-library/react-native';
import { BitcoinUnit } from '../../models/bitcoinUnits';

jest.mock('../../blue_modules/BlueElectrum', () => ({ connectMain: jest.fn() }));
jest.mock('../../blue_modules/currency', () => ({
  init: jest.fn(),
  mostRecentFetchedRate: jest.fn(() => Promise.resolve({})),
  isRateOutdated: jest.fn(() => Promise.resolve(false)),
  updateExchangeRate: jest.fn(() => Promise.resolve()),
  fiatToBTC: jest.fn(() => 0),
  satoshiToBTC: jest.fn(v => String(v)),
  getCurrencySymbol: jest.fn(() => '$'),
  satoshiToLocalCurrency: () => '0',
  preferredFiatCurrency: { endPointKey: 'USD' },
}));
jest.mock('react-native-haptic-feedback', () => ({ trigger: jest.fn() }));
jest.mock('../../class/biometrics', () => ({
  isBiometricUseCapableAndEnabled: jest.fn().mockResolvedValue(false),
  unlockWithBiometrics: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../components/Alert', () => jest.fn());
jest.mock('../../components/navigationStyle', () => () => options => options);

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockPop = jest.fn();
const mockRouteParams = {};
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useRoute: () => ({ params: mockRouteParams }),
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: mockGoBack,
      pop: mockPop,
      getParent: () => ({ popToTop: jest.fn() }),
    }),
    useTheme: () => require('../../components/themes').BlueDarkTheme,
  };
});

const mockUseSparkContext = jest.fn();
jest.mock('../../api/spark/contexts/spark.context', () => ({
  useSparkContext: () => mockUseSparkContext(),
}));

jest.mock('../../api/spark/spark-sdk', () => {
  class SparkSessionStaleError extends Error {
    constructor() {
      super('Spark session is no longer the one this call started with');
      this.name = 'SparkSessionStaleError';
    }
  }
  return {
    isSparkSdkConnected: () => true,
    SparkSessionStaleError,
    acquireSparkSessionLease: () => ({
      identity: 'pk-pay',
      requireSdk: () => ({}),
    }),
  };
});

const { SparkWallet } = require('../../class/wallets/spark-wallet');
const { BlueStorageContext } = require('../../blue_modules/storage-context');
const LnurlPay = require('../../screen/lnd/lnurlPay').default;
const loc = require('../../loc').default;
const alert = require('../../components/Alert');

const SAMPLE_INVOICE =
  'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp';

function makeWallet() {
  const wallet = SparkWallet.create('pk-pay');
  wallet.getID = () => 'spark-pay-1';
  wallet.balance = 1_000_000;
  wallet.payInvoice = jest.fn();
  return wallet;
}

function renderPay(wallet, extraParams = {}) {
  mockRouteParams.walletID = 'spark-pay-1';
  mockRouteParams.invoice = SAMPLE_INVOICE;
  mockRouteParams.amountSat = 1000;
  mockRouteParams.amountUnit = BitcoinUnit.SATS;
  mockRouteParams.description = 'tea';
  Object.assign(mockRouteParams, extraParams);
  return render(
    <BlueStorageContext.Provider value={{ wallets: [wallet], refreshAllWalletTransactions: jest.fn() }}>
      <LnurlPay />
    </BlueStorageContext.Provider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseSparkContext.mockReturnValue({
    isConnected: true,
    isConnecting: false,
    isCreating: false,
    createSparkWallet: jest.fn(),
    outgoingPayment: null,
  });
});

describe('LnurlPay Spark pending send', () => {
  it('shows the in-transit state for a pending payment and does not invite another send', async () => {
    const wallet = makeWallet();
    const decoded = wallet.decodeInvoice(SAMPLE_INVOICE);
    wallet.payInvoice.mockResolvedValue({ status: 'pending', paymentHash: decoded.payment_hash });
    const screen = renderPay(wallet);

    await waitFor(() => screen.getByText(loc.lnd.payButton));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });

    await waitFor(() => screen.getByText(loc.wallets.lightning_spark_payment_in_transit));
    assert.strictEqual(screen.queryByText(loc.lnd.payButton), null);
    assert.strictEqual(screen.queryByText(loc.wallets.lightning_spark_payment_failed), null);
    expect(wallet.payInvoice).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('navigates to the paid screen when a later SDK completion arrives', async () => {
    const wallet = makeWallet();
    const decoded = wallet.decodeInvoice(SAMPLE_INVOICE);
    wallet.payInvoice.mockResolvedValue({ status: 'pending', paymentHash: decoded.payment_hash });
    const screen = renderPay(wallet);

    await waitFor(() => screen.getByText(loc.lnd.payButton));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });
    await waitFor(() => screen.getByText(loc.wallets.lightning_spark_payment_in_transit));

    mockUseSparkContext.mockReturnValue({
      isConnected: true,
      isConnecting: false,
      isCreating: false,
      createSparkWallet: jest.fn(),
      outgoingPayment: { status: 'completed', paymentHash: decoded.payment_hash, preimage: 'pre-1' },
    });
    screen.rerender(
      <BlueStorageContext.Provider value={{ wallets: [wallet], refreshAllWalletTransactions: jest.fn() }}>
        <LnurlPay />
      </BlueStorageContext.Provider>,
    );

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    const nav = mockNavigate.mock.calls[0];
    assert.strictEqual(nav[0], 'Success');
    assert.strictEqual(nav[1].amount, 1000);
    assert.strictEqual(wallet.last_paid_invoice_result.payment_preimage, 'pre-1');
    expect(wallet.payInvoice).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
    assert.strictEqual(screen.queryByText(loc.lnd.payButton), null);
    assert.strictEqual(screen.queryByText(loc.wallets.lightning_spark_payment_failed), null);
  });

  it('still shows a failure when the payment has actually failed', async () => {
    const wallet = makeWallet();
    wallet.payInvoice.mockRejectedValue(new Error(loc.wallets.lightning_spark_payment_failed));
    const screen = renderPay(wallet);

    await waitFor(() => screen.getByText(loc.lnd.payButton));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });

    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(alert).toHaveBeenCalledWith(loc.wallets.lightning_spark_payment_failed);
    expect(alert).not.toHaveBeenCalledWith(loc.wallets.lightning_spark_payment_in_transit);
    await waitFor(() => screen.getByText(loc.lnd.payButton));
    assert.strictEqual(screen.queryByText(loc.wallets.lightning_spark_payment_in_transit), null);
    expect(wallet.payInvoice).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
