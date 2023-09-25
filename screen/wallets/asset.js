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
} from 'react-native';
import { Icon } from 'react-native-elements';
import { useRoute, useNavigation, useTheme, useFocusEffect } from '@react-navigation/native';
import { Chain } from '../../models/bitcoinUnits';
import { BlueText } from '../../BlueComponents';
import navigationStyle from '../../components/navigationStyle';
import { WatchOnlyWallet } from '../../class';
import ActionSheet from '../ActionSheet';
import loc from '../../loc';
import { FContainer, FButton } from '../../components/FloatButtons';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import { isDesktop } from '../../blue_modules/environment';
import BlueClipboard from '../../blue_modules/clipboard';
import { TransactionListItem } from '../../components/TransactionListItem';
import alert from '../../components/Alert';
import { ImageButton } from '../../components/ImageButton';
import { DfxService, useDfxSessionContext } from '../../api/dfx/contexts/session.context';
import BigNumber from 'bignumber.js';
import TransactionsNavigationHeader from '../../components/TransactionsNavigationHeader';
import PropTypes from 'prop-types';

import BuyEn from '../../img/dfx/buttons/buy_en.png';
import SellEn from '../../img/dfx/buttons/sell_en.png';
import BuyDe from '../../img/dfx/buttons/buy_de.png';
import SellDe from '../../img/dfx/buttons/sell_de.png';
import BuyFr from '../../img/dfx/buttons/buy_fr.png';
import SellFr from '../../img/dfx/buttons/sell_fr.png';
import BuyIt from '../../img/dfx/buttons/buy_it.png';
import SellIt from '../../img/dfx/buttons/sell_it.png';

const scanqrHelper = require('../../helpers/scan-qr');
const fs = require('../../blue_modules/fs');
const BlueElectrum = require('../../blue_modules/BlueElectrum');
const currency = require('../../blue_modules/currency');

const buttonFontSize =
  PixelRatio.roundToNearestPixel(Dimensions.get('window').width / 26) > 22
    ? 22
    : PixelRatio.roundToNearestPixel(Dimensions.get('window').width / 26);

const Asset = ({ navigation }) => {
  const { wallets, saveToDisk, setSelectedWallet, refreshAllWalletTransactions, walletTransactionUpdateStatus, isElectrumDisabled } =
    useContext(BlueStorageContext);
  const { name, params } = useRoute();
  const walletID = params.walletID;
  const [isLoading, setIsLoading] = useState(false);
  const wallet = useMemo(() => wallets.find(w => w.getID() === walletID), [wallets, walletID]);
  const [itemPriceUnit, setItemPriceUnit] = useState(wallet.getPreferredBalanceUnit());
  const [dataSource, setDataSource] = useState(wallet.getTransactions(15));
  const [timeElapsed, setTimeElapsed] = useState(0);
  const [limit, setLimit] = useState(15);
  const [pageSize, setPageSize] = useState(20);
  const { setParams, setOptions, navigate } = useNavigation();
  const { colors, scanImage } = useTheme();
  const walletActionButtonsRef = useRef();
  const { isNotAllowedInCountry, openServices, isProcessing } = useDfxSessionContext();
  const { width } = useWindowDimensions();
  const [isHandlingOpenServices, setIsHandlingOpenServices] = useState(false);

  const getButtonImages = lang => {
    switch (lang) {
      case 'en':
        return [BuyEn, SellEn];
      case 'de_de':
        return [BuyDe, SellDe];
      case 'fr_fr':
        return [BuyFr, SellFr];
      case 'it':
        return [BuyIt, SellIt];
      default:
        return [BuyEn, SellEn];
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
    },
    dfxButtonContainer: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      marginVertical: 10,
      height: 70,
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

  useEffect(() => {
    const interval = setInterval(() => setTimeElapsed(prev => prev + 1), 60000);
    return () => {
      clearInterval(interval);
    };
  }, []);

  const showNotAvailableInCountryAlert = () => {
    Alert.alert(loc.alert.availability, loc.alert.not_available, [{ text: loc._.ok }], { cancelable: false });
  };

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

  const handleOpenServices = service => {
    if (isNotAllowedInCountry) {
      showNotAvailableInCountryAlert();
    } else {
      setIsHandlingOpenServices(true);
      openServices(walletID, new BigNumber(currency.satoshiToBTC(wallet.getBalance())).toString(), service)
        .catch(e =>
          Alert.alert('Something went wrong', e.message?.toString(), [
            {
              text: loc._.ok,
              onPress: () => {},
              style: 'default',
            },
          ]),
        )
        .finally(() => setIsHandlingOpenServices(false));
    }
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
    return (getTransactionsSliced(Infinity).length > limit && <ActivityIndicator style={styles.activityIndicator} />) || <View />;
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

  const navigateToSendScreen = () => {
    navigate('SendDetailsRoot', {
      screen: 'SendDetails',
      params: {
        walletID: wallet.getID(),
      },
    });
  };

  const renderItem = item => (
    <TransactionListItem item={item.item} itemPriceUnit={itemPriceUnit} timeElapsed={timeElapsed} walletID={walletID} />
  );

  const onBarCodeRead = value => {
    if (!value) return;

    if (!isLoading) {
      setIsLoading(true);
      const navParams = {
        walletID: wallet.getID(),
        uri: value,
      };
      if (wallet.chain === Chain.ONCHAIN) {
        navigate('SendDetailsRoot', { screen: 'SendDetails', params: navParams });
      } else {
        navigate('SendDetailsRoot', { screen: 'ScanLndInvoice', params: navParams });
      }
    }
    setIsLoading(false);
  };

  const choosePhoto = () => {
    fs.showImagePickerAndReadImage().then(onBarCodeRead);
  };

  const copyFromClipboard = async () => {
    onBarCodeRead(await BlueClipboard().getClipboardContent());
  };

  const sendButtonPress = () => {
    if (wallet.chain === Chain.OFFCHAIN) {
      return navigate('SendDetailsRoot', { screen: 'ScanLndInvoice', params: { walletID: wallet.getID() } });
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
    scanqrHelper(navigate, name, false).then(d => onBarCodeRead(d));
  };

  const getItemLayout = (_, index) => ({
    length: 64,
    offset: 64 * index,
    index,
  });

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
      />
      <View style={stylesHook.dfxContainer}>
        <BlueText>{loc.wallets.external_services}</BlueText>
        <View style={stylesHook.dfxButtonContainer}>
          {isProcessing ? (
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
              <View>
                <ImageButton
                  source={buttonImages[1]}
                  onPress={() => handleOpenServices(DfxService.SELL)}
                  disabled={isHandlingOpenServices}
                />
              </View>
            </>
          )}
        </View>
      </View>

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
          {...(isElectrumDisabled ? {} : { refreshing: isLoading, onRefresh: refreshTransactions })}
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
            onPress={() => {
              if (wallet.chain === Chain.OFFCHAIN) {
                navigate('ReceiveDetailsRoot', { screen: 'LNDCreateInvoice', params: { walletID: wallet.getID() } });
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
        <FButton onPress={onScanButtonPressed} icon={<Image resizeMode="stretch" source={scanImage} />} text={loc.send.details_scan} />
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

Asset.navigationOptions = navigationStyle({});

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
});