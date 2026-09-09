import React from 'react';
import assert from 'assert';
import { bech32m } from 'bech32';
import { fireEvent, render, waitFor, act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityIndicator } from 'react-native';
import { BitcoinUnit } from '../../models/bitcoinUnits';

const mockRandomBytes = jest.fn();
let mockRandomCounter = 0;

jest.mock('../../blue_modules/BlueElectrum', () => ({ connectMain: jest.fn() }));
jest.mock('../../blue_modules/currency', () => ({
  init: jest.fn(),
  mostRecentFetchedRate: jest.fn(() => Promise.resolve({})),
  isRateOutdated: jest.fn(() => Promise.resolve(false)),
  updateExchangeRate: jest.fn(() => Promise.resolve()),
  fiatToBTC: jest.fn(() => 0.00001),
  satoshiToBTC: jest.fn(v => String(v)),
  btcToSatoshi: jest.fn(v => Number(v)),
  getCurrencySymbol: jest.fn(() => '$'),
  satoshiToLocalCurrency: jest.fn(() => '0'),
  preferredFiatCurrency: { endPointKey: 'USD' },
}));
jest.mock('../../class/rng', () => ({
  randomBytes: size => mockRandomBytes(size),
}));
jest.mock('react-native-haptic-feedback', () => ({ trigger: jest.fn() }));
jest.mock('../../class/biometrics', () => ({
  isBiometricUseCapableAndEnabled: jest.fn().mockResolvedValue(false),
  unlockWithBiometrics: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../components/Alert', () => jest.fn());
jest.mock('../../helpers/errors', () => ({ reportError: jest.fn() }));
// A Spark wallet that mounts "Fee: Free" never finishes in this renderer.
// Record the line and skip the node so the case fails by name, not by hang.
jest.mock('react-native-elements', () => {
  const R = require('react');
  const { Text: RNText } = require('react-native');
  const actual = jest.requireActual('react-native-elements');
  /* eslint-disable react/prop-types */
  function Text(props) {
    if (global.__forbidSparkFreeFee) {
      const loc = require('../../loc').default;
      const text = R.Children.toArray(props.children).join('');
      if (text === `${loc.send.create_fee}: ${loc._.free}`) {
        global.__sparkFreeFeeShown = true;
        return null;
      }
    }
    return R.createElement(RNText, props, props.children);
  }
  /* eslint-enable react/prop-types */
  return { ...actual, Text };
});

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockPop = jest.fn();
const mockRouteParams = {};
let mockRouteKey = 'lnurl-pay-test-route-1';
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useRoute: () => ({ key: mockRouteKey, params: mockRouteParams }),
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

const mockSparkSdk = {
  prepareSendPayment: jest.fn(),
  sendPayment: jest.fn(),
};

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
      requireSdk: () => mockSparkSdk,
    }),
  };
});

const { SparkWallet } = require('../../class/wallets/spark-wallet');
const { BlueStorageContext } = require('../../blue_modules/storage-context');
const { LightningCustodianWallet } = require('../../class');
const { LightningLdsWallet } = require('../../class/wallets/lightning-lds-wallet');
const LnurlPay = require('../../screen/lnd/lnurlPay').default;
const Lnurl = require('../../class/lnurl').default;
const loc = require('../../loc').default;
const alert = require('../../components/Alert');
const { reportError } = require('../../helpers/errors');
const Biometric = require('../../class/biometrics');
const currency = require('../../blue_modules/currency');
const { BlueDarkTheme } = require('../../components/themes');
const {
  applyOutgoingSdkEvent,
  beginOutgoingPayment,
  getOutgoingPayment,
  subscribeOutgoingPayment,
  __resetOutgoingPaymentForTests,
} = require('../../api/spark/outgoing-payment');
const {
  PaymentDetails_Tags,
  PaymentStatus,
  PaymentType,
  SdkEvent_Tags,
  SendPaymentMethod_Tags,
} = require('@breeztech/breez-sdk-spark-react-native');

const SAMPLE_INVOICE =
  'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp';
const SPARK_INVOICE = bech32m.encode('spark', bech32m.toWords(Buffer.from('dfx reusable sats invoice')), 10000);
const LNURL_PAY_SUCCESS_DISPLAY = {
  domain: 'example.com',
  description: 'tea',
  lnurl: 'LNURL1TEST',
  repeatable: false,
};

function makeWallet() {
  const wallet = SparkWallet.create('pk-pay');
  wallet.getID = () => 'spark-pay-1';
  wallet.balance = 1_000_000;
  wallet.payInvoice = jest.fn();
  wallet.paySparkInvoice = jest.fn();
  wallet.payLnurlMax = jest.fn();
  wallet.getLnurlMaxFeeQuote = jest.fn().mockResolvedValue({
    amountSats: 1000,
    walletIdentity: 'pk-pay',
    requestKey: 'test-request',
    feeSats: 4,
  });
  wallet.getPaymentFeeQuote = jest.fn().mockResolvedValue({
    invoice: SPARK_INVOICE,
    amountSats: 1000,
    walletIdentity: 'pk-pay',
    method: SendPaymentMethod_Tags.SparkInvoice,
    feeSats: 4,
  });
  return wallet;
}

function makeLndhubWallet() {
  return {
    type: LightningCustodianWallet.type,
    getID: () => 'lndhub-pay-1',
    getBalance: () => 1_000_000,
    getPreferredBalanceUnit: () => BitcoinUnit.SATS,
    payInvoice: jest.fn(),
    decodeInvoice: jest.fn(),
  };
}

function makeLdsWallet() {
  return {
    type: LightningLdsWallet.type,
    getID: () => 'lds-pay-1',
    getBalance: () => 1_000_000,
    getPreferredBalanceUnit: () => BitcoinUnit.SATS,
    payInvoice: jest.fn(),
    decodeInvoice: jest.fn(),
  };
}

function mockLnurlDomain(domain) {
  jest.spyOn(Lnurl.prototype, 'callLnurlPayService').mockResolvedValue({ description: 'tea', domain });
  jest.spyOn(Lnurl.prototype, 'getDomain').mockReturnValue(domain);
}

function feeRangeText(max) {
  return `${loc.send.create_fee}: 0 ${BitcoinUnit.SATS} - ${max} ${BitcoinUnit.SATS}`;
}

function freeFeeText() {
  return `${loc.send.create_fee}: ${loc._.free}`;
}

function renderPay(wallet, extraParams = {}) {
  mockRouteParams.walletID = wallet.getID();
  mockRouteParams.routeId = 'route-1';
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

function rerenderPay(screen, wallet) {
  screen.rerender(
    <BlueStorageContext.Provider value={{ wallets: [wallet], refreshAllWalletTransactions: jest.fn() }}>
      <LnurlPay />
    </BlueStorageContext.Provider>,
  );
}

function getPayButton(screen) {
  const { BlueButton } = require('../../BlueComponents');
  return screen.UNSAFE_getAllByType(BlueButton).find(button => button.props.title === loc.lnd.payButton);
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockSparkSdk.prepareSendPayment.mockReset();
  mockSparkSdk.sendPayment.mockReset();
  await AsyncStorage.clear();
  mockRandomCounter = 0;
  mockRandomBytes.mockImplementation(async size => Buffer.alloc(size, ++mockRandomCounter));
  mockRouteKey = 'lnurl-pay-test-route-1';
  for (const key of Object.keys(mockRouteParams)) {
    delete mockRouteParams[key];
  }
  mockUseSparkContext.mockReturnValue({
    isConnected: true,
    isConnecting: false,
    isCreating: false,
    createSparkWallet: jest.fn(),
    outgoingPayment: null,
  });
});

