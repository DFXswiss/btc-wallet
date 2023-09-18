import React, { useEffect, useState, useContext, useRef, useMemo } from 'react';
import {
  Alert,
  Dimensions,
  InteractionManager,
  PixelRatio,
  Platform,
  Image,
  StatusBar,
  StyleSheet,
  Text,
  findNodeHandle,
  TouchableOpacity,
  View,
  I18nManager,
  useWindowDimensions,
} from 'react-native';
import { Icon } from 'react-native-elements';
import { useRoute, useNavigation, useTheme } from '@react-navigation/native';
import { Chain } from '../../models/bitcoinUnits';
import { BlueAlertWalletExportReminder, BlueListItem, SecondButton } from '../../BlueComponents';
import navigationStyle from '../../components/navigationStyle';
import { LightningCustodianWallet, LightningLdkWallet, MultisigHDWallet, WatchOnlyWallet } from '../../class';
import ActionSheet from '../ActionSheet';
import loc, { formatBalance } from '../../loc';
import { FContainer, FButton } from '../../components/FloatButtons';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import BlueClipboard from '../../blue_modules/clipboard';
import alert from '../../components/Alert';
import TransactionsNavigationHeader, { actionKeys } from '../../components/TransactionsNavigationHeader';
import PropTypes from 'prop-types';
import DeeplinkSchemaMatch from '../../class/deeplink-schema-match';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';

const scanqrHelper = require('../../helpers/scan-qr');
const fs = require('../../blue_modules/fs');
const BlueElectrum = require('../../blue_modules/BlueElectrum');

const buttonFontSize =
  PixelRatio.roundToNearestPixel(Dimensions.get('window').width / 26) > 22
    ? 22
    : PixelRatio.roundToNearestPixel(Dimensions.get('window').width / 26);

const dummyLnWallet = { chain: Chain.OFFCHAIN, isDummy: true };

