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
import { getUniqueIdSync } from 'react-native-device-info';
import * as Sentry from '@sentry/react-native';
// Not re-exported by @sentry/react-native, but it pins @sentry/core to an exact
// version, so this resolves to the same deduped instance the SDK itself uses.
import { captureConsoleIntegration } from '@sentry/core';
const BlueApp = require('./BlueApp');

// blue_modules/analytics.js's setSentryEnabled() only toggles JS-side event
// delivery (client.getOptions().enabled) - it can't retroactively stop native
// crash handling once initialized. enableNative can only be set at init time,
// so the persisted Do Not Track choice has to be read (async, AsyncStorage-
// backed) before Sentry.init() runs, not after. Deferring init briefly - rather
// than initializing native handling unconditionally and hoping to disable it
// later - is what actually keeps an opted-out user's native crashes local.
BlueApp.isDoNotTrackEnabled().then(doNotTrack => {
  Sentry.init({
    dsn: 'https://3442e1e21177204b9c8d25d2f682b485@sentry.dfxserve.com/4',

    // Set both here, atomically, from the one resolved value: blue_modules/
    // analytics.js reads this same async preference independently for live
    // toggling later, and racing two separate reads of it at startup could
    // otherwise leave the JS side briefly enabled for an opted-out user.
    enableNative: !doNotTrack,
    enabled: !doNotTrack,

    // Do not attach IP address, cookies, or other PII to events.
    sendDefaultPii: false,

    // Enable Logs
    enableLogs: true,

    // Without this, a caught error that only reaches console.error is recorded
    // as a breadcrumb and a log, but never opens an issue - so nothing alerts on
    // it. Errors only: console.warn is far too noisy (Electrum reconnects alone
    // produce hundreds a day). Merged with the SDK's default integrations.
    integrations: [captureConsoleIntegration({ levels: ['error'] })],

    // uncomment the line below to enable Spotlight (https://spotlightjs.com)
    // spotlight: __DEV__,
  });

  // Error events get a user id from the native layer, logs do not - the SDK's
  // log enricher copies scope *attributes* onto each log but never the scope
  // user. Without this every log row has user.id = null, so "6 Electrum drops"
  // can't be told apart from "6 users affected". Same id the About screen shows
  // for support, so this adds no identifier that isn't already reported.
  if (!doNotTrack) {
    Sentry.getGlobalScope().setAttributes({ 'user.id': getUniqueIdSync() });
  }
});
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
  const wasElectrumOnline = useRef(undefined);

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
      .catch(() => {});
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
      // isConnected is `boolean | null`, where null means "not yet determined".
      // Only a definite false means offline - treating unknown as offline would
      // gate connectMain() off entirely (see the networkConnected check there)
      // and leave Electrum wedged with no connection and no retry.
      const isOffline = state.isConnected === false;
      BlueElectrum.setNetworkConnected(!isOffline);

      // The initial connect used to run at BlueApp.js module scope, before NetInfo
      // had reported anything - and BlueElectrum defaults networkConnected to true,
      // so a cold start with no network burned the whole retry cascade for nothing.
      // NetInfo delivers the current state as soon as we subscribe, so this is the
      // earliest point at which the answer is actually known.
      //
      // Fires on the first report that says we have a network, and again on every
      // offline -> online transition: while offline every connectMain() returns at
      // the networkConnected guard, so reconnecting here is immediate instead of
      // waiting for the next waitTillConnected() timeout to drive it. Not
      // level-triggered: reconnecting when already connected re-arms the 30 minute
      // peer rotation timer.
      if (!isOffline && wasElectrumOnline.current !== true) {
        BlueElectrum.connectMain();
      }
      wasElectrumOnline.current = !isOffline;
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

export default Sentry.wrap(App);