describe('LnurlPay Spark invoice mode', () => {
  afterEach(() => {
    Biometric.isBiometricUseCapableAndEnabled.mockResolvedValue(false);
    Biometric.unlockWithBiometrics.mockResolvedValue(true);
    jest.restoreAllMocks();
  });

  it('blocks a real SparkWallet payment when the send fee exceeds the previously quoted fee', async () => {
    mockSparkSdk.prepareSendPayment
      .mockResolvedValueOnce({
        amount: 250000n,
        paymentMethod: {
          tag: SendPaymentMethod_Tags.Bolt11Invoice,
          inner: { lightningFeeSats: 1n, sparkTransferFeeSats: undefined },
        },
      })
      .mockResolvedValueOnce({
        amount: 250000n,
        paymentMethod: {
          tag: SendPaymentMethod_Tags.Bolt11Invoice,
          inner: { lightningFeeSats: 50n, sparkTransferFeeSats: undefined },
        },
      })
      .mockResolvedValueOnce({
        amount: 250000n,
        paymentMethod: {
          tag: SendPaymentMethod_Tags.Bolt11Invoice,
          inner: { lightningFeeSats: 50n, sparkTransferFeeSats: undefined },
        },
      })
      .mockResolvedValueOnce({
        amount: 250000n,
        paymentMethod: {
          tag: SendPaymentMethod_Tags.Bolt11Invoice,
          inner: { lightningFeeSats: 50n, sparkTransferFeeSats: undefined },
        },
      });
    mockSparkSdk.sendPayment.mockResolvedValue({
      payment: { id: 'payment-1', paymentType: PaymentType.Send, status: PaymentStatus.Completed },
    });

    const wallet = SparkWallet.create('pk-pay');
    wallet.getID = () => 'spark-pay-real-method';
    wallet.balance = 1_000_000;
    const screen = renderPay(wallet, { amountSat: 250000 });

    await waitFor(() => screen.getByText(`${loc.send.create_fee}: 1 ${BitcoinUnit.SATS}`));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });

    assert.strictEqual(mockSparkSdk.sendPayment.mock.calls.length, 0);
    await waitFor(() => screen.getByText(`${loc.send.create_fee}: 50 ${BitcoinUnit.SATS}`));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });
    await waitFor(() => expect(mockSparkSdk.sendPayment).toHaveBeenCalledTimes(1));
    const sentPrepare = mockSparkSdk.sendPayment.mock.calls[0][0].prepareResponse;
    assert.ok(sentPrepare.paymentMethod.inner.lightningFeeSats <= 50n);
  });

  it('shows the prepared Spark fee before paying instead of a percentage range', async () => {
    const wallet = makeWallet();
    const screen = renderPay(wallet, { invoice: undefined, sparkInvoice: SPARK_INVOICE, amountUnit: undefined });

    await waitFor(() => screen.getByText(`${loc.send.create_fee}: 4 ${BitcoinUnit.SATS}`));
    expect(wallet.getPaymentFeeQuote).toHaveBeenCalledWith(SPARK_INVOICE, 1000);
    assert.strictEqual(screen.queryByText(feeRangeText(Math.round(1000 * 0.03))), null);
    expect(wallet.paySparkInvoice).not.toHaveBeenCalled();
  });

  it('blocks payment and shows a localized retryable error when the Spark fee cannot be prepared', async () => {
    const wallet = makeWallet();
    wallet.getPaymentFeeQuote.mockRejectedValueOnce(new Error('fee unavailable')).mockResolvedValueOnce({
      invoice: SPARK_INVOICE,
      amountSats: 1000,
      walletIdentity: 'pk-pay',
      method: SendPaymentMethod_Tags.SparkInvoice,
      feeSats: 4,
    });
    const screen = renderPay(wallet, { invoice: undefined, sparkInvoice: SPARK_INVOICE, amountUnit: undefined });

    await waitFor(() => screen.getByText(loc.send.create_fee + ': ' + loc.send.server_error));
    const payButton = screen.getByText(loc.lnd.payButton);
    expect(payButton).toBeTruthy();
    await act(async () => {
      fireEvent.press(payButton);
    });
    expect(wallet.paySparkInvoice).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.press(screen.getByText(loc.wallets.list_tryagain));
    });
    await waitFor(() => screen.getByText(`${loc.send.create_fee}: 4 ${BitcoinUnit.SATS}`));
    expect(wallet.getPaymentFeeQuote).toHaveBeenCalledTimes(2);
    expect(wallet.paySparkInvoice).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });

  it('pays a fixed Spark invoice without creating or querying an LNURL', async () => {
    const wallet = makeWallet();
    wallet.paySparkInvoice.mockResolvedValue({ status: 'completed', paymentHash: 'spark-payment-1', fee: 2 });
    const callLnurlPayService = jest.spyOn(Lnurl.prototype, 'callLnurlPayService');
    const screen = renderPay(wallet, { invoice: undefined, sparkInvoice: SPARK_INVOICE, amountUnit: undefined });

    await waitFor(() => screen.getByText(loc.lnd.payButton));
    assert.strictEqual(screen.queryByText(feeRangeText(Math.round(1000 * 0.03))), null);
    assert.strictEqual(screen.queryByText(freeFeeText()), null);
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });

    await waitFor(() => expect(wallet.paySparkInvoice).toHaveBeenCalledTimes(1));
    const [paidInvoice, paidAmount, seed] = wallet.paySparkInvoice.mock.calls[0];
    assert.strictEqual(paidInvoice, SPARK_INVOICE);
    assert.strictEqual(paidAmount, 1000);
    assert.match(seed, /^[0-9a-f]{32}$/);
    assert.notStrictEqual(seed, mockRouteKey);
    await waitFor(() => expect(AsyncStorage.removeItem).toHaveBeenCalledTimes(1));
    expect(wallet.payInvoice).not.toHaveBeenCalled();
    expect(callLnurlPayService).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('Success', {
      amount: 1000,
      amountUnit: BitcoinUnit.SATS,
      fee: 2,
      invoiceDescription: undefined,
    });
  });

  it('reuses the persisted Spark idempotency seed when the same pending operation is reopened', async () => {
    const wallet = makeWallet();
    wallet.paySparkInvoice.mockResolvedValue({ status: 'pending', paymentHash: 'spark-payment-first-open' });
    const screen = renderPay(wallet, { invoice: undefined, sparkInvoice: SPARK_INVOICE, amountUnit: undefined });

    await waitFor(() => screen.getByText(loc.lnd.payButton));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });
    await waitFor(() => expect(wallet.paySparkInvoice).toHaveBeenCalledTimes(1));
    const firstSeed = wallet.paySparkInvoice.mock.calls[0][2];

    screen.unmount();
    mockRouteKey = 'lnurl-pay-test-route-2';
    const reopenedWallet = makeWallet();
    reopenedWallet.paySparkInvoice.mockResolvedValue({ status: 'pending', paymentHash: 'spark-payment-reopened' });
    const reopenedScreen = renderPay(reopenedWallet, { invoice: undefined, sparkInvoice: SPARK_INVOICE, amountUnit: undefined });

    await waitFor(() => reopenedScreen.getByText(loc.lnd.payButton));
    await act(async () => {
      fireEvent.press(reopenedScreen.getByText(loc.lnd.payButton));
    });

    await waitFor(() => expect(reopenedWallet.paySparkInvoice).toHaveBeenCalledTimes(1));
    assert.strictEqual(firstSeed, reopenedWallet.paySparkInvoice.mock.calls[0][2]);
    expect(mockRandomBytes).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.getItem).toHaveBeenCalledTimes(2);
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
  });

  it('creates a new Spark idempotency seed after the previous operation completed', async () => {
    const wallet = makeWallet();
    wallet.paySparkInvoice.mockResolvedValue({ status: 'completed', paymentHash: 'spark-payment-completed' });
    const screen = renderPay(wallet, { invoice: undefined, sparkInvoice: SPARK_INVOICE, amountUnit: undefined });

    await waitFor(() => screen.getByText(loc.lnd.payButton));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });
    await waitFor(() => expect(AsyncStorage.removeItem).toHaveBeenCalledTimes(1));
    const completedSeed = wallet.paySparkInvoice.mock.calls[0][2];

    screen.unmount();
    const nextWallet = makeWallet();
    nextWallet.paySparkInvoice.mockResolvedValue({ status: 'pending', paymentHash: 'spark-payment-next-sale' });
    const nextScreen = renderPay(nextWallet, { invoice: undefined, sparkInvoice: SPARK_INVOICE, amountUnit: undefined });

    await waitFor(() => nextScreen.getByText(loc.lnd.payButton));
    await act(async () => {
      fireEvent.press(nextScreen.getByText(loc.lnd.payButton));
    });
    await waitFor(() => expect(nextWallet.paySparkInvoice).toHaveBeenCalledTimes(1));
    assert.notStrictEqual(completedSeed, nextWallet.paySparkInvoice.mock.calls[0][2]);
    expect(mockRandomBytes).toHaveBeenCalledTimes(2);
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(2);
  });

  it('creates different Spark idempotency seeds for different operations even when the navigation key is reused', async () => {
    const wallet = makeWallet();
    wallet.paySparkInvoice.mockResolvedValue({ status: 'pending', paymentHash: 'spark-payment-route-1' });
    const screen = renderPay(wallet, { invoice: undefined, sparkInvoice: SPARK_INVOICE, amountUnit: undefined, routeId: 'route-1' });

    await waitFor(() => screen.getByText(loc.lnd.payButton));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });
    await waitFor(() => expect(wallet.paySparkInvoice).toHaveBeenCalledTimes(1));
    const firstSeed = wallet.paySparkInvoice.mock.calls[0][2];

    screen.unmount();
    const otherWallet = makeWallet();
    otherWallet.paySparkInvoice.mockResolvedValue({ status: 'pending', paymentHash: 'spark-payment-route-2' });
    const otherScreen = renderPay(otherWallet, {
      invoice: undefined,
      sparkInvoice: SPARK_INVOICE,
      amountUnit: undefined,
      routeId: 'route-2',
    });

    await waitFor(() => otherScreen.getByText(loc.lnd.payButton));
    await act(async () => {
      fireEvent.press(otherScreen.getByText(loc.lnd.payButton));
    });
    await waitFor(() => expect(otherWallet.paySparkInvoice).toHaveBeenCalledTimes(1));
    assert.notStrictEqual(firstSeed, otherWallet.paySparkInvoice.mock.calls[0][2]);
    expect(mockRandomBytes).toHaveBeenCalledTimes(2);
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(2);
  });

  it('restores the Spark pay button when paySparkInvoice rejects because the session is gone', async () => {
    const { SparkSessionStaleError } = require('../../api/spark/spark-sdk');
    const wallet = makeWallet();
    wallet.paySparkInvoice.mockRejectedValue(new SparkSessionStaleError());
    const screen = renderPay(wallet, { invoice: undefined, sparkInvoice: SPARK_INVOICE, amountUnit: undefined });

    await waitFor(() => screen.getByText(loc.lnd.payButton));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });

    await waitFor(() => expect(alert).toHaveBeenCalledWith('Spark session is no longer the one this call started with'));
    await waitFor(() => screen.getByText(loc.lnd.payButton));
    expect(getPayButton(screen).props.disabled).toBe(false);
    assert.strictEqual(screen.queryByText(loc.wallets.lightning_spark_payment_in_transit), null);
    expect(wallet.paySparkInvoice).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows Spark invoice payments as pending and applies the existing biometric gate', async () => {
    Biometric.isBiometricUseCapableAndEnabled.mockResolvedValue(true);
    Biometric.unlockWithBiometrics.mockResolvedValue(true);
    const wallet = makeWallet();
    wallet.paySparkInvoice.mockResolvedValue({ status: 'pending', paymentHash: 'spark-payment-pending' });
    const screen = renderPay(wallet, { invoice: undefined, sparkInvoice: SPARK_INVOICE, amountUnit: undefined });

    await waitFor(() => screen.getByText(loc.lnd.payButton));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });

    await waitFor(() => screen.getByText(loc.wallets.lightning_spark_payment_in_transit));
    expect(Biometric.unlockWithBiometrics).toHaveBeenCalledTimes(1);
    expect(wallet.paySparkInvoice).toHaveBeenCalledTimes(1);
    assert.strictEqual(screen.queryByText(loc.lnd.payButton), null);
  });

  it('releases the persisted seed when a pending Spark payment completes through an SDK event', async () => {
    const wallet = makeWallet();
    wallet.paySparkInvoice.mockResolvedValue({ status: 'pending', paymentHash: 'spark-payment-event-completed', fee: 2 });
    const screen = renderPay(wallet, { invoice: undefined, sparkInvoice: SPARK_INVOICE, amountUnit: undefined });

    await waitFor(() => screen.getByText(loc.lnd.payButton));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });
    await waitFor(() => screen.getByText(loc.wallets.lightning_spark_payment_in_transit));
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();

    mockUseSparkContext.mockReturnValue({
      isConnected: true,
      isConnecting: false,
      isCreating: false,
      createSparkWallet: jest.fn(),
      outgoingPayment: { status: 'completed', paymentHash: 'spark-payment-event-completed' },
    });
    screen.rerender(
      <BlueStorageContext.Provider value={{ wallets: [wallet], refreshAllWalletTransactions: jest.fn() }}>
        <LnurlPay />
      </BlueStorageContext.Provider>,
    );

    await waitFor(() => expect(AsyncStorage.removeItem).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('Success', expect.objectContaining({ amount: 1000, amountUnit: BitcoinUnit.SATS, fee: 2 })),
    );
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

  it('restores the pay button without a spinner when a pending payment later fails', async () => {
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
      outgoingPayment: { status: 'failed', paymentHash: decoded.payment_hash },
    });
    screen.rerender(
      <BlueStorageContext.Provider value={{ wallets: [wallet], refreshAllWalletTransactions: jest.fn() }}>
        <LnurlPay />
      </BlueStorageContext.Provider>,
    );

    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(alert).toHaveBeenCalledWith(loc.wallets.lightning_spark_payment_failed);
    expect(alert).not.toHaveBeenCalledWith(loc.wallets.lightning_spark_payment_in_transit);
    await waitFor(() => screen.getByText(loc.lnd.payButton));
    expect(screen.UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
    assert.strictEqual(screen.queryByText(loc.wallets.lightning_spark_payment_in_transit), null);
    expect(wallet.payInvoice).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('leaves a pending send in transit when the SDK reports an unrecognized status', async () => {
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
      outgoingPayment: { status: 'unknown', paymentHash: decoded.payment_hash },
    });
    screen.rerender(
      <BlueStorageContext.Provider value={{ wallets: [wallet], refreshAllWalletTransactions: jest.fn() }}>
        <LnurlPay />
      </BlueStorageContext.Provider>,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(alert).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByText(loc.wallets.lightning_spark_payment_in_transit)).toBeTruthy();
  });

  it('navigates after a pending LNURL payment succeeds even when storing the success rejects', async () => {
    const wallet = makeWallet();
    const decoded = wallet.decodeInvoice(SAMPLE_INVOICE);
    const storageError = new Error('storage unavailable');
    jest.spyOn(Lnurl.prototype, 'callLnurlPayService').mockResolvedValue({ description: 'tea', domain: 'example.com' });
    jest.spyOn(Lnurl.prototype, 'getDomain').mockReturnValue('example.com');
    jest.spyOn(Lnurl.prototype, 'getDescription').mockReturnValue('tea');
    jest.spyOn(Lnurl.prototype, 'getImage').mockReturnValue(undefined);
    jest.spyOn(Lnurl.prototype, 'getDisposable').mockReturnValue(true);
    jest.spyOn(Lnurl.prototype, 'getSuccessAction').mockReturnValue(undefined);
    jest.spyOn(Lnurl.prototype, 'getCommentAllowed').mockReturnValue(false);
    jest.spyOn(Lnurl.prototype, 'requestBolt11FromLnurlPayService').mockResolvedValue({ pr: SAMPLE_INVOICE });
    const storeSuccess = jest.spyOn(Lnurl.prototype, 'storeSuccess').mockRejectedValue(storageError);
    wallet.payInvoice.mockResolvedValue({ status: 'pending', paymentHash: decoded.payment_hash });
    const screen = renderPay(wallet, { invoice: undefined, lnurl: 'LNURL1TEST' });

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

    await waitFor(() => expect(reportError).toHaveBeenCalledWith('lnurlPay: failed to store LNURL success', storageError));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(storeSuccess).toHaveBeenCalledWith(decoded.payment_hash, 'pre-1');
    expect(mockNavigate).toHaveBeenCalledWith('SendDetailsRoot', {
      screen: 'LnurlPaySuccess',
      params: {
        paymentHash: decoded.payment_hash,
        justPaid: true,
        fromWalletID: 'spark-pay-1',
        lnurlPay: LNURL_PAY_SUCCESS_DISPLAY,
      },
    });
    expect(alert).not.toHaveBeenCalled();
  });
});

