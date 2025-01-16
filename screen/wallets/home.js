import React, { useEffect, useState, useContext, useRef, useMemo } from 'react';
import {
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
  AppState,
} from 'react-native';
import { Icon } from 'react-native-elements';
import { useRoute, useNavigation, useTheme } from '@react-navigation/native';
import * as bitcoin from 'bitcoinjs-lib';
import { Chain } from '../../models/bitcoinUnits';
import { BlueListItem, SecondButton } from '../../BlueComponents';
import navigationStyle from '../../components/navigationStyle';
import { MultisigHDWallet, WatchOnlyWallet } from '../../class';
import ActionSheet from '../ActionSheet';
import loc, { formatBalance } from '../../loc';
import { FContainer, FButton } from '../../components/FloatButtons';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import BlueClipboard from '../../blue_modules/clipboard';
import TransactionsNavigationHeader from '../../components/TransactionsNavigationHeader';
import PropTypes from 'prop-types';
import DeeplinkSchemaMatch from '../../class/deeplink-schema-match';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import { LightningLdsWallet } from '../../class/wallets/lightning-lds-wallet';
import BoltCard from '../../class/boltcard';
import { TaprootLdsWallet, TaprootLdsWalletType } from '../../class/wallets/taproot-lds-wallet';
import scanqrHelper from '../../helpers/scan-qr';

const fs = require('../../blue_modules/fs');
const BlueElectrum = require('../../blue_modules/BlueElectrum');

const buttonFontSize =
  PixelRatio.roundToNearestPixel(Dimensions.get('window').width / 26) > 22
    ? 22
    : PixelRatio.roundToNearestPixel(Dimensions.get('window').width / 26);

const dummyTaroWallets = [
  { title: 'USD', subtitle: 'Taro Protocol' },
  { title: 'EUR', subtitle: 'Taro Protocol' },
];

