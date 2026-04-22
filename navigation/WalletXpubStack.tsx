import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../components/themes';

import WalletXpub from '../screen/wallets/xpub';

type WalletXpubStackParamList = {
  WalletXpub: { walletID?: string; xpub?: string };
};

const Stack = createNativeStackNavigator<WalletXpubStackParamList>();

const WalletXpubStack = () => {
  const theme = useTheme();
  return (
    <Stack.Navigator screenOptions={{ headerShadowVisible: false }} initialRouteName="WalletXpub">
      <Stack.Screen name="WalletXpub" component={WalletXpub} options={WalletXpub.navigationOptions(theme)} />
    </Stack.Navigator>
  );
};

export default WalletXpubStack;
