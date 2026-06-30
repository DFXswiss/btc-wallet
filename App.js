import { GestureHandlerRootView } from 'react-native-gesture-handler'; // should be on top
import React, { useContext, useEffect, useRef } from 'react';
import {
  AppState,
  DeviceEventEmitter,
  NativeModules,
  NativeEventEmitter,
  Linking,
  Platform,
  StyleSheet,
  UIManager,
  View,
  StatusBar,
  LogBox,
} from 'react-native';
import { NavigationContainer, CommonActions } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { navigationRef } from './NavigationService';
import * as NavigationService from './NavigationService';
import OnAppLaunch from './class/on-app-launch';
import DeeplinkSchemaMatch from './class/deeplink-schema-match';
import { BlueDarkTheme } from './components/themes';
import InitRoot from './navigation';
import { isDesktop } from './blue_modules/environment';
import { BlueStorageContext } from './blue_modules/storage-context';
import WatchConnectivity from './WatchConnectivity';
import DeviceQuickActions from './class/quick-actions';
import useCompanionListeners from './hooks/useCompanionListeners';
import Biometric from './class/biometrics';
import WidgetCommunication from './blue_modules/WidgetCommunication';
import HandoffComponent from './components/handoff';
import Privacy from './blue_modules/Privacy';
import { addEventListener } from '@react-native-community/netinfo';
const currency = require('./blue_modules/currency');
const BlueElectrum = require('./blue_modules/BlueElectrum');

const eventEmitter = Platform.OS === 'ios' ? new NativeEventEmitter(NativeModules.EventEmitter) : undefined;
const { EventEmitter } = NativeModules;

LogBox.ignoreLogs(['Require cycle:']);

if (Platform.OS === 'android') {
  if (UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
  }
}

const App = () => {
  const { walletsInitialized, wallets, addWallet, saveToDisk, setBalanceRefreshInterval, clearBalanceRefreshInterval } =
    useContext(BlueStorageContext);
  const appState = useRef(AppState.currentState);

  useCompanionListeners();

  const openSettings = () => {
    NavigationService.dispatch(
      CommonActions.navigate({
        name: 'Settings',
      }),
    );
  };

  const onUserActivityOpen = data => {
    switch (data.activityType) {
      case HandoffComponent.activityTypes.ReceiveOnchain:
        NavigationService.navigate('ReceiveDetailsRoot', {
          screen: 'ReceiveDetails',
          params: {
            address: data.userInfo.address,
          },
        });
        break;
      case HandoffComponent.activityTypes.Xpub:
        NavigationService.navigate('WalletXpubRoot', {
          screen: 'WalletXpub',
          params: {
            xpub: data.userInfo.xpub,
          },
        });
        break;
      default:
        break;
    }
  };

  useEffect(() => {
    if (walletsInitialized) {
      addListeners();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletsInitialized]);

  const urlSubscription = useRef(null);
  const appStateSubscription = useRef(null);

  useEffect(() => {
    return () => {
      urlSubscription.current?.remove();
      appStateSubscription.current?.remove();
      eventEmitter?.removeAllListeners('openSettings');
      eventEmitter?.removeAllListeners('onUserActivityOpen');
    };
  }, []);

  const addListeners = () => {
    urlSubscription.current = Linking.addEventListener('url', handleOpenURL);
    appStateSubscription.current = AppState.addEventListener('change', handleAppStateChange);
    DeviceEventEmitter.addListener('quickActionShortcut', walletQuickActions);
    DeviceQuickActions.popInitialAction().then(popInitialAction);
    EventEmitter?.getMostRecentUserActivity()
      .then(onUserActivityOpen)
      .catch(() => console.log('No userActivity object sent'));
    handleAppStateChange(undefined);
    eventEmitter?.addListener('openSettings', openSettings);
    eventEmitter?.addListener('onUserActivityOpen', onUserActivityOpen);
  };

  const popInitialAction = async data => {
    if (data) {
      const wallet = wallets.find(w => w.getID() === data.userInfo.url.split('wallet/')[1]);
      NavigationService.dispatch(
        CommonActions.navigate({
          name: 'WalletTransactions',
          key: `WalletTransactions-${wallet.getID()}`,
          params: {
            walletID: wallet.getID(),
            walletType: wallet.type,
          },
        }),
      );
    } else {
      const url = await Linking.getInitialURL();
      if (url) {
        if (DeeplinkSchemaMatch.hasSchema(url)) {
          handleOpenURL({ url });
        }
      } else {
        const isViewAllWalletsEnabled = await OnAppLaunch.isViewAllWalletsEnabled();
        if (!isViewAllWalletsEnabled) {
          const selectedDefaultWallet = await OnAppLaunch.getSelectedDefaultWallet();
          const wallet = wallets.find(w => w.getID() === selectedDefaultWallet.getID());
          if (wallet) {
            NavigationService.dispatch(
              CommonActions.navigate({
                name: 'WalletTransactions',
                key: `WalletTransactions-${wallet.getID()}`,
                params: {
                  walletID: wallet.getID(),
                  walletType: wallet.type,
                },
              }),
            );
          }
        }
      }
    }
  };

  const walletQuickActions = data => {
    const wallet = wallets.find(w => w.getID() === data.userInfo.url.split('wallet/')[1]);
    NavigationService.dispatch(
      CommonActions.navigate({
        name: 'WalletTransactions',
        key: `WalletTransactions-${wallet.getID()}`,
        params: {
          walletID: wallet.getID(),
          walletType: wallet.type,
        },
      }),
    );
  };

  useEffect(() => {
    const unsubscribe = addEventListener(state => {
      BlueElectrum.setNetworkConnected(state.isConnected);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const handleAppStateChange = async nextAppState => {
    if (wallets.length === 0) return;
    if ((appState.current.match(/inactive|background/) && nextAppState === 'active') || nextAppState === undefined) {
      currency.updateExchangeRate();
      setBalanceRefreshInterval();
    }
    if (appState.current === 'active' && nextAppState?.match(/background/)) clearBalanceRefreshInterval();
    if (nextAppState) {
      appState.current = nextAppState;
    }
  };

  const handleOpenURL = event => {
    DeeplinkSchemaMatch.navigationRouteFor(event, value => NavigationService.navigate(...value), { wallets, addWallet, saveToDisk });
  };

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <View style={styles.root}>
          <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
          <NavigationContainer ref={navigationRef} theme={BlueDarkTheme}>
            <InitRoot />
          </NavigationContainer>
          {walletsInitialized && !isDesktop && <WatchConnectivity />}
        </View>
        <DeviceQuickActions />
        <Biometric />
        <WidgetCommunication />
        <Privacy />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingVertical: Platform.OS === 'android' ? 15 : 0,
  },
});

export default App;
