import React from 'react';
import { Linking } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

// Creating the first wallet used to hand over to the LNDHub screen with
// isOnboarding: true. It now replaces the stack with the wallet home screen —
// the Lightning wallet is added deliberately from there.
jest.mock('../../blue_modules/BlueElectrum', () => ({ connectMain: jest.fn() }));
jest.mock('../../blue_modules/currency', () => ({ init: jest.fn() }));
jest.mock('../../BlueApp', () => ({ AppStorage: { LNDHUB: 'lndhub' } }));
jest.mock('../../components/Alert', () => jest.fn());
jest.mock('react-native-haptic-feedback', () => ({ trigger: jest.fn() }));

const mockAlert = require('../../components/Alert');

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: () => Promise.resolve('https://lndhub.example'),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

let mockConfig = {};
jest.mock('react-native-config', () => ({
  get REACT_APP_DISCLAIMER_URL() {
    return mockConfig.REACT_APP_DISCLAIMER_URL;
  },
}));

const mockGetSignMessage = jest.fn(address => `sign ${address}`);
jest.mock('../../api/dfx/hooks/auth.hook', () => ({ useAuth: () => ({ getSignMessage: mockGetSignMessage }) }));

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockDispatch = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack, dispatch: mockDispatch }),
    useTheme: () => require('../../components/themes').BlueDarkTheme,
  };
});

const mockWallet = {
  setLabel: jest.fn(),
  generate: jest.fn().mockResolvedValue(undefined),
  generateFromEntropy: jest.fn().mockResolvedValue(undefined),
  _getExternalAddressByIndex: jest.fn(() => 'bc1qmain'),
  signMessage: jest.fn().mockResolvedValue('ownership-proof'),
};
jest.mock('../../class', () => ({
  HDSegwitBech32Wallet: Object.assign(
    function () {
      return mockWallet;
    },
    { typeReadable: 'HD SegWit (BIP84 Bech32 Native)' },
  ),
  SegwitP2SHWallet: { typeReadable: 'SegWit (P2SH)' },
  HDSegwitP2SHWallet: { typeReadable: 'HD SegWit (BIP49 P2SH)' },
}));

const WalletsAdd = require('../../screen/wallets/add').default;
const { BlueStorageContext } = require('../../blue_modules/storage-context');
const loc = require('../../loc').default;
const { StackActions } = require('@react-navigation/native');

const addWallet = jest.fn();
const saveToDisk = jest.fn().mockResolvedValue(undefined);
let isAdvancedModeEnabled;

const renderScreen = () =>
  render(
    <BlueStorageContext.Provider value={{ addWallet, saveToDisk, isAdvancedModeEnabled }}>
      <WalletsAdd />
    </BlueStorageContext.Provider>,
  );

// The screen only leaves its loading state once isAdvancedModeEnabled settled.
const renderReadyScreen = async () => {
  const screen = renderScreen();
  await waitFor(() => expect(screen.queryByText(loc.wallets.add_import_wallet)).toBeTruthy());
  return screen;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockConfig = {};
  isAdvancedModeEnabled = jest.fn().mockResolvedValue(false);
});

