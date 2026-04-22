import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../components/themes';

import ViewEditMultisigCosigners from '../screen/wallets/viewEditMultisigCosigners';

type ViewEditMultisigCosignersStackParamList = {
  ViewEditMultisigCosigners: { walletID: string };
};

const Stack = createNativeStackNavigator<ViewEditMultisigCosignersStackParamList>();

const ViewEditMultisigCosignersStack = () => {
  const theme = useTheme();
  return (
    <Stack.Navigator initialRouteName="ViewEditMultisigCosigners" screenOptions={{ headerShadowVisible: false }}>
      <Stack.Screen
        name="ViewEditMultisigCosigners"
        component={ViewEditMultisigCosigners}
        options={ViewEditMultisigCosigners.navigationOptions(theme)}
      />
    </Stack.Navigator>
  );
};

export default ViewEditMultisigCosignersStack;