const WalletHome = ({ navigation }) => {
  const {
    wallets: storedWallets,
    saveToDisk,
    setSelectedWallet,
    refreshAllWalletTransactions,
    walletTransactionUpdateStatus,
    isElectrumDisabled,
  } = useContext(BlueStorageContext);

  const wallets = useMemo(() => (storedWallets.length === 1 ? [...storedWallets, dummyLnWallet] : storedWallets), [storedWallets]);
  const walletID = useMemo(() => wallets[0]?.getID(), [wallets]);
  const [isLoading, setIsLoading] = useState(false);
  const { name } = useRoute();
  const { setParams, setOptions, navigate } = useNavigation();
  const { colors, scanImage } = useTheme();
  const walletActionButtonsRef = useRef();
  const { width } = useWindowDimensions();

  const wallet = useMemo(() => wallets.find(w => w.getID() === walletID), [wallets, walletID]);
  const totalWallet = useMemo(() => {
    const total = new WatchOnlyWallet();
    total.setLabel(loc.wallets.total);
    total.balance = wallets.reduce((prev, curr) => prev + (curr.isDummy ? 0 : curr.getBalance()), 0);
    total.hideBalance = wallet.hideBalance;
    total.preferredBalanceUnit = wallet.preferredBalanceUnit;
    return total;
  }, [wallets, wallet]);

  const stylesHook = StyleSheet.create({
    listHeaderText: {
      color: colors.foregroundColor,
    },
    list: {
      backgroundColor: colors.background,
    },
  });

  useEffect(() => {
    setOptions({ headerTitle: walletTransactionUpdateStatus === walletID ? loc.transactions.updating : '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletTransactionUpdateStatus]);

  useEffect(() => {
    setIsLoading(true);
    setIsLoading(false);
    setSelectedWallet(wallet.getID());
    setOptions({
      headerStyle: {
        backgroundColor: 'transparent',
        borderBottomWidth: 0,
        elevation: 0,
        // shadowRadius: 0,
        shadowOffset: { height: 0, width: 0 },
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletID]);

  useEffect(() => {
    const newWallet = wallets.find(w => w.getID() === walletID);
    if (newWallet) {
      setParams({
        walletID,
        isLoading: false,
        showsBackupSeed: !newWallet.getUserHasBackedUpSeed(),
        backupWarning: newWallet.getBalance() > 0,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallets, walletID]);

  useEffect(() => {
    if (!wallet) return;
    refreshAllWalletTransactions()
      .then(() => refreshTransactions())
      .catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet]);

  /**
   * Forcefully fetches TXs and balance for wallet
   */
  const refreshTransactions = async () => {
    if (isElectrumDisabled) return setIsLoading(false);
    if (isLoading) return;
    setIsLoading(true);
    let noErr = true;
    let smthChanged = false;
    try {
      // await BlueElectrum.ping();
      await BlueElectrum.waitTillConnected();
      if (wallet.allowBIP47() && wallet.isBIP47Enabled()) {
        const pcStart = +new Date();
        await wallet.fetchBIP47SenderPaymentCodes();
        const pcEnd = +new Date();
        console.log(wallet.getLabel(), 'fetch payment codes took', (pcEnd - pcStart) / 1000, 'sec');
      }
      const balanceStart = +new Date();
      const oldBalance = wallet.getBalance();
      await wallet.fetchBalance();
      if (oldBalance !== wallet.getBalance()) smthChanged = true;
      const balanceEnd = +new Date();
      console.log(wallet.getLabel(), 'fetch balance took', (balanceEnd - balanceStart) / 1000, 'sec');
      const start = +new Date();
      const oldTxLen = wallet.getTransactions().length;
      await wallet.fetchTransactions();
      if (wallet.fetchPendingTransactions) {
        await wallet.fetchPendingTransactions();
      }
      if (wallet.fetchUserInvoices) {
        await wallet.fetchUserInvoices();
      }
      if (oldTxLen !== wallet.getTransactions().length) smthChanged = true;
      const end = +new Date();
      console.log(wallet.getLabel(), 'fetch tx took', (end - start) / 1000, 'sec');
    } catch (err) {
      noErr = false;
      alert(err.message);
      setIsLoading(false);
    }
    if (noErr && smthChanged) {
      console.log('saving to disk');
      await saveToDisk(); // caching
      //    setDataSource([...getTransactionsSliced(limit)]);
    }
    setIsLoading(false);
  };

  const onWalletSelect = async selectedWallet => {
    if (selectedWallet) {
      navigate('WalletTransactions', {
        walletType: wallet.type,
        walletID: wallet.getID(),
        key: `WalletTransactions-${wallet.getID()}`,
      });
      /** @type {LightningCustodianWallet} */
      let toAddress = false;
      if (wallet.refill_addressess.length > 0) {
        toAddress = wallet.refill_addressess[0];
      } else {
        try {
          await wallet.fetchBtcAddress();
          toAddress = wallet.refill_addressess[0];
        } catch (Err) {
          return alert(Err.message);
        }
      }
      navigate('SendDetailsRoot', {
        screen: 'SendDetails',
        params: {
          memo: loc.lnd.refill_lnd_balance,
          address: toAddress,
          walletID: selectedWallet.getID(),
        },
      });
    }
  };

  const navigateToSendScreen = () => {
    navigate('SendDetailsRoot', {
      screen: 'SendDetails',
      params: {
        walletID: wallet.getID(),
      },
    });
  };

  const onBarScanned = value => {
    if (!value) return;
    DeeplinkSchemaMatch.navigationRouteFor({ url: value }, completionValue => {
      ReactNativeHapticFeedback.trigger('impactLight', { ignoreAndroidSystemSettings: false });
      navigate(...completionValue);
    });
  };

  const choosePhoto = () => {
    fs.showImagePickerAndReadImage().then(onBarScanned);
  };

  const copyFromClipboard = async () => {
    onBarScanned(await BlueClipboard().getClipboardContent());
  };

  const sendButtonPress = () => {
    if (wallet.chain === Chain.OFFCHAIN) {
      return navigate('ScanLndInvoiceRoot', { screen: 'ScanLndInvoice', params: { walletID: wallet.getID() } });
    }

    if (wallet.type === WatchOnlyWallet.type && wallet.isHd() && !wallet.useWithHardwareWalletEnabled()) {
      return Alert.alert(
        loc.wallets.details_title,
        loc.transactions.enable_offline_signing,
        [
          {
            text: loc._.ok,
            onPress: async () => {
              wallet.setUseWithHardwareWalletEnabled(true);
              await saveToDisk();
              navigateToSendScreen();
            },
            style: 'default',
          },

          { text: loc._.cancel, onPress: () => {}, style: 'cancel' },
        ],
        { cancelable: false },
      );
    }

    navigateToSendScreen();
  };

  const sendButtonLongPress = async () => {
    const isClipboardEmpty = (await BlueClipboard().getClipboardContent()).trim().length === 0;
    if (Platform.OS === 'ios') {
      const options = [loc._.cancel, loc.wallets.list_long_choose, loc.wallets.list_long_scan];
      if (!isClipboardEmpty) {
        options.push(loc.wallets.list_long_clipboard);
      }
      ActionSheet.showActionSheetWithOptions(
        { options, cancelButtonIndex: 0, anchor: findNodeHandle(walletActionButtonsRef.current) },
        buttonIndex => {
          if (buttonIndex === 1) {
            choosePhoto();
          } else if (buttonIndex === 2) {
            navigate('ScanQRCodeRoot', {
              screen: 'ScanQRCode',
              params: {
                launchedBy: name,
                onBarScanned,
                showFileImportButton: false,
              },
            });
          } else if (buttonIndex === 3) {
            copyFromClipboard();
          }
        },
      );
    } else if (Platform.OS === 'android') {
      const buttons = [
        {
          text: loc._.cancel,
          onPress: () => {},
          style: 'cancel',
        },
        {
          text: loc.wallets.list_long_choose,
          onPress: choosePhoto,
        },
        {
          text: loc.wallets.list_long_scan,
          onPress: () =>
            navigate('ScanQRCodeRoot', {
              screen: 'ScanQRCode',
              params: {
                launchedBy: name,
                onBarScanned,
                showFileImportButton: false,
              },
            }),
        },
      ];
      if (!isClipboardEmpty) {
        buttons.push({
          text: loc.wallets.list_long_clipboard,
          onPress: copyFromClipboard,
        });
      }
      ActionSheet.showActionSheetWithOptions({
        title: '',
        message: '',
        buttons,
      });
    }
  };

  const onScanButtonPressed = () => {
    scanqrHelper(navigate, name, false).then(d => onBarScanned(d));
  };

  const navigateToViewEditCosigners = () => {
    navigate('ViewEditMultisigCosignersRoot', {
      screen: 'ViewEditMultisigCosigners',
      params: {
        walletId: wallet.getID(),
      },
    });
  };

  const onManageFundsPressed = ({ id }) => {
    if (id === actionKeys.Refill) {
      const availableWallets = [...wallets.filter(item => item.chain === Chain.ONCHAIN && item.allowSend())];
      if (availableWallets.length === 0) {
        alert(loc.lnd.refill_create);
      } else {
        navigate('SelectWallet', { onWalletSelect, chainType: Chain.ONCHAIN });
      }
    } else if (id === actionKeys.RefillWithExternalWallet) {
      if (wallet.getUserHasSavedExport()) {
        navigate('ReceiveDetailsRoot', {
          screen: 'ReceiveDetails',
          params: {
            walletID: wallet.getID(),
          },
        });
      }
    }
  };

  return (
    <View style={styles.flex}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent animated />
      <TransactionsNavigationHeader
        navigation={navigation}
        wallet={totalWallet}
        width={width}
        onWalletChange={total =>
          InteractionManager.runAfterInteractions(async () => {
            wallets.forEach(w => {
              w.preferredBalanceUnit = total.preferredBalanceUnit;
              w.hideBalance = total.hideBalance;
            });
            saveToDisk();
          })
        }
        onManageFundsPressed={id => {
          if (wallet.type === MultisigHDWallet.type) {
            navigateToViewEditCosigners();
          } else if (wallet.type === LightningLdkWallet.type) {
            navigate('LdkInfo', { walletID: wallet.getID() });
          } else if (wallet.type === LightningCustodianWallet.type) {
            if (wallet.getUserHasSavedExport()) {
              onManageFundsPressed({ id });
            } else {
              BlueAlertWalletExportReminder({
                onSuccess: async () => {
                  wallet.setUserHasSavedExport(true);
                  await saveToDisk();
                  onManageFundsPressed({ id });
                },
                onFailure: () =>
                  navigate('WalletExportRoot', {
                    screen: 'WalletExport',
                    params: {
                      walletID: wallet.getID(),
                    },
                  }),
              });
            }
          }
        }}
      />
      {/* TODO (david): tiles
      <View style={styles.dfxButtonContainer}>
        <View style={styles.dfxIcons}></View>
      </View> */}

      <View style={[styles.list, stylesHook.list]}>
        {wallets.map((w, i) => (
          <TouchableOpacity
            key={i}
            disabled={w.isDummy}
            onPress={() => navigate('WalletsRoot', { screen: 'WalletAsset', params: { walletID: w.getID() } })}
          >
            <BlueListItem
              title="Bitcoin"
              subtitleNumberOfLines={1}
              subtitle={w.chain === Chain.ONCHAIN ? 'On-chain' : 'Lightning'}
              Component={View}
              {...(!w.isDummy
                ? w.hideBalance
                  ? {
                      chevron: true,
                      rightElement: <Icon name="eye-slash" type="font-awesome" color="#FFFFFF" />,
                    }
                  : {
                      chevron: true,
                      rightTitle: formatBalance(w.getBalance(), w.getPreferredBalanceUnit(), true).toString(),
                      rightTitleStyle: styles.walletBalance,
                    }
                : {
                    rightElement: (
                      <SecondButton
                        title="Add"
                        onPress={() => navigate('WalletsRoot', { screen: 'AddLightning', params: { walletID: wallet.getID() } })}
                      />
                    ),
                  })}
            />
          </TouchableOpacity>
        ))}
      </View>
      <FContainer ref={walletActionButtonsRef}>
        {wallet.allowReceive() && (
          <FButton
            testID="ReceiveButton"
            text={loc.receive.header}
            onPress={() => {
              if (wallet.chain === Chain.OFFCHAIN) {
                navigate('LNDCreateInvoiceRoot', { screen: 'LNDCreateInvoice', params: { walletID: wallet.getID() } });
              } else {
                navigate('ReceiveDetailsRoot', { screen: 'ReceiveDetails', params: { walletID: wallet.getID() } });
              }
            }}
            icon={
              <View style={styles.receiveIcon}>
                <Icon name="arrow-down" size={buttonFontSize} type="font-awesome" color={colors.buttonAlternativeTextColor} />
              </View>
            }
          />
        )}
        <FButton
          onPress={onScanButtonPressed}
          onLongPress={sendButtonLongPress}
          icon={<Image resizeMode="stretch" source={scanImage} />}
          text={loc.send.details_scan}
        />
        {(wallet.allowSend() || (wallet.type === WatchOnlyWallet.type && wallet.isHd())) && (
          <FButton
            onLongPress={sendButtonLongPress}
            onPress={sendButtonPress}
            text={loc.send.header}
            testID="SendButton"
            icon={
              <View style={styles.sendIcon}>
                <Icon name="arrow-down" size={buttonFontSize} type="font-awesome" color={colors.buttonAlternativeTextColor} />
              </View>
            }
          />
        )}
      </FContainer>
    </View>
  );
};

export default WalletHome;

WalletHome.navigationOptions = navigationStyle({}, (options, { theme, navigation, route }) => {
  const stylesHook = StyleSheet.create({
    backupSeed: {
      height: 34,
      padding: 8,
      borderRadius: 8,
      backgroundColor: route?.params?.backupWarning ? '#FFF389' : theme.colors.buttonBackgroundColor,
    },
    backupSeedText: {
      marginLeft: 4,
      color: route?.params?.backupWarning ? '#072440' : theme.colors.buttonAlternativeTextColor,
      fontWeight: '600',
      fontSize: 14,
    },
  });

  return {
    headerLeft: () =>
      route?.params?.showsBackupSeed ? (
        <TouchableOpacity
          accessibilityRole="button"
          testID="backupSeed"
          style={stylesHook.backupSeed}
          onPress={() => {
            navigation.navigate('BackupSeedRoot', { screenName: 'BackupExplanation' });
          }}
        >
          <View style={styles.backupSeedContainer}>
            {route?.params?.backupWarning && <Icon name="warning-outline" type="ionicon" size={18} color="#072440" />}
            <Text style={stylesHook.backupSeedText}>
              {route?.params?.backupWarning ? loc.wallets.backupSeedWarning : loc.wallets.backupSeed}
            </Text>
          </View>
        </TouchableOpacity>
      ) : null,
    headerRight: () => (
      <TouchableOpacity
        accessibilityRole="button"
        testID="Settings"
        disabled={(route?.params?.isLoading ?? true) === true}
        style={styles.walletDetails}
        onPress={() =>
          route?.params?.walletID &&
          navigation.navigate('Settings', {
            walletID: route?.params?.walletID,
          })
        }
      >
        <Icon name="more-horiz" type="material" size={22} color="#FFFFFF" />
      </TouchableOpacity>
    ),
    title: '',
    headerStyle: {
      backgroundColor: 'transparent',
      borderBottomWidth: 0,
      elevation: 0,
      // shadowRadius: 0,
      shadowOffset: { height: 0, width: 0 },
    },
    headerTintColor: '#FFFFFF',
    headerBackTitleVisible: false,
    headerHideBackButton: true,
    gestureEnabled: false,
  };
});

WalletHome.propTypes = {
  navigation: PropTypes.shape(),
};

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  walletDetails: {
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  backupSeedContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  list: {
    flex: 1,
  },
  walletBalance: {
    color: 'white',
  },
  sendIcon: {
    transform: [{ rotate: I18nManager.isRTL ? '-225deg' : '225deg' }],
  },
  receiveIcon: {
    transform: [{ rotate: I18nManager.isRTL ? '45deg' : '-45deg' }],
  },
});
