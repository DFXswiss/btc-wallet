import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../components/themes';

import AztecoRedeem from '../screen/receive/aztecoRedeem';
import SelectWallet from '../screen/wallets/selectWallet';

import { AztecoRedeemStackParamList } from './types';

const Stack = createNativeStackNavigator<AztecoRedeemStackParamList>();

const AztecoRedeemStack = () => {
  const theme = useTheme();
  return (
    <Stack.Navigator screenOptions={{ headerShadowVisible: false }}>
      <Stack.Screen name="AztecoRedeem" component={AztecoRedeem} options={AztecoRedeem.navigationOptions(theme)} />
      <Stack.Screen name="SelectWallet" component={SelectWallet} />
    </Stack.Navigator>
  );
};

export default AztecoRedeemStack;
