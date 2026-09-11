import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Platform } from 'react-native';

jest.mock('../../blue_modules/BlueElectrum', () => ({ connectMain: jest.fn() }));
jest.mock('../../blue_modules/currency', () => ({ init: jest.fn() }));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate }),
    useTheme: () => require('../../components/themes').BlueDarkTheme,
  };
});

let mockWalletContext;
jest.mock('../../contexts/wallet.context', () => ({
  useWalletContext: () => mockWalletContext,
}));

// Avoid pulling the full wallet class graph (circular imports under Jest).
jest.mock('../../class/wallets/taproot-lds-wallet', () => ({
  TaprootLdsWalletType: { BTC: 'BTC', CHF: 'CHF', USD: 'USD', EUR: 'EUC' },
  TaprootLdsWallet: { type: 'taprootLdsWallet' },
}));
jest.mock('../../class/wallets/lightning-lds-wallet', () => ({
  LightningLdsWallet: { type: 'lightningLdsWallet' },
}));
jest.mock('../../class/wallets/spark-wallet', () => ({
  SparkWallet: { type: 'sparkWallet' },
}));
jest.mock('../../class', () => ({
  MultisigHDWallet: { type: 'HDmultisig' },
}));

const Settings = require('../../screen/settings/settings').default;
const { BlueStorageContext } = require('../../blue_modules/storage-context');
const { LightningLdsWallet } = require('../../class/wallets/lightning-lds-wallet');
const { SparkWallet } = require('../../class/wallets/spark-wallet');
const { TaprootLdsWallet, TaprootLdsWalletType } = require('../../class/wallets/taproot-lds-wallet');
const { MultisigHDWallet } = require('../../class');
const loc = require('../../loc').default;

function renderSettings(wallets) {
  return render(
    <BlueStorageContext.Provider value={{ wallets, language: 'en', ldsDEV: false }}>
      <Settings />
    </BlueStorageContext.Provider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockWalletContext = { walletID: 'onchain-1' };
});

