import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import UnlockWith from '../UnlockWith';

type UnlockWithScreenStackParamList = {
  UnlockWithScreen: { unlockOnComponentMount?: boolean } | undefined;
};

const Stack = createNativeStackNavigator<UnlockWithScreenStackParamList>();

const UnlockWithScreenStack = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="UnlockWithScreen" component={UnlockWith} initialParams={{ unlockOnComponentMount: true }} />
  </Stack.Navigator>
);

export default UnlockWithScreenStack;
