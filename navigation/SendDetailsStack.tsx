import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../components/themes';

import SendDetails from '../screen/send/details';
import Confirm from '../screen/send/confirm';
import PsbtWithHardwareWallet from '../screen/send/psbtWithHardwareWallet';
import SendCreate from '../screen/send/create';
import PsbtMultisig from '../screen/send/psbtMultisig';
import PsbtMultisigQRCode from '../screen/send/psbtMultisigQRCode';
import Success from '../screen/send/success';
import SelectWallet from '../screen/wallets/selectWallet';
import CoinControl from '../screen/send/coinControl';
import ScanLndInvoice from '../screen/lnd/scanLndInvoice';
import LnurlPay from '../screen/lnd/lnurlPay';
import LnurlPaySuccess from '../screen/lnd/lnurlPaySuccess';
import LnurlAuth from '../screen/lnd/lnurlAuth';
import LnurlNavigationForwarder from '../screen/lnd/lnurlNavigationForwarder';
import OpenCryptoPayCommitOnchain from '../screen/open-crypto-pay/openCrytoPayCommitOnchain';

import { SendDetailsStackParamList } from './types';

const Stack = createNativeStackNavigator<SendDetailsStackParamList>();

const SendDetailsStack = () => {
  const theme = useTheme();

  return (
    <Stack.Navigator screenOptions={{ headerShadowVisible: false }}>
      <Stack.Screen name="SendDetails" component={SendDetails} options={SendDetails.navigationOptions(theme)} />
      <Stack.Screen name="Confirm" component={Confirm} options={Confirm.navigationOptions(theme)} />
      <Stack.Screen name="PsbtWithHardwareWallet" component={PsbtWithHardwareWallet} options={PsbtWithHardwareWallet.navigationOptions(theme)} />
      <Stack.Screen name="CreateTransaction" component={SendCreate} options={SendCreate.navigationOptions(theme)} />
      <Stack.Screen name="PsbtMultisig" component={PsbtMultisig} options={PsbtMultisig.navigationOptions(theme)} />
      <Stack.Screen name="PsbtMultisigQRCode" component={PsbtMultisigQRCode} options={PsbtMultisigQRCode.navigationOptions(theme)} />
      <Stack.Screen name="Success" component={Success} options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="SelectWallet" component={SelectWallet} options={SelectWallet.navigationOptions(theme)} />
      <Stack.Screen name="CoinControl" component={CoinControl} options={CoinControl.navigationOptions(theme)} />
      <Stack.Screen name="ScanLndInvoice" component={ScanLndInvoice} options={ScanLndInvoice.navigationOptions(theme)} />
      <Stack.Screen name="LnurlPay" component={LnurlPay} options={LnurlPay.navigationOptions(theme)} />
      <Stack.Screen name="LnurlPaySuccess" component={LnurlPaySuccess} options={LnurlPaySuccess.navigationOptions(theme)} />
      <Stack.Screen name="LnurlAuth" component={LnurlAuth} options={LnurlAuth.navigationOptions(theme)} />
      <Stack.Screen
        name="LnurlNavigationForwarder"
        component={LnurlNavigationForwarder}
        options={LnurlNavigationForwarder.navigationOptions(theme)}
      />
      <Stack.Screen
        name="OpenCryptoPayCommitOnchain"
        component={OpenCryptoPayCommitOnchain}
        options={OpenCryptoPayCommitOnchain.navigationOptions(theme)}
      />
    </Stack.Navigator>
  );
};

export default SendDetailsStack;
