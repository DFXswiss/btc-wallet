import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Chain } from '../../models/bitcoinUnits';

const mockNavigate = jest.fn();
const mockOpenServices = jest.fn();
const mockRemember = jest.fn().mockResolvedValue(undefined);
const mockRecommendedFees = jest.fn();
const mockSetItem = jest.fn().mockResolvedValue(undefined);
const mockFetchUtxo = jest.fn().mockResolvedValue(undefined);
const languageState = { value: 'en' };
const availabilityState = { value: true };
let mockMainWallet;

jest.mock('../../api/dfx/contexts/session.context', () => ({
  DfxService: { BUY: 'buy', SELL: 'sell', SWAP: 'swap' },
  useDfxSessionContext: () => ({ isAvailable: availabilityState.value, openServices: mockOpenServices }),
}));
jest.mock('../../contexts/wallet.context', () => ({ useWalletContext: () => ({ wallet: mockMainWallet }) }));
jest.mock('../../blue_modules/storage-context', () => {
  const ReactModule = require('react');
  return { BlueStorageContext: ReactModule.createContext({ wallets: [], isDfxPos: false, isDfxSwap: false }) };
});
jest.mock('../../loc', () => ({
  __esModule: true,
  default: {
    getLanguage: () => languageState.value,
    wallets: { external_services: 'External services' },
    _: { ok: 'OK' },
    send: { details_utxo_refresh_unsupported_server: 'Server does not support UTXO batching' },
  },
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useTheme: () => ({ colors: { background: '#111' } }),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({ setItem: mockSetItem }));
jest.mock('../../models/networkTransactionFees', () => ({
  __esModule: true,
  default: { recommendedFees: mockRecommendedFees },
  NetworkTransactionFee: { StorageKey: 'NetworkTransactionFee' },
}));
jest.mock('../../helpers/dfxMaxAmount', () => ({ DfxMaxAmount: { remember: mockRemember } }));
jest.mock('../../helpers/utils', () => ({
  Utils: {
    withRetry: fn => fn(),
    sumUtxoValue: utxos => utxos.reduce((sum, utxo) => sum + utxo.value, 0),
  },
}));
jest.mock('../../blue_modules/currency', () => ({ satoshiToBTC: value => Number(value) / 100000000 }));
jest.mock('../../components/ImageButton', () => ({
  ImageButton: ({ source, onPress, disabled }) =>
    require('react').createElement(
      require('react-native').TouchableOpacity,
      { testID: `dfx-${source}`, onPress, disabled },
      require('react').createElement(require('react-native').Text, null, source),
    ),
}));
jest.mock('../../BlueComponents', () => ({
  BlueText: ({ children }) => require('react').createElement(require('react-native').Text, null, children),
}));
jest.mock('../../class', () => ({ WatchOnlyWallet: { type: 'watchOnly' } }));
jest.mock('../../class/wallets/lightning-lds-wallet', () => ({ LightningLdsWallet: { type: 'lightningLdsWallet' } }));
jest.mock('../../class/wallets/spark-wallet', () => ({ SparkWallet: { type: 'sparkWallet' } }));
jest.mock('../../class/wallets/abstract-hd-electrum-wallet', () => ({ AbstractHDElectrumWallet: class AbstractHDElectrumWallet {} }));
jest.mock('../../img/dfx/buttons/buy_en.png', () => 'buy-en');
jest.mock('../../img/dfx/buttons/sell_en.png', () => 'sell-en');
jest.mock('../../img/dfx/buttons/buy_de.png', () => 'buy-de');
jest.mock('../../img/dfx/buttons/sell_de.png', () => 'sell-de');
jest.mock('../../img/dfx/buttons/buy_fr.png', () => 'buy-fr');
jest.mock('../../img/dfx/buttons/sell_fr.png', () => 'sell-fr');
jest.mock('../../img/dfx/buttons/buy_it.png', () => 'buy-it');
jest.mock('../../img/dfx/buttons/sell_it.png', () => 'sell-it');
jest.mock('../../img/dfx/buttons/swap.png', () => 'swap');

const { BlueStorageContext } = require('../../blue_modules/storage-context');
const { AbstractHDElectrumWallet } = require('../../class/wallets/abstract-hd-electrum-wallet');
const DfxServicesButtons = require('../../components/DfxServicesButtons').default;

function makeWallet(overrides = {}) {
  const wallet = {
    type: 'legacy',
    chain: Chain.OFFCHAIN,
    getID: () => 'wallet-1',
    getBalance: () => 100000000,
    getUtxo: () => [{ value: 100000 }],
    fetchUtxo: mockFetchUtxo,
    getChangeAddressAsync: jest.fn().mockResolvedValue('change-async'),
    getAddress: jest.fn().mockReturnValue('legacy-address'),
    createTransaction: jest.fn().mockReturnValue({ fee: 1000 }),
  };
  return Object.assign(wallet, overrides);
}

function renderButtons(wallet, extras = {}) {
  return render(
    <BlueStorageContext.Provider value={{ wallets: [wallet], isDfxPos: false, isDfxSwap: false, ...extras }}>
      <DfxServicesButtons walletID={wallet.getID()} />
    </BlueStorageContext.Provider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOpenServices.mockReset();
  mockRemember.mockReset();
  mockRecommendedFees.mockReset();
  mockSetItem.mockReset();
  mockFetchUtxo.mockReset();
  mockOpenServices.mockResolvedValue(undefined);
  mockRemember.mockResolvedValue(undefined);
  mockRecommendedFees.mockResolvedValue({ fastestFee: 5 });
  mockSetItem.mockResolvedValue(undefined);
  mockFetchUtxo.mockResolvedValue(undefined);
  languageState.value = 'en';
  availabilityState.value = true;
  mockRecommendedFees.mockResolvedValue({ fastestFee: 5 });
  mockOpenServices.mockResolvedValue(undefined);
  mockMainWallet = makeWallet({ getID: () => 'main-wallet' });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('DfxServicesButtons rendered service actions', () => {
  it('renders localized sets and handles each service/POS action', async () => {
    const wallet = makeWallet();
    const screen = renderButtons(wallet, { isDfxSwap: true, isDfxPos: true });
    expect(screen.getByText('External services')).toBeTruthy();
    for (const language of ['en', 'de', 'fr', 'it', 'xx']) {
      languageState.value = language;
      screen.rerender(
        <BlueStorageContext.Provider value={{ wallets: [wallet], isDfxPos: true, isDfxSwap: true }}>
          <DfxServicesButtons walletID={wallet.getID()} />
        </BlueStorageContext.Provider>,
      );
      const image = language === 'de' ? 'buy-de' : language === 'fr' ? 'buy-fr' : language === 'it' ? 'buy-it' : 'buy-en';
      await waitFor(() => expect(screen.getByTestId(`dfx-${image}`)).toBeTruthy());
    }
    fireEvent.press(screen.getByTestId('dfx-buy-en'));
    await waitFor(() => expect(mockOpenServices).toHaveBeenCalledWith('wallet-1', '1', 'buy'));
    fireEvent.press(screen.getByTestId('dfx-swap'));
    await waitFor(() => expect(mockOpenServices).toHaveBeenCalledWith('wallet-1', '0.97', 'swap'));
    fireEvent.press(screen.getByTestId('dfx-sell-en'));
    await waitFor(() => expect(mockOpenServices).toHaveBeenCalledWith('wallet-1', '0.97', 'sell'));
    fireEvent.press(screen.getByText('Point'));
    expect(mockNavigate).toHaveBeenCalledWith('ReceiveDetailsRoot', { screen: 'CashierDfxPos', params: { walletID: 'wallet-1' } });
    const mainFallback = render(
      <BlueStorageContext.Provider value={{ wallets: [makeWallet({ type: 'other' })], isDfxPos: false, isDfxSwap: false }}>
        <DfxServicesButtons walletID="missing-id" />
      </BlueStorageContext.Provider>,
    );
    expect(mainFallback.getByText('External services')).toBeTruthy();
    availabilityState.value = false;
    const unavailable = renderButtons(wallet);
    expect(unavailable.queryByText('External services')).toBeNull();
  });

  it('refreshes on-chain UTXOs, estimates fees, remembers max, and opens sell', async () => {
    class OnchainWallet extends AbstractHDElectrumWallet {}
    const wallet = new OnchainWallet();
    Object.assign(
      wallet,
      makeWallet({
        chain: Chain.ONCHAIN,
        getID: () => 'onchain-wallet',
        getUtxo: () => [{ value: 60000 }, { value: 40000 }],
        getChangeAddressAsync: jest.fn().mockResolvedValue('onchain-change'),
        createTransaction: jest.fn().mockReturnValue({ fee: 3000 }),
        _getInternalAddressByIndex: jest.fn().mockReturnValue('fallback-change'),
        getNextFreeChangeAddressIndex: jest.fn().mockReturnValue(7),
      }),
    );
    const screen = renderButtons(wallet, { isDfxSwap: true });
    fireEvent.press(screen.getByTestId('dfx-sell-en'));
    await waitFor(() => expect(mockOpenServices).toHaveBeenCalledWith('onchain-wallet', '0.00097', 'sell'));
    fireEvent.press(screen.getByTestId('dfx-swap'));
    await waitFor(() => expect(mockOpenServices).toHaveBeenCalledWith('onchain-wallet', '0.00097', 'swap'));
    expect(mockFetchUtxo).toHaveBeenCalled();
    expect(wallet.createTransaction).toHaveBeenCalledWith(
      [{ value: 60000 }, { value: 40000 }],
      [{ address: '36JxaUrpDzkEerkTf1FzwHNE1Hb7cCjgJV' }],
      5,
      'onchain-change',
      false,
    );
    expect(mockSetItem).toHaveBeenCalledWith('NetworkTransactionFee', JSON.stringify({ fastestFee: 5 }));
    expect(mockRemember).toHaveBeenCalledWith('onchain-wallet', 'sell', 97000, 100000);
    fireEvent.press(screen.getByTestId('dfx-sell-en'));
    await waitFor(() => expect(wallet.getChangeAddressAsync).toHaveBeenCalledTimes(1));
  });

  it('uses the abstract-wallet internal fallback and keeps a fee-estimate failure safe', async () => {
    class FallbackWallet extends AbstractHDElectrumWallet {}
    const wallet = new FallbackWallet();
    Object.assign(
      wallet,
      makeWallet({
        chain: Chain.ONCHAIN,
        getID: () => 'fallback-wallet',
        getChangeAddressAsync: jest.fn().mockRejectedValue(new Error('no change')),
        _getInternalAddressByIndex: jest.fn().mockReturnValue('internal-change'),
        getNextFreeChangeAddressIndex: jest.fn().mockReturnValue(3),
      }),
    );
    mockRecommendedFees.mockRejectedValueOnce(new Error('fee unavailable'));
    const screen = renderButtons(wallet);
    fireEvent.press(screen.getByTestId('dfx-sell-en'));
    await waitFor(() => expect(mockOpenServices).toHaveBeenCalledWith('fallback-wallet', '0', 'sell'));
    expect(wallet._getInternalAddressByIndex).toHaveBeenCalledWith(3);
    expect(mockRemember).toHaveBeenCalledWith('fallback-wallet', 'sell', 0, 100000);
  });

  it('uses watch-only and legacy address fallbacks', async () => {
    const watch = makeWallet({
      chain: Chain.ONCHAIN,
      type: 'watchOnly',
      isHd: () => false,
      getAddress: jest.fn().mockReturnValue('watch-address'),
    });
    const screen = renderButtons(watch);
    fireEvent.press(screen.getByTestId('dfx-sell-en'));
    await waitFor(() => expect(mockOpenServices).toHaveBeenCalled());
    expect(watch.getAddress).toHaveBeenCalled();

    const legacy = makeWallet({
      chain: Chain.ONCHAIN,
      getChangeAddressAsync: jest.fn().mockRejectedValue(new Error('no change')),
      getAddress: jest.fn().mockReturnValue('legacy-fallback'),
    });
    const second = renderButtons(legacy);
    fireEvent.press(second.getByTestId('dfx-sell-en'));
    await waitFor(() => expect(mockOpenServices).toHaveBeenCalledWith('wallet-1', '0.00099', 'sell'));
    expect(legacy.getAddress).toHaveBeenCalled();
  });

  it('shows actionable errors when service opening rejects', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const wallet = makeWallet({ getChangeAddressAsync: jest.fn().mockResolvedValue('change') });
    mockOpenServices.mockRejectedValueOnce(new Error('fee unavailable'));
    const screen = renderButtons(wallet);
    fireEvent.press(screen.getByTestId('dfx-sell-en'));
    await waitFor(() => expect(alert).toHaveBeenCalledWith('Something went wrong', 'fee unavailable', expect.any(Array)));
    alert.mock.calls[0][2][0].onPress();
    expect(mockOpenServices).toHaveBeenCalledTimes(1);
    expect(mockOpenServices).toHaveBeenCalledWith('wallet-1', '0.97', 'sell');

    alert.mockClear();
    const error = Object.assign(new Error('batching'), { code: 'ELECTRUM_BATCHING_UNSUPPORTED' });
    mockOpenServices.mockRejectedValueOnce(error);
    const secondWallet = makeWallet();
    const second = renderButtons(secondWallet);
    fireEvent.press(second.getByTestId('dfx-sell-en'));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith('Something went wrong', 'Server does not support UTXO batching', expect.any(Array)),
    );
    alert.mock.calls[0][2][0].onPress();
  });
});
