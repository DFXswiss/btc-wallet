import React, { useEffect, useState, useCallback, useContext, useRef, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  InteractionManager,
  PixelRatio,
  Platform,
  Image,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  findNodeHandle,
  View,
  I18nManager,
  useWindowDimensions,
  TouchableOpacity,
  AppState,
} from 'react-native';
import { Icon } from 'react-native-elements';
import { useRoute, useNavigation, useTheme, useFocusEffect } from '@react-navigation/native';
import { Chain } from '../../models/bitcoinUnits';
import { BlueText } from '../../BlueComponents';
import navigationStyle from '../../components/navigationStyle';
import { MultisigHDWallet, WatchOnlyWallet } from '../../class';
import ActionSheet from '../ActionSheet';
import loc from '../../loc';
import { FContainer, FButton } from '../../components/FloatButtons';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import { isDesktop } from '../../blue_modules/environment';
import BlueClipboard from '../../blue_modules/clipboard';
import { TransactionListItem } from '../../components/TransactionListItem';
import { ImageButton } from '../../components/ImageButton';
import { DfxService, useDfxSessionContext } from '../../api/dfx/contexts/session.context';
import BigNumber from 'bignumber.js';
import TransactionsNavigationHeader from '../../components/TransactionsNavigationHeader';
import PropTypes from 'prop-types';
import DeeplinkSchemaMatch from '../../class/deeplink-schema-match';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import Config from 'react-native-config';

import BuyEn from '../../img/dfx/buttons/buy_en.png';
import SellEn from '../../img/dfx/buttons/sell_en.png';
import BuyDe from '../../img/dfx/buttons/buy_de.png';
import SellDe from '../../img/dfx/buttons/sell_de.png';
import BuyFr from '../../img/dfx/buttons/buy_fr.png';
import SellFr from '../../img/dfx/buttons/sell_fr.png';
import BuyIt from '../../img/dfx/buttons/buy_it.png';
import SellIt from '../../img/dfx/buttons/sell_it.png';
import SwapEn from '../../img/dfx/buttons/swap.png';
import NetworkTransactionFees, { NetworkTransactionFee } from '../../models/networkTransactionFees';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AbstractHDElectrumWallet } from '../../class/wallets/abstract-hd-electrum-wallet';
import { LightningLdsWallet } from '../../class/wallets/lightning-lds-wallet';
import BoltCard from '../../class/boltcard';
import scanqrHelper from '../../helpers/scan-qr';

const fs = require('../../blue_modules/fs');
const BlueElectrum = require('../../blue_modules/BlueElectrum');
const currency = require('../../blue_modules/currency');

const buttonFontSize =
  PixelRatio.roundToNearestPixel(Dimensions.get('window').width / 26) > 22
    ? 22
    : PixelRatio.roundToNearestPixel(Dimensions.get('window').width / 26);

