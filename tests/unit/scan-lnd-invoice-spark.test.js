import React from 'react';
import assert from 'assert';
import { render, waitFor } from '@testing-library/react-native';
import { BitcoinUnit, Chain } from '../../models/bitcoinUnits';

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
jest.mock('../../components/Alert', () => jest.fn());
jest.mock('../../components/navigationStyle', () => () => options => options);

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

const { SparkWallet, sparkMaxSendFeeSats } = require('../../class/wallets/spark-wallet');
const { BlueStorageContext } = require('../../blue_modules/storage-context');
const { LightningCustodianWallet } = require('../../class');
const ScanLndInvoice = require('../../screen/lnd/scanLndInvoice').default;
const Lnurl = require('../../class/lnurl').default;
const loc = require('../../loc').default;

const LNURL = 'LNURL1TEST';

function makeSparkWallet() {
  const wallet = SparkWallet.create('pk-scan');
  wallet.getID = () => 'spark-scan-1';
  wallet.balance = 1_000_000;
  wallet.setLabel('Spark');
  return wallet;
}

function makeLndhubWallet() {
  return {
    type: LightningCustodianWallet.type,
    chain: Chain.OFFCHAIN,
    getID: () => 'lndhub-scan-1',
    getBalance: () => 1_000_000,
    getLabel: () => 'LNDHub',
    getPreferredBalanceUnit: () => BitcoinUnit.SATS,
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
  mockRouteParams.walletID = wallet.getID();
  mockRouteParams.uri = LNURL;
  Object.assign(mockRouteParams, extraParams);
  return render(
    <BlueStorageContext.Provider value={{ wallets: [wallet] }}>
      <ScanLndInvoice />
    </BlueStorageContext.Provider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(mockRouteParams)) {
    delete mockRouteParams[key];
  }
});

describe('ScanLndInvoice fee mark', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not show Free for a Spark payment to a listed free domain', async () => {
    mockLnurl('lightning.space', 1000);
    const wallet = makeSparkWallet();
    const screen = renderScan(wallet);

    await waitFor(() => screen.getByText(feeRangeText(sparkMaxSendFeeSats(1000))));
    assert.strictEqual(screen.queryByText(loc._.free), null);
  });

  it('still shows Free for an LNDHub payment to a listed free domain', async () => {
    mockLnurl('lightning.space', 1000);
    const wallet = makeLndhubWallet();
    const screen = renderScan(wallet);

    await waitFor(() => screen.getByText(loc._.free));
    assert.strictEqual(screen.queryByText(feeRangeText(sparkMaxSendFeeSats(1000))), null);
  });

  it('shows the Spark-enforced fee cap for a small amount, not a rounded 0', async () => {
    const amountSat = 10;
    mockLnurl('example.com', amountSat);
    const wallet = makeSparkWallet();
    const screen = renderScan(wallet);

    await waitFor(() => screen.getByText(feeRangeText(sparkMaxSendFeeSats(amountSat))));
    assert.strictEqual(sparkMaxSendFeeSats(amountSat), 1);
    assert.strictEqual(Math.round(amountSat * 0.03), 0);
    assert.strictEqual(Math.floor(amountSat * 0.03), 0);
    assert.strictEqual(screen.queryByText(feeRangeText(0)), null);
    assert.strictEqual(screen.queryByText(loc._.free), null);
  });
});
