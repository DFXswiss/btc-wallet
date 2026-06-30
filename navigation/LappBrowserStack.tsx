import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../components/themes';

import LappBrowser from '../screen/lnd/browser';

type LappBrowserStackParamList = {
  LappBrowser: { fromSecret?: string; fromWallet?: object; url?: string };
};

const Stack = createNativeStackNavigator<LappBrowserStackParamList>();

const LappBrowserStack = () => {
  const theme = useTheme();
  return (
    <Stack.Navigator screenOptions={{ headerShadowVisible: false }} initialRouteName="LappBrowser">
      <Stack.Screen name="LappBrowser" component={LappBrowser} options={LappBrowser.navigationOptions(theme)} />
    </Stack.Navigator>
  );
};

export default LappBrowserStack;
