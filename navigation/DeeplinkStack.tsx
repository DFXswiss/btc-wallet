import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../components/themes';

import Sell from '../screen/dfx/sell';
import Swap from '../screen/dfx/swap';
import Confirm from '../screen/send/confirm';
import SendCreate from '../screen/send/create';
import Success from '../screen/send/success';
import LnurlPay from '../screen/lnd/lnurlPay';
import LnurlPaySuccess from '../screen/lnd/lnurlPaySuccess';

import { DeeplinkStackParamList } from './types';

const Stack = createNativeStackNavigator<DeeplinkStackParamList>();

const DeeplinkStack = () => {
  const theme = useTheme();

  return (
    <Stack.Navigator screenOptions={{ headerShadowVisible: false }} initialRouteName="Sell">
      <Stack.Screen name="Sell" component={Sell} options={Sell.navigationOptions(theme)} />
      <Stack.Screen name="Swap" component={Swap} options={Swap.navigationOptions(theme)} />
      <Stack.Screen name="Confirm" component={Confirm} options={Confirm.navigationOptions(theme)} />
      <Stack.Screen name="CreateTransaction" component={SendCreate} options={SendCreate.navigationOptions(theme)} />
      <Stack.Screen name="Success" component={Success} options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="LnurlPay" component={LnurlPay} options={LnurlPay.navigationOptions(theme)} />
      <Stack.Screen name="LnurlPaySuccess" component={LnurlPaySuccess} options={LnurlPaySuccess.navigationOptions(theme)} />
    </Stack.Navigator>
  );
};

export default DeeplinkStack;
