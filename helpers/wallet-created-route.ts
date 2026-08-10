import type { NavigatorScreenParams } from '@react-navigation/native';
import type { WalletsStackParamList } from '../navigation/types';

/**
 * Route the app lands on once the first wallet has been created or imported.
 *
 * The onboarding used to replace the stack with the LNDHub screen
 * ("AddLightning"), so setting up the app always ended on the Lightning
 * provider selection. The Lightning wallet is opt-in now: it is only reached by
 * pressing "add" on the Lightning row of the home screen (screen/wallets/home.js).
 *
 * Returned as [routeName, params] so it can be spread into StackActions.replace().
 */
export const walletCreatedRoute = (): ['WalletsRoot', NavigatorScreenParams<WalletsStackParamList>] => [
  'WalletsRoot',
  { screen: 'WalletTransactions' },
];
