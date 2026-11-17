import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

// Importing via a custom derivation path used to pop the AddWallet stack. That
// leaves the user stuck when AddWalletRoot is the only root route (first
// wallet). It now replaces the stack with the wallet home screen.
jest.mock('../../blue_modules/BlueElectrum', () => ({ connectMain: jest.fn() }));
jest.mock('../../blue_modules/currency', () => ({ init: jest.fn() }));
jest.mock('../../blue_modules/debounce', () => fn => fn);
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

const mockDispatch = jest.fn();
let mockRouteParams;
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useRoute: () => ({ params: mockRouteParams }),
    useNavigation: () => ({ dispatch: mockDispatch }),
    useTheme: () => require('../../components/themes').BlueDarkTheme,
  };
});

const makeWalletClass = (type, typeReadable) =>
  Object.assign(
    function () {
      return {
        type,
        setSecret: jest.fn(),
        setPassphrase: jest.fn(),
        setDerivationPath: jest.fn(),
        wasEverUsed: jest.fn().mockResolvedValue(true),
      };
    },
    { type, typeReadable },
  );

jest.mock('../../class', () => ({
  HDLegacyP2PKHWallet: makeWalletClass('HDlegacyP2PKH', 'HD Legacy (BIP44 P2PKH)'),
  HDSegwitP2SHWallet: makeWalletClass('HDsegwitP2SH', 'HD SegWit (BIP49 P2SH)'),
  HDSegwitBech32Wallet: makeWalletClass('HDsegwitBech32', 'HD SegWit (BIP84 Bech32 Native)'),
}));

jest.mock('../../class/wallet-import', () => ({
  validateBip32: () => true,
}));

const ImportCustomDerivationPath = require('../../screen/wallets/importCustomDerivationPath').default;
const { BlueStorageContext } = require('../../blue_modules/storage-context');
const { StackActions } = require('@react-navigation/native');

const addAndSaveWallet = jest.fn();

const renderScreen = () =>
  render(
    <BlueStorageContext.Provider value={{ addAndSaveWallet }}>
      <ImportCustomDerivationPath />
    </BlueStorageContext.Provider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockRouteParams = { importText: 'abandon abandon about', password: undefined };
});

describe('ImportCustomDerivationPath', () => {
  it('replaces the stack with the wallet home screen once the wallet is stored', async () => {
    // Save must complete before navigation unmounts this screen.
    let resolveSave;
    addAndSaveWallet.mockReturnValueOnce(
      new Promise(resolve => {
        resolveSave = resolve;
      }),
    );

    const screen = renderScreen();

    await waitFor(() => expect(screen.getByText('HD SegWit (BIP84 Bech32 Native)')).toBeTruthy());
    fireEvent.press(screen.getByText('HD SegWit (BIP84 Bech32 Native)'));
    fireEvent.press(screen.getByTestId('ImportButton'));

    await waitFor(() => expect(addAndSaveWallet).toHaveBeenCalled());
    expect(mockDispatch).not.toHaveBeenCalled();
    resolveSave();
    await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith(StackActions.replace('WalletsRoot', { screen: 'WalletTransactions' })));
  });

  // addAndSaveWallet cannot reject on a storage failure: BlueApp.saveToDisk
  // swallows those. A rejection comes from a corrupt wallet object during
  // majorTomToGroundControl (e.g. a malformed cosigner).
  it('surfaces a rejected save, does not navigate, and allows a retry', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    addAndSaveWallet.mockRejectedValueOnce(new Error('wallet is corrupt'));

    const screen = renderScreen();

    await waitFor(() => expect(screen.getByText('HD SegWit (BIP84 Bech32 Native)')).toBeTruthy());
    fireEvent.press(screen.getByText('HD SegWit (BIP84 Bech32 Native)'));
    fireEvent.press(screen.getByTestId('ImportButton'));

    await waitFor(() => expect(alert).toHaveBeenCalledWith('wallet is corrupt'));
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(addAndSaveWallet).toHaveBeenCalledTimes(1);

    // importing.current was reset — a second press must start a new attempt.
    addAndSaveWallet.mockResolvedValueOnce(undefined);
    fireEvent.press(screen.getByTestId('ImportButton'));

    await waitFor(() => expect(addAndSaveWallet).toHaveBeenCalledTimes(2));
    expect(mockDispatch).toHaveBeenCalledWith(StackActions.replace('WalletsRoot', { screen: 'WalletTransactions' }));
    alert.mockRestore();
  });
});
