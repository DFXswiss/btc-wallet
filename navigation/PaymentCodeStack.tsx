import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import PaymentCode from '../screen/wallets/paymentCode';
import PaymentCodesList from '../screen/wallets/paymentCodesList';
import loc from '../loc';

import { PaymentCodeStackParamList } from './types';

const Stack = createNativeStackNavigator<PaymentCodeStackParamList>();

const PaymentCodeStack = () => (
  <Stack.Navigator screenOptions={{ headerShadowVisible: false }} initialRouteName="PaymentCode">
    <Stack.Screen name="PaymentCode" component={PaymentCode} options={{ headerTitle: loc.bip47.payment_code }} />
    <Stack.Screen name="PaymentCodesList" component={PaymentCodesList} options={{ headerTitle: loc.bip47.payment_codes_list }} />
  </Stack.Navigator>
);

export default PaymentCodeStack;
