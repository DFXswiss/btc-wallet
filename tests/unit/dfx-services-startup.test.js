import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Chain } from '../../models/bitcoinUnits';

const mockNavigate = jest.fn();
const mockFetchUtxo = jest.fn();
const mockAuth = jest.fn();
const mockGetSignMessage = jest.fn();
const mockGetLnurlFromAddress = jest.fn();
const mockSessionSet = jest.fn();
let mockMainWallet;

jest.mock('../../api/dfx/hooks/auth.hook', () => ({
  useAuth: () => ({ auth: mockAuth, getSignMessage: mockGetSignMessage }),
}));
jest.mock('../../api/dfx/hooks/api.hook', () => ({ useApi: () => ({ call: jest.fn() }) }));
jest.mock('../../hooks/store.hook', () => ({
  useStore: () => ({ dfxSession: { set: mockSessionSet, remove: jest.fn() } }),
}));
jest.mock('../../contexts/wallet.context', () => ({
  useWalletContext: () => ({
    wallet: mockMainWallet,
    walletID: 'main-wallet-id',
    address: 'main-wallet-address',
    signMessage: jest.fn(),
    getOwnershipProof: jest.fn(),
  }),
}));
jest.mock('../../blue_modules/storage-context', () => {
  const ReactModule = require('react');
  return { BlueStorageContext: ReactModule.createContext({ wallets: [], isDfxPos: false, isDfxSwap: false }) };
});
jest.mock('../../loc', () => ({
  __esModule: true,
  default: {
    getLanguage: () => 'en',
    wallets: {
      external_services: 'External services',
      lightning_spark_address_unavailable: 'Spark Lightning address is unavailable',
    },
    _: { ok: 'OK' },
    send: { details_utxo_refresh_unsupported_server: 'Server does not support UTXO batching' },
  },
}));
jest.mock('../../api/dfx/contexts/language.context', () => ({ useLanguageContext: () => ({ languages: [] }) }));
jest.mock('../../class/lnurl', () => ({
  __esModule: true,
  default: { getLnurlFromAddress: mockGetLnurlFromAddress },
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useTheme: () => ({ colors: { background: '#111' } }),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({ setItem: jest.fn() }));
jest.mock('../../models/networkTransactionFees', () => ({
  __esModule: true,
  default: { recommendedFees: jest.fn().mockResolvedValue({ fastestFee: 5 }) },
  NetworkTransactionFee: { StorageKey: 'NetworkTransactionFee' },
}));
jest.mock('../../helpers/dfxMaxAmount', () => ({ DfxMaxAmount: { remember: jest.fn().mockResolvedValue(undefined) } }));
jest.mock('../../helpers/utils', () => ({
  Utils: { withRetry: fn => fn(), sumUtxoValue: utxos => utxos.reduce((sum, utxo) => sum + utxo.value, 0) },
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
const { DfxSessionContextProvider } = require('../../api/dfx/contexts/session.context');
const DfxServicesButtons = require('../../components/DfxServicesButtons').default;

function makeWallet(type = 'sparkWallet') {
  return {
    type,
    chain: Chain.OFFCHAIN,
    getID: () => 'spark-wallet-id',
    lnAddress: 'alice@example.com',
    signCompactMessage: jest.fn().mockResolvedValue('compact-signature'),
    getBalance: () => 100000000,
    getUtxo: () => [{ value: 100000 }],
    fetchUtxo: mockFetchUtxo,
    getChangeAddressAsync: jest.fn().mockResolvedValue('change'),
    getAddress: jest.fn().mockReturnValue('address'),
    createTransaction: jest.fn().mockReturnValue({ fee: 1000 }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ accessToken: 'access-token' });
  mockGetSignMessage.mockImplementation(address => `sign:${address}`);
  mockGetLnurlFromAddress.mockReturnValue('lnurl1sparkaddress');
  mockFetchUtxo.mockResolvedValue(undefined);
  mockMainWallet = makeWallet();
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('renders service buttons and forwards a rendered Buy action to openServices', async () => {
  const wallet = mockMainWallet;
  const screen = render(
    <BlueStorageContext.Provider value={{ wallets: [wallet], isDfxPos: false, isDfxSwap: false }}>
      <DfxSessionContextProvider>
        <DfxServicesButtons walletID={wallet.getID()} />
      </DfxSessionContextProvider>
    </BlueStorageContext.Provider>,
  );

  await waitFor(() => expect(screen.getByText('External services')).toBeTruthy());
  expect(mockAuth).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('dfx-buy-en'));
  await waitFor(() => expect(mockAuth).toHaveBeenCalledWith('LNURL1SPARKADDRESS', 'compact-signature'));
  expect(wallet.signCompactMessage).toHaveBeenCalledWith('sign:LNURL1SPARKADDRESS');
  expect(Linking.openURL).toHaveBeenCalledWith(expect.stringContaining('session=access-token'));
});

it('keeps rendered services hidden for a multisig-only wallet without startup auth', async () => {
  const wallet = makeWallet('HDmultisig');
  const screen = render(
    <BlueStorageContext.Provider value={{ wallets: [wallet], isDfxPos: false, isDfxSwap: false }}>
      <DfxSessionContextProvider>
        <DfxServicesButtons walletID={wallet.getID()} />
      </DfxSessionContextProvider>
    </BlueStorageContext.Provider>,
  );
  await waitFor(() => expect(screen.queryByText('External services')).toBeNull());
  expect(mockAuth).not.toHaveBeenCalled();
});
