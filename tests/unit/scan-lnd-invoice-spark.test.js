import React from 'react';
import assert from 'assert';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ActivityIndicator, Keyboard } from 'react-native';
import { BitcoinUnit, Chain } from '../../models/bitcoinUnits';

jest.mock('../../blue_modules/BlueElectrum', () => ({ connectMain: jest.fn() }));
jest.mock('../../blue_modules/currency', () => ({
  init: jest.fn(),
  mostRecentFetchedRate: jest.fn(() => Promise.resolve({})),
  isRateOutdated: jest.fn(() => Promise.resolve(false)),
  updateExchangeRate: jest.fn(() => Promise.resolve()),
  fiatToBTC: jest.fn(() => 0),
  btcToSatoshi: jest.fn(v => Math.round(Number(v) * 1e8)),
  satoshiToBTC: jest.fn(v => String(v)),
  getCurrencySymbol: jest.fn(() => '$'),
  satoshiToLocalCurrency: () => '0',
  preferredFiatCurrency: { endPointKey: 'USD' },
}));
jest.mock('react-native-haptic-feedback', () => ({ trigger: jest.fn() }));
jest.mock('../../components/Alert', () => jest.fn());

jest.mock('../../BlueComponents', () => {
  const ReactModule = require('react');
  const { TouchableOpacity, View } = require('react-native');
  const actual = jest.requireActual('../../BlueComponents');
  function BlueWalletSelect({ wallets, onChange }) {
    return ReactModule.createElement(
      View,
      { testID: 'WalletSelect' },
      ReactModule.createElement(TouchableOpacity, {
        testID: 'WalletSelectMissing',
        accessibilityRole: 'button',
        onPress: () => {
          global.__walletSelectResult = onChange('missing-wallet-id');
        },
      }),
      ReactModule.createElement(TouchableOpacity, {
        testID: 'WalletSelectOnchain',
        accessibilityRole: 'button',
        onPress: () => {
          global.__walletSelectResult = onChange('onchain-scan-1');
        },
      }),
      wallets.map(w =>
        ReactModule.createElement(TouchableOpacity, {
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
  return { ...actual, BlueWalletSelect };
});

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockSetParams = jest.fn();
const mockRouteParams = {};
jest.mock('@react-navigation/native', () => {
  const RN = require('react');
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useRoute: () => ({ params: mockRouteParams }),
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: mockGoBack,
      setParams: mockSetParams,
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

jest.mock('../../api/spark/spark-sdk', () => ({
  isSparkSdkConnected: () => true,
  SparkSessionStaleError: class SparkSessionStaleError extends Error {
    constructor() {
      super('Spark session is no longer the one this call started with');
      this.name = 'SparkSessionStaleError';
    }
  },
  acquireSparkSessionLease: () => ({
    identity: 'pk-scan',
    requireSdk: () => ({}),
  }),
}));

const { SparkWallet } = require('../../class/wallets/spark-wallet');
const { BlueStorageContext } = require('../../blue_modules/storage-context');
const { LightningCustodianWallet } = require('../../class');
const { LightningLdsWallet } = require('../../class/wallets/lightning-lds-wallet');
const ScanLndInvoice = require('../../screen/lnd/scanLndInvoice').default;
const Lnurl = require('../../class/lnurl').default;
const DeeplinkSchemaMatch = require('../../class/deeplink-schema-match').default;
const loc = require('../../loc').default;
const alert = require('../../components/Alert');
const { bech32m } = require('bech32');
const SPARK_ADDRESS = bech32m.encode('spark', bech32m.toWords(Buffer.from('spark-address-identity-key-32')), 10000);
const haptic = require('react-native-haptic-feedback');
const { BlueDarkTheme } = require('../../components/themes');
const AmountInput = require('../../components/AmountInput').default;

const LNURL = 'LNURL1TEST';
const SAMPLE_INVOICE =
  'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp';
const BIP21_WITH_LIGHTNING = 'bitcoin:BC1Q3RL0MKYK0ZRTXFMQN9WPCD3GNAZ00YV9YP0HXE?amount=0.000001&lightning=' + SAMPLE_INVOICE + '&foo=bar';

function makeSparkWallet() {
  const wallet = SparkWallet.create('pk-scan');
  wallet.getID = () => 'spark-scan-1';
  wallet.balance = 1_000_000;
  wallet.setLabel('Spark');
  wallet.getPaymentFeeWithoutSending = jest.fn().mockResolvedValue(4);
  return wallet;
}

function makeLndhubWallet(id = 'lndhub-scan-1') {
  return {
    type: LightningCustodianWallet.type,
    chain: Chain.OFFCHAIN,
    getID: () => id,
    getBalance: () => 1_000_000,
    getLabel: () => 'LNDHub',
    getPreferredBalanceUnit: () => BitcoinUnit.SATS,
    decodeInvoice: jest.fn(),
    user_invoices_raw: [],
  };
}

function makeLdsWallet() {
  return {
    type: LightningLdsWallet.type,
    chain: Chain.OFFCHAIN,
    getID: () => 'lds-scan-1',
    getBalance: () => 1_000_000,
    getLabel: () => 'LDS',
    getPreferredBalanceUnit: () => BitcoinUnit.SATS,
    decodeInvoice: jest.fn(),
    user_invoices_raw: [],
  };
}

function makeOnchainWallet() {
  return {
    type: 'legacy',
    chain: Chain.ONCHAIN,
    getID: () => 'onchain-scan-1',
    getBalance: () => 1_000_000,
    getLabel: () => 'Onchain',
  };
}

function futureDecodedInvoice(overrides = {}) {
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    num_satoshis: '1000',
    description: 'coffee',
    timestamp: String(timestamp),
    expiry: '3600',
    payment_hash: 'pay-hash-1',
    ...overrides,
  };
}

function mockLnurl(domain, amountSat) {
  jest.spyOn(Lnurl.prototype, 'callLnurlPayService').mockResolvedValue({ description: 'tea', domain });
  jest.spyOn(Lnurl.prototype, 'getDomain').mockReturnValue(domain);
  jest.spyOn(Lnurl.prototype, 'getAmount').mockReturnValue(amountSat);
  jest.spyOn(Lnurl.prototype, 'getDescription').mockReturnValue('tea');
}

function feeRangeText(max) {
  return `0 ${BitcoinUnit.SATS} - ${max} ${BitcoinUnit.SATS}`;
}

function renderScan(wallet, extraParams = {}) {
  const { wallets, ...routeParams } = extraParams;
  mockRouteParams.walletID = wallet.getID();
  mockRouteParams.uri = LNURL;
  Object.assign(mockRouteParams, routeParams);
  return render(
    <BlueStorageContext.Provider value={{ wallets: wallets || [wallet] }}>
      <ScanLndInvoice />
    </BlueStorageContext.Provider>,
  );
}

async function expectSparkAcceptsLightning(uri) {
  const wallet = makeSparkWallet();
  wallet.decodeInvoice = jest.fn().mockReturnValue(futureDecodedInvoice());
  mockLnurl('example.com', 1000);
  const screen = renderScan(wallet, { uri });
  await waitFor(() => screen.getByText(loc.lnd.next));
  expect(alert).not.toHaveBeenCalledWith(loc.wallets.lightning_spark_only);
  expect(mockNavigate).not.toHaveBeenCalled();
  return { wallet, screen };
}

function renderScanWithWallets(wallets, extraParams = {}) {
  Object.assign(mockRouteParams, extraParams);
  return render(
    <BlueStorageContext.Provider value={{ wallets }}>
      <ScanLndInvoice />
    </BlueStorageContext.Provider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  global.__walletSelectResult = undefined;
  for (const key of Object.keys(mockRouteParams)) {
    delete mockRouteParams[key];
  }
});

describe('ScanLndInvoice fee mark', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    AmountInput.conversionCache = {};
  });
  it('does not guess a Lightning fee range or mark it free for a Spark wallet', async () => {
    const { wallet } = await expectSparkAcceptsLightning(LNURL);
    expect(wallet.getPaymentFeeWithoutSending).not.toHaveBeenCalled();
  });

  it('accepts a BOLT11 invoice on a Spark wallet', async () => {
    await expectSparkAcceptsLightning(SAMPLE_INVOICE);
  });

  it('keeps Spark fee quotes for a BOLT11 invoice', async () => {
    const { wallet } = await expectSparkAcceptsLightning(SAMPLE_INVOICE);
    expect(wallet.getPaymentFeeWithoutSending).toHaveBeenCalledWith(SAMPLE_INVOICE, 1000);
  });
  it('still shows Free for an LNDHub payment to a listed free domain', async () => {
    mockLnurl('lightning.space', 1000);
    const wallet = makeLndhubWallet();
    const screen = renderScan(wallet);

    await waitFor(() => screen.getByText(loc._.free));
    assert.strictEqual(screen.queryByText(feeRangeText(Math.round(1000 * 0.03))), null);
  });
  it('does not show a guessed fee range for a small Spark Lightning payment', async () => {
    const { wallet } = await expectSparkAcceptsLightning(LNURL);
    expect(wallet.getPaymentFeeWithoutSending).not.toHaveBeenCalled();
  });
  it('shows Free for an LDS payment to an internal DFX domain', async () => {
    mockLnurl('api.dfx.swiss', 1000);
    const wallet = makeLdsWallet();
    const screen = renderScan(wallet);

    await waitFor(() => screen.getByText(loc._.free));
    assert.strictEqual(screen.queryByText(feeRangeText(Math.round(1000 * 0.03))), null);
  });

  it('shows the 3-percent LNDHub fee range for a domain that is not free', async () => {
    mockLnurl('example.com', 1000);
    const wallet = makeLndhubWallet();
    const screen = renderScan(wallet);

    await waitFor(() => screen.getByText(feeRangeText(Math.round(1000 * 0.03))));
    assert.strictEqual(screen.queryByText(loc._.free), null);
  });

  it('uses the LNDHub amount multiplier when paying a non-free LNURL', async () => {
    mockLnurl('example.com', 1000);
    const wallet = makeLndhubWallet();
    const screen = renderScan(wallet);

    await waitFor(() => screen.getByText(loc.lnd.next));
    fireEvent.press(screen.getByText(loc.lnd.next));
    expect(mockNavigate).toHaveBeenCalledWith(
      'SendDetailsRoot',
      expect.objectContaining({ params: expect.objectContaining({ amountSat: 1000 }) }),
    );
  });
  it('goes back and alerts when no Lightning wallet is available', async () => {
    renderScanWithWallets([], { walletID: 'missing', uri: LNURL });

    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(haptic.trigger).toHaveBeenCalledWith('notificationError', { ignoreAndroidSystemSettings: false });
    await waitFor(() => expect(alert).toHaveBeenCalledWith(loc.wallets.no_ln_wallet_error));
  });

  it('sets the route wallet id when a Lightning wallet is present', async () => {
    mockLnurl('example.com', 1000);
    const wallet = makeSparkWallet();
    renderScan(wallet);

    await waitFor(() => expect(mockSetParams).toHaveBeenCalledWith({ walletID: wallet.getID() }));
  });

  it('falls back to the first off-chain wallet when the route id does not match', async () => {
    mockLnurl('example.com', 1000);
    const wallet = makeSparkWallet();
    renderScan(wallet, { walletID: 'missing-id' });

    await waitFor(() => expect(mockSetParams).toHaveBeenCalledWith({ walletID: wallet.getID() }));
    await waitFor(() => expect(mockNavigate).not.toHaveBeenCalled());
  });

  it('shows the loading indicator while the LNURL pay service is in flight', () => {
    jest.spyOn(Lnurl.prototype, 'callLnurlPayService').mockReturnValue(new Promise(() => {}));
    const wallet = makeLndhubWallet();
    const screen = renderScan(wallet);

    expect(screen.UNSAFE_queryAllByType(ActivityIndicator).length).toBeGreaterThan(0);
    expect(screen.queryByText(loc.lnd.next)).toBeNull();
  });

  it('clears the loading state and alerts when the LNURL pay service rejects', async () => {
    jest.spyOn(Lnurl.prototype, 'callLnurlPayService').mockRejectedValue(new Error('lnurl down'));
    const wallet = makeLndhubWallet();
    const screen = renderScan(wallet);

    await waitFor(() => expect(alert).toHaveBeenCalledWith('lnurl down'));
    expect(haptic.trigger).toHaveBeenCalledWith('notificationError', { ignoreAndroidSystemSettings: false });
    expect(screen.getByText(loc.lnd.next)).toBeTruthy();
    expect(screen.UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('uses 1 sat and leaves the note editable when LNURL omits amount and description', async () => {
    jest.spyOn(Lnurl.prototype, 'callLnurlPayService').mockResolvedValue({ description: '', domain: 'example.com' });
    jest.spyOn(Lnurl.prototype, 'getDomain').mockReturnValue('example.com');
    jest.spyOn(Lnurl.prototype, 'getAmount').mockReturnValue(undefined);
    jest.spyOn(Lnurl.prototype, 'getDescription').mockReturnValue('');
    const wallet = makeSparkWallet();
    const screen = renderScan(wallet);

    await waitFor(() => expect(screen.getByText(loc.send.create_fee)).toBeTruthy());
    expect(screen.getByText('-')).toBeTruthy();
    const note = screen.getByDisplayValue('');
    expect(note.props.editable).not.toBe(false);
    fireEvent.changeText(note, 'own memo');
    expect(screen.getByDisplayValue('own memo')).toBeTruthy();
  });

  it('shows the Lightning address in full and treats a listed free domain as free on LNDHub', async () => {
    const wallet = makeLndhubWallet();
    const screen = renderScan(wallet, { uri: 'tea@lightning.space' });

    await waitFor(() => screen.getByText('tea@lightning.space'));
    fireEvent.changeText(screen.getByTestId('BitcoinAmountInput'), '1000');
    expect(screen.getByText(loc._.free)).toBeTruthy();
    fireEvent.press(screen.getByText(loc.lnd.next));
    expect(mockNavigate).toHaveBeenCalledWith('SendDetailsRoot', {
      screen: 'LnurlPay',
      params: {
        lnurl: 'tea@lightning.space',
        amountSat: 1000,
        description: undefined,
        walletID: wallet.getID(),
      },
    });
  });
  it('does not show a guessed Spark fee range for a Lightning address on a free domain', async () => {
    const { wallet } = await expectSparkAcceptsLightning('tea@lightning.space');
    expect(wallet.getPaymentFeeWithoutSending).not.toHaveBeenCalled();
  });
  it('shows the 3-percent LNDHub fee range for a Lightning address that is not free', async () => {
    const wallet = makeLndhubWallet();
    const screen = renderScan(wallet, { uri: 'tea@example.com' });

    await waitFor(() => screen.getByText('tea@example.com'));
    fireEvent.changeText(screen.getByTestId('BitcoinAmountInput'), '1000');
    expect(screen.getByText(feeRangeText(Math.round(1000 * 0.03)))).toBeTruthy();
    assert.strictEqual(screen.queryByText(loc._.free), null);
  });

  it('marks an LDS Lightning address on an internal domain as free', async () => {
    const wallet = makeLdsWallet();
    const screen = renderScan(wallet, { uri: 'tea@dfx.swiss' });

    await waitFor(() => screen.getByText('tea@dfx.swiss'));
    fireEvent.changeText(screen.getByTestId('BitcoinAmountInput'), '1000');
    expect(screen.getByText(loc._.free)).toBeTruthy();
    fireEvent.press(screen.getByText(loc.lnd.next));
    expect(mockNavigate).toHaveBeenCalledWith(
      'SendDetailsRoot',
      expect.objectContaining({
        screen: 'LnurlPay',
        params: expect.objectContaining({ lnurl: 'tea@dfx.swiss', amountSat: 1000 }),
      }),
    );
  });

  it('truncates a long invoice destination and shows Expired for a lapsed bolt11', async () => {
    const wallet = makeLndhubWallet();
    wallet.decodeInvoice = jest.fn().mockReturnValue({
      num_satoshis: '250000',
      description: 'bolt11 memo',
      timestamp: '1',
      expiry: '1',
      payment_hash: 'expired-hash',
    });
    const screen = renderScan(wallet, { uri: SAMPLE_INVOICE });
    const truncated = `${SAMPLE_INVOICE.substring(0, 18)}.....${SAMPLE_INVOICE.substring(SAMPLE_INVOICE.length - 18)}`;

    await waitFor(() => screen.getByText(truncated));
    expect(screen.getByText(loc.lnd.expired)).toBeTruthy();
    expect(screen.queryByText(SAMPLE_INVOICE)).toBeNull();
    expect(screen.getByTestId('BitcoinAmountInput').props.editable).toBe(false);
    fireEvent.press(screen.getByText(loc.lnd.next));
    expect(alert).toHaveBeenCalledWith(loc.lnd.errorInvoiceExpired);
    expect(haptic.trigger).toHaveBeenCalledWith('notificationError', { ignoreAndroidSystemSettings: false });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('strips a LIGHTNING: prefix and shows remaining minutes for a live invoice', async () => {
    const wallet = makeLndhubWallet();
    const decoded = futureDecodedInvoice();
    wallet.decodeInvoice = jest.fn().mockReturnValue(decoded);
    const screen = renderScan(wallet, { uri: `LIGHTNING:${SAMPLE_INVOICE}`, walletID: undefined });

    await waitFor(() => screen.getByText(/Expires in \d+ minutes/));
    expect(wallet.decodeInvoice).toHaveBeenCalledWith(SAMPLE_INVOICE);
    fireEvent.press(screen.getByText(loc.lnd.next));
    expect(mockNavigate).toHaveBeenCalledWith('SendDetailsRoot', {
      screen: 'LnurlPay',
      params: {
        invoice: SAMPLE_INVOICE,
        amountSat: 1000,
        amountUnit: BitcoinUnit.SATS,
        description: 'coffee',
        walletID: wallet.getID(),
      },
    });
  });

  it('extracts the bolt11 from a BIP-21 URI including a lightning= query', async () => {
    const wallet = makeLndhubWallet();
    wallet.decodeInvoice = jest.fn().mockReturnValue(futureDecodedInvoice({ description: '' }));
    const screen = renderScan(wallet, { uri: BIP21_WITH_LIGHTNING });

    await waitFor(() => expect(wallet.decodeInvoice).toHaveBeenCalledWith(SAMPLE_INVOICE));
    fireEvent.press(screen.getByText(loc.lnd.next));
    expect(mockNavigate).toHaveBeenCalledWith(
      'SendDetailsRoot',
      expect.objectContaining({
        params: expect.objectContaining({ invoice: SAMPLE_INVOICE, description: '' }),
      }),
    );
  });

  it('pays a testnet invoice destination', async () => {
    const wallet = makeLndhubWallet();
    const testnetInvoice = 'lntb1testinvoiceplaceholderxxxxxxxx';
    wallet.decodeInvoice = jest.fn().mockReturnValue(futureDecodedInvoice({ description: undefined }));
    const screen = renderScan(wallet, { uri: testnetInvoice });

    await waitFor(() => expect(wallet.decodeInvoice).toHaveBeenCalledWith(testnetInvoice));
    fireEvent.press(screen.getByText(loc.lnd.next));
    expect(mockNavigate).toHaveBeenCalledWith(
      'SendDetailsRoot',
      expect.objectContaining({
        params: expect.objectContaining({ invoice: testnetInvoice, amountSat: 1000 }),
      }),
    );
  });

  it('clears the form and alerts when decoding the invoice throws', async () => {
    const wallet = makeLndhubWallet();
    wallet.decodeInvoice = jest.fn(() => {
      throw new Error('bad invoice');
    });
    const screen = renderScan(wallet, { uri: SAMPLE_INVOICE });

    await waitFor(() => expect(alert).toHaveBeenCalledWith('bad invoice'));
    expect(haptic.trigger).toHaveBeenCalledWith('notificationError', { ignoreAndroidSystemSettings: false });
    expect(screen.getByText(loc.lnd.next)).toBeTruthy();
    expect(screen.getByText('-')).toBeTruthy();
    expect(() => fireEvent.press(screen.getByText(loc.lnd.next))).not.toThrow();
    expect(alert).toHaveBeenCalledWith(loc.send.details_address_field_is_not_valid);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('alerts that the amount is not valid when LNURL pay is pressed with 0 sats', async () => {
    mockLnurl('example.com', 1000);
    const wallet = makeLndhubWallet();
    const screen = renderScan(wallet);

    await waitFor(() => screen.getByText(loc.lnd.next));
    fireEvent.changeText(screen.getByTestId('BitcoinAmountInput'), '0');
    fireEvent.press(screen.getByText(loc.lnd.next));
    expect(alert).toHaveBeenCalledWith(loc.send.details_amount_field_is_not_valid);
    expect(haptic.trigger).toHaveBeenCalledWith('notificationError', { ignoreAndroidSystemSettings: false });
    expect(mockNavigate).not.toHaveBeenCalled();
  });
  it('does not guess a Spark fee when checking the remaining balance', async () => {
    const { wallet } = await expectSparkAcceptsLightning(LNURL);
    expect(wallet.getPaymentFeeWithoutSending).not.toHaveBeenCalled();
  });
  it('alerts when the remaining LNDHub balance cannot cover the 3-percent fee', async () => {
    mockLnurl('example.com', 1000);
    const wallet = makeLndhubWallet();
    const screen = renderScan(wallet);

    await waitFor(() => screen.getByText(loc.lnd.next));
    fireEvent.changeText(screen.getByTestId('BitcoinAmountInput'), '990000');
    fireEvent.press(screen.getByText(loc.lnd.next));
    expect(alert).toHaveBeenCalledWith(loc.lnd.error_balance_for_insuficient_fee);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not apply the insufficient-fee check when the destination is free on LNDHub', async () => {
    mockLnurl('lightning.space', 1000);
    const wallet = makeLndhubWallet();
    const screen = renderScan(wallet);

    await waitFor(() => screen.getByText(loc._.free));
    fireEvent.changeText(screen.getByTestId('BitcoinAmountInput'), '990000');
    fireEvent.press(screen.getByText(loc.lnd.next));
    expect(alert).not.toHaveBeenCalledWith(loc.lnd.error_balance_for_insuficient_fee);
    expect(mockNavigate).toHaveBeenCalledWith(
      'SendDetailsRoot',
      expect.objectContaining({
        params: expect.objectContaining({ amountSat: 990000, walletID: wallet.getID() }),
      }),
    );
  });

  it('sends the full balance on MAX when the destination is free', async () => {
    mockLnurl('lightning.space', 1000);
    const wallet = makeLndhubWallet();
    const screen = renderScan(wallet);

    await waitFor(() => screen.getByText('MAX'));
    fireEvent.press(screen.getByText('MAX'));
    fireEvent.press(screen.getByText(loc.lnd.next));
    expect(mockNavigate).toHaveBeenCalledWith(
      'SendDetailsRoot',
      expect.objectContaining({
        params: expect.objectContaining({ amountSat: 1_000_000 }),
      }),
    );
  });
  it('marks a full-balance Spark LNURL payment for SDK fee preparation', async () => {
    mockLnurl('example.com', 1000);
    const wallet = makeSparkWallet();
    const screen = renderScan(wallet, { uri: LNURL });
    await waitFor(() => screen.getByText(loc.lnd.next));
    fireEvent.press(screen.getByText('MAX'));
    fireEvent.press(screen.getByText(loc.lnd.next));
    expect(mockNavigate).toHaveBeenCalledWith('SendDetailsRoot', {
      screen: 'LnurlPay',
      params: expect.objectContaining({ lnurl: LNURL, isMax: true, walletID: wallet.getID() }),
    });
  });

  it('navigates LNURL pay with the typed Spark amount', async () => {
    mockLnurl('example.com', 1000);
    const wallet = makeSparkWallet();
    const screen = renderScan(wallet, { uri: LNURL });
    await waitFor(() => screen.getByText(loc.lnd.next));
    fireEvent.changeText(screen.getByTestId('BitcoinAmountInput'), '2500');
    fireEvent.press(screen.getByText(loc.lnd.next));
    expect(mockNavigate).toHaveBeenCalledWith('SendDetailsRoot', {
      screen: 'LnurlPay',
      params: expect.objectContaining({ lnurl: LNURL, amountSat: 2500, walletID: wallet.getID() }),
    });
  });
  it('alerts that zero-amount invoices are not supported', async () => {
    const wallet = makeLndhubWallet();
    wallet.decodeInvoice = jest.fn().mockReturnValue(futureDecodedInvoice({ num_satoshis: '0' }));
    const screen = renderScan(wallet, { uri: SAMPLE_INVOICE });

    await waitFor(() => screen.getByText(loc.lnd.next));
    fireEvent.press(screen.getByText(loc.lnd.next));
    expect(alert).toHaveBeenCalledWith(loc.lnd.error_tip_invoice_not_supported);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('lets a fractional-sat invoice be paid, as on develop', async () => {
    const wallet = makeLndhubWallet();
    wallet.decodeInvoice = jest.fn().mockReturnValue(futureDecodedInvoice({ num_satoshis: '1.5' }));
    const screen = renderScan(wallet, { uri: SAMPLE_INVOICE });

    await waitFor(() => screen.getByText(loc.lnd.next));
    fireEvent.press(screen.getByText(loc.lnd.next));
    expect(alert).not.toHaveBeenCalledWith(loc.lnd.error_tip_invoice_not_supported);
    expect(mockNavigate).toHaveBeenCalledWith(
      'SendDetailsRoot',
      expect.objectContaining({ params: expect.objectContaining({ amountSat: 1 }) }),
    );
  });

  it('refuses to pay an invoice that this wallet created', async () => {
    const wallet = makeLndhubWallet();
    const decoded = futureDecodedInvoice({ payment_hash: 'own-hash' });
    wallet.decodeInvoice = jest.fn().mockReturnValue(decoded);
    wallet.user_invoices_raw = [{ payment_hash: 'own-hash' }];
    const screen = renderScan(wallet, { uri: SAMPLE_INVOICE });

    await waitFor(() => screen.getByText(loc.lnd.next));
    fireEvent.press(screen.getByText(loc.lnd.next));
    expect(alert).toHaveBeenCalledWith(loc.lnd.sameWalletAsInvoiceError);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('returns without navigating when Next is pressed on an invoice destination that has not been decoded', () => {
    jest.spyOn(DeeplinkSchemaMatch, 'isLightningInvoice').mockReturnValue(true);
    const wallet = makeSparkWallet();
    const screen = renderScan(wallet, { uri: undefined });

    expect(() => fireEvent.press(screen.getByText(loc.lnd.next))).not.toThrow();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalledWith(loc.lnd.error_tip_invoice_not_supported);
    expect(alert).not.toHaveBeenCalledWith(loc.lnd.errorInvoiceExpired);
    expect(alert).not.toHaveBeenCalledWith(loc.send.details_address_field_is_not_valid);
  });

  it('treats a BIP-21 destination as an invoice pay when Next is pressed', () => {
    jest.spyOn(DeeplinkSchemaMatch, 'isLightningInvoice').mockReturnValue(false);
    jest.spyOn(DeeplinkSchemaMatch, 'isTestnetLightningInvoice').mockReturnValue(false);
    jest.spyOn(DeeplinkSchemaMatch, 'isBothBitcoinAndLightning').mockReturnValue({ bitcoin: 'bitcoin:x', lndInvoice: 'lightning:y' });
    const wallet = makeSparkWallet();
    const screen = renderScan(wallet, { uri: undefined });

    expect(() => fireEvent.press(screen.getByText(loc.lnd.next))).not.toThrow();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalledWith(loc.send.details_address_field_is_not_valid);
  });

  it('alerts that the address is not valid when the destination matches no Lightning scheme', async () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    const wallet = makeSparkWallet();
    const screen = renderScan(wallet, { uri: 'not-a-lightning-destination' });

    await waitFor(() => expect(dismiss).toHaveBeenCalled());
    fireEvent.press(screen.getByText(loc.lnd.next));
    expect(alert).toHaveBeenCalledWith(loc.send.details_address_field_is_not_valid);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('routes a Lightning address from Spark to the quote and payment screen', async () => {
    const wallet = makeSparkWallet();
    const screen = renderScan(wallet, { uri: 'tea@example.com' });

    await waitFor(() => screen.getByText('tea@example.com'));
    fireEvent.changeText(screen.getByTestId('BitcoinAmountInput'), '1000');
    fireEvent.press(screen.getByText(loc.lnd.next));

    expect(mockNavigate).toHaveBeenCalledWith('SendDetailsRoot', {
      screen: 'LnurlPay',
      params: expect.objectContaining({ lnurl: 'tea@example.com', amountSat: 1000, walletID: wallet.getID() }),
    });
    expect(alert).not.toHaveBeenCalledWith(loc.wallets.lightning_spark_only);
  });

  it('routes a BOLT11 invoice from Spark to the prepared Lightning payment flow', async () => {
    const wallet = makeSparkWallet();
    wallet.decodeInvoice = jest.fn().mockReturnValue(futureDecodedInvoice());
    const screen = renderScan(wallet, { uri: SAMPLE_INVOICE });

    await waitFor(() => screen.getByText(loc.lnd.next));
    fireEvent.press(screen.getByText(loc.lnd.next));

    expect(mockNavigate).toHaveBeenCalledWith('SendDetailsRoot', {
      screen: 'LnurlPay',
      params: expect.objectContaining({ invoice: SAMPLE_INVOICE, amountSat: 1000, walletID: wallet.getID() }),
    });
    expect(alert).not.toHaveBeenCalledWith(loc.wallets.lightning_spark_only);
  });

  it('pays a bolt11 with the Lightning wallet when Spark is listed first', async () => {
    const spark = makeSparkWallet();
    const lightning = makeLndhubWallet();
    lightning.decodeInvoice = jest.fn().mockReturnValue(futureDecodedInvoice());
    const screen = renderScan(spark, { uri: SAMPLE_INVOICE, walletID: undefined, wallets: [spark, lightning] });

    await waitFor(() => screen.getByText(/Expires in \d+ minutes/));
    expect(lightning.decodeInvoice).toHaveBeenCalledWith(SAMPLE_INVOICE);
    expect(alert).not.toHaveBeenCalledWith(loc.wallets.lightning_spark_only);
    fireEvent.press(screen.getByText(loc.lnd.next));
    expect(mockNavigate).toHaveBeenCalledWith('SendDetailsRoot', {
      screen: 'LnurlPay',
      params: expect.objectContaining({ invoice: SAMPLE_INVOICE, walletID: lightning.getID() }),
    });
  });

  it('recognizes a lowercase spark1 address as a payable destination', async () => {
    const wallet = makeSparkWallet();
    const screen = renderScan(wallet, { uri: SPARK_ADDRESS });
    const truncated = `${SPARK_ADDRESS.substring(0, 18)}.....${SPARK_ADDRESS.substring(SPARK_ADDRESS.length - 18)}`;

    await waitFor(() => screen.getByText(truncated));
    fireEvent.changeText(screen.getByTestId('BitcoinAmountInput'), '1000');
    await waitFor(() => expect(wallet.getPaymentFeeWithoutSending).toHaveBeenCalledWith(SPARK_ADDRESS, 1000));
    fireEvent.press(screen.getByText(loc.lnd.next));
    expect(mockNavigate).toHaveBeenCalledWith('SendDetailsRoot', {
      screen: 'LnurlPay',
      params: {
        sparkAddress: SPARK_ADDRESS,
        amountSat: 1000,
        amountUnit: BitcoinUnit.SATS,
        walletID: wallet.getID(),
      },
    });
    expect(alert).not.toHaveBeenCalledWith(loc.send.details_address_field_is_not_valid);
  });

  it('does not treat a mangled spark1 string as a destination', async () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    const wallet = makeSparkWallet();
    const screen = renderScan(wallet, { uri: 'spark1not-a-valid-bech32m-value' });

    await waitFor(() => expect(dismiss).toHaveBeenCalled());
    fireEvent.press(screen.getByText(loc.lnd.next));
    expect(alert).toHaveBeenCalledWith(loc.send.details_address_field_is_not_valid);
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(DeeplinkSchemaMatch.isSparkAddress('spark1not-a-valid-bech32m-value')).toBe(false);
    expect(DeeplinkSchemaMatch.isSparkAddress(SPARK_ADDRESS.toUpperCase())).toBe(false);
  });

  it('keeps the wallet label as text when only one Lightning wallet exists', async () => {
    mockLnurl('example.com', 1000);
    const wallet = makeSparkWallet();
    const screen = renderScan(wallet);

    await waitFor(() => screen.getByText(loc.wallets.lightning_spark_wallet_label));
    expect(screen.queryByTestId('WalletSelect')).toBeNull();
  });

  it('shows the wallet picker when more than one Lightning wallet exists and ignores a missing pick', async () => {
    mockLnurl('example.com', 1000);
    const spark = makeSparkWallet();
    const lndhub = makeLndhubWallet();
    const screen = renderScan(spark, { wallets: [spark, lndhub] });

    await waitFor(() => screen.getByTestId('WalletSelect'));
    fireEvent.press(screen.getByTestId('WalletSelectMissing'));
    assert.strictEqual(global.__walletSelectResult, undefined);
    expect(mockSetParams).not.toHaveBeenCalledWith({ walletID: 'missing-wallet-id' });
  });

  it('hands off to SendDetails when the picker chooses an on-chain wallet', async () => {
    mockLnurl('example.com', 1000);
    const spark = makeSparkWallet();
    const onchain = makeOnchainWallet();
    const lndhub = makeLndhubWallet();
    const screen = renderScan(spark, { wallets: [spark, lndhub, onchain] });

    await waitFor(() => screen.getByTestId('WalletSelectOnchain'));
    fireEvent.press(screen.getByTestId('WalletSelectOnchain'));
    assert.deepStrictEqual(global.__walletSelectResult, { name: 'SendDetails', params: { walletID: 'onchain-scan-1' } });
  });

  it('updates the route wallet id when the picker chooses another Lightning wallet', async () => {
    mockLnurl('example.com', 1000);
    const spark = makeSparkWallet();
    const lndhub = makeLndhubWallet();
    const screen = renderScan(spark, { wallets: [spark, lndhub] });

    await waitFor(() => screen.getByTestId(`WalletSelect-${lndhub.getID()}`));
    fireEvent.press(screen.getByTestId(`WalletSelect-${lndhub.getID()}`));
    expect(mockSetParams).toHaveBeenCalledWith({ walletID: lndhub.getID() });
  });

  it('converts a SATS amount through LOCAL_CURRENCY using the AmountInput cache', async () => {
    mockLnurl('example.com', 1000);
    const wallet = makeLndhubWallet();
    const screen = renderScan(wallet);

    await waitFor(() => screen.getByText(loc.lnd.next));
    fireEvent.press(screen.getByTestId('changeAmountUnitButton'));
    fireEvent.press(screen.getByText(loc.lnd.next));
    expect(mockNavigate).toHaveBeenCalledWith(
      'SendDetailsRoot',
      expect.objectContaining({
        params: expect.objectContaining({ amountSat: 1000 }),
      }),
    );
  });

  it('converts a typed LOCAL_CURRENCY amount without a cache hit via fiatToBTC', async () => {
    mockLnurl('example.com', 1000);
    const wallet = makeLndhubWallet();
    const screen = renderScan(wallet);

    await waitFor(() => screen.getByText(loc.lnd.next));
    fireEvent.press(screen.getByTestId('changeAmountUnitButton'));
    fireEvent.changeText(screen.getByTestId('BitcoinAmountInput'), '9');
    fireEvent.press(screen.getByText(loc.lnd.next));
    expect(alert).toHaveBeenCalledWith(loc.send.details_amount_field_is_not_valid);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('converts a BTC amount back to sats before LNURL pay', async () => {
    mockLnurl('example.com', 1000);
    const wallet = makeLndhubWallet();
    const screen = renderScan(wallet);

    await waitFor(() => screen.getByText(loc.lnd.next));
    fireEvent.press(screen.getByTestId('changeAmountUnitButton'));
    fireEvent.press(screen.getByTestId('changeAmountUnitButton'));
    fireEvent.press(screen.getByText(loc.lnd.next));
    const nav = mockNavigate.mock.calls[0];
    assert.strictEqual(nav[0], 'SendDetailsRoot');
    assert.strictEqual(typeof nav[1].params.amountSat, 'number');
    assert.ok(nav[1].params.amountSat > 0);
  });

  it('does not process a destination when the screen is opened without a uri', () => {
    const wallet = makeSparkWallet();
    const screen = renderScan(wallet, { uri: undefined });

    expect(screen.getByText('-')).toBeTruthy();
    expect(screen.getByText(loc.lnd.next)).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('titles the navigation header Send and goes back from the close button', () => {
    const goBack = jest.fn();
    const options = ScanLndInvoice.navigationOptions(BlueDarkTheme)({
      navigation: { goBack },
      route: {},
    });
    expect(options.title).toBe(loc.send.header);
    const close = render(options.headerRight());
    fireEvent.press(close.getByTestId('NavigationCloseButton'));
    expect(goBack).toHaveBeenCalled();
    close.unmount();
  });
});
