import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../components/themes';

import BackupExplanation from '../screen/wallets/dfx/backup-explanation';
import PleaseBackup from '../screen/wallets/pleaseBackup';

import { BackupSeedStackParamList } from './types';

const Stack = createNativeStackNavigator<BackupSeedStackParamList>();

const BackupSeedStack = () => {
  const theme = useTheme();
  return (
    <Stack.Navigator screenOptions={{ headerShadowVisible: false }}>
      <Stack.Screen name="BackupExplanation" component={BackupExplanation} options={BackupExplanation.navigationOptions(theme)} />
      <Stack.Screen name="PleaseBackup" component={PleaseBackup} options={PleaseBackup.navigationOptions(theme)} />
    </Stack.Navigator>
  );
};

export default BackupSeedStack;
