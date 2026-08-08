import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

// Importing a wallet used to hand over to the LNDHub screen with
// isOnboarding: true. It now replaces the stack with the wallet home screen —
// the Lightning wallet is added deliberately from there.
jest.mock('../../blue_modules/BlueElectrum', () => ({ connectMain: jest.fn() }));
jest.mock('../../blue_modules/currency', () => ({ init: jest.fn() }));
jest.mock('react-native-haptic-feedback', () => ({ trigger: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockDispatch = jest.fn();
let mockRouteParams;
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useRoute: () => ({ params: mockRouteParams }),
    useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack, dispatch: mockDispatch }),
    useTheme: () => require('../../components/themes').BlueDarkTheme,
  };
});

let mockPrompt;
jest.mock(
  '../../helpers/prompt',
  () =>
    (...args) =>
      mockPrompt(...args),
);

// startImport is the engine behind the screen; the tests drive it by hand.
let mockCallbacks;
let mockImportPromise;
const mockStop = jest.fn();
jest.mock('../../class/wallet-import', () => (secret, askPassphrase, searchAccounts, onProgress, onWallet, onPassword) => {
  mockCallbacks = { secret, askPassphrase, searchAccounts, onProgress, onWallet, onPassword };
  return { promise: mockImportPromise, stop: mockStop };
});

let mockMultisigCosigners = [];
let mockMultisigSize = { n: 0, m: 0 };
jest.mock('../../class', () => ({
  HDSegwitBech32Wallet: function () {
    return { setSecret: jest.fn(), validateMnemonic: () => true };
  },
  MultisigHDWallet: Object.assign(
    function () {
      return {
        type: 'HDmultisig',
        setSecret: jest.fn(),
        getN: () => mockMultisigSize.n,
        getM: () => mockMultisigSize.m,
        getID: () => 'multisig-id',
        typeReadable: 'Multisig Vault',
        getCosigners: () => mockMultisigCosigners,
      };
    },
    { type: 'HDmultisig', isXpubString: value => value.startsWith('xpub') },
  ),
  WatchOnlyWallet: { type: 'watchOnly' },
}));

const ImportWalletDiscovery = require('../../screen/wallets/importDiscovery').default;
const { BlueStorageContext } = require('../../blue_modules/storage-context');
const loc = require('../../loc').default;
const { StackActions } = require('@react-navigation/native');

const addAndSaveWallet = jest.fn().mockResolvedValue(undefined);

const renderScreen = () =>
  render(
    <BlueStorageContext.Provider value={{ addAndSaveWallet }}>
      <ImportWalletDiscovery />
    </BlueStorageContext.Provider>,
  );

const foundWallet = (id, typeReadable = 'HD SegWit (BIP84 Bech32 Native)') => ({
  type: 'HDsegwitBech32',
  typeReadable,
  getID: () => id,
  getDerivationPath: () => "m/84'/0'/0'",
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRouteParams = { importText: 'abandon abandon about', askPassphrase: false, searchAccounts: false };
  mockMultisigCosigners = [];
  mockMultisigSize = { n: 0, m: 0 };
  mockPrompt = jest.fn().mockResolvedValue('passphrase');
  mockImportPromise = Promise.resolve({ cancelled: false, wallets: [] });
});

