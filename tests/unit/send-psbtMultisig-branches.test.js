import React from 'react';
import { FlatList } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockNavigate = jest.fn();
const mockSetParams = jest.fn();
const mockAlert = jest.fn();
const mockPing = jest.fn(() => Promise.resolve());
const mockWaitTillConnected = jest.fn(() => Promise.resolve());
const mockNotification = jest.fn();
const mockHaptic = jest.fn();
const mockFromBase64 = jest.fn();
const mockTransactionFromHex = jest.fn(() => ({ getId: () => 'txid' }));
const mockRouteParams = { walletID: 'multisig-wallet', psbtBase64: 'initial' };

const makePsbt = () => ({
  txOutputs: [
    { address: 'bc1qexternal0000000000000000000000000000000', value: 1000 },
    { address: 'bc1qowned00000000000000000000000000000000', value: 2000 },
    { address: 'bc1qexternal1111111111111111111111111111111', value: 3000 },
    { address: 'bc1qexternal2222222222222222222222222222222', value: 4000 },
  ],
  combine: jest.fn(),
  finalizeAllInputs: jest.fn(),
  extractTransaction: jest.fn(() => ({ toHex: () => 'txhex' })),
  toHex: jest.fn(() => 'psbt-hex'),
});
let activePsbt;
let combinedPsbt;

jest.mock('../../blue_modules/storage-context', () => {
  const ReactModule = require('react');
  return { BlueStorageContext: ReactModule.createContext({}) };
});
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, setParams: mockSetParams }),
    useRoute: () => ({ params: mockRouteParams }),
    useTheme: () => require('../../components/themes').BlueDarkTheme,
  };
});
jest.mock('../../blue_modules/BlueElectrum', () => ({ ping: mockPing, waitTillConnected: mockWaitTillConnected }));
jest.mock('../../blue_modules/notifications', () => ({ majorTomToGroundControl: mockNotification }));
jest.mock('../../components/Alert', () => mockAlert);
jest.mock('../../components/DynamicQRCode', () => ({ DynamicQRCode: () => <>dynamic-qr-code</> }));
jest.mock('../../class/biometrics', () => ({
  __esModule: true,
  default: {
    isBiometricUseCapableAndEnabled: jest.fn(),
    unlockWithBiometrics: jest.fn(),
  },
}));
jest.mock('../../blue_modules/currency', () => ({
  satoshiToBTC: value => String(value / 100000000),
  satoshiToLocalCurrency: value => `$${value}`,
}));
jest.mock('react-native-haptic-feedback', () => ({ trigger: mockHaptic }));
jest.mock('bitcoinjs-lib', () => ({
  Psbt: { fromBase64: mockFromBase64 },
  Transaction: { fromHex: mockTransactionFromHex },
}));

const PsbtMultisig = require('../../screen/send/psbtMultisig').default;
const Biometric = require('../../class/biometrics').default;
const { BlueStorageContext } = require('../../blue_modules/storage-context');
const loc = require('../../loc').default;
const { BlueDarkTheme } = require('../../components/themes');

let wallet;
let fetchAndSaveWalletTransactions;

