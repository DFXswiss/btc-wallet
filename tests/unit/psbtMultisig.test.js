import React from 'react';
import { render } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// First paint used isTxSigned as useState's initial value, but that const is
// declared later in the same function. Rendering threw ReferenceError.
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
jest.mock('../../components/DynamicQRCode', () => ({
  DynamicQRCode: () => null,
}));
jest.mock('../../class/biometrics', () => ({
  __esModule: true,
  default: {
    isBiometricUseCapableAndEnabled: jest.fn(() => Promise.resolve(false)),
    unlockWithBiometrics: jest.fn(() => Promise.resolve(true)),
  },
}));
jest.mock('../../blue_modules/storage-context', () => {
  const RN = require('react');
  return { BlueStorageContext: RN.createContext({ wallets: [] }) };
});

const PsbtMultisig = require('../../screen/send/psbtMultisig').default;
const { BlueStorageContext } = require('../../blue_modules/storage-context');
const { BlueDarkTheme } = require('../../components/themes');

// 1-in/1-out PSBT from tests/e2e/bluewallet2.spec.js. fromBase64 must succeed so
// a failure is the isTxSigned TDZ, not a parse error before the Sign button exists.
const PSBT_BASE64 =
  'cHNidP8BAFICAAAAAXYa7FEQBAQ2X0B48aHHKKgzkVuHfQ2yCOi3v9RR0IqlAQAAAAAAAACAAegDAAAAAAAAFgAUSnH40G+jiJfreeRb36cs641KFm8AAAAAAAEBH5YVAAAAAAAAFgAUTKHjDm4OJQSbvy9uzyLYi5i5XIoiBgMQcGrP5TIMrdvb73yB4WnZvkPzKr1EzJXJYBHWmlPJZRgAAAAAVAAAgAAAAIAAAACAAQAAAD4AAAAAAA==';

const Stack = createNativeStackNavigator();

const wallet = {
  getID: () => 'wallet-multisig',
  getM: () => 2,
  weOwnAddress: () => false,
  hasCosignerSignedPSBT: () => false,
  canSignThisPsbt: () => true,
  calculateFeeFromPsbt: () => 1000,
  calculateHowManySignaturesWeHaveFromPsbt: () => 0,
};

const renderPsbtMultisig = () =>
  render(
    <BlueStorageContext.Provider value={{ wallets: [wallet], fetchAndSaveWalletTransactions: jest.fn() }}>
      <NavigationContainer theme={BlueDarkTheme}>
        <Stack.Navigator initialRouteName="PsbtMultisig" screenOptions={{ headerShown: false }}>
          <Stack.Screen
            name="PsbtMultisig"
            component={PsbtMultisig}
            initialParams={{
              walletID: wallet.getID(),
              psbtBase64: PSBT_BASE64,
            }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </BlueStorageContext.Provider>,
  );

describe('PsbtMultisig first paint', () => {
  it('renders the Sign control instead of throwing on isTxSigned', () => {
    const screen = renderPsbtMultisig();

    expect(screen.getByTestId('PsbtMultisigSignButton')).toBeTruthy();
    expect(screen.getByTestId('PsbtMultisigConfirmButton')).toBeTruthy();
  });
});
