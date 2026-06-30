import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import ScanQRCode from '../screen/send/ScanQRCode';
import { isDesktop } from '../blue_modules/environment';

import { ScanQRCodeStackParamList } from './types';

const Stack = createNativeStackNavigator<ScanQRCodeStackParamList>();

const ScanQRCodeStack = () => (
  <Stack.Navigator screenOptions={{ headerShown: false, presentation: isDesktop ? 'containedModal' : 'fullScreenModal' }}>
    <Stack.Screen name="ScanQRCode" component={ScanQRCode} />
  </Stack.Navigator>
);

export default ScanQRCodeStack;