describe('LnurlPay fee mark', () => {
  afterEach(() => {
    global.__forbidSparkFreeFee = false;
    global.__sparkFreeFeeShown = false;
    jest.restoreAllMocks();
  });

  async function renderSparkPaymentScreen(wallet, extraParams) {
    global.__forbidSparkFreeFee = true;
    global.__sparkFreeFeeShown = false;
    try {
      const screen = renderPay(wallet, extraParams);
      await waitFor(() => screen.getByText(loc.lnd.payButton));
      return screen;
    } catch (e) {
      if (global.__sparkFreeFeeShown) {
        throw new Error('fee line showed Free for a Spark payment');
      }
      throw e;
    }
  }

  it('does not show a guessed fee range or Free for a Spark payment to a listed free domain', async () => {
    mockLnurlDomain('lightning.space');
    const screen = await renderSparkPaymentScreen(makeWallet(), { invoice: undefined, lnurl: 'LNURL1TEST' });
    assert.strictEqual(screen.queryByText(feeRangeText(Math.round(1000 * 0.03))), null);
    assert.strictEqual(screen.queryByText(freeFeeText()), null);
  });

  it('still shows Free for an LNDHub payment to a listed free domain', async () => {
    mockLnurlDomain('lightning.space');
    const wallet = makeLndhubWallet();
    const screen = renderPay(wallet, { invoice: undefined, lnurl: 'LNURL1TEST', walletID: wallet.getID() });

    await waitFor(() => screen.getByText(freeFeeText()));
    assert.strictEqual(screen.queryByText(loc.lnd.payButton) === null, false);
  });

  it('does not show a guessed fee range or Free for a Spark payment of an invoice marked free', async () => {
    const screen = await renderSparkPaymentScreen(makeWallet(), { free: true });
    assert.strictEqual(screen.queryByText(feeRangeText(Math.round(1000 * 0.03))), null);
    assert.strictEqual(screen.queryByText(freeFeeText()), null);
  });

  it('still shows Free for an LNDHub payment of an invoice marked free', async () => {
    const wallet = makeLndhubWallet();
    const screen = renderPay(wallet, { free: true });

    await waitFor(() => screen.getByText(freeFeeText()));
    assert.strictEqual(screen.queryByText(feeRangeText(Math.round(1000 * 0.03))), null);
  });

  it('does not show a guessed fee range for a small Spark payment', async () => {
    mockLnurlDomain('example.com');
    const amountSat = 10;
    const wallet = makeWallet();
    const screen = renderPay(wallet, { invoice: undefined, lnurl: 'LNURL1TEST', amountSat });

    await waitFor(() => screen.getByText(loc.lnd.payButton));
    assert.strictEqual(screen.queryByText(feeRangeText(1)), null);
    assert.strictEqual(screen.queryByText(feeRangeText(0)), null);
    assert.strictEqual(screen.queryByText(freeFeeText()), null);
  });

  it('still shows Free for an LDS payment to an internal DFX domain', async () => {
    mockLnurlDomain('api.dfx.swiss');
    const wallet = makeLdsWallet();
    const screen = renderPay(wallet, { invoice: undefined, lnurl: 'LNURL1TEST', walletID: wallet.getID() });

    await waitFor(() => screen.getByText(freeFeeText()));
    assert.strictEqual(screen.queryByText(loc.lnd.payButton) === null, false);
  });

  it('shows the 3-percent LNDHub fee range for a domain that is not free', async () => {
    mockLnurlDomain('example.com');
    const wallet = makeLndhubWallet();
    const screen = renderPay(wallet, { invoice: undefined, lnurl: 'LNURL1TEST', walletID: wallet.getID() });

    await waitFor(() => screen.getByText(feeRangeText(Math.round(1000 * 0.03))));
    assert.strictEqual(screen.queryByText(freeFeeText()), null);
  });
});