describe('Settings Lightning wallet entry', () => {
  it('enables the Lightning entry for a Spark-only wallet and navigates to its details', () => {
    const sparkWallet = {
      type: SparkWallet.type,
      getID: () => 'spark-wallet-id',
    };
    const screen = renderSettings([sparkWallet]);
    const item = screen.getByTestId('WalletDetailsLnd');

    expect(item).not.toBeDisabled();
    expect(screen.getByText(loc.wallets.lightning_spark_wallet_label)).toBeTruthy();
    expect(screen.queryByText(loc.wallets.lightning_wallet_label)).toBeNull();
    fireEvent.press(item);
    expect(mockNavigate).toHaveBeenCalledWith('WalletDetails', { walletID: 'spark-wallet-id' });
  });

  it('prefers the LDS wallet over Spark when both are present, even if Spark is listed first', () => {
    const sparkWallet = {
      type: SparkWallet.type,
      getID: () => 'spark-wallet-id',
    };
    const ldsWallet = {
      type: LightningLdsWallet.type,
      getID: () => 'lds-wallet-id',
    };
    const screen = renderSettings([sparkWallet, ldsWallet]);
    const item = screen.getByTestId('WalletDetailsLnd');

    expect(item).not.toBeDisabled();
    fireEvent.press(item);
    expect(mockNavigate).toHaveBeenCalledWith('WalletDetails', { walletID: 'lds-wallet-id' });
    expect(mockNavigate).not.toHaveBeenCalledWith('WalletDetails', { walletID: 'spark-wallet-id' });
  });

  it('keeps the Lightning entry disabled when neither LDS nor Spark is present', () => {
    const screen = renderSettings([]);
    expect(screen.getByTestId('WalletDetailsLnd')).toBeDisabled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('enables the Lightning entry for an LDS-only wallet and navigates to its details', () => {
    const ldsWallet = {
      type: LightningLdsWallet.type,
      getID: () => 'lds-only-id',
    };
    const screen = renderSettings([ldsWallet]);
    const item = screen.getByTestId('WalletDetailsLnd');

    expect(item).not.toBeDisabled();
    expect(screen.getByText(loc.wallets.lightning_wallet_label)).toBeTruthy();
    expect(screen.queryByText(loc.wallets.lightning_spark_wallet_label)).toBeNull();
    fireEvent.press(item);
    expect(mockNavigate).toHaveBeenCalledWith('WalletDetails', { walletID: 'lds-only-id' });
  });

  it('does not navigate when the disabled Lightning row is pressed', () => {
    const screen = renderSettings([]);
    expect(screen.getByTestId('WalletDetailsLnd')).toBeDisabled();
    fireEvent.press(screen.getByTestId('WalletDetailsLnd'));
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('Settings remaining rows', () => {
  it('navigates each settings row to its screen', () => {
    const screen = renderSettings([]);

    fireEvent.press(screen.getByTestId('GeneralSettings'));
    expect(mockNavigate).toHaveBeenCalledWith('GeneralSettings');

    fireEvent.press(screen.getByTestId('WalletDetails'));
    expect(mockNavigate).toHaveBeenCalledWith('WalletDetails', { walletID: 'onchain-1' });

    fireEvent.press(screen.getByTestId('Currency'));
    expect(mockNavigate).toHaveBeenCalledWith('Currency');

    fireEvent.press(screen.getByTestId('Language'));
    expect(mockNavigate).toHaveBeenCalledWith('Language');

    fireEvent.press(screen.getByTestId('SecurityButton'));
    expect(mockNavigate).toHaveBeenCalledWith('EncryptStorage');

    fireEvent.press(screen.getByTestId('NetworkSettings'));
    expect(mockNavigate).toHaveBeenCalledWith('NetworkSettings');

    fireEvent.press(screen.getByTestId('Tools'));
    expect(mockNavigate).toHaveBeenCalledWith('Tools');

    fireEvent.press(screen.getByText('Feature Flags'));
    expect(mockNavigate).toHaveBeenCalledWith('FeatureFlags');

    fireEvent.press(screen.getByTestId('AboutButton'));
    expect(mockNavigate).toHaveBeenCalledWith('About');
  });

  it('enables the multi-device row for a multisig wallet and navigates to its details', () => {
    const multisigWallet = {
      type: MultisigHDWallet.type,
      getID: () => 'multisig-id',
    };
    const screen = renderSettings([multisigWallet]);
    const item = screen.getByTestId('WalletDetailsMultisig');

    expect(item).not.toBeDisabled();
    fireEvent.press(item);
    expect(mockNavigate).toHaveBeenCalledWith('WalletDetails', { walletID: 'multisig-id' });
  });

  it('does not navigate when the disabled multi-device row is pressed', () => {
    const screen = renderSettings([]);
    expect(screen.getByTestId('WalletDetailsMultisig')).toBeDisabled();
    fireEvent.press(screen.getByTestId('WalletDetailsMultisig'));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('still hides the CHF entry when a non-CHF taproot wallet is present and LDS-dev is off', () => {
    const btcTaproot = {
      type: TaprootLdsWallet.type,
      getID: () => 'btc-taproot-id',
      getCurrencyName: () => TaprootLdsWalletType.BTC,
    };
    const screen = renderSettings([btcTaproot]);
    expect(screen.queryByText(loc.wallets.chf_taproot_wallet_label)).toBeNull();
    expect(screen.queryByTestId('WalletDetailsChfTaproot')).toBeNull();
  });

  it('shows the Settings subheader on Android', () => {
    const previous = Platform.OS;
    Platform.OS = 'android';
    try {
      const screen = renderSettings([]);
      expect(screen.getByText(loc.settings.header)).toBeTruthy();
    } finally {
      Platform.OS = previous;
    }
  });

  it('titles the navigation header with Settings on iOS', () => {
    let isolatedLoc;
    let IsolatedSettings;
    jest.isolateModules(() => {
      isolatedLoc = require('../../loc').default;
      isolatedLoc.setLanguage('en');
      IsolatedSettings = require('../../screen/settings/settings').default;
    });

    const theme = require('../../components/themes').BlueDarkTheme;
    const options = IsolatedSettings.navigationOptions(theme)({
      navigation: { goBack: jest.fn() },
      route: {},
    });
    expect(options.headerTitle).toBe(isolatedLoc.settings.header);
  });

  it('leaves the navigation title empty under Android Platform.select so the in-page subheader can carry it', () => {
    let headerTitle;
    jest.isolateModules(() => {
      const RN = require('react-native');
      const originalSelect = RN.Platform.select;
      // Jest loads Platform.ios.js, whose select ignores OS and always takes spec.ios.
      // Mirror Platform.android.js: no `android` key → `default`.
      RN.Platform.select = spec => ('android' in spec ? spec.android : 'native' in spec ? spec.native : spec.default);
      try {
        const SettingsAndroid = require('../../screen/settings/settings').default;
        const theme = require('../../components/themes').BlueDarkTheme;
        const options = SettingsAndroid.navigationOptions(theme)({
          navigation: { goBack: jest.fn() },
          route: {},
        });
        headerTitle = options.headerTitle;
      } finally {
        RN.Platform.select = originalSelect;
      }
    });
    expect(headerTitle).toBe('');
  });
});
