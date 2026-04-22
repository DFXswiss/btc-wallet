import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../components/themes';

import ExportMultisigCoordinationSetup from '../screen/wallets/exportMultisigCoordinationSetup';

type ExportMultisigCoordinationSetupStackParamList = {
  ExportMultisigCoordinationSetup: { walletID: string };
};

const Stack = createNativeStackNavigator<ExportMultisigCoordinationSetupStackParamList>();

const ExportMultisigCoordinationSetupStack = () => {
  const theme = useTheme();
  return (
    <Stack.Navigator initialRouteName="ExportMultisigCoordinationSetup" screenOptions={{ headerShadowVisible: false }}>
      <Stack.Screen
        name="ExportMultisigCoordinationSetup"
        component={ExportMultisigCoordinationSetup}
        options={ExportMultisigCoordinationSetup.navigationOptions(theme)}
      />
    </Stack.Navigator>
  );
};

export default ExportMultisigCoordinationSetupStack;
