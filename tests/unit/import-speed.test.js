import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

// The import-speed shortcut used to pop the AddWallet stack. That leaves the
// user stuck when AddWalletRoot is the only root route (first wallet). It now
// replaces the stack with the wallet home screen.
jest.mock('../../blue_modules/BlueElectrum', () => ({ connectMain: jest.fn() }));
jest.mock('../../blue_modules/currency', () => ({ init: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

const mockDispatch = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ dispatch: mockDispatch }),
    useTheme: () => require('../../components/themes').BlueDarkTheme,
  };
});

const mockWallet = {
  setSecret: jest.fn(),
  setPassphrase: jest.fn(),
  fetchBalance: jest.fn().mockResolvedValue(undefined),
};

jest.mock('../../class', () => ({
  HDSegwitBech32Wallet: Object.assign(
    function () {
      return mockWallet;
    },
    { type: 'HDsegwitBech32' },
  ),
  WatchOnlyWallet: Object.assign(
    function () {
      return mockWallet;
    },
    { type: 'watchOnly' },
  ),
}));

const WalletsImportSpeed = require('../../screen/wallets/importSpeed').default;
const { BlueStorageContext } = require('../../blue_modules/storage-context');
const { StackActions } = require('@react-navigation/native');

const addAndSaveWallet = jest.fn();

const renderScreen = () =>
  render(
    <BlueStorageContext.Provider value={{ addAndSaveWallet }}>
      <WalletsImportSpeed />
    </BlueStorageContext.Provider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
});

describe('WalletsImportSpeed', () => {
  it('replaces the stack with the wallet home screen once the wallet is stored', async () => {
    const screen = renderScreen();

    fireEvent.changeText(screen.getByTestId('SpeedMnemonicInput'), 'abandon abandon about');
    fireEvent.changeText(screen.getByTestId('SpeedWalletTypeInput'), 'HDsegwitBech32');
    fireEvent.press(screen.getByTestId('SpeedDoImport'));

    await waitFor(() => expect(addAndSaveWallet).toHaveBeenCalledWith(mockWallet));
    expect(mockWallet.setSecret).toHaveBeenCalledWith('abandon abandon about');
    expect(mockWallet.fetchBalance).toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalledWith(StackActions.replace('WalletsRoot', { screen: 'WalletTransactions' }));
    // Save must complete before navigation unmounts this screen.
    expect(addAndSaveWallet.mock.invocationCallOrder[0]).toBeLessThan(mockDispatch.mock.invocationCallOrder[0]);
  });
});