const Asset = ({ navigation }) => {
  const {
    wallets,
    saveToDisk,
    setSelectedWallet,
    refreshAllWalletTransactions,
    walletTransactionUpdateStatus,
    isElectrumDisabled,
    isDfxPos,
    isDfxSwap,
  } = useContext(BlueStorageContext);
  const { name, params } = useRoute();
  const walletID = params.walletID;
  const [isLoading, setIsLoading] = useState(false);
  const multisigWallet = useMemo(() => wallets.find(w => w.type === MultisigHDWallet.type), [wallets]);
  const wallet = useMemo(() => wallets.find(w => w.getID() === walletID), [wallets, walletID]);
  const [itemPriceUnit, setItemPriceUnit] = useState(wallet.getPreferredBalanceUnit());
  const [dataSource, setDataSource] = useState(wallet.getTransactions(15));
  const [timeElapsed, setTimeElapsed] = useState(0);
  const [limit, setLimit] = useState(15);
  const [pageSize, setPageSize] = useState(20);
  const { setParams, setOptions, navigate } = useNavigation();
  const { colors, scanImage } = useTheme();
  const walletActionButtonsRef = useRef();
  const { isAvailable: isDfxAvailable, openServices, isProcessing: isDfxProcessing } = useDfxSessionContext();
  const { width } = useWindowDimensions();
  const [isHandlingOpenServices, setIsHandlingOpenServices] = useState(false);
  const [changeAddress, setChangeAddress] = useState('');
  const [fContainerHeight, setFContainerHeight] = useState(0);
  const txRefreshInterval = useRef(null);
  const elapsedTimeInterval = useRef(null);

  const getButtonImages = lang => {
    switch (lang) {
      case 'en':
        return [BuyEn, SellEn, SwapEn];
      case 'de_de':
        return [BuyDe, SellDe, SwapEn];
      case 'fr_fr':
        return [BuyFr, SellFr, SwapEn];
      case 'it':
        return [BuyIt, SellIt, SwapEn];
      default:
        return [BuyEn, SellEn, SwapEn];
    }
  };

  const language = loc.getLanguage()?.toLowerCase();
  const buttonImages = useMemo(() => getButtonImages(language), [language]);

  const stylesHook = StyleSheet.create({
    listHeaderText: {
      color: colors.foregroundColor,
    },
    list: {
      backgroundColor: colors.background,
    },
    dfxContainer: {
      backgroundColor: '#0A345A',
      alignItems: 'center',
      height: 110,
    },
    dfxButtonContainer: {
      flexGrow: 1,
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      marginVertical: 10,
      gap: 10,
    },
  });

  /**
   * Simple wrapper for `wallet.getTransactions()`, where `wallet` is current wallet.
   * Sorts. Provides limiting.
   *
   * @param lmt {Integer} How many txs return, starting from the earliest. Default: all of them.
   * @returns {Array}
   */
  const getTransactionsSliced = (lmt = Infinity) => {
    let txs = wallet.getTransactions();
    for (const tx of txs) {
      tx.sort_ts = +new Date(tx.received);
    }
    txs = txs.sort(function (a, b) {
      return b.sort_ts - a.sort_ts;
    });

    return txs.slice(0, lmt);
  };

  const clearElapsedTimeInterval = () => {
    if (elapsedTimeInterval.current) {
      clearInterval(elapsedTimeInterval.current);
      elapsedTimeInterval.current = null;
    }
  };

  const setElapsedTimeInterval = () => {
    clearElapsedTimeInterval();
    elapsedTimeInterval.current = setInterval(() => setTimeElapsed(prev => prev + 1), 60000);
  };

  useEffect(() => {
    setElapsedTimeInterval();
    return () => {
      clearElapsedTimeInterval();
    };
  }, []);

  useEffect(() => {
    if (walletActionButtonsRef.current && Platform.OS === 'android') {
      walletActionButtonsRef.current.measure((x, y, width, height) => {
        setFContainerHeight(height);
      });
    }
  }, []);

  const clearTxRefreshInterval = () => {
    if (txRefreshInterval.current) {
      clearInterval(txRefreshInterval.current);
      txRefreshInterval.current = null;
    }
  };

  const setTxRefreshInterval = () => {
    clearTxRefreshInterval();
    refreshTransactions();
    txRefreshInterval.current = setInterval(() => {
      refreshTransactions();
    }, 20 * 1000);
  };

  useEffect(() => {
    setTxRefreshInterval();
    return () => {
      clearTxRefreshInterval();
    };
  }, []);

  const appState = useRef(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (appState.current === 'active' && nextAppState.match(/background/)) {
        clearTxRefreshInterval();
        clearElapsedTimeInterval();
      }

      if (appState.current.match(/background/) && nextAppState === 'active') {
        setTxRefreshInterval();
        setElapsedTimeInterval();
      }

      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    setOptions({ headerTitle: walletTransactionUpdateStatus === walletID ? loc.transactions.updating : '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletTransactionUpdateStatus]);

  useEffect(() => {
    setIsLoading(true);
    setLimit(15);
    setPageSize(20);
    setTimeElapsed(0);
    setItemPriceUnit(wallet.getPreferredBalanceUnit());
    setIsLoading(false);
    setSelectedWallet(wallet.getID());
    setDataSource(wallet.getTransactions(15));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletID]);

  useEffect(() => {
    const newWallet = wallets.find(w => w.getID() === walletID);
    if (newWallet) {
      setParams({
        walletID,
        isLoading: false,
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

  useEffect(() => {
    setDataSource([...getTransactionsSliced(limit)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallets]);

  const getChangeAddressAsync = async wallet => {
    if (changeAddress) return changeAddress; // cache

    let change;
    if (WatchOnlyWallet.type === wallet.type && !wallet.isHd()) {
      // plain watchonly - just get the address
      change = wallet.getAddress();
    } else {
      // otherwise, lets call widely-used getChangeAddressAsync()
      try {
        change = await Promise.race([sleep(2000), wallet.getChangeAddressAsync()]);
      } catch (_) {}

      if (!change) {
        // either sleep expired or getChangeAddressAsync threw an exception
        if (wallet instanceof AbstractHDElectrumWallet) {
          change = wallet._getInternalAddressByIndex(wallet.getNextFreeChangeAddressIndex());
        } else {
          // legacy wallets
          change = wallet.getAddress();
        }
      }
    }
    if (change) setChangeAddress(change); // cache
    return change;
  };

  const getEstimatedOnChainFee = async () => {
    const lutxo = wallet.getUtxo();
    const changeAddress = await getChangeAddressAsync(wallet);
    const dustTarget = [{ address: '36JxaUrpDzkEerkTf1FzwHNE1Hb7cCjgJV' }];
    const networkTransactionFees = await NetworkTransactionFees.recommendedFees();
    await AsyncStorage.setItem(NetworkTransactionFee.StorageKey, JSON.stringify(networkTransactionFees));
    // dummy transaction, not to be broadcasted
    const { fee } = wallet.createTransaction(lutxo, dustTarget, Number(networkTransactionFees.fastestFee), changeAddress, false);
    return fee;
  };

  const getBalanceByDfxService = async service => {
    const balance = wallet.getBalance();
    if (service === DfxService.SELL || service === DfxService.SWAP) {
      try {
        const fee = wallet.chain === Chain.ONCHAIN ? await getEstimatedOnChainFee() : balance * 0.03; // max 3% fee for LNBits
        return balance - fee;
      } catch (_) {
        return 0;
      }
    }
    return balance;
  };

  const handleOpenServices = async service => {
    setIsHandlingOpenServices(true);
    try {
      const maxBalance = await getBalanceByDfxService(service);
      openServices(walletID, new BigNumber(currency.satoshiToBTC(maxBalance)).toString(), service);
    } catch (e) {
      Alert.alert('Something went wrong', e.message?.toString(), [
        {
          text: loc._.ok,
          onPress: () => {},
          style: 'default',
        },
      ]);
    }
    setIsHandlingOpenServices(false);
  };

  const handleOpenDfxPosMode = async () => {
    navigate('ReceiveDetailsRoot', {
      screen: 'CashierDfxPos',
      params: { walletID: wallet.getID() },
    });
  };

  // if description of transaction has been changed we want to show new one
  useFocusEffect(
    useCallback(() => {
      setTimeElapsed(prev => prev + 1);
    }, []),
  );

  const isLightning = () => {
    const w = wallet;
    if (w && w.chain === Chain.OFFCHAIN) {
      return true;
    }

    return false;
  };

  const isLightningTestnet = () => {
    return isLightning() && wallet?.getBaseURI()?.startsWith(Config.REACT_APP_LDS_DEV_URL);
  };

  const isMultiSig = () => wallet.type === MultisigHDWallet.type;

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
      setIsLoading(false);
      setTimeElapsed(prev => prev + 1);
    }

    if (noErr && smthChanged) {
      console.log('saving to disk');
      await saveToDisk(); // caching
    }
    setIsLoading(false);
    setTimeElapsed(prev => prev + 1);
  };

  const _keyExtractor = (_item, index) => index.toString();

  const renderListFooterComponent = () => {
    // if not all txs rendered - display indicator
    return (
      (getTransactionsSliced(Infinity).length > limit && <ActivityIndicator style={styles.activityIndicator} />) || (
        <View style={{ height: 2 * fContainerHeight }} />
      )
    );
  };

  const renderListHeaderComponent = () => {
    const style = {};
    if (!isDesktop) {
      // we need this button for testing
      style.opacity = 0;
      style.height = 1;
      style.width = 1;
    } else if (isLoading) {
      style.opacity = 0.5;
    } else {
      style.opacity = 1.0;
    }

    return (
      <View style={styles.flex}>
        <View style={styles.listHeaderTextRow}>
          <Text style={[styles.listHeaderText, stylesHook.listHeaderText]}>{loc.transactions.list_title}</Text>
        </View>
      </View>
    );
  };

  const renderItem = item => (
    <TransactionListItem item={item.item} itemPriceUnit={itemPriceUnit} timeElapsed={timeElapsed} walletID={walletID} />
  );

  const importPsbt = base64Psbt => {
    try {
      if (Boolean(multisigWallet) && multisigWallet.howManySignaturesCanWeMake()) {
        navigation.navigate('SendDetailsRoot', {
          screen: 'PsbtMultisig',
          params: {
            psbtBase64: base64Psbt,
            walletID: multisigWallet.getID(),
          },
        });
      }
    } catch (_) {}
  };
  const onBarCodeRead = value => {
    if (!value || isLoading) return;

    setIsLoading(true);

    if (BoltCard.isPossiblyBoltcardTapDetails(value)) {
      navigate('TappedCardDetails', { tappedCardDetails: value });
    } else if (DeeplinkSchemaMatch.isPossiblyPSBTString(value)) {
      importPsbt(value);
    } else if (DeeplinkSchemaMatch.isBothBitcoinAndLightning(value)) {
      const uri = DeeplinkSchemaMatch.isBothBitcoinAndLightning(value);
      const route = DeeplinkSchemaMatch.isBothBitcoinAndLightningOnWalletSelect(wallet, uri);
      ReactNativeHapticFeedback.trigger('impactLight', { ignoreAndroidSystemSettings: false });
      navigate(...route);
    } else {
      DeeplinkSchemaMatch.navigationRouteFor(
        { url: value },
        completionValue => {
          ReactNativeHapticFeedback.trigger('impactLight', { ignoreAndroidSystemSettings: false });
          navigate(...completionValue);
        },
        { walletID, wallets },
      );
    }
    setIsLoading(false);
  };

  const choosePhoto = () => {
    fs.showImagePickerAndReadImage().then(onBarCodeRead);
  };

  const copyFromClipboard = async () => {
    onBarCodeRead(await BlueClipboard().getClipboardContent());
  };

  const receiveButtonPress = () => {
    if (wallet.chain === Chain.OFFCHAIN) {
      navigate('ReceiveDetailsRoot', {
        screen: wallet.isPosMode ? 'PosReceive' : 'LNDReceive',
        params: { walletID: wallet.getID() },
      });
    } else {
      navigate('ReceiveDetailsRoot', { screen: 'ReceiveDetails', params: { walletID: wallet.getID() } });
    }
  };

  const sendButtonPress = () => {
    return navigate('ScanCodeSendRoot', { screen: 'ScanCodeSend', params: { walletID: wallet.getID() } });
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
                onBarScanned: onBarCodeRead,
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
                onBarScanned: onBarCodeRead,
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
    const navigateBackHere = () => navigate(name, params);
    scanqrHelper(navigate, navigateBackHere, false).then(d => onBarCodeRead(d));
  };

  const getItemLayout = (_, index) => ({
    length: 64,
    offset: 64 * index,
    index,
  });

  const handleGoToBoltCard = () => {
    return wallet.getBoltcards().length > 0 ? navigate('BoltCardDetails') : navigate('AddBoltcard');
  };

  const renderRightHeaderComponent = () => {
    switch (wallet.type) {
      case LightningLdsWallet.type:
        return (
          <TouchableOpacity onPress={handleGoToBoltCard} style={styles.boltcardButton}>
            <Image source={require('../../img/pay-card-link.png')} style={{ width: 1.3 * 30, height: 30 }} />
            <Text style={stylesHook.listHeaderText}>{loc.boltcard.pay_card}</Text>
          </TouchableOpacity>
        );

      default:
        return null;
    }
  };

  return (
    <View style={styles.flex}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent animated />
      <TransactionsNavigationHeader
        navigation={navigation}
        wallet={wallet}
        width={width}
        onWalletChange={passedWallet =>
          InteractionManager.runAfterInteractions(async () => {
            setItemPriceUnit(passedWallet.getPreferredBalanceUnit());
            saveToDisk();
          })
        }
        rightHeaderComponent={renderRightHeaderComponent()}
      />
      {!isMultiSig() && (
        <View style={stylesHook.dfxContainer}>
          {isDfxAvailable && (
            <>
              <BlueText>{loc.wallets.external_services}</BlueText>
              <View style={stylesHook.dfxButtonContainer}>
                {isDfxProcessing ? (
                  <ActivityIndicator />
                ) : (
                  <>
                    <View>
                      <ImageButton
                        source={buttonImages[0]}
                        onPress={() => handleOpenServices(DfxService.BUY)}
                        disabled={isHandlingOpenServices}
                      />
                    </View>
                    {isDfxSwap && (
                      <View>
                        <ImageButton
                          source={buttonImages[2]}
                          onPress={() => handleOpenServices(DfxService.SWAP)}
                          disabled={isHandlingOpenServices}
                        />
                      </View>
                    )}
                    <View>
                      <ImageButton
                        source={buttonImages[1]}
                        onPress={() => handleOpenServices(DfxService.SELL)}
                        disabled={isHandlingOpenServices}
                      />
                    </View>
                    {isDfxPos && (
                      <View style={{ backgroundColor: colors.background, height: '100%' }}>
                        <TouchableOpacity
                          onPress={handleOpenDfxPosMode}
                          disabled={isHandlingOpenServices}
                          style={{ justifyContent: 'center', alignItems: 'center', width: 60, padding: 10 }}
                        >
                          <BlueText>Point</BlueText>
                          <BlueText>of</BlueText>
                          <BlueText>Sale</BlueText>
                        </TouchableOpacity>
                      </View>
                    )}
                  </>
                )}
              </View>
            </>
          )}
        </View>
      )}
      {isLightningTestnet() && (
        <View style={styles.testnetBanner}>
          <Text>Testnet</Text>
        </View>
      )}
      <View style={[styles.list, stylesHook.list]}>
        <FlatList
          getItemLayout={getItemLayout}
          ListHeaderComponent={renderListHeaderComponent}
          onEndReachedThreshold={0.3}
          onEndReached={async () => {
            // pagination in works. in this block we will add more txs to FlatList
            // so as user scrolls closer to bottom it will render mode transactions
            if (getTransactionsSliced(Infinity).length < limit) {
              // all list rendered. nop
              return;
            }
            setDataSource(getTransactionsSliced(limit + pageSize));
            setLimit(prev => prev + pageSize);
            setPageSize(prev => prev * 2);
          }}
          ListFooterComponent={renderListFooterComponent}
          ListEmptyComponent={
            <ScrollView style={styles.flex} contentContainerStyle={styles.scrollViewContent}>
              <Text numberOfLines={0} style={styles.emptyTxs}>
                {(isLightning() && loc.wallets.list_empty_txs1_lightning) || loc.wallets.list_empty_txs1}
              </Text>
            </ScrollView>
          }
          data={dataSource}
          extraData={[timeElapsed, dataSource, wallets]}
          keyExtractor={_keyExtractor}
          renderItem={renderItem}
          initialNumToRender={10}
          removeClippedSubviews
          contentInset={{ top: 0, left: 0, bottom: 90, right: 0 }}
        />
      </View>
      <FContainer ref={walletActionButtonsRef}>
        {wallet.allowReceive() && (
          <FButton
            testID="ReceiveButton"
            text={loc.receive.header}
            onPress={receiveButtonPress}
            icon={
              <View style={styles.receiveIcon}>
                <Icon name="arrow-down" size={buttonFontSize} type="font-awesome" color={colors.buttonAlternativeTextColor} />
              </View>
            }
          />
        )}
        <FButton
          onPress={onScanButtonPressed}
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

export default Asset;

Asset.navigationOptions = navigationStyle({}, (options, { navigation, route }) => ({
  ...options,
  headerStyle: {
    backgroundColor: 'transparent',
    borderBottomWidth: 0,
    elevation: 0,
    shadowOffset: { height: 0, width: 0 },
  },
  headerRight: () => (
    <TouchableOpacity
      accessibilityRole="button"
      testID="Settings"
      style={styles.walletDetails}
      onPress={() => {
        route?.params?.walletID &&
          navigation.navigate('Settings', {
            walletID: route?.params?.walletID,
          });
      }}
    >
      <Icon name="more-horiz" type="material" size={22} color="#FFFFFF" />
    </TouchableOpacity>
  ),
}));

Asset.propTypes = {
  navigation: PropTypes.shape(),
};

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scrollViewContent: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  activityIndicator: {
    marginVertical: 20,
  },
  listHeaderTextRow: {
    flex: 1,
    marginTop: 12,
    marginHorizontal: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  listHeaderText: {
    marginTop: 8,
    marginBottom: 8,
    fontWeight: 'bold',
    fontSize: 24,
  },
  list: {
    flex: 1,
  },
  emptyTxs: {
    fontSize: 18,
    color: '#9aa0aa',
    textAlign: 'center',
    marginVertical: 16,
  },
  sendIcon: {
    transform: [{ rotate: I18nManager.isRTL ? '-225deg' : '225deg' }],
  },
  receiveIcon: {
    transform: [{ rotate: I18nManager.isRTL ? '45deg' : '-45deg' }],
  },
  testnetBanner: {
    backgroundColor: 'red',
    padding: 5,
    alignItems: 'center',
  },
  walletDetails:{
    paddingLeft: 12,
    paddingVertical:12
  },
  boltcardButton: { justifyContent: 'center', alignItems: 'center', marginTop: 10 },
  scanIconContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  }
});
