import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

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
});