describe('LnurlPay remaining payment paths', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    Biometric.isBiometricUseCapableAndEnabled.mockResolvedValue(false);
    Biometric.unlockWithBiometrics.mockResolvedValue(true);
  });

  function mockLnurlPay({ domain = 'example.com', description = 'tea', image, getMin, getCommentAllowed } = {}) {
    jest.spyOn(Lnurl.prototype, 'callLnurlPayService').mockResolvedValue({ description, domain, image });
    jest.spyOn(Lnurl.prototype, 'getDomain').mockReturnValue(domain);
    jest.spyOn(Lnurl.prototype, 'getDescription').mockReturnValue(description);
    jest.spyOn(Lnurl.prototype, 'getImage').mockReturnValue(image);
    jest.spyOn(Lnurl.prototype, 'getDisposable').mockReturnValue(true);
    jest.spyOn(Lnurl.prototype, 'getSuccessAction').mockReturnValue(undefined);
    jest.spyOn(Lnurl.prototype, 'getCommentAllowed').mockReturnValue(getCommentAllowed ?? false);
    jest.spyOn(Lnurl.prototype, 'getMin').mockReturnValue(getMin ?? 1);
    jest.spyOn(Lnurl.prototype, 'requestBolt11FromLnurlPayService').mockResolvedValue({ pr: SAMPLE_INVOICE });
    return jest.spyOn(Lnurl.prototype, 'storeSuccess').mockResolvedValue(undefined);
  }

  it('requests a new LNURL invoice after a non-fee pay error instead of retrying the cached invoice', async () => {
    mockLnurlPay();
    const firstInvoice = SAMPLE_INVOICE;
    const secondInvoice = 'lnbc1-new-after-expiry';
    Lnurl.prototype.requestBolt11FromLnurlPayService
      .mockResolvedValueOnce({ pr: firstInvoice })
      .mockResolvedValueOnce({ pr: secondInvoice });
    const wallet = makeWallet();
    wallet.payInvoice.mockRejectedValue(new Error('invoice expired'));
    const screen = renderPay(wallet, { invoice: undefined, lnurl: 'LNURL1TEST' });

    await waitFor(() => screen.getByText(`${loc.send.create_fee}: 4 ${BitcoinUnit.SATS}`));
    await waitFor(() => expect(Lnurl.prototype.requestBolt11FromLnurlPayService).toHaveBeenCalledTimes(1));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });

    await waitFor(() => expect(alert).toHaveBeenCalledWith('invoice expired'));
    expect(wallet.payInvoice).toHaveBeenCalledTimes(1);
    expect(wallet.payInvoice).toHaveBeenCalledWith(firstInvoice, 1000, expect.objectContaining({ feeSats: 4 }));
    await waitFor(() => screen.getByText(loc.lnd.payButton));

    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });

    await waitFor(() => expect(Lnurl.prototype.requestBolt11FromLnurlPayService).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(wallet.getPaymentFeeQuote).toHaveBeenCalledWith(secondInvoice, 1000));
    expect(wallet.payInvoice.mock.calls.map(call => call[0])).toEqual([firstInvoice]);
  });

  it('keeps the spinner up while the LNURL pay service has not returned an amount', () => {
    jest.spyOn(Lnurl.prototype, 'callLnurlPayService').mockReturnValue(new Promise(() => {}));
    const wallet = makeWallet();
    const screen = renderPay(wallet, { invoice: undefined, lnurl: 'LNURL1TEST' });

    expect(screen.UNSAFE_queryAllByType(ActivityIndicator).length).toBeGreaterThan(0);
    expect(screen.queryByText(loc.lnd.payButton)).toBeNull();
    screen.unmount();
  });

  it('alerts and pops when the LNURL pay service rejects', async () => {
    const serviceError = new Error('lnurl down');
    jest.spyOn(Lnurl.prototype, 'callLnurlPayService').mockRejectedValue(serviceError);
    const wallet = makeWallet();
    renderPay(wallet, { invoice: undefined, lnurl: 'LNURL1TEST' });

    await waitFor(() => expect(alert).toHaveBeenCalledWith('lnurl down'));
    expect(mockPop).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('loads the LNURL pay service from a Lightning address destination', async () => {
    mockLnurlPay();
    const wallet = makeWallet();
    const screen = renderPay(wallet, { invoice: undefined, lnurl: undefined, destination: 'lnaddress@zbd.gg' });

    await waitFor(() => screen.getByText(loc.lnd.payButton));
    expect(Lnurl.prototype.callLnurlPayService).toHaveBeenCalled();
    expect(screen.getByText('example.com')).toBeTruthy();
  });

  it('alerts and goes back when the LNURL amount is missing', async () => {
    mockLnurlPay({ getMin: 0 });
    const wallet = makeWallet();
    renderPay(wallet, { invoice: undefined, lnurl: 'LNURL1TEST', amountSat: undefined });

    await waitFor(() => expect(alert).toHaveBeenCalledWith('Internal error: incorrect LNURL amount'));
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('uses the LNURL min amount when amountSat is not provided', async () => {
    mockLnurlPay({ getMin: 750 });
    const wallet = makeWallet();
    const screen = renderPay(wallet, { invoice: undefined, lnurl: 'LNURL1TEST', amountSat: undefined });

    await waitFor(() => screen.getByText(loc.lnd.payButton));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });

    await waitFor(() => expect(wallet.payInvoice).toHaveBeenCalledWith(SAMPLE_INVOICE, 750, expect.objectContaining({ feeSats: 4 })));
    expect(Lnurl.prototype.requestBolt11FromLnurlPayService).toHaveBeenCalledWith(750, undefined);
  });

  it('blocks a rendered LNURL payment when the returned invoice amount differs', async () => {
    mockLnurlPay({ getMin: 1000 });
    jest.spyOn(Lnurl.prototype, 'requestBolt11FromLnurlPayService').mockResolvedValue({ pr: SAMPLE_INVOICE });
    mockSparkSdk.prepareSendPayment.mockResolvedValue({
      amount: 999n,
      paymentMethod: {
        tag: SendPaymentMethod_Tags.Bolt11Invoice,
        inner: { lightningFeeSats: 1n, sparkTransferFeeSats: undefined },
      },
    });
    const wallet = SparkWallet.create('pk-pay');
    wallet.getID = () => 'spark-pay-amount-mismatch';
    wallet.balance = 1_000_000;
    const screen = renderPay(wallet, { invoice: undefined, lnurl: 'LNURL1TEST', amountSat: 1000 });

    await waitFor(() => screen.getByText(loc.send.create_fee + ': ' + loc.send.server_error));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });
    expect(mockSparkSdk.sendPayment).not.toHaveBeenCalled();
  });

  it('converts a BTC preferred unit amount before paying an LNURL invoice', async () => {
    mockLnurlPay();
    const wallet = makeWallet();
    wallet.getPreferredBalanceUnit = () => BitcoinUnit.BTC;
    const screen = renderPay(wallet, { invoice: undefined, lnurl: 'LNURL1TEST' });

    await waitFor(() => screen.getByText(loc.lnd.payButton));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });

    await waitFor(() => expect(currency.satoshiToBTC).toHaveBeenCalledWith(1000));
    expect(currency.btcToSatoshi).toHaveBeenCalled();
    expect(wallet.payInvoice).toHaveBeenCalledWith(SAMPLE_INVOICE, 1000, expect.objectContaining({ feeSats: 4 }));
  });

  it('pays with the cached satoshi amount after converting from local currency', async () => {
    currency.satoshiToLocalCurrency.mockReturnValue('12.34');
    mockLnurlPay();
    const wallet = makeWallet();
    wallet.getPreferredBalanceUnit = () => BitcoinUnit.LOCAL_CURRENCY;
    try {
      const screen = renderPay(wallet, { invoice: undefined, lnurl: 'LNURL1TEST' });

      await waitFor(() => screen.getByText(loc.lnd.payButton));
      await act(async () => {
        fireEvent.press(screen.getByText(loc.lnd.payButton));
      });

      await waitFor(() => expect(Lnurl.prototype.requestBolt11FromLnurlPayService).toHaveBeenCalledWith(1000, undefined));
    } finally {
      currency.satoshiToLocalCurrency.mockReturnValue('0');
    }
  });

  it('converts a local-currency invoice amount through fiat when there is no cache', async () => {
    const wallet = makeWallet();
    wallet.payInvoice.mockResolvedValue({ status: 'completed' });
    const screen = renderPay(wallet, { amountUnit: BitcoinUnit.LOCAL_CURRENCY });

    await waitFor(() => screen.getByText(loc.lnd.payButton));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });

    await waitFor(() => expect(wallet.payInvoice).toHaveBeenCalled());
    expect(currency.fiatToBTC).toHaveBeenCalled();
    expect(currency.btcToSatoshi).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('Success', expect.objectContaining({ amount: expect.any(Number) }));
  });

  it('pays an LNURL invoice in sats when the preferred unit is neither btc nor fiat', async () => {
    mockLnurlPay();
    const wallet = makeWallet();
    wallet.getPreferredBalanceUnit = () => BitcoinUnit.MAX;
    const screen = renderPay(wallet, { invoice: undefined, lnurl: 'LNURL1TEST', destination: 'not-a-lightning-address' });

    await waitFor(() => screen.getByText(loc.lnd.payButton));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });

    await waitFor(() => expect(Lnurl.prototype.requestBolt11FromLnurlPayService).toHaveBeenCalledWith(1000, undefined));
    expect(wallet.payInvoice).toHaveBeenCalledWith(SAMPLE_INVOICE, 1000, expect.objectContaining({ feeSats: 4 }));
  });

  it('shows the payload image, domain, and a differing route description', async () => {
    mockLnurlPay({ description: 'service-desc', image: 'data:image/png;base64,aaa' });
    const wallet = makeWallet();
    const screen = renderPay(wallet, {
      invoice: undefined,
      lnurl: 'LNURL1TEST',
      description: 'route-desc',
    });

    await waitFor(() => screen.getByText('service-desc'));
    expect(screen.getByText('route-desc')).toBeTruthy();
    expect(screen.getByText('example.com')).toBeTruthy();
  });

  it('sends the route description as the LNURL comment when comments are allowed', async () => {
    mockLnurlPay({ getCommentAllowed: 32 });
    const wallet = makeWallet();
    wallet.payInvoice.mockResolvedValue({ status: 'completed' });
    const screen = renderPay(wallet, { invoice: undefined, lnurl: 'LNURL1TEST', description: 'please tea' });

    await waitFor(() => screen.getByText(loc.lnd.payButton));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });

    await waitFor(() => expect(Lnurl.prototype.requestBolt11FromLnurlPayService).toHaveBeenCalledWith(1000, 'please tea'));
  });

  it('sends Spark MAX through the SDK preparation without requesting a second invoice', async () => {
    mockLnurlPay({ getCommentAllowed: 32 });
    const payRequest = { callback: 'https://example.com/callback' };
    jest.spyOn(Lnurl.prototype, 'getLnurlPayRequestDetails').mockReturnValue(payRequest);
    const wallet = makeWallet();
    wallet.payLnurlMax.mockResolvedValue({ status: 'completed', paymentHash: 'max-payment-hash', fee: 2 });
    const screen = renderPay(wallet, {
      invoice: undefined,
      lnurl: 'LNURL1TEST',
      amountSat: 1000,
      description: 'please tea',
      isMax: true,
    });

    await waitFor(() => screen.getByText(loc.lnd.payButton));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });

    await waitFor(() =>
      expect(wallet.payLnurlMax).toHaveBeenCalledWith(payRequest, 1000, 'please tea', expect.objectContaining({ feeSats: 4 })),
    );
    expect(Lnurl.prototype.requestBolt11FromLnurlPayService).not.toHaveBeenCalled();
    expect(wallet.payInvoice).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('SendDetailsRoot', {
      screen: 'LnurlPaySuccess',
      params: {
        paymentHash: 'max-payment-hash',
        fee: 2,
        justPaid: true,
        fromWalletID: 'spark-pay-1',
        lnurlPay: LNURL_PAY_SUCCESS_DISPLAY,
      },
    });
  });

  it('navigates to LNURL success immediately when payInvoice is not pending', async () => {
    const storeSuccess = mockLnurlPay();
    const wallet = makeWallet();
    const decoded = wallet.decodeInvoice(SAMPLE_INVOICE);
    wallet.payInvoice.mockResolvedValue({ status: 'completed', fee: 2 });
    wallet.last_paid_invoice_result = { payment_preimage: 'pre-now' };
    const refreshAllWalletTransactions = jest.fn();
    mockRouteParams.walletID = wallet.getID();
    mockRouteParams.invoice = undefined;
    mockRouteParams.lnurl = 'LNURL1TEST';
    mockRouteParams.amountSat = 1000;
    mockRouteParams.amountUnit = BitcoinUnit.SATS;
    mockRouteParams.description = 'tea';
    const screen = render(
      <BlueStorageContext.Provider value={{ wallets: [wallet], refreshAllWalletTransactions }}>
        <LnurlPay />
      </BlueStorageContext.Provider>,
    );

    await waitFor(() => screen.getByText(loc.lnd.payButton));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('SendDetailsRoot', {
        screen: 'LnurlPaySuccess',
        params: {
          paymentHash: decoded.payment_hash,
          fee: 2,
          justPaid: true,
          fromWalletID: 'spark-pay-1',
          lnurlPay: LNURL_PAY_SUCCESS_DISPLAY,
        },
      }),
    );
    expect(storeSuccess).toHaveBeenCalledWith(decoded.payment_hash, 'pre-now');
    expect(refreshAllWalletTransactions).toHaveBeenCalled();
  });

  it('keeps an invalid AES success action out of the paid path and still navigates once', async () => {
    const decryptError = new Error('Malformed UTF-8 data');
    mockLnurlPay();
    Lnurl.prototype.getSuccessAction.mockReturnValue({
      tag: 'aes',
      ciphertext: 'invalid',
      iv: 'invalid',
      description: 'your code',
    });
    jest.spyOn(Lnurl, 'decipherAES').mockImplementation(() => {
      throw decryptError;
    });
    const wallet = makeWallet();
    const decoded = wallet.decodeInvoice(SAMPLE_INVOICE);
    wallet.payInvoice.mockResolvedValue({ status: 'completed', fee: 2 });
    wallet.last_paid_invoice_result = { payment_preimage: 'pre-now' };
    const screen = renderPay(wallet, { invoice: undefined, lnurl: 'LNURL1TEST' });

    await waitFor(() => screen.getByText(loc.lnd.payButton));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('SendDetailsRoot', {
        screen: 'LnurlPaySuccess',
        params: {
          paymentHash: decoded.payment_hash,
          fee: 2,
          justPaid: true,
          fromWalletID: 'spark-pay-1',
          lnurlPay: {
            ...LNURL_PAY_SUCCESS_DISPLAY,
            preamble: 'your code',
          },
        },
      }),
    );
    expect(reportError).toHaveBeenCalledWith('lnurlPaySuccess: failed to decrypt success action', decryptError);
    expect(wallet.payInvoice).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
    assert.strictEqual(screen.queryByText(loc.lnd.payButton), null);
  });

  it('navigates to LNURL success after an immediate pay even when storing the success rejects', async () => {
    const wallet = makeWallet();
    const decoded = wallet.decodeInvoice(SAMPLE_INVOICE);
    const storageError = new Error('storage unavailable');
    const storeSuccess = mockLnurlPay();
    storeSuccess.mockRejectedValue(storageError);
    wallet.payInvoice.mockResolvedValue({ status: 'completed', fee: 2 });
    wallet.last_paid_invoice_result = { payment_preimage: 'pre-now' };
    const screen = renderPay(wallet, { invoice: undefined, lnurl: 'LNURL1TEST' });

    await waitFor(() => screen.getByText(loc.lnd.payButton));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });

    await waitFor(() => expect(reportError).toHaveBeenCalledWith('lnurlPay: failed to store LNURL success', storageError));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('SendDetailsRoot', {
        screen: 'LnurlPaySuccess',
        params: {
          paymentHash: decoded.payment_hash,
          fee: 2,
          justPaid: true,
          fromWalletID: 'spark-pay-1',
          lnurlPay: LNURL_PAY_SUCCESS_DISPLAY,
        },
      }),
    );
    expect(storeSuccess).toHaveBeenCalledWith(decoded.payment_hash, 'pre-now');
    expect(wallet.payInvoice).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
    assert.strictEqual(screen.queryByText(loc.lnd.payButton), null);
  });

  it('navigates to LNURL success without storing when there is no preimage', async () => {
    const storeSuccess = mockLnurlPay();
    const wallet = makeWallet();
    wallet.payInvoice.mockResolvedValue({ status: 'completed' });
    const screen = renderPay(wallet, { invoice: undefined, lnurl: 'LNURL1TEST' });

    await waitFor(() => screen.getByText(loc.lnd.payButton));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('SendDetailsRoot', expect.anything()));
    expect(storeSuccess).not.toHaveBeenCalled();
  });

  it('navigates to the paid screen immediately when an invoice payment is not pending', async () => {
    const wallet = makeWallet();
    const decoded = wallet.decodeInvoice(SAMPLE_INVOICE);
    wallet.payInvoice.mockResolvedValue(undefined);
    const screen = renderPay(wallet);

    await waitFor(() => screen.getByText(loc.lnd.payButton));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('Success', {
        amount: 1000,
        amountUnit: BitcoinUnit.SATS,
        invoiceDescription: decoded.description,
      }),
    );
  });

  it('does not navigate to success when an invoice payment returns an unrecognized status', async () => {
    const wallet = makeWallet();
    wallet.payInvoice.mockResolvedValue({ status: 'unknown' });
    const screen = renderPay(wallet);

    await waitFor(() => screen.getByText(loc.lnd.payButton));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });

    await waitFor(() => expect(wallet.payInvoice).toHaveBeenCalledTimes(1));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('uses the decoded payment hash when a pending invoice result has none', async () => {
    const wallet = makeWallet();
    const decoded = wallet.decodeInvoice(SAMPLE_INVOICE);
    wallet.payInvoice.mockResolvedValue({ status: 'pending' });
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
      outgoingPayment: { status: 'completed', paymentHash: decoded.payment_hash },
    });
    screen.rerender(
      <BlueStorageContext.Provider value={{ wallets: [wallet], refreshAllWalletTransactions: jest.fn() }}>
        <LnurlPay />
      </BlueStorageContext.Provider>,
    );

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Success', expect.objectContaining({ amount: 1000 })));
    expect(wallet.last_paid_invoice_result).toBeUndefined();
  });

  it('does not finish a send when a completed SDK payment has a different payment hash', async () => {
    const wallet = makeWallet();
    wallet.decodeInvoice = jest.fn().mockReturnValue({ payment_hash: 'hash-watch', description: 'tea' });
    wallet.payInvoice.mockResolvedValue({ status: 'pending', paymentHash: 'hash-watch' });
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
      outgoingPayment: { status: 'completed', paymentHash: 'hash-other', preimage: 'pre-other' },
    });
    screen.rerender(
      <BlueStorageContext.Provider value={{ wallets: [wallet], refreshAllWalletTransactions: jest.fn() }}>
        <LnurlPay />
      </BlueStorageContext.Provider>,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
    expect(screen.queryByText(loc.lnd.payButton)).toBeNull();
    expect(screen.queryByText(loc.wallets.lightning_spark_payment_failed)).toBeNull();
  });

  it('does not finish a send when the SDK reports a pending outgoing payment', async () => {
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
      outgoingPayment: { status: 'pending', paymentHash: decoded.payment_hash },
    });
    screen.rerender(
      <BlueStorageContext.Provider value={{ wallets: [wallet], refreshAllWalletTransactions: jest.fn() }}>
        <LnurlPay />
      </BlueStorageContext.Provider>,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
    expect(screen.getByText(loc.wallets.lightning_spark_payment_in_transit)).toBeTruthy();
  });

  it('finishes a pending invoice when neither the result nor the decode has a payment hash', async () => {
    const wallet = makeWallet();
    wallet.decodeInvoice = jest.fn().mockReturnValue({ description: 'tea' });
    wallet.payInvoice.mockResolvedValue({ status: 'pending' });
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
      outgoingPayment: { status: 'completed' },
    });
    screen.rerender(
      <BlueStorageContext.Provider value={{ wallets: [wallet], refreshAllWalletTransactions: jest.fn() }}>
        <LnurlPay />
      </BlueStorageContext.Provider>,
    );

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('Success', {
        amount: 1000,
        amountUnit: BitcoinUnit.SATS,
        invoiceDescription: 'tea',
      }),
    );
  });

  it('ignores an SDK completion that arrives before this screen started a send', async () => {
    mockUseSparkContext.mockReturnValue({
      isConnected: true,
      isConnecting: false,
      isCreating: false,
      createSparkWallet: jest.fn(),
      outgoingPayment: { status: 'completed', paymentHash: 'stale', preimage: 'pre-stale' },
    });
    const wallet = makeWallet();
    const screen = renderPay(wallet);

    await waitFor(() => screen.getByText(loc.lnd.payButton));
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByText(loc.lnd.payButton)).toBeTruthy();
  });

  it('stores LNURL success from a later SDK completion when storeSuccess resolves', async () => {
    const storeSuccess = mockLnurlPay();
    const wallet = makeWallet();
    const decoded = wallet.decodeInvoice(SAMPLE_INVOICE);
    wallet.payInvoice.mockResolvedValue({ status: 'pending' });
    const screen = renderPay(wallet, { invoice: undefined, lnurl: 'LNURL1TEST' });

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
      outgoingPayment: { status: 'completed', paymentHash: decoded.payment_hash, preimage: 'pre-ok' },
    });
    screen.rerender(
      <BlueStorageContext.Provider value={{ wallets: [wallet], refreshAllWalletTransactions: jest.fn() }}>
        <LnurlPay />
      </BlueStorageContext.Provider>,
    );

    await waitFor(() => expect(storeSuccess).toHaveBeenCalledWith(decoded.payment_hash, 'pre-ok'));
    expect(mockNavigate).toHaveBeenCalledWith('SendDetailsRoot', {
      screen: 'LnurlPaySuccess',
      params: {
        paymentHash: decoded.payment_hash,
        justPaid: true,
        fromWalletID: 'spark-pay-1',
        lnurlPay: LNURL_PAY_SUCCESS_DISPLAY,
      },
    });
    expect(reportError).not.toHaveBeenCalled();
  });

  it('returns without paying when biometric unlock fails', async () => {
    Biometric.isBiometricUseCapableAndEnabled.mockResolvedValue(true);
    Biometric.unlockWithBiometrics.mockResolvedValue(false);
    const wallet = makeWallet();
    const screen = renderPay(wallet);

    await waitFor(() => screen.getByText(loc.lnd.payButton));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });

    await waitFor(() => expect(Biometric.unlockWithBiometrics).toHaveBeenCalled());
    expect(wallet.payInvoice).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByText(loc.lnd.payButton)).toBeTruthy();
    expect(screen.UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);

    Biometric.unlockWithBiometrics.mockResolvedValue(true);
    wallet.payInvoice.mockResolvedValue({ status: 'completed' });
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });
    await waitFor(() => expect(wallet.payInvoice).toHaveBeenCalledTimes(1));
  });

  it('pays after a successful biometric unlock', async () => {
    Biometric.isBiometricUseCapableAndEnabled.mockResolvedValue(true);
    Biometric.unlockWithBiometrics.mockResolvedValue(true);
    const wallet = makeWallet();
    wallet.payInvoice.mockResolvedValue({ status: 'completed' });
    const screen = renderPay(wallet);

    await waitFor(() => screen.getByText(loc.lnd.payButton));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });

    await waitFor(() => expect(wallet.payInvoice).toHaveBeenCalled());
    expect(Biometric.unlockWithBiometrics).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('Success', expect.anything());
  });

  it('alerts the pay error and restores the pay button when payInvoice rejects', async () => {
    const wallet = makeWallet();
    wallet.payInvoice.mockRejectedValue(new Error('pay exploded'));
    const screen = renderPay(wallet);

    await waitFor(() => screen.getByText(loc.lnd.payButton));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });

    await waitFor(() => expect(alert).toHaveBeenCalledWith('pay exploded'));
    await waitFor(() => screen.getByText(loc.lnd.payButton));
    expect(mockNavigate).not.toHaveBeenCalled();

    wallet.payInvoice.mockResolvedValue({ status: 'completed' });
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });
    await waitFor(() => expect(wallet.payInvoice).toHaveBeenCalledTimes(2));
    expect(mockNavigate).toHaveBeenCalledWith('Success', expect.anything());
  });

  it('admits only one payment while two taps are waiting on the same biometric check', async () => {
    let releaseBiometricCheck;
    const biometricCheck = new Promise(resolve => {
      releaseBiometricCheck = resolve;
    });
    Biometric.isBiometricUseCapableAndEnabled.mockReturnValue(biometricCheck);
    Biometric.unlockWithBiometrics.mockResolvedValue(true);
    const wallet = makeWallet();
    const decoded = wallet.decodeInvoice(SAMPLE_INVOICE);
    wallet.payInvoice.mockResolvedValue({ status: 'pending', paymentHash: decoded.payment_hash });
    const screen = renderPay(wallet);

    const payButton = await waitFor(() => screen.getByText(loc.lnd.payButton));
    act(() => {
      fireEvent.press(payButton);
      fireEvent.press(payButton);
    });
    expect(Biometric.isBiometricUseCapableAndEnabled).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseBiometricCheck(true);
      await biometricCheck;
    });
    await waitFor(() => expect(wallet.payInvoice).toHaveBeenCalledTimes(1));
    expect(Biometric.unlockWithBiometrics).toHaveBeenCalledTimes(1);
  });

  it('releases the synchronous guard after invalid satoshi input', async () => {
    const wallet = makeWallet();
    const screen = renderPay(wallet, { amountSat: 1000.5 });

    await waitFor(() => screen.getByText(loc.lnd.payButton));
    fireEvent.press(screen.getByText(loc.lnd.payButton));
    await waitFor(() => expect(alert).toHaveBeenCalledWith(loc.lnd.error_tip_invoice_not_supported));
    await waitFor(() => screen.getByText(loc.lnd.payButton));
    fireEvent.press(screen.getByText(loc.lnd.payButton));

    await waitFor(() => expect(alert).toHaveBeenCalledTimes(2));
    expect(wallet.payInvoice).not.toHaveBeenCalled();
  });

  it('shows insufficient funds and goes back from cancel when the amount exceeds the balance', async () => {
    const wallet = makeWallet();
    const screen = renderPay(wallet, { amountSat: 2_000_000 });

    await waitFor(() => screen.getByText(loc.send.insufficient_funds));
    expect(screen.queryByText(loc.lnd.payButton)).toBeNull();
    fireEvent.press(screen.getByText(loc._.cancel));
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('throws when the wallet is removed from storage after mount', async () => {
    const wallet = makeWallet();
    const screen = renderPay(wallet);
    await waitFor(() => screen.getByText(loc.lnd.payButton));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      expect(() => {
        screen.rerender(
          <BlueStorageContext.Provider value={{ wallets: [], refreshAllWalletTransactions: jest.fn() }}>
            <LnurlPay />
          </BlueStorageContext.Provider>,
        );
      }).toThrow();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('pops to the top of the parent stack from the close button', () => {
    const popToTop = jest.fn();
    const options = LnurlPay.navigationOptions(BlueDarkTheme)({
      navigation: { getParent: () => ({ popToTop }) },
      route: {},
    });
    const close = render(options.headerRight());
    fireEvent.press(close.getByTestId('NavigationCloseButton'));
    expect(popToTop).toHaveBeenCalledTimes(1);
    close.unmount();
  });
});

describe('LnurlPay remaining uncovered fee and lifecycle paths', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    Biometric.isBiometricUseCapableAndEnabled.mockResolvedValue(false);
    Biometric.unlockWithBiometrics.mockResolvedValue(true);
  });

  function mockLnurlPay({ domain = 'example.com', description = 'tea', getMin = 1, getCommentAllowed = false } = {}) {
    jest.spyOn(Lnurl.prototype, 'callLnurlPayService').mockResolvedValue({ description, domain });
    jest.spyOn(Lnurl.prototype, 'getDomain').mockReturnValue(domain);
    jest.spyOn(Lnurl.prototype, 'getDescription').mockReturnValue(description);
    jest.spyOn(Lnurl.prototype, 'getImage').mockReturnValue(undefined);
    jest.spyOn(Lnurl.prototype, 'getDisposable').mockReturnValue(true);
    jest.spyOn(Lnurl.prototype, 'getSuccessAction').mockReturnValue(undefined);
    jest.spyOn(Lnurl.prototype, 'getCommentAllowed').mockReturnValue(getCommentAllowed);
    jest.spyOn(Lnurl.prototype, 'getMin').mockReturnValue(getMin);
    jest.spyOn(Lnurl.prototype, 'requestBolt11FromLnurlPayService').mockResolvedValue({ pr: SAMPLE_INVOICE });
    return jest.spyOn(Lnurl.prototype, 'storeSuccess').mockResolvedValue(undefined);
  }

  it('reports a Spark seed cleanup failure without changing the success result', async () => {
    const wallet = makeWallet();
    wallet.paySparkInvoice.mockResolvedValue({ status: 'completed', paymentHash: 'cleanup-error', fee: 2 });
    const cleanupError = new Error('storage cleanup failed');
    AsyncStorage.removeItem.mockRejectedValueOnce(cleanupError);
    const screen = renderPay(wallet, { invoice: undefined, sparkInvoice: SPARK_INVOICE, amountUnit: undefined });

    await waitFor(() => screen.getByText(loc.lnd.payButton));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });
    await waitFor(() => expect(reportError).toHaveBeenCalledWith('lnurlPay: failed to release Spark payment seed', cleanupError));
    expect(mockNavigate).toHaveBeenCalledWith('Success', expect.objectContaining({ amount: 1000, fee: 2 }));
  });

  it('retries an LNURL MAX fee quote error and sends with the new quote', async () => {
    jest.spyOn(Lnurl.prototype, 'getLnurlPayRequestDetails').mockReturnValue({ callback: 'https://example.com/callback' });
    mockLnurlPay({ getMin: 1000 });
    const wallet = makeWallet();
    wallet.getLnurlMaxFeeQuote.mockRejectedValueOnce(new Error('max quote unavailable')).mockResolvedValueOnce({
      amountSats: 1000,
      walletIdentity: 'pk-pay',
      requestKey: 'retry-request',
      feeSats: 6,
    });
    wallet.payLnurlMax.mockResolvedValue({ status: 'completed', paymentHash: 'max-retry', fee: 6 });
    const screen = renderPay(wallet, { invoice: undefined, lnurl: 'LNURL1TEST', isMax: true });

    await waitFor(() => screen.getByText(`${loc.send.create_fee}: ${loc.send.server_error}`));
    expect(wallet.getLnurlMaxFeeQuote).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.press(screen.getByText(loc.wallets.list_tryagain));
    });
    await waitFor(() => screen.getByText(`${loc.send.create_fee}: 6 ${BitcoinUnit.SATS}`));
    expect(getPayButton(screen).props.disabled).toBe(false);
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });
    await waitFor(() => expect(wallet.payLnurlMax).toHaveBeenCalledTimes(1));
    expect(wallet.payLnurlMax).toHaveBeenCalledWith(
      { callback: 'https://example.com/callback' },
      1000,
      undefined,
      expect.objectContaining({ requestKey: 'retry-request', feeSats: 6 }),
    );
  });

  it('keeps the newer LNURL MAX quote when an older result arrives late', async () => {
    jest.spyOn(Lnurl.prototype, 'getLnurlPayRequestDetails').mockReturnValue({ callback: 'https://example.com/callback' });
    mockLnurlPay({ getMin: 1000, getCommentAllowed: true });
    Lnurl.prototype.callLnurlPayService.mockImplementation(() => Promise.resolve({ description: 'tea', domain: 'example.com' }));
    let resolveOldQuote;
    const newQuote = { amountSats: 2000, walletIdentity: 'pk-pay', requestKey: 'new-request', feeSats: 7 };
    const wallet = makeWallet();
    wallet.getLnurlMaxFeeQuote
      .mockReturnValueOnce(
        new Promise(resolve => {
          resolveOldQuote = resolve;
        }),
      )
      .mockResolvedValue(newQuote);
    wallet.payLnurlMax.mockResolvedValue({ status: 'completed', paymentHash: 'max-new', fee: 7 });
    const screen = renderPay(wallet, { invoice: undefined, lnurl: 'LNURL1TEST', isMax: true, amountSat: 1000, description: 'old-comment' });
    await waitFor(() => expect(wallet.getLnurlMaxFeeQuote).toHaveBeenCalledTimes(1));
    mockRouteParams.amountSat = 2000;
    mockRouteParams.description = 'new-comment';
    mockRouteParams.lnurl = 'LNURL1NEW';
    rerenderPay(screen, wallet);
    await waitFor(() => expect(wallet.getLnurlMaxFeeQuote.mock.calls.some(([, amountSats]) => amountSats === 2000)).toBe(true));
    await waitFor(() => screen.getByText(`${loc.send.create_fee}: 7 ${BitcoinUnit.SATS}`));
    resolveOldQuote({ amountSats: 1000, walletIdentity: 'pk-pay', requestKey: 'old-request', feeSats: 99 });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText(`${loc.send.create_fee}: 7 ${BitcoinUnit.SATS}`)).toBeTruthy();
    expect(getPayButton(screen).props.disabled).toBe(false);
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });
    await waitFor(() => expect(wallet.payLnurlMax).toHaveBeenCalledTimes(1));
    expect(wallet.payLnurlMax).toHaveBeenCalledWith({ callback: 'https://example.com/callback' }, 2000, 'new-comment', newQuote);
  });

  it('keeps the newer LNURL MAX quote when an older error arrives late', async () => {
    jest.spyOn(Lnurl.prototype, 'getLnurlPayRequestDetails').mockReturnValue({ callback: 'https://example.com/callback' });
    mockLnurlPay({ getMin: 1000, getCommentAllowed: true });
    Lnurl.prototype.callLnurlPayService.mockImplementation(() => Promise.resolve({ description: 'tea', domain: 'example.com' }));
    let rejectOldQuote;
    const newQuote = { amountSats: 2000, walletIdentity: 'pk-pay', requestKey: 'new-request', feeSats: 8 };
    const wallet = makeWallet();
    wallet.getLnurlMaxFeeQuote
      .mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          rejectOldQuote = reject;
        }),
      )
      .mockResolvedValue(newQuote);
    wallet.payLnurlMax.mockResolvedValue({ status: 'completed', paymentHash: 'max-new', fee: 8 });
    const screen = renderPay(wallet, { invoice: undefined, lnurl: 'LNURL1TEST', isMax: true, amountSat: 1000, description: 'old-comment' });
    await waitFor(() => expect(wallet.getLnurlMaxFeeQuote).toHaveBeenCalledTimes(1));
    mockRouteParams.amountSat = 2000;
    mockRouteParams.description = 'new-comment';
    mockRouteParams.lnurl = 'LNURL1NEW';
    rerenderPay(screen, wallet);
    await waitFor(() => expect(wallet.getLnurlMaxFeeQuote.mock.calls.some(([, amountSats]) => amountSats === 2000)).toBe(true));
    await waitFor(() => screen.getByText(`${loc.send.create_fee}: 8 ${BitcoinUnit.SATS}`));
    rejectOldQuote(new Error('late max error'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText(`${loc.send.create_fee}: 8 ${BitcoinUnit.SATS}`)).toBeTruthy();
    expect(getPayButton(screen).props.disabled).toBe(false);
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });
    await waitFor(() => expect(wallet.payLnurlMax).toHaveBeenCalledTimes(1));
    expect(wallet.payLnurlMax).toHaveBeenCalledWith({ callback: 'https://example.com/callback' }, 2000, 'new-comment', newQuote);
  });

  it('keeps a newer fixed-invoice quote when an older result arrives late', async () => {
    const wallet = makeWallet();
    let resolveOldQuote;
    const newQuote = {
      invoice: 'invoice-new',
      amountSats: 2000,
      walletIdentity: 'pk-pay',
      method: SendPaymentMethod_Tags.Bolt11Invoice,
      feeSats: 7,
    };
    wallet.getPaymentFeeQuote
      .mockReturnValueOnce(
        new Promise(resolve => {
          resolveOldQuote = resolve;
        }),
      )
      .mockResolvedValueOnce(newQuote);
    wallet.payInvoice.mockResolvedValue({ status: 'completed', fee: 7 });
    wallet.decodeInvoice = jest.fn().mockReturnValue({ payment_hash: 'new-payment' });
    const screen = renderPay(wallet, { invoice: 'invoice-old', amountSat: 1000 });
    await waitFor(() => expect(wallet.getPaymentFeeQuote).toHaveBeenCalledTimes(1));
    mockRouteParams.invoice = 'invoice-new';
    mockRouteParams.amountSat = 2000;
    rerenderPay(screen, wallet);
    await waitFor(() => expect(wallet.getPaymentFeeQuote).toHaveBeenCalledTimes(2));
    await waitFor(() => screen.getByText(`${loc.send.create_fee}: 7 ${BitcoinUnit.SATS}`));
    resolveOldQuote({
      invoice: 'invoice-old',
      amountSats: 1000,
      walletIdentity: 'pk-pay',
      method: SendPaymentMethod_Tags.Bolt11Invoice,
      feeSats: 99,
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText(`${loc.send.create_fee}: 7 ${BitcoinUnit.SATS}`)).toBeTruthy();
    expect(getPayButton(screen).props.disabled).toBe(false);
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });
    await waitFor(() => expect(wallet.payInvoice).toHaveBeenCalledTimes(1));
    expect(wallet.payInvoice).toHaveBeenCalledWith('invoice-new', 2000, newQuote);
  });

  it('keeps a newer fixed-invoice quote when an older error arrives late', async () => {
    const wallet = makeWallet();
    let rejectOldQuote;
    const newQuote = {
      invoice: 'invoice-new',
      amountSats: 2000,
      walletIdentity: 'pk-pay',
      method: SendPaymentMethod_Tags.Bolt11Invoice,
      feeSats: 8,
    };
    wallet.getPaymentFeeQuote
      .mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          rejectOldQuote = reject;
        }),
      )
      .mockResolvedValueOnce(newQuote);
    wallet.payInvoice.mockResolvedValue({ status: 'completed', fee: 8 });
    wallet.decodeInvoice = jest.fn().mockReturnValue({ payment_hash: 'new-payment' });
    const screen = renderPay(wallet, { invoice: 'invoice-old', amountSat: 1000 });
    await waitFor(() => expect(wallet.getPaymentFeeQuote).toHaveBeenCalledTimes(1));
    mockRouteParams.invoice = 'invoice-new';
    mockRouteParams.amountSat = 2000;
    rerenderPay(screen, wallet);
    await waitFor(() => expect(wallet.getPaymentFeeQuote).toHaveBeenCalledTimes(2));
    await waitFor(() => screen.getByText(`${loc.send.create_fee}: 8 ${BitcoinUnit.SATS}`));
    rejectOldQuote(new Error('late fixed quote error'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText(`${loc.send.create_fee}: 8 ${BitcoinUnit.SATS}`)).toBeTruthy();
    expect(getPayButton(screen).props.disabled).toBe(false);
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });
    await waitFor(() => expect(wallet.payInvoice).toHaveBeenCalledTimes(1));
    expect(wallet.payInvoice).toHaveBeenCalledWith('invoice-new', 2000, newQuote);
  });

  it('keeps a newer LNURL invoice quote when an older error arrives late', async () => {
    mockLnurlPay({ getMin: 1000 });
    const oldInvoice = 'invoice-old';
    const newInvoice = 'invoice-new';
    const newQuote = {
      invoice: newInvoice,
      amountSats: 1000,
      walletIdentity: 'pk-pay',
      method: SendPaymentMethod_Tags.Bolt11Invoice,
      feeSats: 8,
    };
    let rejectOldQuote;
    const wallet = makeWallet();
    wallet.getPaymentFeeQuote.mockImplementation(invoice => {
      if (invoice === newInvoice) return Promise.resolve(newQuote);
      return new Promise((_resolve, reject) => {
        rejectOldQuote = reject;
      });
    });
    wallet.payInvoice.mockResolvedValue({ status: 'completed', fee: 8 });
    wallet.decodeInvoice = jest.fn().mockReturnValue({ payment_hash: 'new-payment' });
    const requestPromises = [];
    jest.spyOn(Lnurl.prototype, 'requestBolt11FromLnurlPayService').mockImplementation(
      (amountSats, comment) =>
        new Promise(resolve => {
          requestPromises.push({ amountSats, comment, resolve });
        }),
    );
    const screen = renderPay(wallet, { invoice: undefined, lnurl: 'LNURL1TEST', amountSat: 1000 });
    await waitFor(() => expect(requestPromises).toHaveLength(1));
    mockRouteParams.description = 'new-comment';
    rerenderPay(screen, wallet);
    await waitFor(() => expect(requestPromises).toHaveLength(2));
    requestPromises[1].resolve({ pr: newInvoice });
    await waitFor(() => screen.getByText(`${loc.send.create_fee}: 8 ${BitcoinUnit.SATS}`));
    requestPromises[0].resolve({ pr: oldInvoice });
    await waitFor(() => expect(wallet.getPaymentFeeQuote).toHaveBeenCalledTimes(2));
    rejectOldQuote(new Error('late LNURL quote error'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText(`${loc.send.create_fee}: 8 ${BitcoinUnit.SATS}`)).toBeTruthy();
    expect(getPayButton(screen).props.disabled).toBe(false);
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });
    await waitFor(() => expect(wallet.payInvoice).toHaveBeenCalledTimes(1));
    expect(wallet.payInvoice).toHaveBeenCalledWith(newInvoice, 1000, newQuote);
  });

  it('shows an in-transit state for a pending Spark MAX payment', async () => {
    jest.spyOn(Lnurl.prototype, 'getLnurlPayRequestDetails').mockReturnValue({ callback: 'https://example.com/callback' });
    mockLnurlPay({ getMin: 1000 });
    const wallet = makeWallet();
    wallet.payLnurlMax.mockResolvedValue({ status: 'pending', paymentHash: 'max-pending', fee: 4 });
    const screen = renderPay(wallet, { invoice: undefined, lnurl: 'LNURL1TEST', isMax: true });
    await waitFor(() => screen.getByText(loc.lnd.payButton));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });
    await waitFor(() => screen.getByText(loc.wallets.lightning_spark_payment_in_transit));
  });

  it('restores the button when a Spark MAX payment returns a non-completed status', async () => {
    jest.spyOn(Lnurl.prototype, 'getLnurlPayRequestDetails').mockReturnValue({ callback: 'https://example.com/callback' });
    mockLnurlPay({ getMin: 1000 });
    const wallet = makeWallet();
    wallet.payLnurlMax.mockResolvedValue({ status: 'unknown', paymentHash: 'max-unknown', fee: 4 });
    const screen = renderPay(wallet, { invoice: undefined, lnurl: 'LNURL1TEST', isMax: true });
    await waitFor(() => screen.getByText(loc.lnd.payButton));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });
    await waitFor(() => expect(wallet.payLnurlMax).toHaveBeenCalledTimes(1));
    expect(getPayButton(screen).props.disabled).toBe(false);
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });
    await waitFor(() => expect(wallet.payLnurlMax).toHaveBeenCalledTimes(2));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('keeps a newer LNURL invoice quote when an older result arrives late', async () => {
    mockLnurlPay({ getMin: 1000 });
    const oldInvoice = 'invoice-old';
    const newInvoice = 'invoice-new';
    const newQuote = {
      invoice: newInvoice,
      amountSats: 1000,
      walletIdentity: 'pk-pay',
      method: SendPaymentMethod_Tags.Bolt11Invoice,
      feeSats: 7,
    };
    const wallet = makeWallet();
    wallet.getPaymentFeeQuote.mockImplementation(invoice =>
      invoice === newInvoice ? Promise.resolve(newQuote) : Promise.resolve({ ...newQuote, invoice: oldInvoice, feeSats: 99 }),
    );
    wallet.payInvoice.mockResolvedValue({ status: 'completed', fee: 7 });
    wallet.decodeInvoice = jest.fn().mockReturnValue({ payment_hash: 'new-payment' });
    const requestPromises = [];
    jest.spyOn(Lnurl.prototype, 'requestBolt11FromLnurlPayService').mockImplementation(
      (amountSats, comment) =>
        new Promise(resolve => {
          requestPromises.push({ amountSats, comment, resolve });
        }),
    );
    const screen = renderPay(wallet, { invoice: undefined, lnurl: 'LNURL1TEST', amountSat: 1000 });
    await waitFor(() => expect(requestPromises).toHaveLength(1));
    mockRouteParams.description = 'new-comment';
    rerenderPay(screen, wallet);
    await waitFor(() => expect(requestPromises).toHaveLength(2));
    requestPromises[1].resolve({ pr: newInvoice });
    await waitFor(() => screen.getByText(`${loc.send.create_fee}: 7 ${BitcoinUnit.SATS}`));
    requestPromises[0].resolve({ pr: oldInvoice });
    await waitFor(() => expect(wallet.getPaymentFeeQuote).toHaveBeenCalledTimes(2));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText(`${loc.send.create_fee}: 7 ${BitcoinUnit.SATS}`)).toBeTruthy();
    expect(getPayButton(screen).props.disabled).toBe(false);
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });
    await waitFor(() => expect(wallet.payInvoice).toHaveBeenCalledTimes(1));
    expect(wallet.payInvoice).toHaveBeenCalledWith(newInvoice, 1000, newQuote);
  });

  it('reports a success-display failure and still navigates after payment', async () => {
    mockLnurlPay();
    const displayError = new Error('success display unavailable');
    Lnurl.prototype.getDisposable.mockImplementationOnce(() => {
      throw displayError;
    });
    const wallet = makeWallet();
    wallet.payInvoice.mockResolvedValue({ status: 'completed', fee: 2 });
    const screen = renderPay(wallet, { invoice: undefined, lnurl: 'LNURL1TEST' });

    await waitFor(() => screen.getByText(loc.lnd.payButton));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });
    await waitFor(() => expect(reportError).toHaveBeenCalledWith('lnurlPay: failed to prepare LNURL success display', displayError));
    expect(mockNavigate).toHaveBeenCalledWith('SendDetailsRoot', expect.objectContaining({ screen: 'LnurlPaySuccess' }));
  });

  it('reports a pending LNURL completion failure when wallet result access throws', async () => {
    mockLnurlPay();
    const finishError = new Error('wallet result unavailable');
    const wallet = makeWallet();
    Object.defineProperty(wallet, 'last_paid_invoice_result', {
      configurable: true,
      get() {
        throw finishError;
      },
    });
    const decoded = wallet.decodeInvoice(SAMPLE_INVOICE);
    wallet.payInvoice.mockResolvedValue({ status: 'pending', paymentHash: decoded.payment_hash });
    const screen = renderPay(wallet, { invoice: undefined, lnurl: 'LNURL1TEST' });

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
      outgoingPayment: { status: 'completed', paymentHash: decoded.payment_hash },
    });
    screen.rerender(
      <BlueStorageContext.Provider value={{ wallets: [wallet], refreshAllWalletTransactions: jest.fn() }}>
        <LnurlPay />
      </BlueStorageContext.Provider>,
    );
    await waitFor(() => expect(reportError).toHaveBeenCalledWith('lnurlPay: failed to finish LNURL success', finishError));
  });

  it.each([
    ['completed', { status: 'completed', fee: 2 }],
    ['pending', { status: 'pending', paymentHash: 'lndhub-pending', fee: 1 }],
    ['pending without hash', { status: 'pending', fee: 1 }],
    ['unknown', { status: 'unknown' }],
  ])('handles a non-Spark LNDHub %s response', async (_label, result) => {
    mockLnurlPay();
    const wallet = makeLndhubWallet();
    wallet.decodeInvoice.mockReturnValue({ payment_hash: 'lndhub-hash', description: 'tea' });
    wallet.payInvoice.mockResolvedValue(result);
    const screen = renderPay(wallet, { invoice: undefined, lnurl: 'LNURL1TEST' });

    await waitFor(() => screen.getByText(loc.lnd.payButton));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });
    if (result.status === 'completed') {
      await waitFor(() =>
        expect(mockNavigate).toHaveBeenCalledWith('SendDetailsRoot', expect.objectContaining({ screen: 'LnurlPaySuccess' })),
      );
    } else if (result.status === 'pending') {
      await waitFor(() => screen.getByText(loc.wallets.lightning_spark_payment_in_transit));
    } else {
      await waitFor(() => expect(wallet.payInvoice).toHaveBeenCalledTimes(1));
      expect(mockNavigate).not.toHaveBeenCalled();
    }
  });

  it('records a first Spark LNURL invoice quote when the defensive handler is invoked while disabled', async () => {
    mockLnurlPay();
    const wallet = makeWallet();
    let resolveQuote;
    wallet.getPaymentFeeQuote.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveQuote = resolve;
        }),
    );
    const screen = renderPay(wallet, { invoice: undefined, lnurl: 'LNURL1TEST' });

    await waitFor(() => screen.getByText(loc.lnd.payButton));
    expect(getPayButton(screen).props.disabled).toBe(true);
    await act(async () => {
      getPayButton(screen).props.onPress();
    });
    await waitFor(() => expect(wallet.getPaymentFeeQuote).toHaveBeenCalledTimes(2));
    resolveQuote({
      invoice: SAMPLE_INVOICE,
      amountSats: 1000,
      walletIdentity: 'pk-pay',
      method: SendPaymentMethod_Tags.Bolt11Invoice,
      feeSats: 4,
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(wallet.payInvoice).not.toHaveBeenCalled();
    expect(screen.getByText(`${loc.send.create_fee}: 4 ${BitcoinUnit.SATS}`)).toBeTruthy();
    expect(getPayButton(screen).props.disabled).toBe(false);
  });

  it('restores the Spark button after a quoted invoice returns an unknown status', async () => {
    mockLnurlPay();
    const wallet = makeWallet();
    wallet.payInvoice.mockResolvedValue({ status: 'unknown' });
    const screen = renderPay(wallet, { invoice: undefined, lnurl: 'LNURL1TEST' });

    await waitFor(() => screen.getByText(loc.lnd.payButton));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });
    await waitFor(() => expect(wallet.payInvoice).toHaveBeenCalledTimes(1));
    expect(getPayButton(screen).props.disabled).toBe(false);
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });
    await waitFor(() => expect(wallet.payInvoice).toHaveBeenCalledTimes(2));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('restores the Spark button after a reusable invoice returns an unknown status', async () => {
    const wallet = makeWallet();
    wallet.paySparkInvoice.mockResolvedValue({ status: 'unknown' });
    const screen = renderPay(wallet, { invoice: undefined, sparkInvoice: SPARK_INVOICE, amountUnit: undefined });

    await waitFor(() => screen.getByText(loc.lnd.payButton));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });
    await waitFor(() => expect(wallet.paySparkInvoice).toHaveBeenCalledTimes(1));
    expect(getPayButton(screen).props.disabled).toBe(false);
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });
    await waitFor(() => expect(wallet.paySparkInvoice).toHaveBeenCalledTimes(2));
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('outgoing payment tracking across LnurlPay routes', () => {
  beforeEach(() => {
    __resetOutgoingPaymentForTests();
  });

  afterEach(() => {
    __resetOutgoingPaymentForTests();
  });

  it('notifies the older route when its SDK completion arrives after a newer payment began', () => {
    beginOutgoingPayment({ paymentHash: 'older-hash', paymentId: 'older-id', invoice: 'older-invoice' });
    beginOutgoingPayment({ paymentHash: 'newer-hash', paymentId: 'newer-id', invoice: 'newer-invoice' });
    const seen = [];
    const unsubscribe = subscribeOutgoingPayment(payment => seen.push(payment));

    applyOutgoingSdkEvent({
      tag: SdkEvent_Tags.PaymentSucceeded,
      inner: {
        payment: {
          id: 'older-id',
          paymentType: PaymentType.Send,
          status: PaymentStatus.Completed,
          amount: 1000n,
          fees: 2n,
          timestamp: 1n,
          method: {},
          details: {
            tag: PaymentDetails_Tags.Lightning,
            inner: {
              invoice: 'older-invoice',
              destinationPubkey: 'destination',
              description: 'tea',
              htlcDetails: { paymentHash: 'older-hash', preimage: 'older-preimage' },
            },
          },
        },
      },
    });
    unsubscribe();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual(
      expect.objectContaining({
        status: 'completed',
        paymentHash: 'older-hash',
        paymentId: 'older-id',
        preimage: 'older-preimage',
      }),
    );
    expect(getOutgoingPayment()).toEqual(expect.objectContaining({ status: 'pending', paymentHash: 'newer-hash', paymentId: 'newer-id' }));
  });
});
