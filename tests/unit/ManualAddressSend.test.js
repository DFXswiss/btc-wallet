import React from 'react';
import { Text, TextInput } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// Manual "enter address" used replace() with a parent-navigator route name.
// replace does not leave ScanCodeSendStack, so Continue did nothing. navigate()
// does climb to the parent, which is how ScanCodeSend already opens this screen.
jest.mock('../../blue_modules/BlueElectrum', () => ({ connectMain: jest.fn() }));
jest.mock('../../blue_modules/currency', () => ({ init: jest.fn() }));
jest.mock('react-native-gesture-handler', () => {
  const { TextInput: RNTextInput, ScrollView } = require('react-native');
  return { TextInput: RNTextInput, ScrollView };
});

let mockMainWallet;
jest.mock('../../contexts/wallet.context', () => ({
  useWalletContext: () => ({ wallet: mockMainWallet }),
}));

jest.mock('../../blue_modules/storage-context', () => {
  const RN = require('react');
  return { BlueStorageContext: RN.createContext({ wallets: [] }) };
});

const ManualAddressSend = require('../../screen/send/ManualAddressSend').default;
const { BlueStorageContext } = require('../../blue_modules/storage-context');
const { BlueDarkTheme } = require('../../components/themes');
const { Chain } = require('../../models/bitcoinUnits');
const loc = require('../../loc').default;

const ONCHAIN_ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const COMBINED_BIP21 =
  'bitcoin:BC1Q3RL0MKYK0ZRTXFMQN9WPCD3GNAZ00YV9YP0HXE?amount=0.000001&lightning=lnbc1u1pwry044pp53xlmkghmzjzm3cljl6729cwwqz5hhnhevwfajpkln850n7clft4sdqlgfy4qv33ypmj7sj0f32rzvfqw3jhxaqcqzysxq97zvuq5zy8ge6q70prnvgwtade0g2k5h2r76ws7j2926xdjj2pjaq6q3r4awsxtm6k5prqcul73p3atveljkn6wxdkrcy69t6k5edhtc6q7lgpe4m5k4';

const onchainWallet = {
  getID: () => 'wallet-onchain',
  chain: Chain.ONCHAIN,
};

const RootStack = createNativeStackNavigator();
const ScanStack = createNativeStackNavigator();
const SendStack = createNativeStackNavigator();

const SendDetailsStub = () => <Text>SendDetails</Text>;
const ScanLndInvoiceStub = () => <Text>ScanLndInvoice</Text>;
const ScannerStub = () => <Text>scanner</Text>;

const ScanCodeSendStackScreen = () => (
  <ScanStack.Navigator initialRouteName="ManualEnterAddress" screenOptions={{ headerShown: false }}>
    <ScanStack.Screen name="ScanCodeSend" component={ScannerStub} />
    <ScanStack.Screen name="ManualEnterAddress" component={ManualAddressSend} initialParams={{ walletID: onchainWallet.getID() }} />
  </ScanStack.Navigator>
);

const SendDetailsStackScreen = () => (
  <SendStack.Navigator screenOptions={{ headerShown: false }}>
    <SendStack.Screen name="SendDetails" component={SendDetailsStub} />
    <SendStack.Screen name="ScanLndInvoice" component={ScanLndInvoiceStub} />
  </SendStack.Navigator>
);

const renderManualAddress = () => {
  const navigationRef = createNavigationContainerRef();
  const screen = render(
    <BlueStorageContext.Provider value={{ wallets: [onchainWallet] }}>
      <NavigationContainer ref={navigationRef} theme={BlueDarkTheme}>
        <RootStack.Navigator initialRouteName="ScanCodeSendRoot" screenOptions={{ headerShown: false }}>
          <RootStack.Screen name="ScanCodeSendRoot" component={ScanCodeSendStackScreen} />
          <RootStack.Screen name="SendDetailsRoot" component={SendDetailsStackScreen} />
        </RootStack.Navigator>
      </NavigationContainer>
    </BlueStorageContext.Provider>,
  );
  return { screen, navigationRef };
};

const typeAndContinue = async (screen, value) => {
  fireEvent.changeText(screen.UNSAFE_getByType(TextInput), value);
  await waitFor(() => expect(screen.getByRole('button', { name: loc._.continue })).not.toBeDisabled());
  fireEvent.press(screen.getByRole('button', { name: loc._.continue }));
};

beforeEach(() => {
  mockMainWallet = onchainWallet;
});

describe('ManualAddressSend', () => {
  it('leaves the address screen for SendDetails after a valid on-chain address', async () => {
    const { screen, navigationRef } = renderManualAddress();

    expect(screen.getByText(loc.send.text_address_or_invoice)).toBeTruthy();
    await waitFor(() => expect(navigationRef.getCurrentRoute()?.name).toBe('ManualEnterAddress'));

    await typeAndContinue(screen, ONCHAIN_ADDRESS);

    await waitFor(() => expect(navigationRef.getCurrentRoute().name).toBe('SendDetails'));
    expect(screen.getByText('SendDetails')).toBeTruthy();

    // Address entry stays under SendDetails so back can correct a mistyped destination.
    act(() => navigationRef.goBack());
    expect(navigationRef.getCurrentRoute().name).toBe('ManualEnterAddress');
    expect(screen.getByText(loc.send.text_address_or_invoice)).toBeTruthy();
    expect(screen.getByDisplayValue(ONCHAIN_ADDRESS)).toBeTruthy();
  });

  it('leaves the address screen for SendDetails after a combined bitcoin-and-lightning URI', async () => {
    const { screen, navigationRef } = renderManualAddress();

    await typeAndContinue(screen, COMBINED_BIP21);

    await waitFor(() => expect(navigationRef.getCurrentRoute().name).toBe('SendDetails'));
    expect(screen.getByText('SendDetails')).toBeTruthy();
  });
});
