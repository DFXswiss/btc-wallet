import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../components/themes';

import ScanCodeSend from '../screen/send/ScanCodeSend';
import ManualAddressSend from '../screen/send/ManualAddressSend';

import { ScanCodeSendStackParamList } from './types';

const Stack = createNativeStackNavigator<ScanCodeSendStackParamList>();

const ScanCodeSendStack = () => {
  const theme = useTheme();
  return (
    <Stack.Navigator>
      <Stack.Screen name="ScanCodeSend" component={ScanCodeSend} options={(ScanCodeSend as any).navigationOptions(theme)} />
      <Stack.Screen
        name="ManualEnterAddress"
        component={ManualAddressSend}
        options={(ManualAddressSend as any).navigationOptions(theme)}
      />
    </Stack.Navigator>
  );
};

export default ScanCodeSendStack;
