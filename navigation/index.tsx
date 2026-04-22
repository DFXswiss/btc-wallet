import React, { lazy, useContext } from 'react';
import { createNativeStackNavigator, NativeStackNavigationOptions } from '@react-navigation/native-stack';

import { isDesktop } from '../blue_modules/environment';
import { BlueStorageContext } from '../blue_modules/storage-context';
import SelectWallet from '../screen/wallets/selectWallet';

import { withLazySuspense } from './LazyLoadingIndicator';
import { InitStackParamList, RootStackParamList } from './types';

// Lazy-load every stack root. UnlockWithScreen stays eager: it's the very first
// screen shown on cold start, so deferring it would only add overhead.
import UnlockWithScreenStack from './UnlockWithScreenStack';

const LazyReorderWalletsStack = lazy(() => import('./ReorderWalletsStack'));
const LazyWalletsStack = lazy(() => import('./WalletsStack'));
const LazyBackupSeedStack = lazy(() => import('./BackupSeedStack'));
const LazyAddWalletStack = lazy(() => import('./AddWalletStack'));
const LazySendDetailsStack = lazy(() => import('./SendDetailsStack'));
const LazyAztecoRedeemStack = lazy(() => import('./AztecoRedeemStack'));
const LazyWalletExportStack = lazy(() => import('./WalletExportStack'));
const LazyExportMultisigCoordinationSetupStack = lazy(() => import('./ExportMultisigCoordinationSetupStack'));
const LazyViewEditMultisigCosignersStack = lazy(() => import('./ViewEditMultisigCosignersStack'));
const LazyWalletXpubStack = lazy(() => import('./WalletXpubStack'));
const LazySignVerifyStack = lazy(() => import('./SignVerifyStack'));
const LazyReceiveDetailsStack = lazy(() => import('./ReceiveDetailsStack'));
const LazyLappBrowserStack = lazy(() => import('./LappBrowserStack'));
const LazyScanQRCodeStack = lazy(() => import('./ScanQRCodeStack'));
const LazyScanCodeSendStack = lazy(() => import('./ScanCodeSendStack'));
const LazyDeeplinkStack = lazy(() => import('./DeeplinkStack'));
const LazyPaymentCodeStack = lazy(() => import('./PaymentCodeStack'));

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
      <RootStack.Screen name="WalletsRoot" component={withLazySuspense(LazyWalletsStack)} options={{ headerShown: false }} />
      <RootStack.Screen name="BackupSeedRoot" component={withLazySuspense(LazyBackupSeedStack)} options={NavigationDefaultOptions} />
      <RootStack.Screen name="AddWalletRoot" component={withLazySuspense(LazyAddWalletStack)} options={{ headerShown: false }} />
      <RootStack.Screen name="SendDetailsRoot" component={withLazySuspense(LazySendDetailsStack)} options={NavigationDefaultOptions} />
      <RootStack.Screen name="AztecoRedeemRoot" component={withLazySuspense(LazyAztecoRedeemStack)} options={NavigationDefaultOptions} />
      <RootStack.Screen name="WalletExportRoot" component={withLazySuspense(LazyWalletExportStack)} options={NavigationDefaultOptions} />
      <RootStack.Screen
        name="ExportMultisigCoordinationSetupRoot"
        component={withLazySuspense(LazyExportMultisigCoordinationSetupStack)}
        options={NavigationDefaultOptions}
      />
      <RootStack.Screen
        name="ViewEditMultisigCosignersRoot"
        component={withLazySuspense(LazyViewEditMultisigCosignersStack)}
        options={NavigationDefaultOptions}
      />
      <RootStack.Screen name="WalletXpubRoot" component={withLazySuspense(LazyWalletXpubStack)} options={NavigationDefaultOptions} />
      <RootStack.Screen name="SignVerifyRoot" component={withLazySuspense(LazySignVerifyStack)} options={NavigationDefaultOptions} />
      <RootStack.Screen name="SelectWallet" component={SelectWallet} />
      <RootStack.Screen
        name="ReceiveDetailsRoot"
        component={withLazySuspense(LazyReceiveDetailsStack)}
        options={NavigationDefaultOptions}
      />
      <RootStack.Screen name="LappBrowserRoot" component={withLazySuspense(LazyLappBrowserStack)} options={NavigationDefaultOptions} />
      <RootStack.Screen
        name="ScanQRCodeRoot"
        component={withLazySuspense(LazyScanQRCodeStack)}
        options={{
          headerShown: false,
          presentation: isDesktop ? 'containedModal' : 'fullScreenModal',
        }}
      />
      <RootStack.Screen
        name="ScanCodeSendRoot"
        component={withLazySuspense(LazyScanCodeSendStack)}
        options={{ headerShown: false }}
      />
      <RootStack.Screen name="DeeplinkRoot" component={withLazySuspense(LazyDeeplinkStack)} options={NavigationDefaultOptions} />
      <RootStack.Screen name="PaymentCodeRoot" component={withLazySuspense(LazyPaymentCodeStack)} options={NavigationDefaultOptions} />
    </RootStack.Navigator>
  );
};

const InitStack = createNativeStackNavigator<InitStackParamList>();

const InitRoot = () => (
  <InitStack.Navigator initialRouteName="UnlockWithScreenRoot">
    <InitStack.Screen name="UnlockWithScreenRoot" component={UnlockWithScreenStack} options={{ headerShown: false }} />
    <InitStack.Screen
      name="ReorderWallets"
      component={withLazySuspense(LazyReorderWalletsStack)}
      options={{ headerShown: false, gestureEnabled: false, presentation: isDesktop ? 'containedModal' : 'modal' }}
    />
    <InitStack.Screen name="Navigation" component={Navigation} options={{ headerShown: false, animationTypeForReplace: 'push' }} />
  </InitStack.Navigator>
);

export default InitRoot;
