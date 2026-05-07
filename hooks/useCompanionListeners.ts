import { useCallback, useContext, useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { CommonActions } from '@react-navigation/native';
import {
  clearStoredNotifications,
  getDeliveredNotifications,
  getStoredNotifications,
  initializeNotifications,
  removeAllDeliveredNotifications,
  setApplicationIconBadgeNumber,
} from '../blue_modules/notifications';
import { BlueStorageContext } from '../blue_modules/storage-context';
import { Chain } from '../models/bitcoinUnits';
import * as NavigationService from '../NavigationService';

/**
 * Wires the notifications module to wallet state. Initializes notifications once wallets
 * are ready and processes the stored / delivered notifications queue when the app comes
 * to foreground.
 */
const useCompanionListeners = () => {
  const { wallets, walletsInitialized, fetchAndSaveWalletTransactions, refreshAllWalletTransactions } = useContext(BlueStorageContext);
  const appState = useRef<AppStateStatus>(AppState.currentState);

  const processPushNotifications = useCallback(async (): Promise<boolean> => {
    if (!walletsInitialized) {
      console.log('not processing push notifications because wallets are not initialized');
      return false;
    }

    await new Promise(resolve => setTimeout(resolve, 200));
    try {
      const notifications2process = await getStoredNotifications();
      await clearStoredNotifications();
      setApplicationIconBadgeNumber(0);

      const deliveredNotifications = await getDeliveredNotifications();
      setTimeout(() => {
        try {
          removeAllDeliveredNotifications();
        } catch (error) {
          console.error('Failed to remove delivered notifications:', error);
        }
      }, 5000);

      for (const payload of notifications2process) {
        const wasTapped = payload.foreground === false || (payload.foreground === true && payload.userInteraction);

        console.log('processing push notification:', payload);
        let wallet;
        switch (+payload.type) {
          case 2:
          case 3:
            wallet = wallets.find((w: any) => w.weOwnAddress(payload.address));
            break;
          case 1:
          case 4:
            wallet = wallets.find((w: any) => w.weOwnTransaction(payload.txid || payload.hash));
            break;
        }

        if (wallet) {
          const walletID = wallet.getID();
          fetchAndSaveWalletTransactions(walletID);
          if (wasTapped) {
            if (payload.type !== 3 || wallet.chain === Chain.OFFCHAIN) {
              NavigationService.dispatch(
                CommonActions.navigate({
                  name: 'WalletTransactions',
                  params: {
                    walletID,
                    walletType: wallet.type,
                  },
                }),
              );
            } else {
              NavigationService.navigate('ReceiveDetailsRoot', {
                screen: 'ReceiveDetails',
                params: {
                  walletID,
                  address: payload.address,
                },
              });
            }
            return true;
          }
        } else {
          console.log('could not find wallet while processing push notification, NOP');
        }
      }

      if (deliveredNotifications.length > 0) {
        refreshAllWalletTransactions();
      }
    } catch (error) {
      console.error('Failed to process push notifications:', error);
    }
    return false;
  }, [walletsInitialized, wallets, fetchAndSaveWalletTransactions, refreshAllWalletTransactions]);

  useEffect(() => {
    if (!walletsInitialized) return;

    initializeNotifications(processPushNotifications);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletsInitialized]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', async nextAppState => {
      if (!walletsInitialized || wallets.length === 0) return;
      if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        await processPushNotifications();
      }
      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [processPushNotifications, walletsInitialized, wallets.length]);
};

export default useCompanionListeners;
