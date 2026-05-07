import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../components/themes';

import AddWallet from '../screen/wallets/add';
import ImportWallet from '../screen/wallets/import';
import ImportWalletDiscovery from '../screen/wallets/importDiscovery';
import ScanImport from '../screen/wallets/ScanImport';
import ImportCustomDerivationPath from '../screen/wallets/importCustomDerivationPath';
import ImportSpeed from '../screen/wallets/importSpeed';
import PleaseBackup from '../screen/wallets/pleaseBackup';
import PleaseBackupLNDHub from '../screen/wallets/pleaseBackupLNDHub';
import ProvideEntropy from '../screen/wallets/provideEntropy';
import WalletsAddMultisigHelp from '../screen/wallets/addMultisigHelp';

import { AddWalletStackParamList } from './types';

const Stack = createNativeStackNavigator<AddWalletStackParamList>();

const AddWalletStack = () => {
  const theme = useTheme();

  return (
    <Stack.Navigator screenOptions={{ headerShadowVisible: false }}>
      <Stack.Screen name="AddWallet" component={AddWallet} options={AddWallet.navigationOptions(theme)} />
      <Stack.Screen name="ImportWallet" component={ImportWallet} options={ImportWallet.navigationOptions(theme)} />
      <Stack.Screen name="ImportWalletDiscovery" component={ImportWalletDiscovery} options={ImportWalletDiscovery.navigationOptions(theme)} />
      <Stack.Screen name="ScanImport" component={ScanImport} options={(ScanImport as any).navigationOptions(theme)} />
      <Stack.Screen
        name="ImportCustomDerivationPath"
        component={ImportCustomDerivationPath}
        options={ImportCustomDerivationPath.navigationOptions(theme)}
      />
      <Stack.Screen name="ImportSpeed" component={ImportSpeed} options={ImportSpeed.navigationOptions(theme)} />
      <Stack.Screen name="PleaseBackup" component={PleaseBackup} options={PleaseBackup.navigationOptions(theme)} />
      <Stack.Screen name="PleaseBackupLNDHub" component={PleaseBackupLNDHub} options={PleaseBackupLNDHub.navigationOptions(theme)} />
      <Stack.Screen name="ProvideEntropy" component={ProvideEntropy} options={ProvideEntropy.navigationOptions(theme)} />
      <Stack.Screen name="WalletsAddMultisigHelp" component={WalletsAddMultisigHelp} options={WalletsAddMultisigHelp.navigationOptions(theme)} />
    </Stack.Navigator>
  );
};

export default AddWalletStack;
