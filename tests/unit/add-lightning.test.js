import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

// The LNDHub screen used to double as an onboarding step, where its secondary
// button read "Skip for now". Onboarding no longer opens it — it is only reached
// from the "add" button on the home screen, so the button is always "Cancel".
jest.mock('../../blue_modules/BlueElectrum', () => ({ connectMain: jest.fn() }));
jest.mock('../../blue_modules/currency', () => ({ init: jest.fn() }));

const mockNavigate = jest.fn();
let mockRouteParams = {};
let mockWalletContext;
let mockGetUser;

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useRoute: () => ({ params: mockRouteParams }),
    useNavigation: () => ({ navigate: mockNavigate }),
    useTheme: () => require('../../components/themes').BlueDarkTheme,
  };
});
jest.mock('../../api/lds/hooks/lds.hook', () => ({ useLds: () => ({ getUser: (...args) => mockGetUser(...args) }) }));
jest.mock('../../contexts/wallet.context', () => ({ useWalletContext: () => mockWalletContext }));
jest.mock('../../class/lnurl', () => ({ getUrlFromLnurl: value => (value.includes('@') ? `https://${value.split('@')[1]}` : false) }));

// The created wallets only have to record what the screen does with them.
const mockWalletStub = () => ({
  setLabel: jest.fn(),
  setBaseURI: jest.fn(),
  setSecret: jest.fn(),
  init: jest.fn().mockResolvedValue(undefined),
  authorize: jest.fn().mockResolvedValue(undefined),
  fetchTransactions: jest.fn().mockResolvedValue(undefined),
  fetchUserInvoices: jest.fn().mockResolvedValue(undefined),
  fetchPendingTransactions: jest.fn().mockResolvedValue(undefined),
  fetchBalance: jest.fn().mockResolvedValue(undefined),
});

const mockLightningWallet = mockWalletStub();
const mockTaprootWallet = mockWalletStub();
const mockCreateLightning = jest.fn(() => mockLightningWallet);
const mockCreateTaproot = jest.fn(() => mockTaprootWallet);

jest.mock('../../class/wallets/lightning-lds-wallet', () => ({
  LightningLdsWallet: { create: (...args) => mockCreateLightning(...args) },
}));
jest.mock('../../class/wallets/taproot-lds-wallet', () => ({
  TaprootLdsWalletType: { BTC: 'BTC', CHF: 'CHF', USD: 'USD', EUR: 'EUC' },
  TaprootLdsWallet: { create: (...args) => mockCreateTaproot(...args) },
}));

const AddLightning = require('../../screen/wallets/dfx/add-lightning').default;
const { BlueStorageContext } = require('../../blue_modules/storage-context');
const loc = require('../../loc').default;

const addAndSaveWallet = jest.fn();

const renderScreen = () =>
  render(
    <BlueStorageContext.Provider value={{ addAndSaveWallet }}>
      <AddLightning />
    </BlueStorageContext.Provider>,
  );

const ldsUser = {
  lightning: {
    address: 'user@lightning.space',
    addressOwnershipProof: 'proof',
    wallets: [
      { asset: { name: 'BTC' }, lndhubAdminUrl: 'lndhub://admin:btc-secret@https://lightning.space' },
      {
        asset: { name: 'CHF', displayName: 'Swiss Franc' },
        lndhubAdminUrl: 'lndhub://admin:chf-secret@https://lightning.space',
        lnbitsWalletId: 'lnbits-1',
      },
      // Without an admin URL there is nothing to create from.
      { asset: { name: 'USD' } },
    ],
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRouteParams = {};
  mockWalletContext = { address: 'bc1qexample', signMessage: jest.fn().mockResolvedValue('signature') };
  mockGetUser = jest.fn().mockResolvedValue(ldsUser);
});

