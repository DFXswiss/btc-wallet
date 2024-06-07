import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  InteractionManager,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Image
} from 'react-native';
import { useNavigation, useRoute, useTheme, useFocusEffect } from '@react-navigation/native';
import Share from 'react-native-share';
import QRCodeComponent from '../../components/QRCodeComponent';
import {
  BlueLoading,
  BlueCopyTextToClipboard,
  BlueButton,
  BlueText,
  BlueCard,
  BlueSpacing40,
  BlueWalletSelect,
  BlueDismissKeyboardInputAccessory,
} from '../../BlueComponents';
import navigationStyle from '../../components/navigationStyle';
import { Chain, BitcoinUnit } from '../../models/bitcoinUnits';
import HandoffComponent from '../../components/handoff';
import DeeplinkSchemaMatch from '../../class/deeplink-schema-match';
import loc, { formatBalance } from '../../loc';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import Notifications from '../../blue_modules/notifications';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import { TransactionPendingIconBig } from '../../components/TransactionPendingIconBig';
import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import { SuccessView } from '../send/success';
import useInputAmount from '../../hooks/useInputAmount';
import NetworkTransactionFees from '../../models/networkTransactionFees';
const currency = require('../../blue_modules/currency');

const ReceiveDetails = () => {
  const { walletID, address } = useRoute().params;
  const { wallets, saveToDisk, sleep, isElectrumDisabled, fetchAndSaveWalletTransactions } = useContext(BlueStorageContext);
  const wallet = wallets.find(w => w.getID() === walletID);
  const [customLabel, setCustomLabel] = useState('');
  const [bip21encoded, setBip21encoded] = useState();
  const [isCustom, setIsCustom] = useState(false);
  const [showPendingBalance, setShowPendingBalance] = useState(false);
  const [showConfirmedBalance, setShowConfirmedBalance] = useState(false);
  const [showAddress, setShowAddress] = useState(false);
  const { goBack, setParams, replace } = useNavigation();
  const { colors } = useTheme();
  const [intervalMs, setIntervalMs] = useState(5000);
  const [eta, setEta] = useState('');
  const [initialConfirmed, setInitialConfirmed] = useState(0);
  const [initialUnconfirmed, setInitialUnconfirmed] = useState(0);
  const [displayBalance, setDisplayBalance] = useState('');
  const fetchAddressInterval = useRef();
  const { inputProps, amountSats, formattedUnit, changeToNextUnit } = useInputAmount();
  
   const stylesHook = StyleSheet.create({
    modalContent: {
      backgroundColor: colors.modal,
      borderTopColor: colors.foregroundColor,
      borderWidth: colors.borderWidth,
    },
    customAmount: {
      borderColor: colors.formBorder,
      borderBottomColor: colors.formBorder,
      backgroundColor: colors.inputBackgroundColor,
    },
    customAmountText: {
      color: colors.foregroundColor,
    },
    root: {
      backgroundColor: colors.elevated,
    },
    rootBackgroundColor: {
      backgroundColor: colors.elevated,
    },
    amount: {
      color: colors.foregroundColor,
    },
    label: {
      color: colors.foregroundColor,
    },
    modalButton: {
      backgroundColor: colors.modalButton,
    },
  });

  useEffect(() => {
    if (showConfirmedBalance) {
      ReactNativeHapticFeedback.trigger('notificationSuccess', { ignoreAndroidSystemSettings: false });
    }
  }, [showConfirmedBalance]);

  // re-fetching address balance periodically
  useEffect(() => {
    console.log('receive/defails - useEffect');

    if (fetchAddressInterval.current) {
      // interval already exists, lets cleanup it and recreate, so theres no duplicate intervals
      clearInterval(fetchAddressInterval.current);
      fetchAddressInterval.current = undefined;
    }

    fetchAddressInterval.current = setInterval(async () => {
      try {
        const decoded = DeeplinkSchemaMatch.bip21decode(bip21encoded);
        const address2use = address || decoded.address;
        if (!address2use) return;

        console.log('checking address', address2use, 'for balance...');
        const balance = await BlueElectrum.getBalanceByAddress(address2use);
        console.log('...got', balance);

        if (balance.unconfirmed > 0) {
          if (initialConfirmed === 0 && initialUnconfirmed === 0) {
            // saving initial values for later (when tx gets confirmed)
            setInitialConfirmed(balance.confirmed);
            setInitialUnconfirmed(balance.unconfirmed);
            setIntervalMs(25000);
            ReactNativeHapticFeedback.trigger('impactHeavy', { ignoreAndroidSystemSettings: false });
          }

          const txs = await BlueElectrum.getMempoolTransactionsByAddress(address2use);
          const tx = txs.pop();
          if (tx) {
            const rez = await BlueElectrum.multiGetTransactionByTxid([tx.tx_hash], 10, true);
            if (rez && rez[tx.tx_hash] && rez[tx.tx_hash].vsize) {
              const satPerVbyte = Math.round(tx.fee / rez[tx.tx_hash].vsize);
              const fees = await NetworkTransactionFees.recommendedFees();
              if (satPerVbyte >= fees.fastestFee) {
                setEta(loc.formatString(loc.transactions.eta_fastest));
              } else if (satPerVbyte >= fees.mediumFee) {
                setEta(loc.formatString(loc.transactions.eta_fast));
              } else if (satPerVbyte >= fees.slowFee) {
                setEta(loc.formatString(loc.transactions.eta_medium));
              } else {
                setEta(loc.formatString(loc.transactions.eta_slow));
              }
            }
          }

          setDisplayBalance(
            loc.formatString(loc.transactions.pending_with_amount, {
              amt1: formatBalance(balance.unconfirmed, BitcoinUnit.LOCAL_CURRENCY, true).toString(),
              amt2: formatBalance(balance.unconfirmed, BitcoinUnit.BTC, true).toString(),
            }),
          );
          setShowPendingBalance(true);
          setShowAddress(false);
        } else if (balance.unconfirmed === 0 && initialUnconfirmed !== 0) {
          // now, handling a case when unconfirmed == 0, but in past it wasnt (i.e. it changed while user was
          // staring at the screen)

          const balanceToShow = balance.confirmed - initialConfirmed;

          if (balanceToShow > 0) {
            // address has actually more coins then initially, so we definately gained something
            setShowConfirmedBalance(true);
            setShowPendingBalance(false);
            setShowAddress(false);

            clearInterval(fetchAddressInterval.current);
            fetchAddressInterval.current = undefined;

            setDisplayBalance(
              loc.formatString(loc.transactions.received_with_amount, {
                amt1: formatBalance(balanceToShow, BitcoinUnit.LOCAL_CURRENCY, true).toString(),
                amt2: formatBalance(balanceToShow, BitcoinUnit.BTC, true).toString(),
              }),
            );

            fetchAndSaveWalletTransactions(walletID);
          } else {
            // rare case, but probable. transaction evicted from mempool (maybe cancelled by the sender)
            setShowConfirmedBalance(false);
            setShowPendingBalance(false);
            setShowAddress(true);
          }
        }
      } catch (error) {
        console.log(error);
      }
    }, intervalMs);
  }, [bip21encoded, address, initialConfirmed, initialUnconfirmed, intervalMs, fetchAndSaveWalletTransactions, walletID]);

  const renderConfirmedBalance = () => {
    return (
      <ScrollView style={stylesHook.rootBackgroundColors} centerContent keyboardShouldPersistTaps="always">
        <View style={styles.scrollBody}>
          {isCustom && (
            <>
              <BlueText style={[styles.label, stylesHook.label]} numberOfLines={1}>
                {customLabel}
              </BlueText>
            </>
          )}
          <SuccessView />
          <BlueText style={[styles.label, stylesHook.label]} numberOfLines={1}>
            {displayBalance}
          </BlueText>
        </View>
      </ScrollView>
    );
  };

  const renderPendingBalance = () => {
    return (
      <ScrollView contentContainerStyle={stylesHook.rootBackgroundColor} centerContent keyboardShouldPersistTaps="always">
        <View style={styles.scrollBody}>
          {isCustom && (
            <>
              <BlueText style={[styles.label, stylesHook.label]} numberOfLines={1}>
                {customLabel}
              </BlueText>
            </>
          )}
          <TransactionPendingIconBig />
          <BlueSpacing40 />
          <BlueText style={[styles.label, stylesHook.label]} numberOfLines={1}>
            {displayBalance}
          </BlueText>
          <BlueText style={[styles.label, stylesHook.label]} numberOfLines={1}>
            {eta}
          </BlueText>
        </View>
      </ScrollView>
    );
  };

  const handleBackButton = () => {
    goBack(null);
    return true;
  };

  useEffect(() => {
    BackHandler.addEventListener('hardwareBackPress', handleBackButton);

    return () => {
      BackHandler.removeEventListener('hardwareBackPress', handleBackButton);
      clearInterval(fetchAddressInterval.current);
      fetchAddressInterval.current = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderReceiveDetails = () => {
    return (
      <KeyboardAvoidingView
        enabled={!Platform.isPad}
        behavior="position"
      >
        <View style={styles.scrollBody}>
          <QRCodeComponent value={bip21encoded} />
          <BlueCopyTextToClipboard text={isCustom ? bip21encoded : address} textStyle={{ marginVertical: 24 }} />
        </View>
        <View style={styles.share}>
          <View style={[styles.customAmount, stylesHook.customAmount]}>
            <TextInput
              placeholderTextColor="#81868e"
              placeholder="Amount (optional)"
              style={[styles.customAmountText, stylesHook.customAmountText]}
              inputAccessoryViewID={BlueDismissKeyboardInputAccessory.InputAccessoryViewID}
              {...inputProps}
            />
            <Text style={styles.inputUnit}>{formattedUnit}</Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={loc._.change_input_currency}
              style={styles.changeToNextUnitButton}
              onPress={changeToNextUnit}
            >
              <Image source={require('../../img/round-compare-arrows-24-px.png')} />
            </TouchableOpacity>
          </View>
          <View style={[styles.customAmount, stylesHook.customAmount]}>
            <TextInput
              onChangeText={setCustomLabel}
              placeholderTextColor="#81868e"
              placeholder={`${loc.receive.details_label} (optional)`}
              value={customLabel || ''}
              numberOfLines={1}
              style={[styles.customAmountText, stylesHook.customAmountText]}
              testID="CustomAmountDescription"
              inputAccessoryViewID={BlueDismissKeyboardInputAccessory.InputAccessoryViewID}
            />
          </View>
          <BlueCard>
            <BlueButton onPress={handleShareButtonPressed} title={loc.receive.details_share} />
          </BlueCard>
        </View>
        <BlueDismissKeyboardInputAccessory />
      </KeyboardAvoidingView>
    );
  };

  const obtainWalletAddress = useCallback(async () => {
    console.log('receive/details - componentDidMount');
    wallet.setUserHasSavedExport(true);
    await saveToDisk();
    let newAddress;
    if (address) {
      setAddressBIP21Encoded(address);
      await Notifications.tryToObtainPermissions();
      Notifications.majorTomToGroundControl([address], [], []);
    } else {
      if (wallet.chain === Chain.ONCHAIN) {
        try {
          if (!isElectrumDisabled) newAddress = await Promise.race([wallet.getAddressAsync(), sleep(1000)]);
        } catch (_) {}
        if (newAddress === undefined) {
          // either sleep expired or getAddressAsync threw an exception
          console.warn('either sleep expired or getAddressAsync threw an exception');
          newAddress = wallet._getExternalAddressByIndex(wallet.getNextFreeAddressIndex());
        } else {
          saveToDisk(); // caching whatever getAddressAsync() generated internally
        }
      } else if (wallet.chain === Chain.OFFCHAIN) {
        try {
          await Promise.race([wallet.getAddressAsync(), sleep(1000)]);
          newAddress = wallet.getAddress();
        } catch (_) {}
        if (newAddress === undefined) {
          // either sleep expired or getAddressAsync threw an exception
          console.warn('either sleep expired or getAddressAsync threw an exception');
          newAddress = wallet.getAddress();
        } else {
          saveToDisk(); // caching whatever getAddressAsync() generated internally
        }
      }
      setAddressBIP21Encoded(newAddress);
      await Notifications.tryToObtainPermissions();
      Notifications.majorTomToGroundControl([newAddress], [], []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setAddressBIP21Encoded = addr => {
    const newBip21encoded = DeeplinkSchemaMatch.bip21encode(addr);
    setParams({ address: addr });
    setBip21encoded(newBip21encoded);
    setShowAddress(true);
  };

  useFocusEffect(
    useCallback(() => {
      const task = InteractionManager.runAfterInteractions(async () => {
        if (wallet) {
          obtainWalletAddress();
        } else if (!wallet && address) {
          setAddressBIP21Encoded(address);
        }
      });
      return () => {
        task.cancel();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [wallet]),
  );

  useEffect(() => {
    const btcAmout = Number(currency.satoshiToBTC(amountSats));
    const hasOptional = btcAmout || customLabel;
    setIsCustom(hasOptional);
    if(hasOptional){
      setBip21encoded(DeeplinkSchemaMatch.bip21encode(address, { amount: btcAmout, label: customLabel }));
    }
  }, [amountSats, customLabel]); 
  
  const handleShareButtonPressed = () => {
    Share.open({ message: bip21encoded }).catch(error => console.log(error));
  };

  const onWalletChange = id => {
    const newWallet = wallets.find(w => w.getID() === id);
    if (!newWallet) return;

    if (newWallet.chain !== Chain.ONCHAIN) {
      return replace('LNDReceive', { walletID: id });
    }
  };

  return (
    <View style={[styles.root, stylesHook.root]}>
      <StatusBar barStyle="light-content" />
      <View style={styles.pickerContainer}>
        <BlueWalletSelect wallets={wallets} value={wallet?.getID()} onChange={onWalletChange} />
      </View>
      {address !== undefined && showAddress && (
        <HandoffComponent title={loc.send.details_address} type={HandoffComponent.activityTypes.ReceiveOnchain} userInfo={{ address }} />
      )}
      {showConfirmedBalance ? renderConfirmedBalance() : null}
      {showPendingBalance ? renderPendingBalance() : null}
      {showAddress ? renderReceiveDetails() : null}
      {!showAddress && !showPendingBalance && !showConfirmedBalance ? <BlueLoading /> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  modalContent: {
    padding: 22,
    justifyContent: 'center',
    alignItems: 'center',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    minHeight: 350,
    height: 350,
  },
  customAmount: {
    flexDirection: 'row',
    borderWidth: 1.0,
    borderBottomWidth: 0.5,
    minHeight: 44,
    height: 44,
    marginHorizontal: 20,
    alignItems: 'center',
    marginVertical: 8,
    borderRadius: 4,
  },
  root: {
    flexGrow: 1,
    justifyContent: 'space-between',
  },
  scrollBody: {
    marginTop: 16,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  share: {
    justifyContent: 'flex-end',
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 8,
  },
  link: {
    marginVertical: 16,
    paddingHorizontal: 32,
  },
  amount: {
    fontWeight: '600',
    fontSize: 36,
    textAlign: 'center',
  },
  label: {
    fontWeight: '600',
    textAlign: 'center',
    paddingBottom: 24,
  },
  modalButton: {
    paddingVertical: 14,
    paddingHorizontal: 70,
    maxWidth: '80%',
    borderRadius: 50,
    fontWeight: '700',
  },
  customAmountText: {
    flex: 1,
    marginHorizontal: 8,
    minHeight: 33,
  },
  pickerContainer: { marginHorizontal: 16 },
  inputUnit:{
    color: '#81868e',
    fontSize: 16,
    marginRight: 10,
    marginLeft: 10,
  },
  changeToNextUnitButton:{
    borderLeftColor: '#676b71',
    borderLeftWidth: 1,
    paddingHorizontal: 10,
  }
});

ReceiveDetails.navigationOptions = navigationStyle(
  {
    closeButton: true,
    headerHideBackButton: true,
  },
  opts => ({ ...opts, title: loc.receive.header }),
);

export default ReceiveDetails;