describe('ImportWalletDiscovery', () => {
  it('replaces the stack with the wallet home screen when a single wallet is found', async () => {
    const wallet = foundWallet('found-1');
    mockImportPromise = Promise.resolve({ cancelled: false, wallets: [wallet] });
    renderScreen();

    await waitFor(() => expect(addAndSaveWallet).toHaveBeenCalledWith(wallet));
    expect(mockDispatch).toHaveBeenCalledWith(StackActions.replace('WalletsRoot', { screen: 'WalletTransactions' }));
    expect(JSON.stringify(mockDispatch.mock.calls)).not.toMatch(/AddLightning|isOnboarding/);
  });

  it('stores the multisig wallet found in a backup alongside the main wallet', async () => {
    mockMultisigSize = { n: 3, m: 2 };
    mockMultisigCosigners = ['xpubCosigner', 'private-key-cosigner'];
    const wallet = foundWallet('found-1');
    mockImportPromise = Promise.resolve({ cancelled: false, wallets: [wallet] });
    renderScreen();

    await waitFor(() => expect(addAndSaveWallet).toHaveBeenCalledTimes(2));
    expect(addAndSaveWallet.mock.calls[0][0]).toBe(wallet);
    expect(addAndSaveWallet.mock.calls[1][0].type).toBe('HDmultisig');
    // The private-key cosigner is what the import runs on, not the xpub.
    expect(mockCallbacks.secret).toBe('private-key-cosigner');
  });

  it('imports nothing while the discovery was cancelled', async () => {
    mockImportPromise = Promise.resolve({ cancelled: true, wallets: [foundWallet('found-1')] });
    const screen = renderScreen();

    await waitFor(() => expect(screen.queryByTestId('Loading')).toBeNull());
    expect(addAndSaveWallet).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('reports when the discovery found nothing', async () => {
    const haptic = require('react-native-haptic-feedback');
    const screen = renderScreen();

    await waitFor(() => expect(screen.queryByText(loc.wallets.import_discovery_no_wallets)).toBeTruthy());
    expect(haptic.trigger).toHaveBeenCalledWith('impactLight', { ignoreAndroidSystemSettings: false });
  });

  it('surfaces an import error', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockImportPromise = Promise.reject(new Error('electrum unreachable'));
    renderScreen();

    await waitFor(() => expect(alert).toHaveBeenCalledWith('import error', 'electrum unreachable'));
    alert.mockRestore();
  });

  it('lists the discovered wallets, keeps watch-only ones out and imports the selected one', async () => {
    let resolveImport;
    mockImportPromise = new Promise(resolve => {
      resolveImport = resolve;
    });
    const screen = renderScreen();

    const first = foundWallet('found-1', 'HD SegWit (BIP84 Bech32 Native)');
    const second = foundWallet('found-2', 'HD SegWit (BIP49 P2SH)');
    await waitFor(() => expect(mockCallbacks).toBeTruthy());
    mockCallbacks.onWallet(first);
    mockCallbacks.onWallet(second);
    mockCallbacks.onWallet({ type: 'watchOnly', getID: () => 'watch-only', typeReadable: 'Watch-only' });
    resolveImport({ cancelled: false, wallets: [first, second] });

    await waitFor(() => expect(screen.queryByText('HD SegWit (BIP49 P2SH)')).toBeTruthy());
    expect(screen.queryByText('Watch-only')).toBeNull();

    fireEvent.press(screen.getByText('HD SegWit (BIP49 P2SH)'));
    fireEvent.press(screen.getByText(loc.wallets.import_do_import));
    await waitFor(() => expect(addAndSaveWallet).toHaveBeenCalledWith(second));
  });

  it('imports only once even when the button is pressed twice', async () => {
    let resolveImport;
    mockImportPromise = new Promise(resolve => {
      resolveImport = resolve;
    });
    const screen = renderScreen();
    const wallet = foundWallet('found-1');
    await waitFor(() => expect(mockCallbacks).toBeTruthy());
    mockCallbacks.onWallet(wallet);
    resolveImport({ cancelled: false, wallets: [] });

    await waitFor(() => expect(screen.queryByTestId('Loading')).toBeNull());
    fireEvent.press(screen.getByText(loc.wallets.import_do_import));
    fireEvent.press(screen.getByText(loc.wallets.import_do_import));

    await waitFor(() => expect(addAndSaveWallet).toHaveBeenCalledTimes(1));
  });

  it('shows the discovery progress', async () => {
    let resolveImport;
    mockImportPromise = new Promise(resolve => {
      resolveImport = resolve;
    });
    const screen = renderScreen();
    await waitFor(() => expect(mockCallbacks).toBeTruthy());
    mockCallbacks.onProgress('m/84 account 0');

    await waitFor(() => expect(screen.queryByText('m/84 account 0')).toBeTruthy());
    resolveImport({ cancelled: false, wallets: [] });
  });

  it('asks for the passphrase and keeps it for the custom derivation path', async () => {
    const screen = renderScreen();
    await waitFor(() => expect(mockCallbacks).toBeTruthy());
    await mockCallbacks.onPassword('Passphrase', 'Enter it');
    expect(mockPrompt).toHaveBeenCalledWith('Passphrase', 'Enter it');

    await waitFor(() => expect(screen.queryByTestId('Loading')).toBeNull());
    fireEvent.press(screen.getByTestId('CustomDerivationPathButton'));
    expect(mockStop).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('ImportCustomDerivationPath', {
      importText: 'abandon abandon about',
      password: 'passphrase',
    });
  });

  it('goes back when the passphrase prompt is cancelled', async () => {
    mockPrompt = jest.fn().mockRejectedValue(new Error('Cancel Pressed'));
    renderScreen();
    await waitFor(() => expect(mockCallbacks).toBeTruthy());

    await expect(mockCallbacks.onPassword('Passphrase', 'Enter it')).rejects.toThrow('Cancel Pressed');
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('rethrows other passphrase failures without leaving the screen', async () => {
    mockPrompt = jest.fn().mockRejectedValue(new Error('prompt exploded'));
    renderScreen();
    await waitFor(() => expect(mockCallbacks).toBeTruthy());

    await expect(mockCallbacks.onPassword('Passphrase', 'Enter it')).rejects.toThrow('prompt exploded');
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('tolerates wallets without a derivation path', async () => {
    let resolveImport;
    mockImportPromise = new Promise(resolve => {
      resolveImport = resolve;
    });
    const screen = renderScreen();
    await waitFor(() => expect(mockCallbacks).toBeTruthy());
    mockCallbacks.onWallet({
      type: 'HDsegwitBech32',
      typeReadable: 'HD SegWit (BIP84 Bech32 Native)',
      getID: () => 'found-1',
      getDerivationPath: () => {
        throw new Error('no derivation path');
      },
    });
    resolveImport({ cancelled: false, wallets: [] });

    await waitFor(() => expect(screen.queryByText('HD SegWit (BIP84 Bech32 Native)')).toBeTruthy());
  });

  it('stops the discovery when the screen goes away', async () => {
    const screen = renderScreen();
    await waitFor(() => expect(mockCallbacks).toBeTruthy());
    screen.unmount();
    expect(mockStop).toHaveBeenCalled();
  });

  it('titles the screen', () => {
    const theme = require('../../components/themes').BlueDarkTheme;
    const options = ImportWalletDiscovery.navigationOptions(theme)({ navigation: { goBack: jest.fn() }, route: { params: {} } });
    expect(options.title).toBe(loc.wallets.import_discovery_title);
  });
});
