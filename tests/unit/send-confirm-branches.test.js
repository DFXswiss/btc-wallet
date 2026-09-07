import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockNavigate = jest.fn();
const mockSetOptions = jest.fn();
const mockAlert = jest.fn();
const mockRouteParams = {
  recipients: [{ address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', value: 10_000 }],
  walletID: 'confirm-wallet',
  fee: 0.00001,
  memo: 'memo',
  tx: 'transaction-hex',
  satoshiPerByte: 2,
  psbt: 'psbt',
  payjoinUrl: 'https://payjoin.example',
};

const mockPing = jest.fn(() => Promise.resolve());
const mockWaitTillConnected = jest.fn(() => Promise.resolve());
const mockTransactionFromHex = jest.fn(() => ({ getId: () => 'txid' }));
const mockPayjoinRun = jest.fn(async () => {
  const broadcastCallback = mockPayjoinConstructor.mock.calls[mockPayjoinConstructor.mock.calls.length - 1][1];
  await broadcastCallback('payjoin-txhex');
});
const mockPayjoinPsbt = { extractTransaction: () => ({ getId: () => 'payjoin-txid' }) };
const mockPayjoinGetPsbt = jest.fn(() => mockPayjoinPsbt);
const mockPayjoinConstructor = jest.fn();

jest.mock('../../blue_modules/storage-context', () => {
  const ReactModule = require('react');
  return { BlueStorageContext: ReactModule.createContext({}) };
});
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, setOptions: mockSetOptions }),
    useRoute: () => ({ params: mockRouteParams }),
    useTheme: () => require('../../components/themes').BlueDarkTheme,
  };
});
jest.mock('../../blue_modules/BlueElectrum', () => ({ ping: mockPing, waitTillConnected: mockWaitTillConnected }));
jest.mock('../../blue_modules/notifications', () => ({ majorTomToGroundControl: jest.fn() }));
jest.mock('../../blue_modules/currency', () => ({
  satoshiToBTC: value => String(value / 100000000),
  satoshiToLocalCurrency: () => '$0.00',
}));
jest.mock('../../class/biometrics', () => ({
  __esModule: true,
  default: {
    isBiometricUseCapableAndEnabled: jest.fn(),
    unlockWithBiometrics: jest.fn(),
  },
}));
jest.mock('../../components/Alert', () => mockAlert);
jest.mock('react-native-haptic-feedback', () => ({ trigger: jest.fn() }));
jest.mock('payjoin-client', () => ({ PayjoinClient: jest.fn(() => ({ run: mockPayjoinRun })) }));
jest.mock('../../class/payjoin-transaction', () =>
  jest.fn(function PayjoinTransaction() {
    mockPayjoinConstructor(...arguments);
    this.getPayjoinPsbt = mockPayjoinGetPsbt;
  }),
);
jest.mock('bitcoinjs-lib', () => {
  const actual = jest.requireActual('bitcoinjs-lib');
  return { ...actual, Transaction: { ...actual.Transaction, fromHex: mockTransactionFromHex } };
});

const Confirm = require('../../screen/send/confirm').default;
const Biometric = require('../../class/biometrics').default;
const { BlueStorageContext } = require('../../blue_modules/storage-context');
const { PayjoinClient } = require('payjoin-client');
const loc = require('../../loc').default;
const { BlueDarkTheme } = require('../../components/themes');

const wallet = {
  getID: () => 'confirm-wallet',
  allowPayJoin: jest.fn(() => true),
  broadcastTx: jest.fn(),
};
const refreshAllWalletTransactions = jest.fn();

