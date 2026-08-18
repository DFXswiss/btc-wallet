import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('../../blue_modules/BlueElectrum', () => ({ connectMain: jest.fn() }));
jest.mock('../../blue_modules/currency', () => ({
  init: jest.fn(),
  preferredFiatCurrency: { endPointKey: 'USD' },
  BitcoinUnit: { BTC: 'BTC', SATS: 'sats' },
  satoshiToLocalCurrency: () => '0',
  satoshiToBTC: v => String(v),
}));
jest.mock('react-native-haptic-feedback', () => ({ trigger: jest.fn() }));
jest.mock('../../components/TransactionsNavigationHeader', () => {
  const RN = require('react');
  const { View } = require('react-native');
  return function TransactionsNavigationHeader() {
    return RN.createElement(View, { testID: 'TransactionsNavigationHeader' });
  };
});
jest.mock('../../helpers/scan-qr', () => jest.fn());
jest.mock('../../class/boltcard', () => ({ isPossiblyBoltcardTapDetails: () => false }));
jest.mock('../../class/deeplink-schema-match', () => ({
  isPossiblyPSBTString: () => false,
  isBothBitcoinAndLightning: () => false,
  isLnUrl: () => false,
  navigationRouteFor: () => {},
}));
jest.mock('../../blue_modules/clipboard', () => () => ({ getClipboardContent: jest.fn().mockResolvedValue('') }));
jest.mock('../../blue_modules/fs', () => ({}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../api/dfx/contexts/session.context', () => ({
  DfxService: { BUY: 'buy', SELL: 'sell', SWAP: 'swap' },
  useDfxSessionContext: () => ({ isAvailable: true, openServices: jest.fn() }),
}));
jest.mock('../../contexts/wallet.context', () => ({
  useWalletContext: () => ({ wallet: null }),
}));
jest.mock('../../api/spark/spark-sdk', () => ({
  requireSparkSdk: () => ({}),
  getSparkSdk: () => ({}),
  isSparkSdkConnected: () => false,
}));

const mockRoute = { name: 'WalletTransactions', params: { walletID: '' } };
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useRoute: () => mockRoute,
    useNavigation: () => ({
      navigate: jest.fn(),
      setParams: jest.fn(),
      setOptions: jest.fn(),
      goBack: jest.fn(),
    }),
    useTheme: () => require('../../components/themes').BlueDarkTheme,
    useFocusEffect: jest.fn(),
  };
});

const Asset = require('../../screen/wallets/asset').default;
const { BlueStorageContext } = require('../../blue_modules/storage-context');
const { SparkWallet } = require('../../class/wallets/spark-wallet');
const { LightningLdsWallet } = require('../../class/wallets/lightning-lds-wallet');
const loc = require('../../loc').default;

function makeSpark(id) {
  const wallet = SparkWallet.create('pk-asset-dfx');
  wallet.getID = () => id;
  wallet.setLabel('Spark');
  return wallet;
}

function makeLds(id) {
  const wallet = LightningLdsWallet.create('lds@test', 'proof');
  wallet.getID = () => id;
  wallet.setLabel('Lightning');
  return wallet;
}

function renderAsset(wallet) {
  mockRoute.params.walletID = wallet.getID();
  return render(
    <BlueStorageContext.Provider
      value={{
        wallets: [wallet],
        saveToDisk: jest.fn(),
        setSelectedWallet: jest.fn(),
        walletTransactionUpdateStatus: '',
        revalidateBalancesInterval: jest.fn(),
      }}
    >
      <Asset navigation={{}} />
    </BlueStorageContext.Provider>,
  );
}

describe('wallet asset DFX services', () => {
  it('shows External services for an LNDHub wallet and hides them for Spark', () => {
    const sparkScreen = renderAsset(makeSpark('spark-asset-1'));
    expect(sparkScreen.queryByText(loc.wallets.external_services)).toBeNull();
    sparkScreen.unmount();

    const ldsScreen = renderAsset(makeLds('lds-asset-1'));
    expect(ldsScreen.getByText(loc.wallets.external_services)).toBeTruthy();
  });
});
