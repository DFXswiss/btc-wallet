import React from 'react';
import { bech32m } from 'bech32';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Chain } from '../../models/bitcoinUnits';

const mockWasConfirmed = jest.fn().mockResolvedValue(false);
const mockRecommendedFees = jest.fn().mockResolvedValue({ fastestFee: 7 });
const mockAsyncGetItem = jest.fn().mockResolvedValue(JSON.stringify({ fastestFee: 7 }));
const mockAlert = jest.fn();

jest.mock('../../blue_modules/BlueElectrum', () => ({ connectMain: jest.fn() }));
jest.mock('../../blue_modules/currency', () => ({
  btcToSatoshi: jest.fn(value => Math.floor(Number(value) * 100_000_000)),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: mockAsyncGetItem,
  setItem: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../api/dfx/contexts/session.context', () => ({ DfxService: { SELL: 'sell', SWAP: 'swap' } }));
jest.mock('../../helpers/dfxMaxAmount', () => ({ DfxMaxAmount: { wasConfirmed: mockWasConfirmed } }));
jest.mock('../../models/networkTransactionFees', () => ({
  __esModule: true,
  default: { recommendedFees: mockRecommendedFees },
  NetworkTransactionFee: { StorageKey: 'NetworkTransactionFee' },
}));
jest.mock('../../helpers/utils', () => ({ Utils: { withRetry: fn => fn(), sumUtxoValue: xs => xs.reduce((sum, x) => sum + x.value, 0) } }));
jest.mock('../../class', () => ({
  AbstractWallet: class AbstractWallet {},
  HDSegwitBech32Wallet: {
    type: 'HDsegwitBech32',
    defaultRBFSequence: 2147483648,
    finalRBFSequence: 4294967295,
  },
  WatchOnlyWallet: { type: 'watchOnly' },
}));
jest.mock('../../class/wallets/lightning-lds-wallet', () => ({
  LightningLdsWallet: { type: 'lightningLdsWallet' },
}));
jest.mock('../../class/wallets/abstract-hd-electrum-wallet', () => ({
  AbstractHDElectrumWallet: class AbstractHDElectrumWallet {},
}));
jest.mock('../../blue_modules/storage-context', () => {
  const ReactModule = require('react');
  return { BlueStorageContext: ReactModule.createContext({}) };
});

jest.mock('../../BlueComponents', () => {
  const ReactModule = require('react');
  const { Text, TouchableOpacity, View } = require('react-native');
  /* eslint-disable react/prop-types */
  function BlueButton({ onPress, title, testID }) {
    return ReactModule.createElement(
      TouchableOpacity,
      { onPress, testID: testID || `Button-${title}` },
      ReactModule.createElement(Text, null, title),
    );
  }
  function SafeBlueArea({ children, style }) {
    return ReactModule.createElement(View, { style }, children);
  }
  /* eslint-enable react/prop-types */
  return { BlueButton, SafeBlueArea };
});

jest.mock('react-native-elements', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  return { Icon: props => ReactModule.createElement(View, props) };
});

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockRouteParams = {};
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
    useRoute: () => ({ params: mockRouteParams }),
    useTheme: () => require('../../components/themes').BlueDarkTheme,
  };
});

const mockSellGetInfo = jest.fn();
jest.mock('../../api/dfx/hooks/sell.hook', () => ({
  useSell: () => ({ getInfo: mockSellGetInfo }),
}));
jest.mock('../../api/dfx/hooks/fiat.hook', () => ({
  useFiat: () => ({ toDescription: value => value.name }),
}));

const mockSwapGetInfo = jest.fn();
jest.mock('../../api/dfx/hooks/swap.hook', () => ({
  useSwap: () => ({ getInfo: mockSwapGetInfo }),
}));
jest.mock('../../contexts/wallet.context', () => ({
  useWalletContext: () => ({ walletID: 'onchain-wallet' }),
}));

const { SparkWallet } = require('../../class/wallets/spark-wallet');
const { LightningLdsWallet } = require('../../class/wallets/lightning-lds-wallet');
const { AbstractHDElectrumWallet } = require('../../class/wallets/abstract-hd-electrum-wallet');
const { BlueStorageContext } = require('../../blue_modules/storage-context');
const { Alert } = require('react-native');
const Sell = require('../../screen/dfx/sell').default;
const Swap = require('../../screen/dfx/swap').default;
const loc = require('../../loc').default;

