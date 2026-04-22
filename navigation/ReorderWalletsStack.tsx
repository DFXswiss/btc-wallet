import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../components/themes';

import ReorderWallets from '../screen/wallets/reorderWallets';

type ReorderWalletsStackParamList = {
  ReorderWallets: undefined;
};

const Stack = createNativeStackNavigator<ReorderWalletsStackParamList>();

const ReorderWalletsStack = () => {
  const theme = useTheme();
  return (
    <Stack.Navigator screenOptions={{ headerShadowVisible: false }}>
      <Stack.Screen name="ReorderWallets" component={ReorderWallets} options={ReorderWallets.navigationOptions(theme)} />
    </Stack.Navigator>
  );
};

export default ReorderWalletsStack;
