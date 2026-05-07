import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../components/themes';

import SignVerify from '../screen/wallets/signVerify';

type SignVerifyStackParamList = {
  SignVerify: { walletID: string; address?: string };
};

const Stack = createNativeStackNavigator<SignVerifyStackParamList>();

const SignVerifyStack = () => {
  const theme = useTheme();
  return (
    <Stack.Navigator screenOptions={{ headerShadowVisible: false }} initialRouteName="SignVerify">
      <Stack.Screen name="SignVerify" component={SignVerify} options={SignVerify.navigationOptions(theme)} />
    </Stack.Navigator>
  );
};

export default SignVerifyStack;
