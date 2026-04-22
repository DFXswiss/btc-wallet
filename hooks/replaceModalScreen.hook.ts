import { useNavigation, StackActions, CommonActions } from '@react-navigation/native';
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
 * because of that we have to come up with our own workaround as none of the known workarounds worked for us.
 *
 * The WHAT of this hook:
 *
 * To achieve similar functionality to the `replace` function, we are using the `reset` and `pop` functions
 * to manually modify the navigation stack. Please only use this hook when the original `replace` function
 * causes the crash mentioned above.
 */

export function useReplaceModalScreen() {
  const navigation = useNavigation();

  const replace = useCallback(
    (newScreen: { name: string; params?: any }) => {
      const state = navigation.getState();
      if (!state) return;

      const routes = [...state.routes];
      const oldScreen = routes.pop();
      if (!oldScreen) return;

      routes.push(newScreen as (typeof routes)[number]);
      routes.push(oldScreen);

      navigation.dispatch(
        CommonActions.reset({
          index: routes.length - 2,
          routes: routes as any,
        }),
      );

      return setTimeout(() => navigation.dispatch(StackActions.pop()), 0);
    },
    [navigation],
  );

  return replace;
}
