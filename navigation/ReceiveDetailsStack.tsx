import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../components/themes';

import ReceiveDetails from '../screen/receive/details';
import LNDCreateInvoice from '../screen/lnd/lndCreateInvoice';
import LnurlAuth from '../screen/lnd/lnurlAuth';
import LNDReceive from '../screen/lnd/lndReceive';
import LndPosReceive from '../screen/lnd/lndPosReceive';
import CashierPos from '../screen/lnd/cashierPos';
import CashierDfxPos from '../screen/wallets/dfx/cashierPos';
import ReceiveDfxPos from '../screen/wallets/dfx/receivePos';
import SelectWallet from '../screen/wallets/selectWallet';
import LNDViewInvoice from '../screen/lnd/lndViewInvoice';
import LNDViewAdditionalInvoiceInformation from '../screen/lnd/lndViewAdditionalInvoiceInformation';
import LNDViewAdditionalInvoicePreImage from '../screen/lnd/lndViewAdditionalInvoicePreImage';

import { ReceiveDetailsStackParamList } from './types';

const Stack = createNativeStackNavigator<ReceiveDetailsStackParamList>();

const ReceiveDetailsStack = () => {
  const theme = useTheme();

  return (
    <Stack.Navigator screenOptions={{ headerShadowVisible: false }} initialRouteName="ReceiveDetails">
      <Stack.Screen name="ReceiveDetails" component={ReceiveDetails} options={ReceiveDetails.navigationOptions(theme)} />
      <Stack.Screen name="LNDCreateInvoice" component={LNDCreateInvoice} options={LNDCreateInvoice.navigationOptions(theme)} />
      <Stack.Screen name="LnurlAuth" component={LnurlAuth} options={LnurlAuth.navigationOptions(theme)} />
      <Stack.Screen name="LNDReceive" component={LNDReceive} options={LNDReceive.navigationOptions(theme)} />
      <Stack.Screen name="PosReceive" component={LndPosReceive} options={LndPosReceive.navigationOptions(theme)} />
      <Stack.Screen name="CashierPos" component={CashierPos} options={CashierPos.navigationOptions(theme)} />
      <Stack.Screen name="CashierDfxPos" component={CashierDfxPos} options={CashierDfxPos.navigationOptions(theme)} />
      <Stack.Screen name="ReceiveDfxPos" component={ReceiveDfxPos} options={ReceiveDfxPos.navigationOptions(theme)} />
      <Stack.Screen name="SelectWallet" component={SelectWallet} options={SelectWallet.navigationOptions(theme)} />
      <Stack.Screen name="LNDViewInvoice" component={LNDViewInvoice} options={LNDViewInvoice.navigationOptions(theme)} />
      <Stack.Screen
        name="LNDViewAdditionalInvoiceInformation"
        component={LNDViewAdditionalInvoiceInformation}
        options={LNDViewAdditionalInvoiceInformation.navigationOptions(theme)}
      />
      <Stack.Screen
        name="LNDViewAdditionalInvoicePreImage"
        component={LNDViewAdditionalInvoicePreImage}
        options={LNDViewAdditionalInvoicePreImage.navigationOptions(theme)}
      />
    </Stack.Navigator>
  );
};

export default ReceiveDetailsStack;