const renderConfirm = () =>
  render(
    <BlueStorageContext.Provider value={{ wallets: [wallet], refreshAllWalletTransactions, isElectrumDisabled: false }}>
      <Confirm />
    </BlueStorageContext.Provider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  Object.assign(mockRouteParams, {
    recipients: [{ address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', value: 10_000 }],
    walletID: 'confirm-wallet',
    fee: 0.00001,
    memo: 'memo',
    tx: 'transaction-hex',
    satoshiPerByte: 2,
    psbt: 'psbt',
    payjoinUrl: 'https://payjoin.example',
  });
  wallet.broadcastTx.mockResolvedValue(true);
  Biometric.isBiometricUseCapableAndEnabled.mockResolvedValue(false);
  Biometric.unlockWithBiometrics.mockResolvedValue(true);
  mockTransactionFromHex.mockReturnValue({ getId: () => 'txid' });
  mockPing.mockResolvedValue(undefined);
  mockWaitTillConnected.mockResolvedValue(undefined);
  mockPayjoinGetPsbt.mockReturnValue(mockPayjoinPsbt);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('Confirm screen controls and send failure modes', () => {
  it('formats the localized confirmation navigation title', () => {
    const options = Confirm.navigationOptions(BlueDarkTheme)({ navigation: {}, route: {} });

    expect(options.title).toBe(loc.send.confirm_header);
  });

  it('requires successful biometric unlock before opening transaction details', async () => {
    Biometric.isBiometricUseCapableAndEnabled.mockResolvedValue(true);
    Biometric.unlockWithBiometrics.mockResolvedValue(false);
    renderConfirm();

    await waitFor(() => expect(Biometric.isBiometricUseCapableAndEnabled).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    const header = mockSetOptions.mock.calls[mockSetOptions.mock.calls.length - 1][0].headerRight;
    const headerScreen = render(header());
    fireEvent.press(headerScreen.getByTestId('TransactionDetailsButton'));

    await waitFor(() => expect(Biometric.unlockWithBiometrics).toHaveBeenCalled());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('opens transaction details with the confirmation data after biometric unlock', async () => {
    Biometric.isBiometricUseCapableAndEnabled.mockResolvedValue(true);
    Biometric.unlockWithBiometrics.mockResolvedValue(true);
    renderConfirm();

    await waitFor(() => expect(Biometric.isBiometricUseCapableAndEnabled).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    const header = mockSetOptions.mock.calls[mockSetOptions.mock.calls.length - 1][0].headerRight;
    const headerScreen = render(header());
    fireEvent.press(headerScreen.getByTestId('TransactionDetailsButton'));

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('CreateTransaction', {
        fee: mockRouteParams.fee,
        recipients: mockRouteParams.recipients,
        memo: mockRouteParams.memo,
        tx: mockRouteParams.tx,
        satoshiPerByte: mockRouteParams.satoshiPerByte,
        wallet,
        feeSatoshi: 1000,
      }),
    );
  });

  it('opens transaction details directly when biometric protection is unavailable', async () => {
    Biometric.isBiometricUseCapableAndEnabled.mockResolvedValue(false);
    renderConfirm();

    await waitFor(() => expect(Biometric.isBiometricUseCapableAndEnabled).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    const header = mockSetOptions.mock.calls[mockSetOptions.mock.calls.length - 1][0].headerRight;
    const headerScreen = render(header());
    fireEvent.press(headerScreen.getByTestId('TransactionDetailsButton'));

    expect(Biometric.unlockWithBiometrics).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('CreateTransaction', expect.any(Object));
  });

  it('runs payjoin and carries both transaction ids into the success flow', async () => {
    const screen = renderConfirm();
    fireEvent(screen.getByTestId('PayjoinSwitch'), 'valueChange', true);
    fireEvent.press(screen.getByRole('button', { name: loc.send.confirm_sendNow }));

    await waitFor(() => expect(PayjoinClient).toHaveBeenCalled());
    expect(mockPayjoinConstructor).toHaveBeenCalledWith(mockRouteParams.psbt, expect.any(Function), wallet);
    expect(mockPayjoinGetPsbt).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('Success', { fee: 1000, amount: expect.any(String) });
    expect(wallet.broadcastTx).toHaveBeenCalledWith('payjoin-txhex');
    await act(async () => {
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
    });
    expect(refreshAllWalletTransactions).toHaveBeenCalled();
  });

  it('completes payjoin when no replacement PSBT is returned', async () => {
    mockPayjoinGetPsbt.mockReturnValue(undefined);
    const screen = renderConfirm();
    fireEvent(screen.getByTestId('PayjoinSwitch'), 'valueChange', true);
    fireEvent.press(screen.getByRole('button', { name: loc.send.confirm_sendNow }));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Success', { fee: 1000, amount: expect.any(String) }));
    expect(mockPayjoinGetPsbt).toHaveBeenCalled();
  });

  it('broadcasts after biometric approval is granted', async () => {
    wallet.allowPayJoin.mockReturnValue(false);
    Biometric.isBiometricUseCapableAndEnabled.mockResolvedValue(true);
    Biometric.unlockWithBiometrics.mockResolvedValue(true);
    const screen = renderConfirm();
    await waitFor(() => expect(Biometric.isBiometricUseCapableAndEnabled).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.press(screen.getByRole('button', { name: loc.send.confirm_sendNow }));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Success', { fee: 1000, amount: expect.any(String) }));
    expect(Biometric.unlockWithBiometrics).toHaveBeenCalled();
    expect(wallet.broadcastTx).toHaveBeenCalledWith(mockRouteParams.tx);
  });

  it('renders without recipients when a route omits the optional list', () => {
    delete mockRouteParams.recipients;

    expect(() => renderConfirm()).not.toThrow();
  });

  it('renders separators and ordinal labels for multiple recipients', () => {
    mockRouteParams.recipients = [
      { address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', value: 10_000 },
      { address: 'bc1qrecipient000000000000000000000000000000', value: 20_000 },
    ];
    const screen = renderConfirm();

    expect(screen.getAllByTestId('TransactionAddress')).toHaveLength(2);
    expect(screen.getByText(loc.formatString(loc._.of, { number: 1, total: 2 }))).toBeTruthy();
  });

  it('shows the broadcast error and stays on confirm when the wallet rejects a broadcast', async () => {
    wallet.allowPayJoin.mockReturnValue(false);
    wallet.broadcastTx.mockResolvedValue(false);
    const screen = renderConfirm();
    fireEvent.press(screen.getByRole('button', { name: loc.send.confirm_sendNow }));

    await waitFor(() => expect(mockAlert).toHaveBeenCalledWith(loc.errors.broadcast));
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: loc.send.confirm_sendNow })).toBeTruthy();
  });

  it('reports transaction decoding failures after a successful broadcast', async () => {
    wallet.allowPayJoin.mockReturnValue(false);
    mockTransactionFromHex.mockImplementation(() => {
      throw new Error('invalid transaction');
    });
    const screen = renderConfirm();
    fireEvent.press(screen.getByRole('button', { name: loc.send.confirm_sendNow }));

    await waitFor(() => expect(mockAlert).toHaveBeenCalledWith('invalid transaction'));
    expect(wallet.broadcastTx).toHaveBeenCalledWith(mockRouteParams.tx);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
