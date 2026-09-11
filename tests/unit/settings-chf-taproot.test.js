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
jest.mock('../../class', () => ({
  MultisigHDWallet: { type: 'HDmultisig' },
}));

const Settings = require('../../screen/settings/settings').default;
const { BlueStorageContext } = require('../../blue_modules/storage-context');
const { TaprootLdsWallet, TaprootLdsWalletType } = require('../../class/wallets/taproot-lds-wallet');
const loc = require('../../loc').default;

function renderSettings(wallets) {
  return render(
    <BlueStorageContext.Provider value={{ wallets, language: 'en', ldsDEV: true }}>
      <Settings />
    </BlueStorageContext.Provider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockWalletContext = { walletID: 'onchain-1' };
});

describe('Settings CHF Taproot entry', () => {
  it('navigates to AddLightning with asset CHF when no CHF wallet exists', () => {
    const screen = renderSettings([]);
    fireEvent.press(screen.getByText(loc.wallets.chf_taproot_wallet_label));

    expect(mockNavigate).toHaveBeenCalledWith('WalletsRoot', {
      screen: 'AddLightning',
      params: { asset: TaprootLdsWalletType.CHF },
    });
    expect(mockNavigate).not.toHaveBeenCalledWith('WalletDetails', expect.anything());
  });

  it('navigates to WalletDetails for an existing CHF wallet, not AddLightning', () => {
    const chfWallet = {
      type: TaprootLdsWallet.type,
      getID: () => 'chf-wallet-id',
      getCurrencyName: () => TaprootLdsWalletType.CHF,
    };
    const screen = renderSettings([chfWallet]);
    fireEvent.press(screen.getByText(loc.wallets.chf_taproot_wallet_label));

    expect(mockNavigate).toHaveBeenCalledWith('WalletDetails', { walletID: 'chf-wallet-id' });
    const wentToAddLightning = mockNavigate.mock.calls.some(call => call[0] === 'WalletsRoot' && call[1]?.screen === 'AddLightning');
    expect(wentToAddLightning).toBe(false);
  });

  it('hides the CHF entry when the LDS-dev feature flag is off', () => {
    const screen = render(
      <BlueStorageContext.Provider value={{ wallets: [], language: 'en', ldsDEV: false }}>
        <Settings />
      </BlueStorageContext.Provider>,
    );
    expect(screen.queryByText(loc.wallets.chf_taproot_wallet_label)).toBeNull();
  });
});