describe('WalletsAdd', () => {
  it('replaces the stack with the wallet home screen once the wallet is stored', async () => {
    const screen = await renderReadyScreen();
    fireEvent.press(screen.getByTestId('Create'));

    await waitFor(() => expect(mockDispatch).toHaveBeenCalled());
    expect(mockWallet.generate).toHaveBeenCalled();
    expect(mockWallet.signMessage).toHaveBeenCalledWith('sign bc1qmain', 'bc1qmain');
    expect(addWallet).toHaveBeenCalledWith(mockWallet);
    expect(saveToDisk).toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalledWith(StackActions.replace('WalletsRoot', { screen: 'WalletTransactions' }));
  });

  it('does not route into the LNDHub screen', async () => {
    const screen = await renderReadyScreen();
    fireEvent.press(screen.getByTestId('Create'));

    await waitFor(() => expect(mockDispatch).toHaveBeenCalled());
    expect(JSON.stringify(mockDispatch.mock.calls)).not.toMatch(/AddLightning|isOnboarding/);
  });

  it('surfaces a create failure without navigating', async () => {
    mockWallet.signMessage.mockRejectedValueOnce(new Error('signing failed'));
    const screen = await renderReadyScreen();
    fireEvent.press(screen.getByTestId('Create'));

    await waitFor(() => expect(mockAlert).toHaveBeenCalledWith('Error: signing failed'));
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(addWallet).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('unlocks create and import after a create failure', async () => {
    mockWallet.signMessage.mockRejectedValueOnce(new Error('signing failed'));
    const screen = await renderReadyScreen();
    fireEvent.press(screen.getByTestId('Create'));

    await waitFor(() => expect(mockAlert).toHaveBeenCalledWith('Error: signing failed'));
    // isLoading must be cleared: ImportWallet is only mounted when !isLoading,
    // and BlueButton disables itself while isLoading is true.
    await waitFor(() => expect(screen.getByTestId('ImportWallet')).toBeTruthy());
    expect(screen.getByRole('button', { name: loc.wallets.add_create })).not.toBeDisabled();
  });

  it('opens the disclaimer only when a URL is configured', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockImplementation(() => Promise.resolve());
    const screen = await renderReadyScreen();

    fireEvent.press(screen.getByText(loc.wallets.add_disclaimer));
    expect(openURL).not.toHaveBeenCalled();

    mockConfig = { REACT_APP_DISCLAIMER_URL: 'https://dfx.swiss/disclaimer' };
    screen.rerender(
      <BlueStorageContext.Provider value={{ addWallet, saveToDisk, isAdvancedModeEnabled }}>
        <WalletsAdd />
      </BlueStorageContext.Provider>,
    );
    fireEvent.press(screen.getByText(loc.wallets.add_disclaimer));
    expect(openURL).toHaveBeenCalledWith('https://dfx.swiss/disclaimer');
    openURL.mockRestore();
  });

  it('offers the wallet import entry point', async () => {
    const screen = await renderReadyScreen();
    fireEvent.press(screen.getByTestId('ImportWallet'));
    expect(mockNavigate).toHaveBeenCalledWith('ScanImport');
  });

  it('titles the screen and hides the back button', () => {
    const theme = require('../../components/themes').BlueDarkTheme;
    const options = WalletsAdd.navigationOptions(theme)({ navigation: { goBack: jest.fn() }, route: { params: {} } });
    expect(options.title).toBe(loc.wallets.add_title);
    expect(options.gestureEnabled).toBe(false);
  });

  describe('advanced mode', () => {
    beforeEach(() => {
      isAdvancedModeEnabled = jest.fn().mockResolvedValue(true);
    });

    it('lets the user pick a wallet type', async () => {
      const screen = await renderReadyScreen();
      expect(screen.queryByText(loc.settings.advanced_options)).toBeTruthy();

      fireEvent.press(screen.getByText('SegWit (P2SH)'));
      fireEvent.press(screen.getByText('HD SegWit (BIP49 P2SH)'));
      fireEvent.press(screen.getByText('HD SegWit (BIP84 Bech32 Native)'));
      expect(screen.queryByText(loc.wallets.add_entropy_provide)).toBeTruthy();
    });

    it('reports the entropy collected so far', async () => {
      const screen = await renderReadyScreen();
      fireEvent.press(screen.getByText(loc.wallets.add_entropy_provide));
      const { onGenerated } = mockNavigate.mock.calls.find(([route]) => route === 'ProvideEntropy')[1];

      act(() => onGenerated(Buffer.alloc(4)));
      expect(screen.queryByText(loc.formatString(loc.wallets.add_entropy_remain, { gen: 4, rem: 28 }))).toBeTruthy();

      act(() => onGenerated(Buffer.alloc(32)));
      expect(screen.queryByText(loc.formatString(loc.wallets.add_entropy_generated, { gen: 32 }))).toBeTruthy();

      act(() => onGenerated(undefined));
      expect(screen.queryByText(loc.wallets.add_entropy_provide)).toBeTruthy();
    });

    it('creates the wallet from the collected entropy', async () => {
      const screen = await renderReadyScreen();
      fireEvent.press(screen.getByText(loc.wallets.add_entropy_provide));
      const { onGenerated } = mockNavigate.mock.calls.find(([route]) => route === 'ProvideEntropy')[1];
      const entropy = Buffer.alloc(32);
      act(() => onGenerated(entropy));

      fireEvent.press(screen.getByTestId('Create'));
      await waitFor(() => expect(mockDispatch).toHaveBeenCalled());
      expect(mockWallet.generateFromEntropy).toHaveBeenCalledWith(entropy);
      expect(mockWallet.generate).not.toHaveBeenCalled();
    });

    it('goes back and reports a failing entropy generation', async () => {
      mockWallet.generateFromEntropy.mockRejectedValueOnce(new Error('bad entropy'));
      const screen = await renderReadyScreen();
      fireEvent.press(screen.getByText(loc.wallets.add_entropy_provide));
      const { onGenerated } = mockNavigate.mock.calls.find(([route]) => route === 'ProvideEntropy')[1];
      act(() => onGenerated(Buffer.alloc(32)));

      fireEvent.press(screen.getByTestId('Create'));
      await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
      expect(mockAlert).toHaveBeenCalledWith('Error: bad entropy');
      expect(addWallet).not.toHaveBeenCalled();
      expect(mockDispatch).not.toHaveBeenCalled();
      // isLoading must be cleared: ImportWallet is only mounted when !isLoading,
      // and BlueButton disables itself while isLoading is true. goBack is a no-op
      // on first-run AddWalletRoot, so the screen must unlock itself.
      await waitFor(() => expect(screen.getByTestId('ImportWallet')).toBeTruthy());
      expect(screen.getByRole('button', { name: loc.wallets.add_create })).not.toBeDisabled();
    });
  });
});
