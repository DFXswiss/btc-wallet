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
  fiatToBTC: jest.fn(() => 0.00001),
  satoshiToBTC: jest.fn(v => String(v)),
  btcToSatoshi: jest.fn(v => Number(v)),
  getCurrencySymbol: jest.fn(() => '$'),
  satoshiToLocalCurrency: jest.fn(() => '0'),
  preferredFiatCurrency: { endPointKey: 'USD' },
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
const { LightningLdsWallet } = require('../../class/wallets/lightning-lds-wallet');
const LnurlPay = require('../../screen/lnd/lnurlPay').default;
const Lnurl = require('../../class/lnurl').default;
const loc = require('../../loc').default;
const alert = require('../../components/Alert');
const { reportError } = require('../../helpers/errors');
const Biometric = require('../../class/biometrics');
const currency = require('../../blue_modules/currency');
const { BlueDarkTheme } = require('../../components/themes');

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
    jest.spyOn(Lnurl.prototype, 'getCommentAllowed').mockReturnValue(getCommentAllowed ?? false);
    jest.spyOn(Lnurl.prototype, 'getMin').mockReturnValue(getMin ?? 1);
    jest.spyOn(Lnurl.prototype, 'requestBolt11FromLnurlPayService').mockResolvedValue({ pr: SAMPLE_INVOICE });
    return jest.spyOn(Lnurl.prototype, 'storeSuccess').mockResolvedValue(undefined);
  }

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

    await waitFor(() => expect(wallet.payInvoice).toHaveBeenCalledWith(SAMPLE_INVOICE));
    expect(Lnurl.prototype.requestBolt11FromLnurlPayService).toHaveBeenCalledWith(750, undefined);
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
    expect(wallet.payInvoice).toHaveBeenCalledWith(SAMPLE_INVOICE);
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
    wallet.payInvoice.mockResolvedValue({ status: 'complete' });
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
    expect(wallet.payInvoice).toHaveBeenCalledWith(SAMPLE_INVOICE);
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
    wallet.payInvoice.mockResolvedValue({ status: 'complete' });
    const screen = renderPay(wallet, { invoice: undefined, lnurl: 'LNURL1TEST', description: 'please tea' });

    await waitFor(() => screen.getByText(loc.lnd.payButton));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.lnd.payButton));
    });

    await waitFor(() => expect(Lnurl.prototype.requestBolt11FromLnurlPayService).toHaveBeenCalledWith(1000, 'please tea'));
  });

  it('navigates to LNURL success immediately when payInvoice is not pending', async () => {
    const storeSuccess = mockLnurlPay();
    const wallet = makeWallet();
    const decoded = wallet.decodeInvoice(SAMPLE_INVOICE);
    wallet.payInvoice.mockResolvedValue({ status: 'complete' });
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

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('SendDetailsRoot', expect.anything()));
    expect(storeSuccess).toHaveBeenCalledWith(decoded.payment_hash, 'pre-now');
    expect(refreshAllWalletTransactions).toHaveBeenCalled();
  });

  it('navigates to LNURL success without storing when there is no preimage', async () => {
    const storeSuccess = mockLnurlPay();
    const wallet = makeWallet();
    wallet.payInvoice.mockResolvedValue({ status: 'complete' });
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
  });

  it('pays after a successful biometric unlock', async () => {
    Biometric.isBiometricUseCapableAndEnabled.mockResolvedValue(true);
    Biometric.unlockWithBiometrics.mockResolvedValue(true);
    const wallet = makeWallet();
    wallet.payInvoice.mockResolvedValue({ status: 'complete' });
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
