import React from 'react';
import { bech32m } from 'bech32';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Chain } from '../../models/bitcoinUnits';

jest.mock('../../blue_modules/BlueElectrum', () => ({ connectMain: jest.fn() }));
jest.mock('../../blue_modules/currency', () => ({
  btcToSatoshi: jest.fn(value => Math.floor(Number(value) * 100_000_000)),
}));
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
const { BlueStorageContext } = require('../../blue_modules/storage-context');
const Sell = require('../../screen/dfx/sell').default;
const Swap = require('../../screen/dfx/swap').default;
const loc = require('../../loc').default;

const SPARK_INVOICE = bech32m.encode('spark', bech32m.toWords(Buffer.from('dfx reusable sats invoice')), 10000);
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
  mockRouteParams.routeId = '1';
  mockRouteParams.amount = AMOUNT_BTC;
  mockRouteParams['wallet-id'] = 'spark-dfx-wallet';
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
    screen.unmount();
    mockNavigate.mockClear();
    mockSellGetInfo.mockResolvedValue(sellInfo(LNURL));
    screen = renderScreen(Sell, makeSparkWallet());

    await waitFor(() => screen.getByTestId('SellConfirm'));
    fireEvent.press(screen.getByTestId('SellConfirm'));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(mockNavigate.mock.calls[0]).toEqual([
      'LnurlPay',
      { lnurl: LNURL, walletID: 'spark-dfx-wallet', amountSat: AMOUNT_SATS },
    ]);
    screen.unmount();
    mockNavigate.mockClear();
    mockRouteParams['wallet-id'] = 'lds-dfx-wallet';
    mockSellGetInfo.mockResolvedValue(sellInfo(SPARK_INVOICE));
    screen = renderScreen(Sell, makeLdsWallet());

    await waitFor(() => screen.getByTestId('SellConfirm'));
    fireEvent.press(screen.getByTestId('SellConfirm'));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(mockNavigate.mock.calls[0]).toEqual([
      'LnurlPay',
      { lnurl: SPARK_INVOICE, walletID: 'lds-dfx-wallet', amountSat: AMOUNT_SATS },
    ]);
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
    screen.unmount();
    mockNavigate.mockClear();
    mockSwapGetInfo.mockResolvedValue(swapInfo(LNURL));
    screen = renderScreen(Swap, makeSparkWallet());

    await waitFor(() => screen.getByTestId(`Button-${loc.swap.confirm}`));
    fireEvent.press(screen.getByTestId(`Button-${loc.swap.confirm}`));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(mockNavigate.mock.calls[0]).toEqual([
      'LnurlPay',
      { lnurl: LNURL, walletID: 'spark-dfx-wallet', amountSat: AMOUNT_SATS },
    ]);
    screen.unmount();
    mockNavigate.mockClear();
    mockRouteParams['wallet-id'] = 'lds-dfx-wallet';
    mockSwapGetInfo.mockResolvedValue(swapInfo(SPARK_INVOICE));
    screen = renderScreen(Swap, makeLdsWallet());

    await waitFor(() => screen.getByTestId(`Button-${loc.swap.confirm}`));
    fireEvent.press(screen.getByTestId(`Button-${loc.swap.confirm}`));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(mockNavigate.mock.calls[0]).toEqual([
      'LnurlPay',
      { lnurl: SPARK_INVOICE, walletID: 'lds-dfx-wallet', amountSat: AMOUNT_SATS },
    ]);
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