const WalletHome = ({ navigation }) => {
  const { wallets, saveToDisk, setSelectedWallet, isElectrumDisabled, ldsDEV, isPosMode } = useContext(BlueStorageContext);
  const walletID = useMemo(() => wallets[0]?.getID(), [wallets]);
  const multisigWallet = useMemo(() => wallets.find(w => w.type === MultisigHDWallet.type), [wallets]);
  const lnWallet = useMemo(() => wallets.find(w => w.type === LightningLdsWallet.type), [wallets]);
  const [isLoading, setIsLoading] = useState(false);
  const { name } = useRoute();
  const { setParams, navigate } = useNavigation();
  const { colors, scanImage } = useTheme();
  const walletActionButtonsRef = useRef();
  const { width } = useWindowDimensions();
  const balanceRefreshInterval = useRef(null);

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
    comingSoon: {
      color: colors.alternativeTextColor,
    },
  });

  useEffect(() => {
    setIsLoading(true);
    setIsLoading(false);
    setSelectedWallet(wallet.getID());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletID]);

  useEffect(() => {
    const newWallet = wallets.find(w => w.getID() === walletID);
    if (newWallet && totalWallet) {
      setParams({
        walletID,
        showsBackupSeed: !newWallet.getUserHasBackedUpSeed(),
        backupWarning: totalWallet.getBalance() > 0,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallets, walletID, totalWallet]);

  useEffect(() => {
    if (!wallets) return;
    refreshBalances().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallets]);

  const clearBalanceRefreshInterval = () => {
    if (balanceRefreshInterval.current) {
      clearInterval(balanceRefreshInterval.current);
      balanceRefreshInterval.current = null;
    }
  };

  const setBalanceRefreshInterval = () => {
    if (!wallets) return;
    clearBalanceRefreshInterval();
    refreshBalances().catch(console.error);
    balanceRefreshInterval.current = setInterval(() => {
      refreshBalances().catch(console.error);
    }, 20 * 1000);
  };

  useEffect(() => {
    setBalanceRefreshInterval();
    return () => {
      clearBalanceRefreshInterval();
    };
  }, []);

  const appState = useRef(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (appState.current === 'active' && nextAppState.match(/background/)) clearBalanceRefreshInterval();
      if (appState.current.match(/background/) && nextAppState === 'active') setBalanceRefreshInterval();
      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, []);

  /**
   * Forcefully fetches balance for wallets
   */
  const refreshBalances = async () => {
    if (isElectrumDisabled) return setIsLoading(false);
    if (isLoading) return;

    setIsLoading(true);
    let noErr = true;
    let smthChanged = false;
    try {
      // await BlueElectrum.ping();
      await BlueElectrum.waitTillConnected();

      for (const w of wallets) {
        smthChanged ||= await refreshBalance(w);
      }
    } catch (err) {
      noErr = false;
      setIsLoading(false);
    }

    if (noErr && smthChanged) {
      console.log('saving to disk');
      await saveToDisk();
    }

    setIsLoading(false);
  };

  const refreshBalance = async w => {
    try {
      if (!w.getBalance) return false;
      const oldBalance = w.getBalance();
      await w.fetchBalance();
      return oldBalance !== w.getBalance();
    } catch (_) {}
  };

  const navigateToSendScreen = () => {
    navigate('SendDetailsRoot', {
      screen: 'SendDetails',
      params: {
        walletID: wallet.getID(),
      },
    });
  };

  const importPsbt = base64Psbt => {
    try {
      const psbt = bitcoin.Psbt.fromBase64(base64Psbt); // if it doesnt throw - all good, its valid
      if (Boolean(multisigWallet) && multisigWallet.howManySignaturesCanWeMake() > 0) {
        navigation.navigate('SendDetailsRoot', {
          screen: 'PsbtMultisig',
          params: {
            psbtBase64: psbt.toBase64(),
            walletID: multisigWallet.getID(),
          },
        });
      }
    } catch (_) {}
  };

  const onBarScanned = value => {
    if (!value) return;

    if (BoltCard.isPossiblyBoltcardTapDetails(value)) {
      navigate('TappedCardDetails', { tappedCardDetails: value });
      return;
    }

    if (DeeplinkSchemaMatch.isPossiblyPSBTString(value)) {
      importPsbt(value);
      return;
    }

    if (DeeplinkSchemaMatch.isBothBitcoinAndLightning(value)) {
      const uri = DeeplinkSchemaMatch.isBothBitcoinAndLightning(value);
      const walletSelected = lnWallet || wallet;
      const route = DeeplinkSchemaMatch.isBothBitcoinAndLightningOnWalletSelect(walletSelected, uri);
      ReactNativeHapticFeedback.trigger('impactLight', { ignoreAndroidSystemSettings: false });
      navigate(...route);
      return;
    }

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
    return navigate('ScanCodeSendRoot', { screen: 'ScanCodeSend' });
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

  const onReceiveButtonPressed = () => {
    if (multisigWallet) return navigate('ReceiveDetailsRoot', { screen: 'ReceiveDetails', params: { walletID: multisigWallet.getID() } });
    if (lnWallet)
      return navigate('ReceiveDetailsRoot', {
        screen: lnWallet.isPosMode ? 'PosReceive' : 'LNDReceive',
        params: { walletID: lnWallet.getID() },
      });
    return navigate('ReceiveDetailsRoot', { screen: 'ReceiveDetails', params: { walletID: wallet.getID() } });
  };

  const onScanButtonPressed = () => {
    scanqrHelper(navigate, name, false).then(d => onBarScanned(d));
  };

  const navigateToAddMultisig = () => {
    navigate('WalletsRoot', {
      screen: 'WalletsAddMultisig',
      params: {
        walletLabel: loc.multisig.default_label,
      },
    });
  };

  const navigateToAddLightning = () => {
    navigate('WalletsRoot', {
      screen: 'AddLightning',
      params: {
        walletID: wallet.getID(),
      },
    });
  };

  const navigateToAddTaproot = asset => {
    navigate('WalletsRoot', {
      screen: 'AddLightning',
      params: {
        walletID: wallet.getID(),
        asset,
      },
    });
  };

  const displayWallets = useMemo(() => {
    const tmpWallets = [];

    const multisigWallet = wallets.find(w => w.type === MultisigHDWallet.type);
    tmpWallets.push({
      wallet: multisigWallet,
      title: 'Bitcoin',
      isActivated: true,
      subtitle: loc.wallets.multi_sig_wallet_label,
      walletID: multisigWallet?.getID?.(),
      onDummyPress: navigateToAddMultisig,
    });

    const onChainWallet = wallets[0];
    tmpWallets.push({
      wallet: onChainWallet,
      title: 'Bitcoin',
      isActivated: true,
      subtitle: loc.wallets.main_wallet_label,
      walletID: onChainWallet.getID?.(),
    });

    const LnWallet = wallets.find(w => w.type === LightningLdsWallet.type);
    tmpWallets.push({
      wallet: LnWallet,
      title: 'Bitcoin',
      isActivated: true,
      subtitle: loc.wallets.lightning_wallet_label,
      walletID: LnWallet?.getID?.(),
      onDummyPress: navigateToAddLightning,
    });

    const chfTaprootWallet = wallets.find(w => w.type === TaprootLdsWallet.type && w.getCurrencyName() === TaprootLdsWalletType.CHF);
    tmpWallets.push({
      wallet: chfTaprootWallet,
      title: 'CHF',
      isActivated: ldsDEV,
      subtitle: 'Taro Protocol',
      walletID: chfTaprootWallet?.getID?.(),
      onDummyPress: () => navigateToAddTaproot(TaprootLdsWalletType.CHF),
    });

    tmpWallets.push(...dummyTaroWallets);
    return tmpWallets;
  }, [wallets]);

  return (
    <View style={styles.flex}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent animated />
      <TransactionsNavigationHeader
        navigation={navigation}
        wallet={totalWallet}
        width={width}
        showRBFWarning={!wallet.allowRBF()}
        onWalletChange={total =>
          InteractionManager.runAfterInteractions(async () => {
            wallets.forEach(w => {
              w.preferredBalanceUnit = total.preferredBalanceUnit;
              w.hideBalance = total.hideBalance;
            });
            await saveToDisk();
          })
        }
      />
      {/* TODO (david): tiles
      <View style={styles.dfxButtonContainer}>
        <View style={styles.dfxIcons}></View>
      </View> */}

      <View style={[styles.list, stylesHook.list]}>
        {displayWallets.map((item, i) => (
          <TouchableOpacity
            key={i}
            disabled={!item.wallet}
            onPress={() => navigate('WalletsRoot', { screen: 'WalletAsset', params: { walletID: item.wallet?.getID() } })}
          >
            {item.wallet ? (
              <BlueListItem
                title={item.title}
                subtitleNumberOfLines={1}
                subtitle={item.subtitle}
                Component={View}
                rightTitle={formatBalance(item.wallet.getBalance(), item.wallet.getPreferredBalanceUnit(), true).toString()}
                rightTitleStyle={styles.walletBalance}
                chevron
              />
            ) : (
              <BlueListItem
                title={item.title}
                subtitleNumberOfLines={1}
                subtitle={item.subtitle}
                Component={View}
                {...(item.isActivated
                  ? {
                      rightElement: (
                        <SecondButton
                          title={loc._.add}
                          icon={{ name: 'plus', type: 'font-awesome', color: 'white', size: 12 }}
                          onPress={item.onDummyPress}
                        />
                      ),
                    }
                  : {
                      rightTitle: loc.wallets.coming_soon,
                      rightTitleStyle: stylesHook.comingSoon,
                    })}
              />
            )}
          </TouchableOpacity>
        ))}
      </View>
      <FContainer ref={walletActionButtonsRef}>
        {wallet.allowReceive() && (
          <FButton
            testID="ReceiveButton"
            text={loc.receive.header}
            onPress={onReceiveButtonPressed}
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
          icon={
            <View style={styles.scanIconContainer}>
              <Image resizeMode="stretch" source={scanImage} />
              <Image style={{ width: 20, height: 20 }} source={require('../../img/nfc.png')} />
            </View>
          }
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
        style={styles.walletDetails}
        onPress={() => navigation.navigate('Settings')}
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
    headerBackVisible: false,
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
    paddingLeft: 12,
    paddingVertical:12
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
  scanIconContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  }
});
