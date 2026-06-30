import React from 'react';
import { Image, Keyboard, TouchableOpacity, StyleSheet } from 'react-native';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { Theme } from './themes';
import loc from '../loc';

const styles = StyleSheet.create({
  button: {
    minWidth: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

// Keep our historical option surface permissive. Concrete shape is still a
// subset of React Navigation v7 native-stack options, which is what the
// navigator accepts at runtime.
type NavigationOptions = NativeStackNavigationOptions;

type OptionsFormatter = (options: NavigationOptions, deps: { theme: Theme; navigation: any; route: any }) => NavigationOptions;

export type NavigationOptionsGetter = (
  theme: Theme,
) => NavigationOptions | ((deps: { navigation: any; route: any; theme?: any }) => NavigationOptions);

const navigationStyle = (
  {
    closeButton = false,
    closeButtonFunc,
    ...opts
  }: NavigationOptions & {
    closeButton?: boolean;
    closeButtonFunc?: (deps: { navigation: any; route: any }) => React.ReactElement;
    headerHideBackButton?: boolean;
  },
  formatter: OptionsFormatter,
): NavigationOptionsGetter => {
  return theme =>
    ({ navigation, route }) => {
      let headerRight;
      if (closeButton) {
        const handleClose = closeButtonFunc
          ? () => closeButtonFunc({ navigation, route })
          : () => {
              Keyboard.dismiss();
              navigation.goBack(null);
            };
        headerRight = () => (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={loc._.close}
            style={styles.button}
            onPress={handleClose}
            testID="NavigationCloseButton"
          >
            <Image source={theme.closeImage} />
          </TouchableOpacity>
        );
      }

      const restOpts = { ...opts };
      delete restOpts.statusBarStyle;

      let options: NavigationOptions = {
        // Native-stack only reads `headerStyle.backgroundColor`; the former
        // borderBottomWidth/elevation/shadow* keys were silently ignored at
        // runtime, so omitting them is behaviour-neutral.
        headerTitleStyle: {
          fontWeight: '600',
          color: theme.colors.foregroundColor,
        },
        headerRight,
        // headerBackTitleVisible is a JS-stack option that native-stack ignores
        // at runtime; dropping it is behaviour-neutral.
        headerTintColor: theme.colors.foregroundColor,
        ...restOpts,
      };

      if (formatter) {
        options = formatter(options, { theme, navigation, route });
      }

      return options;
    };
};

export default navigationStyle;

export const navigationStyleTx = (opts: NavigationOptions, formatter: OptionsFormatter): NavigationOptionsGetter => {
  return theme =>
    ({ navigation, route }) => {
      let options: NavigationOptions = {
        // Native-stack ignores borderBottomWidth/elevation/shadow* in headerStyle
        // (only backgroundColor is honoured) -> omitting them is behaviour-neutral.
        headerTitleStyle: {
          fontWeight: '600',
          color: theme.colors.foregroundColor,
        },
        // headerBackTitle: null,
        // headerBackTitleVisible (JS-stack only) is ignored by native-stack -> omitted, behaviour-neutral.
        headerTintColor: theme.colors.foregroundColor,
        headerLeft: () => (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={loc._.close}
            style={styles.button}
            onPress={() => {
              Keyboard.dismiss();
              navigation.goBack(null);
            }}
          >
            <Image source={theme.closeImage} />
          </TouchableOpacity>
        ),
        ...opts,
      };

      if (formatter) {
        options = formatter(options, { theme, navigation, route });
      }

      return options;
    };
};