const SPARK_INVOICE = bech32m.encode('spark', bech32m.toWords(Buffer.from('dfx reusable sats invoice')), 10000);
const SPARK_ADDRESS = bech32m.encode('spark', bech32m.toWords(Buffer.from('spark-address-identity-key-32')), 10000);
const LNURL = 'LNURL1TEST';
const AMOUNT_BTC = '0.00012345';
const AMOUNT_SATS = 12_345;
const URI_AMOUNT_BTC = '0.00054321';

function makeSparkWallet() {
  return {
    type: SparkWallet.type,
    chain: Chain.OFFCHAIN,
    getID: () => 'spark-dfx-wallet',
  };
}

function makeLdsWallet() {
  return {
    type: LightningLdsWallet.type,
    chain: Chain.OFFCHAIN,
    getID: () => 'lds-dfx-wallet',
  };
}

function sellInfo(address) {
  return {
    deposit: { id: 1, address, blockchain: 'Lightning' },
    iban: 'CH00 0000 0000 0000 0000 0',
    currency: { name: 'CHF' },
    fee: 0,
  };
}

function swapInfo(address) {
  return {
    active: true,
    asset: { blockchain: 'Ethereum', dexName: 'USDC' },
    blockchain: 'Lightning',
    deposit: { address, blockchain: 'Lightning', blockchains: ['Lightning'], id: 1 },
    fee: 0,
  };
}

