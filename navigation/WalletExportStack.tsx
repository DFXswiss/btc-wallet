import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../components/themes';

import WalletExport from '../screen/wallets/export';
import SparkBackupNotice from '../screen/wallets/sparkBackupNotice';

type WalletExportStackParamList = {
  WalletExport: { walletID: string; noticeAccepted?: boolean };
  SparkBackupNotice: { walletID: string };
};

const Stack = createNativeStackNavigator<WalletExportStackParamList>();

const WalletExportStack = () => {
  const theme = useTheme();
  return (
    <Stack.Navigator screenOptions={{ headerShadowVisible: false }} initialRouteName="WalletExport">
      <Stack.Screen name="WalletExport" component={WalletExport} options={WalletExport.navigationOptions(theme)} />
      <Stack.Screen name="SparkBackupNotice" component={SparkBackupNotice} options={SparkBackupNotice.navigationOptions(theme)} />
    </Stack.Navigator>
  );
};

export default WalletExportStack;
