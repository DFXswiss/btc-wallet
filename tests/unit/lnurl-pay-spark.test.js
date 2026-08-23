import React from 'react';
import assert from 'assert';
import { fireEvent, render, waitFor, act } from '@testing-library/react-native';
import { ActivityIndicator } from 'react-native';
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

const { SparkWallet, sparkMaxSendFeeSats } = require('../../class/wallets/spark-wallet');
const { BlueStorageContext } = require('../../blue_modules/storage-context');
const { LightningCustodianWallet } = require('../../class');
const LnurlPay = require('../../screen/lnd/lnurlPay').default;
const Lnurl = require('../../class/lnurl').default;
const loc = require('../../loc').default;
const alert = require('../../components/Alert');
const { reportError } = require('../../helpers/errors');

const SAMPLE_INVOICE =
  'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp';

function makeWallet() {
  const wallet = SparkWallet.create('pk-pay');
  wallet.getID = () => 'spark-pay-1';
  wallet.balance = 1_000_000;
  wallet.payInvoice = jest.fn();
  return wallet;
}

function makeLndhubWallet() {
  return {
    type: LightningCustodianWallet.type,
    getID: () => 'lndhub-pay-1',
    getBalance: () => 1_000_000,
    getPreferredBalanceUnit: () => BitcoinUnit.SATS,
    payInvoice: jest.fn(),
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

  it('navigates after a pending LNURL payment succeeds even when storing the success rejects', async () => {
    const wallet = makeWallet();
    const decoded = wallet.decodeInvoice(SAMPLE_INVOICE);
    const storageError = new Error('storage unavailable');
    jest.spyOn(Lnurl.prototype, 'callLnurlPayService').mockResolvedValue({ description: 'tea', domain: 'example.com' });
    jest.spyOn(Lnurl.prototype, 'getDomain').mockReturnValue('example.com');
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

  async function renderSparkFeeScreen(wallet, extraParams) {
    global.__forbidSparkFreeFee = true;
    global.__sparkFreeFeeShown = false;
    const amountSat = extraParams.amountSat || 1000;
    try {
      const screen = renderPay(wallet, extraParams);
      await waitFor(() => screen.getByText(feeRangeText(sparkMaxSendFeeSats(amountSat))));
      return screen;
    } catch (e) {
      if (global.__sparkFreeFeeShown) {
        throw new Error('fee line showed Free for a Spark payment');
      }
      throw e;
    }
  }

  it('does not show Free for a Spark payment to a listed free domain', async () => {
    mockLnurlDomain('lightning.space');
    const screen = await renderSparkFeeScreen(makeWallet(), { invoice: undefined, lnurl: 'LNURL1TEST' });
    assert.strictEqual(screen.queryByText(freeFeeText()), null);
  });

  it('still shows Free for an LNDHub payment to a listed free domain', async () => {
    mockLnurlDomain('lightning.space');
    const wallet = makeLndhubWallet();
    const screen = renderPay(wallet, { invoice: undefined, lnurl: 'LNURL1TEST', walletID: wallet.getID() });

    await waitFor(() => screen.getByText(freeFeeText()));
    assert.strictEqual(screen.queryByText(loc.lnd.payButton) === null, false);
  });

  it('does not show Free for a Spark payment of an invoice marked free', async () => {
    const screen = await renderSparkFeeScreen(makeWallet(), { free: true });
    assert.strictEqual(screen.queryByText(freeFeeText()), null);
  });

  it('still shows Free for an LNDHub payment of an invoice marked free', async () => {
    const wallet = makeLndhubWallet();
    const screen = renderPay(wallet, { free: true });

    await waitFor(() => screen.getByText(freeFeeText()));
    assert.strictEqual(screen.queryByText(feeRangeText(sparkMaxSendFeeSats(1000))), null);
  });

  it('shows the Spark-enforced fee cap for a small amount, not a rounded 0', async () => {
    mockLnurlDomain('example.com');
    const amountSat = 10;
    const wallet = makeWallet();
    const screen = renderPay(wallet, { invoice: undefined, lnurl: 'LNURL1TEST', amountSat });

    await waitFor(() => screen.getByText(feeRangeText(sparkMaxSendFeeSats(amountSat))));
    assert.strictEqual(sparkMaxSendFeeSats(amountSat), 1);
    assert.strictEqual(Math.round(amountSat * 0.03), 0);
    assert.strictEqual(screen.queryByText(feeRangeText(0)), null);
    assert.strictEqual(screen.queryByText(freeFeeText()), null);
  });
});
