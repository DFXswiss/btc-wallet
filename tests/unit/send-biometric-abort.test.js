import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// Confirm used to swallow a cancelled biometric prompt inside broadcast() and
// then still open Success. The user saw a sent-confirmation for a transaction
// that was never broadcast.
jest.mock('../../blue_modules/BlueElectrum', () => ({
  connectMain: jest.fn(),
  ping: jest.fn(() => Promise.resolve()),
  waitTillConnected: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../blue_modules/currency', () => ({
  init: jest.fn(),
  satoshiToBTC: sat => String(sat / 1e8),
  satoshiToLocalCurrency: () => '$0.00',
}));
jest.mock('../../blue_modules/notifications', () => ({
  majorTomToGroundControl: jest.fn(),
}));
jest.mock('../../components/Alert', () => jest.fn());

jest.mock('../../class/biometrics', () => ({
  __esModule: true,
  default: {
    isBiometricUseCapableAndEnabled: jest.fn(() => Promise.resolve(true)),
    unlockWithBiometrics: jest.fn(() => Promise.resolve(false)),
  },
}));

jest.mock('../../blue_modules/storage-context', () => {
  const RN = require('react');
  return { BlueStorageContext: RN.createContext({ wallets: [] }) };
});

const Confirm = require('../../screen/send/confirm').default;
const Biometric = require('../../class/biometrics').default;
const { BlueStorageContext } = require('../../blue_modules/storage-context');
const { BlueDarkTheme } = require('../../components/themes');
const loc = require('../../loc').default;

// Signed 2-in/2-out tx from tests/unit/multisig-hd-wallet.test.js — fromHex must
// succeed without the fix, otherwise send() throws before it can open Success.
const VALID_TX_HEX =
  '0200000000010211f8cdc7b1255b8d3eb951db2fc6964766aaf6e6d1b42e777c90a52977b3e8e50000000000ffffffff00696f18c09d884c100254825f3ca4f41ca35fbb5e988d3526cbdcfcb30c335b0000000000ffffffff02a08601000000000017a914b3d8a5081a9477dd5d354d4c8a7efc0e64689d1087e8340f0000000000160014eef1091149ba3658a5dfe9c8a8924b3a4f0e1baa02473044022068548d4369730e90f33d4243420b40d4c7ef240bbac1db33354c0e108d503f24022062adcc1d19756bcb3ecae9fe988af7c3147ba7df5ff6b26f4a135037669fcef001210211edf8b518a1ac28d1f9a956a5ddeddaea0df435f2386e7fb86f0e9fde818dda0247304402203140f8ee8311562f15eb1f062f3be98fbe41615262491ad5625d8541ce2e4386022077343891d341112a2b75647d5a1faec0f0a79dac8052249e22eb39591a4bb70c0121023f05c145e61311eb725fdea9834fe20c4e7bbb639def8e47137a2696001f9e9d00000000';

const Stack = createNativeStackNavigator();
const SuccessStub = () => <Text>sent-successfully</Text>;

const mockBroadcastTx = jest.fn(async () => true);

const confirmWallet = {
  getID: () => 'wallet-onchain',
  allowPayJoin: () => false,
  broadcastTx: mockBroadcastTx,
};

const flushBiometricCapable = async () => {
  await act(async () => {
    await Promise.resolve();
  });
  await waitFor(() => expect(Biometric.isBiometricUseCapableAndEnabled).toHaveBeenCalled());
  await act(async () => {
    await Promise.resolve();
  });
};

const renderConfirm = () => {
  const navigationRef = createNavigationContainerRef();
  const screen = render(
    <BlueStorageContext.Provider
      value={{ wallets: [confirmWallet], refreshAllWalletTransactions: jest.fn(), isElectrumDisabled: false }}
    >
      <NavigationContainer ref={navigationRef} theme={BlueDarkTheme}>
        <Stack.Navigator initialRouteName="Confirm" screenOptions={{ headerShown: false }}>
          <Stack.Screen
            name="Confirm"
            component={Confirm}
            initialParams={{
              recipients: [{ address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', value: 10000 }],
              walletID: confirmWallet.getID(),
              fee: 0.00001,
              memo: '',
              tx: VALID_TX_HEX,
              satoshiPerByte: 1,
              psbt: null,
            }}
          />
          <Stack.Screen name="Success" component={SuccessStub} />
        </Stack.Navigator>
      </NavigationContainer>
    </BlueStorageContext.Provider>,
  );
  return { screen, navigationRef };
};

beforeEach(() => {
  jest.clearAllMocks();
  Biometric.isBiometricUseCapableAndEnabled.mockResolvedValue(true);
  Biometric.unlockWithBiometrics.mockResolvedValue(false);
});

describe('biometric abort does not claim a send succeeded', () => {
  it('keeps the confirm screen when the biometric prompt is cancelled', async () => {
    const { screen, navigationRef } = renderConfirm();

    await flushBiometricCapable();
    expect(screen.getByRole('button', { name: loc.send.confirm_sendNow })).toBeTruthy();
    expect(navigationRef.getCurrentRoute().name).toBe('Confirm');

    fireEvent.press(screen.getByRole('button', { name: loc.send.confirm_sendNow }));

    await waitFor(() => expect(Biometric.unlockWithBiometrics).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByText('sent-successfully')).toBeNull();
    expect(screen.getByRole('button', { name: loc.send.confirm_sendNow })).toBeTruthy();
    expect(navigationRef.getCurrentRoute().name).toBe('Confirm');
    expect(mockBroadcastTx).not.toHaveBeenCalled();
  });
});
