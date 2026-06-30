import React, { lazy, useContext } from 'react';
import { createNativeStackNavigator, NativeStackNavigationOptions } from '@react-navigation/native-stack';

import { isDesktop } from '../blue_modules/environment';
import { BlueStorageContext } from '../blue_modules/storage-context';
import SelectWallet from '../screen/wallets/selectWallet';

import { withLazySuspense } from './LazyLoadingIndicator';
import { InitStackParamList, RootStackParamList } from './types';

// UnlockWithScreen stays eager: it's the very first screen shown on cold start.
// WalletsStack stays eager too: it's the main screen shown right after unlock
// and lazy-loading it makes Hermes stack traces unreadable (source maps for the
// split navigation/WalletsStack.bundle are fetched separately and don't
// symbolicate reliably while debugging).
// ScanQRCode and ScanCodeSend are kept eager because they are one of the two
// primary actions on the home screen; deferring them adds a visible spinner
// every time the user taps "Send/Scan".
import UnlockWithScreenStack from './UnlockWithScreenStack';
import WalletsStack from './WalletsStack';
import ScanQRCodeStack from './ScanQRCodeStack';
import ScanCodeSendStack from './ScanCodeSendStack';
import ReceiveDetailsStack from './ReceiveDetailsStack';

// IMPORTANT: wrap every lazy stack with `withLazySuspense` at module scope.
// Calling `withLazySuspense(...)` inline in JSX produces a new component
// identity on every render of <Navigation/>, which makes react-navigation
// tear down and remount the active screen every time the storage context
// publishes (e.g. on each balance poll). See btc-taro-wallet profiling notes.
const ReorderWalletsStackScreen = withLazySuspense(lazy(() => import('./ReorderWalletsStack')));
const BackupSeedStackScreen = withLazySuspense(lazy(() => import('./BackupSeedStack')));
const AddWalletStackScreen = withLazySuspense(lazy(() => import('./AddWalletStack')));
const SendDetailsStackScreen = withLazySuspense(lazy(() => import('./SendDetailsStack')));
const AztecoRedeemStackScreen = withLazySuspense(lazy(() => import('./AztecoRedeemStack')));
const WalletExportStackScreen = withLazySuspense(lazy(() => import('./WalletExportStack')));
const ExportMultisigCoordinationSetupStackScreen = withLazySuspense(
  lazy(() => import('./ExportMultisigCoordinationSetupStack')),
);
const ViewEditMultisigCosignersStackScreen = withLazySuspense(lazy(() => import('./ViewEditMultisigCosignersStack')));
const WalletXpubStackScreen = withLazySuspense(lazy(() => import('./WalletXpubStack')));
const SignVerifyStackScreen = withLazySuspense(lazy(() => import('./SignVerifyStack')));
const LappBrowserStackScreen = withLazySuspense(lazy(() => import('./LappBrowserStack')));
const DeeplinkStackScreen = withLazySuspense(lazy(() => import('./DeeplinkStack')));
const PaymentCodeStackScreen = withLazySuspense(lazy(() => import('./PaymentCodeStack')));

const NavigationDefaultOptions: NativeStackNavigationOptions = {
  headerShown: false,
  presentation: isDesktop ? 'containedModal' : 'modal',
};

const RootStack = createNativeStackNavigator<RootStackParamList>();

const Navigation = () => {
  const { wallets } = useContext(BlueStorageContext);
  return (
    <RootStack.Navigator
      initialRouteName={wallets.length === 0 ? 'AddWalletRoot' : 'WalletsRoot'}
      screenOptions={{ headerShadowVisible: false }}
    >
      <RootStack.Screen name="WalletsRoot" component={WalletsStack} options={{ headerShown: false }} />
      <RootStack.Screen name="BackupSeedRoot" component={BackupSeedStackScreen} options={NavigationDefaultOptions} />
      <RootStack.Screen name="AddWalletRoot" component={AddWalletStackScreen} options={{ headerShown: false }} />
      <RootStack.Screen name="SendDetailsRoot" component={SendDetailsStackScreen} options={NavigationDefaultOptions} />
      <RootStack.Screen name="AztecoRedeemRoot" component={AztecoRedeemStackScreen} options={NavigationDefaultOptions} />
      <RootStack.Screen name="WalletExportRoot" component={WalletExportStackScreen} options={NavigationDefaultOptions} />
      <RootStack.Screen
        name="ExportMultisigCoordinationSetupRoot"
        component={ExportMultisigCoordinationSetupStackScreen}
        options={NavigationDefaultOptions}
      />
      <RootStack.Screen
        name="ViewEditMultisigCosignersRoot"
        component={ViewEditMultisigCosignersStackScreen}
        options={NavigationDefaultOptions}
      />
      <RootStack.Screen name="WalletXpubRoot" component={WalletXpubStackScreen} options={NavigationDefaultOptions} />
      <RootStack.Screen name="SignVerifyRoot" component={SignVerifyStackScreen} options={NavigationDefaultOptions} />
      <RootStack.Screen name="SelectWallet" component={SelectWallet} />
      <RootStack.Screen name="ReceiveDetailsRoot" component={ReceiveDetailsStack} options={NavigationDefaultOptions} />
      <RootStack.Screen name="LappBrowserRoot" component={LappBrowserStackScreen} options={NavigationDefaultOptions} />
      <RootStack.Screen
        name="ScanQRCodeRoot"
        component={ScanQRCodeStack}
        options={{
          headerShown: false,
          presentation: isDesktop ? 'containedModal' : 'fullScreenModal',
        }}
      />
      <RootStack.Screen name="ScanCodeSendRoot" component={ScanCodeSendStack} options={{ headerShown: false }} />
      <RootStack.Screen name="DeeplinkRoot" component={DeeplinkStackScreen} options={NavigationDefaultOptions} />
      <RootStack.Screen name="PaymentCodeRoot" component={PaymentCodeStackScreen} options={NavigationDefaultOptions} />
    </RootStack.Navigator>
  );
};

const InitStack = createNativeStackNavigator<InitStackParamList>();

const InitRoot = () => (
  <InitStack.Navigator initialRouteName="UnlockWithScreenRoot">
    <InitStack.Screen name="UnlockWithScreenRoot" component={UnlockWithScreenStack} options={{ headerShown: false }} />
    <InitStack.Screen
      name="ReorderWallets"
      component={ReorderWalletsStackScreen}
      options={{ headerShown: false, gestureEnabled: false, presentation: isDesktop ? 'containedModal' : 'modal' }}
    />
    <InitStack.Screen name="Navigation" component={Navigation} options={{ headerShown: false, animationTypeForReplace: 'push' }} />
  </InitStack.Navigator>
);

export default InitRoot;