function renderScreen(Component, walletOrWallets) {
  const wallets = Array.isArray(walletOrWallets) ? walletOrWallets : [walletOrWallets];
  return render(
    <BlueStorageContext.Provider value={{ wallets, sleep: jest.fn() }}>
      <Component />
    </BlueStorageContext.Provider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockWasConfirmed.mockReset();
  mockRecommendedFees.mockReset();
  mockAsyncGetItem.mockReset();
  mockAlert.mockReset();
  mockWasConfirmed.mockResolvedValue(false);
  mockRecommendedFees.mockResolvedValue({ fastestFee: 7 });
  mockAsyncGetItem.mockResolvedValue(JSON.stringify({ fastestFee: 7 }));
  mockSellGetInfo.mockReset();
  mockSwapGetInfo.mockReset();
  mockSellGetInfo.mockResolvedValue(sellInfo(LNURL));
  mockSwapGetInfo.mockResolvedValue(swapInfo(LNURL));
  jest.spyOn(Alert, 'alert').mockImplementation(mockAlert);
  mockRouteParams.routeId = '1';
  mockRouteParams.amount = AMOUNT_BTC;
  mockRouteParams['wallet-id'] = 'spark-dfx-wallet';
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('DFX Spark invoice navigation', () => {
  it('routes a Spark sell URI with the confirmed amount and preserves the LNURL fallback', async () => {
    mockSellGetInfo.mockResolvedValue(sellInfo(`spark:${SPARK_INVOICE}?amount=${URI_AMOUNT_BTC}`));
    let screen = renderScreen(Sell, makeSparkWallet());

    await waitFor(() => screen.getByTestId('SellConfirm'));
    fireEvent.press(screen.getByTestId('SellConfirm'));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(mockNavigate.mock.calls[0]).toEqual([
      'LnurlPay',
      { sparkInvoice: SPARK_INVOICE, walletID: 'spark-dfx-wallet', amountSat: AMOUNT_SATS, routeId: '1' },
    ]);
    expect(mockNavigate.mock.calls[0][1].sparkAddress).toBeUndefined();
    expect(mockNavigate.mock.calls[0][1].lnurl).toBeUndefined();
    screen.unmount();
    mockNavigate.mockClear();
    mockSellGetInfo.mockResolvedValue(sellInfo(LNURL));
    screen = renderScreen(Sell, makeSparkWallet());

    await waitFor(() => screen.getByTestId('SellConfirm'));
    fireEvent.press(screen.getByTestId('SellConfirm'));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(mockNavigate.mock.calls[0]).toEqual(['LnurlPay', { lnurl: LNURL, walletID: 'spark-dfx-wallet', amountSat: AMOUNT_SATS }]);
    screen.unmount();
    mockNavigate.mockClear();
    mockRouteParams['wallet-id'] = 'lds-dfx-wallet';
    mockSellGetInfo.mockResolvedValue(sellInfo(SPARK_INVOICE));
    screen = renderScreen(Sell, makeLdsWallet());

    await waitFor(() => screen.getByTestId('SellConfirm'));
    fireEvent.press(screen.getByTestId('SellConfirm'));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(mockNavigate.mock.calls[0]).toEqual(['LnurlPay', { lnurl: SPARK_INVOICE, walletID: 'lds-dfx-wallet', amountSat: AMOUNT_SATS }]);
  });

  it('routes a Spark sell address without falling back to Lightning', async () => {
    mockSellGetInfo.mockResolvedValue(sellInfo(SPARK_ADDRESS));
    const screen = renderScreen(Sell, makeSparkWallet());

    await waitFor(() => screen.getByTestId('SellConfirm'));
    fireEvent.press(screen.getByTestId('SellConfirm'));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(mockNavigate.mock.calls[0]).toEqual([
      'LnurlPay',
      { sparkAddress: SPARK_ADDRESS, walletID: 'spark-dfx-wallet', amountSat: AMOUNT_SATS, routeId: '1' },
    ]);
    expect(mockNavigate.mock.calls[0][1].lnurl).toBeUndefined();
    expect(mockNavigate.mock.calls[0][1].sparkInvoice).toBeUndefined();
  });

  it('routes a Spark swap URI with the confirmed amount and preserves the LNURL fallback', async () => {
    mockSwapGetInfo.mockResolvedValue(swapInfo(`spark:${SPARK_INVOICE}?amount=${URI_AMOUNT_BTC}`));
    let screen = renderScreen(Swap, makeSparkWallet());

    await waitFor(() => screen.getByTestId(`Button-${loc.swap.confirm}`));
    fireEvent.press(screen.getByTestId(`Button-${loc.swap.confirm}`));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(mockNavigate.mock.calls[0]).toEqual([
      'LnurlPay',
      { sparkInvoice: SPARK_INVOICE, walletID: 'spark-dfx-wallet', amountSat: AMOUNT_SATS, routeId: '1' },
    ]);
    expect(mockNavigate.mock.calls[0][1].sparkAddress).toBeUndefined();
    expect(mockNavigate.mock.calls[0][1].lnurl).toBeUndefined();
    screen.unmount();
    mockNavigate.mockClear();
    mockSwapGetInfo.mockResolvedValue(swapInfo(LNURL));
    screen = renderScreen(Swap, makeSparkWallet());

    await waitFor(() => screen.getByTestId(`Button-${loc.swap.confirm}`));
    fireEvent.press(screen.getByTestId(`Button-${loc.swap.confirm}`));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(mockNavigate.mock.calls[0]).toEqual(['LnurlPay', { lnurl: LNURL, walletID: 'spark-dfx-wallet', amountSat: AMOUNT_SATS }]);
    screen.unmount();
    mockNavigate.mockClear();
    mockRouteParams['wallet-id'] = 'lds-dfx-wallet';
    mockSwapGetInfo.mockResolvedValue(swapInfo(SPARK_INVOICE));
    screen = renderScreen(Swap, makeLdsWallet());

    await waitFor(() => screen.getByTestId(`Button-${loc.swap.confirm}`));
    fireEvent.press(screen.getByTestId(`Button-${loc.swap.confirm}`));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(mockNavigate.mock.calls[0]).toEqual(['LnurlPay', { lnurl: SPARK_INVOICE, walletID: 'lds-dfx-wallet', amountSat: AMOUNT_SATS }]);
  });

  it('routes a Spark swap address without falling back to Lightning or the invoice branch', async () => {
    mockSwapGetInfo.mockResolvedValue(swapInfo(SPARK_ADDRESS));
    const screen = renderScreen(Swap, makeSparkWallet());

    await waitFor(() => screen.getByTestId(`Button-${loc.swap.confirm}`));
    fireEvent.press(screen.getByTestId(`Button-${loc.swap.confirm}`));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(mockNavigate.mock.calls[0]).toEqual([
      'LnurlPay',
      { sparkAddress: SPARK_ADDRESS, walletID: 'spark-dfx-wallet', amountSat: AMOUNT_SATS, routeId: '1' },
    ]);
    expect(mockNavigate.mock.calls[0][1].lnurl).toBeUndefined();
    expect(mockNavigate.mock.calls[0][1].sparkInvoice).toBeUndefined();
  });
});

describe('DFX swap Lightning wallet selection', () => {
  it('prefers the LDS wallet over Spark when both are present, even if Spark is listed first', async () => {
    const ldsDeposit = 'LNURL-LDS-DEPOSIT';
    const sparkDeposit = 'LNURL-SPARK-DEPOSIT';
    mockSwapGetInfo.mockImplementation(async walletId => {
      if (walletId === 'lds-dfx-wallet') return swapInfo(ldsDeposit);
      if (walletId === 'spark-dfx-wallet') return swapInfo(sparkDeposit);
      return null;
    });
    mockRouteParams['wallet-id'] = 'lds-dfx-wallet';

    const screen = renderScreen(Swap, [makeSparkWallet(), makeLdsWallet()]);

    await waitFor(() => screen.getByTestId(`Button-${loc.swap.confirm}`));
    expect(screen.getByText(ldsDeposit)).toBeTruthy();
    expect(screen.queryByText(sparkDeposit)).toBeNull();
    const requestedWalletIds = mockSwapGetInfo.mock.calls.map(call => call[0]);
    expect(requestedWalletIds).toContain('lds-dfx-wallet');
    expect(requestedWalletIds).not.toContain('spark-dfx-wallet');
  });
});

function makeOnchainWallet(overrides = {}) {
  return {
    type: 'legacy-onchain',
    chain: Chain.ONCHAIN,
    getID: () => 'onchain-wallet',
    getUtxo: () => [{ value: 100000 }],
    fetchUtxo: jest.fn().mockResolvedValue(undefined),
    getChangeAddressAsync: jest.fn().mockResolvedValue('change-address'),
    getAddress: jest.fn().mockReturnValue('legacy-change'),
    createTransaction: jest.fn().mockReturnValue({
      tx: { toHex: () => 'deadbeef' },
      outputs: [{ address: 'deposit-address', value: 90000 }],
      psbt: 'psbt',
      fee: 1000,
    }),
    ...overrides,
  };
}

describe('DFX sell and swap on-chain confirmation', () => {
  it('builds a fixed sell transaction and navigates to Confirm', async () => {
    const wallet = makeOnchainWallet();
    mockRouteParams['wallet-id'] = 'onchain-wallet';
    mockSellGetInfo.mockResolvedValue(sellInfo('deposit-address'));
    mockWasConfirmed.mockResolvedValue(false);
    const screen = renderScreen(Sell, wallet);
    await waitFor(() => screen.getByTestId('SellConfirm'));
    fireEvent.press(screen.getByTestId('SellConfirm'));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(
        'Confirm',
        expect.objectContaining({ walletID: 'onchain-wallet', tx: 'deadbeef', satoshiPerByte: 7 }),
      ),
    );
    expect(wallet.createTransaction).toHaveBeenCalledWith(
      expect.any(Array),
      [{ address: 'deposit-address', value: AMOUNT_SATS }],
      7,
      'legacy-change',
      4294967295,
    );
  });

  it('uses confirmed max and replaceable sequence, including the all-change recipient fallback', async () => {
    const wallet = makeOnchainWallet({
      type: 'HDsegwitBech32',
      createTransaction: jest.fn().mockReturnValue({
        tx: { toHex: () => 'max-tx' },
        outputs: [{ address: 'legacy-change', value: 99000 }],
        psbt: 'max-psbt',
        fee: 1000,
      }),
    });
    mockRouteParams['wallet-id'] = 'onchain-wallet';
    mockSellGetInfo.mockResolvedValue(sellInfo('deposit-address'));
    mockWasConfirmed.mockResolvedValue(true);
    const screen = renderScreen(Sell, wallet);
    await waitFor(() => screen.getByTestId('SellConfirm'));
    fireEvent.press(screen.getByTestId('SellConfirm'));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(
        'Confirm',
        expect.objectContaining({ tx: 'max-tx', recipients: [{ address: 'legacy-change', value: 99000 }] }),
      ),
    );
    expect(wallet.createTransaction).toHaveBeenCalledWith(
      expect.any(Array),
      [{ address: 'deposit-address' }],
      7,
      'legacy-change',
      2147483648,
    );
  });

  it('reports confirm-time batching errors and does not navigate', async () => {
    const error = Object.assign(new Error('batching'), { code: 'ELECTRUM_BATCHING_UNSUPPORTED' });
    const wallet = makeOnchainWallet({ fetchUtxo: jest.fn().mockRejectedValue(error) });
    mockRouteParams['wallet-id'] = 'onchain-wallet';
    mockSellGetInfo.mockResolvedValue(sellInfo('deposit-address'));
    const screen = renderScreen(Sell, wallet);
    await waitFor(() => screen.getByTestId('SellConfirm'));
    fireEvent.press(screen.getByTestId('SellConfirm'));
    await waitFor(() => expect(mockAlert).toHaveBeenCalledWith('Something went wrong', expect.any(String), expect.any(Array)));
    mockAlert.mock.calls[0][2][0].onPress();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('handles a normal confirm error, watch-only change, and cached change address', async () => {
    const wallet = makeOnchainWallet({
      type: 'watchOnly',
      isHd: () => false,
      getAddress: jest.fn().mockReturnValue('watch-change'),
      fetchUtxo: jest.fn().mockRejectedValue(new Error('ordinary failure')),
    });
    mockRouteParams['wallet-id'] = 'onchain-wallet';
    mockSellGetInfo.mockResolvedValue(sellInfo('deposit-address'));
    const screen = renderScreen(Sell, wallet);
    await waitFor(() => screen.getByTestId('SellConfirm'));
    fireEvent.press(screen.getByTestId('SellConfirm'));
    await waitFor(() => expect(mockAlert).toHaveBeenCalledWith('Something went wrong', 'ordinary failure', expect.any(Array)));
    mockAlert.mock.calls[0][2][0].onPress();
    await waitFor(() => expect(wallet.getAddress).toHaveBeenCalledTimes(1));

    wallet.fetchUtxo.mockResolvedValue(undefined);
    wallet.createTransaction.mockReturnValue({ tx: { toHex: () => 'cached' }, outputs: [], psbt: 'psbt', fee: 1 });
    mockWasConfirmed.mockResolvedValue(false);
    fireEvent.press(screen.getByTestId('SellConfirm'));
    await waitFor(() => expect(wallet.createTransaction).toHaveBeenCalled());
    expect(wallet.getAddress).toHaveBeenCalledTimes(1);
  });

  it('builds a swap transaction and navigates to Confirm', async () => {
    const wallet = makeOnchainWallet({ type: 'HDsegwitBech32' });
    mockRouteParams['wallet-id'] = 'onchain-wallet';
    mockSwapGetInfo.mockResolvedValue(swapInfo('deposit-address'));
    const screen = renderScreen(Swap, wallet);
    await waitFor(() => screen.getByTestId(`Button-${loc.swap.confirm}`));
    fireEvent.press(screen.getByTestId(`Button-${loc.swap.confirm}`));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('Confirm', expect.objectContaining({ walletID: 'onchain-wallet', tx: 'deadbeef' })),
    );
  });

  it('alerts when swap receives an unsupported wallet type', async () => {
    mockRouteParams['wallet-id'] = 'onchain-wallet';
    const unsupported = { ...makeOnchainWallet(), chain: Chain.OFFCHAIN, type: 'unsupported', getID: () => 'onchain-wallet' };
    const second = renderScreen(Swap, unsupported);
    await waitFor(() => second.getByTestId(`Button-${loc.swap.confirm}`));
    fireEvent.press(second.getByTestId(`Button-${loc.swap.confirm}`));
    await waitFor(() => expect(mockAlert).toHaveBeenCalledWith('Unsupported wallet type'));
    expect(mockAlert).toHaveBeenCalledTimes(1);
  });

  it('goes back when swap cannot obtain a quote', async () => {
    const wallet = makeOnchainWallet({ type: 'HDsegwitBech32' });
    mockSwapGetInfo.mockRejectedValue(new Error('quote unavailable'));
    const third = renderScreen(Swap, wallet);
    await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
    third.unmount();
  });

  it('does not render a swap action when the route is missing', () => {
    mockRouteParams.routeId = undefined;
    const noRoute = renderScreen(Swap, []);
    expect(noRoute.queryByTestId(`Button-${loc.swap.confirm}`)).toBeNull();
    expect(mockSwapGetInfo).not.toHaveBeenCalled();
    noRoute.unmount();
  });

  it('does not navigate when the requested swap wallet is absent', async () => {
    mockRouteParams['wallet-id'] = 'missing-wallet';
    mockSwapGetInfo.mockResolvedValue(swapInfo('deposit-address'));
    const noWallet = renderScreen(Swap, makeOnchainWallet({ getID: () => 'other-wallet' }));
    await waitFor(() => noWallet.getByTestId(`Button-${loc.swap.confirm}`));
    mockNavigate.mockClear();
    fireEvent.press(noWallet.getByTestId(`Button-${loc.swap.confirm}`));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(0));
    noWallet.unmount();
  });

  it('uses the confirmed max amount and caches the swap change address', async () => {
    mockRouteParams['wallet-id'] = 'onchain-wallet';
    mockWasConfirmed.mockResolvedValue(true);
    const maxWallet = makeOnchainWallet({
      createTransaction: jest
        .fn()
        .mockReturnValue({ tx: { toHex: () => 'swap-max' }, outputs: [{ address: 'legacy-change', value: 99000 }], psbt: 'psbt', fee: 1 }),
    });
    const maxScreen = renderScreen(Swap, maxWallet);
    await waitFor(() => maxScreen.getByTestId(`Button-${loc.swap.confirm}`));
    fireEvent.press(maxScreen.getByTestId(`Button-${loc.swap.confirm}`));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(
        'Confirm',
        expect.objectContaining({ tx: 'swap-max', recipients: [{ address: 'legacy-change', value: 99000 }] }),
      ),
    );
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    fireEvent.press(maxScreen.getByTestId(`Button-${loc.swap.confirm}`));
    await waitFor(() => expect(maxWallet.getChangeAddressAsync).toHaveBeenCalledTimes(1));
    maxScreen.unmount();
  });

  it('reports the swap batching error and does not navigate', async () => {
    mockRouteParams['wallet-id'] = 'onchain-wallet';
    const swapError = Object.assign(new Error('swap failed'), { code: 'ELECTRUM_BATCHING_UNSUPPORTED' });
    const errorWallet = makeOnchainWallet({
      type: 'watchOnly',
      isHd: () => false,
      getAddress: jest.fn().mockReturnValue('watch-change'),
      fetchUtxo: jest.fn().mockRejectedValue(swapError),
    });
    const errorScreen = renderScreen(Swap, errorWallet);
    await waitFor(() => errorScreen.getByTestId(`Button-${loc.swap.confirm}`));
    mockNavigate.mockClear();
    fireEvent.press(errorScreen.getByTestId(`Button-${loc.swap.confirm}`));
    await waitFor(() =>
      expect(mockAlert).toHaveBeenCalledWith('Something went wrong', loc.send.details_utxo_refresh_unsupported_server, expect.any(Array)),
    );
    expect(mockAlert).toHaveBeenCalledTimes(1);
    mockAlert.mock.calls[0][2][0].onPress();
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(0));
    errorScreen.unmount();
  });

  it('reports an ordinary swap confirmation error', async () => {
    mockRouteParams['wallet-id'] = 'onchain-wallet';
    const errorWallet = makeOnchainWallet({ fetchUtxo: jest.fn().mockRejectedValue(new Error('ordinary swap')) });
    const errorScreen = renderScreen(Swap, errorWallet);
    await waitFor(() => errorScreen.getByTestId(`Button-${loc.swap.confirm}`));
    fireEvent.press(errorScreen.getByTestId(`Button-${loc.swap.confirm}`));
    await waitFor(() => expect(mockAlert).toHaveBeenCalledWith('Something went wrong', 'ordinary swap', expect.any(Array)));
    expect(mockAlert).toHaveBeenCalledTimes(1);
    errorScreen.unmount();
  });

  it('uses the internal swap change address when the wallet fallback rejects', async () => {
    mockRouteParams['wallet-id'] = 'onchain-wallet';
    class SwapFallbackWallet extends AbstractHDElectrumWallet {}
    const internal = new SwapFallbackWallet();
    Object.assign(
      internal,
      makeOnchainWallet({
        _getInternalAddressByIndex: jest.fn().mockReturnValue('internal'),
        getNextFreeChangeAddressIndex: jest.fn().mockReturnValue(9),
        getChangeAddressAsync: jest.fn().mockRejectedValue(new Error('no change')),
      }),
    );
    const internalScreen = renderScreen(Swap, internal);
    await waitFor(() => internalScreen.getByTestId(`Button-${loc.swap.confirm}`));
    fireEvent.press(internalScreen.getByTestId(`Button-${loc.swap.confirm}`));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
    expect(internal._getInternalAddressByIndex).toHaveBeenCalledWith(9);
    internalScreen.unmount();
  });

  it('goes back when both swap wallet quote sources fail', async () => {
    mockSwapGetInfo.mockImplementation(async walletId => {
      if (walletId === 'onchain-wallet') return null;
      throw new Error('lightning quote failed');
    });
    mockRouteParams['wallet-id'] = 'onchain-wallet';
    const failedQuotes = renderScreen(Swap, [makeOnchainWallet(), makeSparkWallet()]);
    await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
    failedQuotes.unmount();
  });

  it('does not request a sell quote when the route is missing', () => {
    mockRouteParams.routeId = undefined;
    const missingRoute = renderScreen(Sell, makeOnchainWallet());
    expect(missingRoute.queryByTestId('SellConfirm')).toBeNull();
    expect(mockSellGetInfo).not.toHaveBeenCalled();
    missingRoute.unmount();
  });

  it('keeps sell confirmation inactive when the quote request fails', async () => {
    mockRouteParams['wallet-id'] = 'missing-wallet';
    const quotePromise = Promise.reject(new Error('quote failed'));
    mockSellGetInfo.mockReturnValue(quotePromise);
    const failedQuote = renderScreen(Sell, makeOnchainWallet());
    await expect(quotePromise).rejects.toThrow('quote failed');
    await waitFor(() => expect(mockSellGetInfo).toHaveBeenCalledTimes(1));
    expect(failedQuote.queryByTestId('SellConfirm')).toBeNull();
    failedQuote.unmount();
  });

  it('does not navigate when the requested sell wallet is absent', async () => {
    mockRouteParams['wallet-id'] = 'missing-wallet';
    mockSellGetInfo.mockResolvedValue(sellInfo('deposit-address'));
    const missingWallet = renderScreen(Sell, makeOnchainWallet({ getID: () => 'other-wallet' }));
    await waitFor(() => missingWallet.getByTestId('SellConfirm'));
    mockNavigate.mockClear();
    fireEvent.press(missingWallet.getByTestId('SellConfirm'));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(0));
    missingWallet.unmount();
  });

  it('uses the legacy address when the sell change address request rejects', async () => {
    const wallet = makeOnchainWallet({ getChangeAddressAsync: jest.fn().mockRejectedValue(new Error('no address')) });
    mockRouteParams['wallet-id'] = 'onchain-wallet';
    mockSellGetInfo.mockResolvedValue(sellInfo('deposit-address'));
    const screen = renderScreen(Sell, wallet);
    await waitFor(() => screen.getByTestId('SellConfirm'));
    fireEvent.press(screen.getByTestId('SellConfirm'));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(wallet.getAddress).toHaveBeenCalledTimes(1));
    screen.unmount();
  });

  it('uses the internal address fallback for sell change output', async () => {
    mockRouteParams['wallet-id'] = 'onchain-wallet';
    class FallbackWallet extends AbstractHDElectrumWallet {}
    const internal = new FallbackWallet();
    Object.assign(
      internal,
      makeOnchainWallet({
        getChangeAddressAsync: jest.fn().mockRejectedValue(new Error('no change')),
        _getInternalAddressByIndex: jest.fn().mockReturnValue('internal-change'),
        getNextFreeChangeAddressIndex: jest.fn().mockReturnValue(2),
      }),
    );
    const internalScreen = renderScreen(Sell, internal);
    await waitFor(() => internalScreen.getByTestId('SellConfirm'));
    fireEvent.press(internalScreen.getByTestId('SellConfirm'));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
    expect(internal._getInternalAddressByIndex).toHaveBeenCalledWith(2);
    internalScreen.unmount();
  });

  it('exposes the sell and swap navigation titles', () => {
    const theme = require('../../components/themes').BlueDarkTheme;
    expect(Sell.navigationOptions(theme)({ navigation: { goBack: jest.fn() }, route: {} }).title).toBe(loc.sell.header);
    expect(Swap.navigationOptions(theme)({ navigation: { goBack: jest.fn() }, route: {} }).title).toBe(loc.swap.header);
  });
});