const renderPsbt = () =>
  render(
    <BlueStorageContext.Provider value={{ wallets: [wallet], fetchAndSaveWalletTransactions }}>
      <PsbtMultisig />
    </BlueStorageContext.Provider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  activePsbt = makePsbt();
  combinedPsbt = makePsbt();
  activePsbt.combine.mockReturnValue(combinedPsbt);
  mockFromBase64.mockImplementation(value => {
    if (value === 'bad') throw new Error('bad psbt');
    return value === 'received' ? combinedPsbt : activePsbt;
  });
  mockRouteParams.walletID = 'multisig-wallet';
  mockRouteParams.psbtBase64 = 'initial';
  delete mockRouteParams.receivedPSBTBase64;
  delete mockRouteParams.launchedBy;
  wallet = {
    getID: jest.fn(() => 'multisig-wallet'),
    getM: jest.fn(() => 2),
    weOwnAddress: jest.fn(address => address.includes('owned')),
    hasCosignerSignedPSBT: jest.fn(() => false),
    canSignThisPsbt: jest.fn(() => true),
    calculateFeeFromPsbt: jest.fn(() => 1234),
    calculateHowManySignaturesWeHaveFromPsbt: jest.fn(() => 0),
    cosignPsbt: jest.fn(),
    broadcastTx: jest.fn(() => Promise.resolve(true)),
  };
  fetchAndSaveWalletTransactions = jest.fn();
  Biometric.isBiometricUseCapableAndEnabled.mockResolvedValue(false);
  Biometric.unlockWithBiometrics.mockResolvedValue(true);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('PsbtMultisig user-visible branches', () => {
  it('formats the localized multisig navigation title', () => {
    const options = PsbtMultisig.navigationOptions(BlueDarkTheme)({ navigation: {}, route: {} });

    expect(options.title).toBe(loc.multisig.header);
    expect(options.headerRight).toEqual(expect.any(Function));
  });

  it('renders signed and unsigned cosigner states and responds to layout', async () => {
    wallet.hasCosignerSignedPSBT.mockReturnValue(true);
    wallet.calculateHowManySignaturesWeHaveFromPsbt.mockReturnValue(1);
    const screen = renderPsbt();

    expect(screen.getAllByTestId('ItemSigned')).toHaveLength(1);
    expect(screen.getAllByTestId('ItemUnsigned')).toHaveLength(1);
    fireEvent(screen.UNSAFE_getByType(FlatList), 'layout', { nativeEvent: { layout: { height: 240 } } });
    expect(wallet.calculateFeeFromPsbt).toHaveBeenCalled();
    await waitFor(() => expect(Biometric.isBiometricUseCapableAndEnabled).toHaveBeenCalled());
  });

  it('combines a received PSBT and clears the consumed route parameter', async () => {
    mockRouteParams.receivedPSBTBase64 = 'received';
    const screen = renderPsbt();

    await waitFor(() => expect(activePsbt.combine).toHaveBeenCalledWith(combinedPsbt));
    expect(mockSetParams).toHaveBeenCalledWith({ receivedPSBTBase64: undefined });
    expect(screen.getByTestId('PsbtMultisigSignButton')).toBeTruthy();
  });

  it('reports an invalid received PSBT without replacing the current screen', async () => {
    mockRouteParams.receivedPSBTBase64 = 'bad';
    const screen = renderPsbt();

    await waitFor(() => expect(mockAlert).toHaveBeenCalled());
    expect(mockAlert.mock.calls[0][0]).toEqual(expect.any(Error));
    expect(screen.getByTestId('PsbtMultisigSignButton')).toBeTruthy();
  });

  it('signs from the rendered control and disables it while the PSBT is signed', async () => {
    const screen = renderPsbt();
    fireEvent.press(screen.getByTestId('PsbtMultisigSignButton'));

    expect(screen.getByTestId('PsbtMultisigSignButton')).toBeDisabled();
    await act(async () => {
      jest.advanceTimersByTime(100);
      await Promise.resolve();
    });
    expect(wallet.cosignPsbt).toHaveBeenCalledWith(activePsbt);
  });

  it('restores the signing state when wallet signing throws', async () => {
    wallet.cosignPsbt.mockImplementation(() => {
      throw new Error('signing failed');
    });
    const screen = renderPsbt();
    fireEvent.press(screen.getByTestId('PsbtMultisigSignButton'));

    await act(async () => {
      jest.advanceTimersByTime(100);
      await Promise.resolve();
    });
    expect(wallet.cosignPsbt).toHaveBeenCalled();
    expect(screen.getByTestId('PsbtMultisigSignButton')).toBeDisabled();
  });

  it('returns a launched PSBT to its requesting screen instead of broadcasting', async () => {
    mockRouteParams.launchedBy = 'CreateChannel';
    wallet.calculateHowManySignaturesWeHaveFromPsbt.mockReturnValue(2);
    const screen = renderPsbt();
    fireEvent.press(screen.getByTestId('PsbtMultisigConfirmButton'));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('CreateChannel', { psbt: activePsbt }));
    expect(wallet.broadcastTx).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('PsbtMultisigConfirmButton'));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('PsbtMultisigConfirmButton')).toBeTruthy();
  });

  it('broadcasts a confirmed PSBT and navigates with fee and amount data', async () => {
    wallet.calculateHowManySignaturesWeHaveFromPsbt.mockReturnValue(2);
    const screen = renderPsbt();
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.press(screen.getByTestId('PsbtMultisigConfirmButton'));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Success', { fee: 1234, amount: expect.any(String) }));
    expect(wallet.broadcastTx).toHaveBeenCalledWith('txhex');
    expect(mockNotification).toHaveBeenCalledWith([], [], ['txid']);
    await act(async () => {
      jest.runAllTimers();
      await Promise.resolve();
    });
    expect(fetchAndSaveWalletTransactions).toHaveBeenCalledWith('multisig-wallet');
    screen.unmount();
    jest.runAllTimers();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not broadcast when biometric approval is cancelled', async () => {
    wallet.calculateHowManySignaturesWeHaveFromPsbt.mockReturnValue(2);
    Biometric.isBiometricUseCapableAndEnabled.mockResolvedValue(true);
    Biometric.unlockWithBiometrics.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const screen = renderPsbt();
    await waitFor(() => expect(Biometric.isBiometricUseCapableAndEnabled).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.press(screen.getByTestId('PsbtMultisigConfirmButton'));

    await waitFor(() => expect(Biometric.unlockWithBiometrics).toHaveBeenCalled());
    expect(wallet.broadcastTx).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockAlert).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('PsbtMultisigConfirmButton'));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Success', { fee: 1234, amount: expect.any(String) }));
    await act(async () => {
      jest.runAllTimers();
      await Promise.resolve();
    });
    screen.unmount();
    jest.runAllTimers();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('broadcasts after biometric approval is granted', async () => {
    wallet.calculateHowManySignaturesWeHaveFromPsbt.mockReturnValue(2);
    Biometric.isBiometricUseCapableAndEnabled.mockResolvedValue(true);
    Biometric.unlockWithBiometrics.mockResolvedValue(true);
    const screen = renderPsbt();
    await waitFor(() => expect(Biometric.isBiometricUseCapableAndEnabled).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.press(screen.getByTestId('PsbtMultisigConfirmButton'));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Success', { fee: 1234, amount: expect.any(String) }));
    expect(Biometric.unlockWithBiometrics).toHaveBeenCalled();
    expect(wallet.broadcastTx).toHaveBeenCalledWith('txhex');
    await act(async () => {
      jest.runAllTimers();
      await Promise.resolve();
    });
    screen.unmount();
    jest.runAllTimers();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('alerts on a false broadcast and permits a controlled retry', async () => {
    wallet.calculateHowManySignaturesWeHaveFromPsbt.mockReturnValue(2);
    wallet.broadcastTx.mockResolvedValue(false);
    const screen = renderPsbt();

    fireEvent.press(screen.getByTestId('PsbtMultisigConfirmButton'));

    await waitFor(() => expect(mockAlert).toHaveBeenCalledWith(expect.objectContaining({ message: loc.errors.broadcast })));
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByTestId('PsbtMultisigConfirmButton')).toBeTruthy();

    wallet.broadcastTx.mockResolvedValue(true);
    fireEvent.press(screen.getByTestId('PsbtMultisigConfirmButton'));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Success', { fee: 1234, amount: expect.any(String) }));
    expect(wallet.broadcastTx).toHaveBeenCalledTimes(2);
    await act(async () => {
      jest.runAllTimers();
      await Promise.resolve();
    });
    screen.unmount();
    jest.runAllTimers();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('alerts on a rejected broadcast without navigating to success', async () => {
    wallet.calculateHowManySignaturesWeHaveFromPsbt.mockReturnValue(2);
    wallet.broadcastTx.mockRejectedValue(new Error('network unavailable'));
    const screen = renderPsbt();

    fireEvent.press(screen.getByTestId('PsbtMultisigConfirmButton'));

    await waitFor(() => expect(mockAlert).toHaveBeenCalledWith(expect.objectContaining({ message: 'network unavailable' })));
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByTestId('PsbtMultisigConfirmButton')).toBeTruthy();
  });

  it('blocks a second press while the broadcast is unresolved', async () => {
    wallet.calculateHowManySignaturesWeHaveFromPsbt.mockReturnValue(2);
    let resolveBroadcast;
    wallet.broadcastTx.mockReturnValue(
      new Promise(resolve => {
        resolveBroadcast = resolve;
      }),
    );
    const screen = renderPsbt();
    const confirmButton = screen.getByTestId('PsbtMultisigConfirmButton');

    await act(async () => {
      fireEvent.press(confirmButton);
      fireEvent.press(confirmButton);
      await Promise.resolve();
    });

    await act(async () => {
      resolveBroadcast(true);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(mockNavigate).toHaveBeenCalledWith('Success', { fee: 1234, amount: expect.any(String) });
    await act(async () => {
      jest.runAllTimers();
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(wallet.broadcastTx).toHaveBeenCalledTimes(1);
    screen.unmount();
    jest.runAllTimers();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('keeps the confirm button disabled while broadcast is pending and resets after success', async () => {
    wallet.calculateHowManySignaturesWeHaveFromPsbt.mockReturnValue(2);
    let resolveBroadcast;
    wallet.broadcastTx.mockReturnValue(
      new Promise(resolve => {
        resolveBroadcast = resolve;
      }),
    );
    const screen = renderPsbt();

    await act(async () => {
      fireEvent.press(screen.getByTestId('PsbtMultisigConfirmButton'));
      await Promise.resolve();
    });
    expect(screen.getByTestId('PsbtMultisigConfirmButton')).toBeDisabled();
    fireEvent.press(screen.getByTestId('PsbtMultisigConfirmButton'));
    expect(wallet.broadcastTx).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveBroadcast(true);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(mockNavigate).toHaveBeenCalledWith('Success', { fee: 1234, amount: expect.any(String) });
    await act(async () => {
      jest.runAllTimers();
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(wallet.broadcastTx).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('PsbtMultisigConfirmButton')).not.toBeDisabled();
    screen.unmount();
    jest.runAllTimers();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('reports a failure to extract the transaction on confirmation', async () => {
    wallet.calculateHowManySignaturesWeHaveFromPsbt.mockReturnValue(2);
    activePsbt.extractTransaction.mockImplementation(() => {
      throw new Error('cannot extract');
    });
    const screen = renderPsbt();
    fireEvent.press(screen.getByTestId('PsbtMultisigConfirmButton'));

    await waitFor(() => expect(mockAlert).toHaveBeenCalledWith(expect.any(Error)));
    expect(wallet.broadcastTx).not.toHaveBeenCalled();
    expect(screen.getByTestId('PsbtMultisigConfirmButton')).toBeTruthy();
  });

  it('explains when the wallet cannot sign this PSBT', () => {
    wallet.canSignThisPsbt.mockReturnValue(false);
    const screen = renderPsbt();

    expect(screen.getByText(loc.multisig.not_part_of_multisig)).toBeTruthy();
    expect(screen.queryByTestId('PsbtMultisigSignButton')).toBeNull();
  });
});
