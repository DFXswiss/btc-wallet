import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockNavigate = jest.fn();
const mockRouteParams = {
  recipients: [{ address: 'bc1qrecipient', value: 50_000 }],
  walletID: 'onchain-wallet',
  fee: 0.0000123,
  tx: 'transaction-hex',
  satoshiPerByte: 2,
};

// Avoid pulling the full wallet class graph (circular imports under Jest).
jest.mock('../../blue_modules/storage-context', () => {
  const ReactModule = require('react');
  return { BlueStorageContext: ReactModule.createContext({}) };
});
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, setOptions: jest.fn() }),
    useRoute: () => ({ params: mockRouteParams }),
    useTheme: () => require('../../components/themes').BlueDarkTheme,
  };
});
jest.mock('../../blue_modules/BlueElectrum', () => ({ ping: jest.fn(), waitTillConnected: jest.fn() }));
jest.mock('../../blue_modules/notifications', () => ({ majorTomToGroundControl: jest.fn() }));
jest.mock('../../blue_modules/currency', () => ({
  satoshiToBTC: jest.fn(value => String(value / 100000000)),
  satoshiToLocalCurrency: jest.fn(() => '$0.00'),
}));
jest.mock('../../class/biometrics', () => ({
  isBiometricUseCapableAndEnabled: jest.fn().mockResolvedValue(false),
  unlockWithBiometrics: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../components/Alert', () => jest.fn());
jest.mock('react-native-haptic-feedback', () => ({ trigger: jest.fn() }));
jest.mock('bitcoinjs-lib', () => {
  const actual = jest.requireActual('bitcoinjs-lib');
  class Transaction extends actual.Transaction {}
  Transaction.fromHex = jest.fn(() => ({ getId: () => 'txid' }));
  return { ...actual, Transaction };
});

const { BlueStorageContext } = require('../../blue_modules/storage-context');
const Confirm = require('../../screen/send/confirm').default;
const loc = require('../../loc').default;

it('passes the on-chain fee to Success in satoshis', async () => {
  const wallet = {
    getID: () => 'onchain-wallet',
    allowPayJoin: () => false,
    broadcastTx: jest.fn().mockResolvedValue(true),
  };
  const screen = render(
    <BlueStorageContext.Provider
      value={{ wallets: [wallet], refreshAllWalletTransactions: jest.fn(), isElectrumDisabled: false }}
    >
      <Confirm />
    </BlueStorageContext.Provider>,
  );

  fireEvent.press(screen.getByText(loc.send.confirm_sendNow));

  await waitFor(() =>
    expect(mockNavigate).toHaveBeenCalledWith('Success', {
      fee: 1230,
      amount: expect.any(String),
    }),
  );
});