describe('AddLightning screen', () => {
  it('offers "cancel", not the onboarding "skip"', () => {
    mockRouteParams = { isOnboarding: true };
    const screen = renderScreen();
    expect(screen.getByText(loc._.cancel)).toBeTruthy();
  });

  it('leaves for the wallet home screen when cancelled', () => {
    mockRouteParams = { isOnboarding: true };
    const screen = renderScreen();
    fireEvent.press(screen.getByText(loc._.cancel));
    expect(mockNavigate).toHaveBeenCalledWith('WalletTransactions');
  });

  it('lists the three LNDHub providers', () => {
    const screen = renderScreen();
    expect(screen.queryByText('lightning.space')).toBeTruthy();
    expect(screen.queryByText('DFX.swiss')).toBeTruthy();
    expect(screen.queryByText(loc.wallets.add_lndhub_custom)).toBeTruthy();
  });

  it('creates the lightning.space wallet from the LDS user and returns home', async () => {
    const screen = renderScreen();
    fireEvent.press(screen.getByText(loc._.continue));

    await waitFor(() => expect(addAndSaveWallet).toHaveBeenCalledWith(mockLightningWallet));
    expect(mockGetUser).toHaveBeenCalledWith('bc1qexample', expect.any(Function));
    expect(mockCreateLightning).toHaveBeenCalledWith('user@lightning.space', 'proof');
    expect(mockLightningWallet.setSecret).toHaveBeenCalledWith('lndhub://admin:btc-secret');
    expect(mockLightningWallet.setBaseURI).toHaveBeenCalledWith('https://lightning.space');
    expect(mockNavigate).toHaveBeenCalledWith('WalletTransactions');
  });

  it('signs the LDS challenge with the wallet address', async () => {
    const screen = renderScreen();
    fireEvent.press(screen.getByText(loc._.continue));

    await waitFor(() => expect(mockGetUser).toHaveBeenCalled());
    const [, sign] = mockGetUser.mock.calls[0];
    await sign('challenge');
    expect(mockWalletContext.signMessage).toHaveBeenCalledWith('challenge', 'bc1qexample');
  });

  it('creates a taproot asset wallet when the route asks for one', async () => {
    mockRouteParams = { asset: 'CHF' };
    const screen = renderScreen();
    fireEvent.press(screen.getByText(loc._.continue));

    await waitFor(() => expect(addAndSaveWallet).toHaveBeenCalledWith(mockTaprootWallet));
    expect(mockCreateTaproot).toHaveBeenCalledWith(
      'user@lightning.space',
      'proof',
      { name: 'CHF', displayName: 'Swiss Franc' },
      'lnbits-1',
    );
    expect(mockTaprootWallet.setLabel).toHaveBeenCalledWith('Swiss Franc');
    expect(mockCreateLightning).not.toHaveBeenCalled();
  });

  it('reports a missing wallet address instead of calling LDS', async () => {
    mockWalletContext = { address: undefined, signMessage: jest.fn() };
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const screen = renderScreen();
    fireEvent.press(screen.getByText(loc._.continue));

    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(alert.mock.calls[0][1]).toBe('Address is not defined');
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('reports a failing LDS call', async () => {
    mockGetUser = jest.fn().mockRejectedValue(new Error('LDS is down'));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const screen = renderScreen();
    fireEvent.press(screen.getByText(loc._.continue));

    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(alert.mock.calls[0][1]).toBe('LDS is down');
    alert.mockRestore();
  });

  it('shows the DFX.swiss provider as not available yet and blocks the continue button', () => {
    const screen = renderScreen();
    fireEvent.press(screen.getByText('DFX.swiss'));

    expect(screen.queryByText(loc.wallets.add_lndhub_DFXswiss_not_available)).toBeTruthy();
    fireEvent.press(screen.getByText(loc._.continue));
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('switches back from DFX.swiss to lightning.space', async () => {
    const screen = renderScreen();
    fireEvent.press(screen.getByText('DFX.swiss'));
    fireEvent.press(screen.getByText('lightning.space'));

    expect(screen.queryByText(loc.wallets.add_lndhub_DFXswiss_not_available)).toBeNull();
    fireEvent.press(screen.getByText(loc._.continue));
    await waitFor(() => expect(mockGetUser).toHaveBeenCalled());
  });

  it('creates a wallet from custom LNDHub credentials without asking LDS', async () => {
    const screen = renderScreen();
    fireEvent.press(screen.getByText(loc.wallets.add_lndhub_custom));
    fireEvent.changeText(screen.getByPlaceholderText('user@provider.domain'), 'me@my.node');
    fireEvent.changeText(screen.getByPlaceholderText('...'), 'my-signature');
    fireEvent.changeText(screen.getByPlaceholderText('lndhub://admin:...'), 'lndhub://admin:my-secret@https://my.node');
    fireEvent.press(screen.getByText(loc._.continue));

    await waitFor(() => expect(addAndSaveWallet).toHaveBeenCalledWith(mockLightningWallet));
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockCreateLightning).toHaveBeenCalledWith('me@my.node', 'my-signature');
    expect(mockLightningWallet.setSecret).toHaveBeenCalledWith('lndhub://admin:my-secret');
    expect(mockNavigate).toHaveBeenCalledWith('WalletTransactions');
  });

  it('keeps the continue button inert while the custom credentials are incomplete', () => {
    const screen = renderScreen();
    fireEvent.press(screen.getByText(loc.wallets.add_lndhub_custom));
    fireEvent.changeText(screen.getByPlaceholderText('user@provider.domain'), 'not-an-address');
    fireEvent.press(screen.getByText(loc._.continue));

    expect(mockCreateLightning).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('disables the continue button while custom credentials are incomplete', () => {
    const screen = renderScreen();
    fireEvent.press(screen.getByText(loc.wallets.add_lndhub_custom));
    fireEvent.changeText(screen.getByPlaceholderText('user@provider.domain'), 'not-an-address');

    expect(screen.getByRole('button', { name: loc._.continue })).toBeDisabled();
  });

  it('opens the custom-LNDHub instructions', () => {
    const { Linking } = require('react-native');
    const openURL = jest.spyOn(Linking, 'openURL').mockImplementation(() => Promise.resolve());
    const screen = renderScreen();
    fireEvent.press(screen.getByText(loc.wallets.add_lndhub_custom));
    fireEvent.press(screen.getByText(loc.wallets.add_lndhub_instructions));

    expect(openURL).toHaveBeenCalledWith('https://docs.dfx.swiss/en/faq.html#how-to-use-your-own-lnd-hub');
    openURL.mockRestore();
  });

  it('titles the screen with the LNDHub header and keeps the swipe-back gesture off', () => {
    const theme = require('../../components/themes').BlueDarkTheme;
    const options = AddLightning.navigationOptions(theme)({ navigation: { goBack: jest.fn() }, route: { params: {} } });
    expect(options.headerTitle).toBe(loc.wallets.add_lndhub);
    expect(options.gestureEnabled).toBe(false);
  });
});
