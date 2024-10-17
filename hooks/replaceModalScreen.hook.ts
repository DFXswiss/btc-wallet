import { useNavigation } from '@react-navigation/native';
import { useCallback } from 'react';

/**
 *  The WHY of this hook:
 * 
 * Unfortunately, upgrading to @react-navigation v6 introduces a bug in the function `replace` 
 * that was not present in previous versions. This bug affects only iOS and appears when replacing
 * a modal screen with another modal screen, causing the app to crash.
 * 
 * To the date of this writing, the issue has been reported several times on react-navigation repository,
 * but with little to none response from the maintainers as it seems to scalate to react-native itself, 
 * because of that we have to come up with our own workaround as none of the known workarounds worked for us 🥲.
 * 
 * The WHAT of this hook:
 * 
 * To achive similar functionality to the `replace` function, we are using the `reset` and `pop` functions
 * to manually modify the navigation stack. Please only use this hook when the original `replace` function
 * causes the crash mentioned above.
 * 
 * Related issues:
 * https://github.com/react-navigation/react-navigation/issues/11201
 * https://github.com/react-navigation/react-navigation/issues/11604
 * https://github.com/react-navigation/react-navigation/issues/11270
 * https://github.com/react-navigation/react-navigation/issues/11259
 */

export function useReplaceModalScreen() {
  const navigation = useNavigation();

  const replace = useCallback(
    (newScreen: { name: string; params: any }) => {
      const routes = [...navigation.getState().routes];
      const oldScreen = routes.pop();
      routes.push(newScreen);
      routes.push(oldScreen);

      navigation.reset({
        index: routes.length - 2, // Efectively navigating to the new screen
        routes,
      });

      return setTimeout(() => navigation.pop(), 0); // Remove the old screen from the stack, completing the replacement
    },
    [navigation],
  );

  return replace;
}
