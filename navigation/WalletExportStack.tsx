import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../components/themes';

import WalletExport from '../screen/wallets/export';

type WalletExportStackParamList = {
  WalletExport: { walletID: string };
};

const Stack = createNativeStackNavigator<WalletExportStackParamList>();

const WalletExportStack = () => {
  const theme = useTheme();
  return (
    <Stack.Navigator screenOptions={{ headerShadowVisible: false }} initialRouteName="WalletExport">
      <Stack.Screen name="WalletExport" component={WalletExport} options={WalletExport.navigationOptions(theme)} />
    </Stack.Navigator>
  );
};

export default WalletExportStack;
