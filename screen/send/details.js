import React, { useState, useRef, useEffect, useCallback, useContext, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useNavigation, useRoute, useTheme, useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import BigNumber from 'bignumber.js';

import { BlueButton, BlueDismissKeyboardInputAccessory, BlueLoading, BlueText, BlueWalletSelect } from '../../BlueComponents';
import navigationStyle from '../../components/navigationStyle';
import NetworkTransactionFees, { NetworkTransactionFee } from '../../models/networkTransactionFees';
import { BitcoinUnit, Chain } from '../../models/bitcoinUnits';
import { HDSegwitBech32Wallet, MultisigHDWallet, WatchOnlyWallet } from '../../class';
import DeeplinkSchemaMatch from '../../class/deeplink-schema-match';
import loc, { formatBalance, formatBalanceWithoutSuffix } from '../../loc';
import BottomModal from '../../components/BottomModal';
import AddressInput from '../../components/AddressInput';
import AmountInput from '../../components/AmountInput';
import InputAccessoryAllFunds from '../../components/InputAccessoryAllFunds';
import { AbstractHDElectrumWallet } from '../../class/wallets/abstract-hd-electrum-wallet';
import { BlueStorageContext } from '../../blue_modules/storage-context';
const currency = require('../../blue_modules/currency');
const prompt = require('../../helpers/prompt');

const btcAddressRx = /^[a-zA-Z0-9]{26,35}$/;

const SendDetails = () => {
  const { wallets, setSelectedWallet, sleep, txMetadata, saveToDisk } = useContext(BlueStorageContext);
  const navigation = useNavigation();
  const { name, params: routeParams } = useRoute();
  const scrollView = useRef();
  const scrollIndex = useRef(0);
  const { colors } = useTheme();

  // state
  const [width, setWidth] = useState(Dimensions.get('window').width);
  const [isLoading, setIsLoading] = useState(false);
  const [wallet, setWallet] = useState(null);
  const [isAmountToolbarVisibleForAndroid, setIsAmountToolbarVisibleForAndroid] = useState(false);
  const [isFeeSelectionModalVisible, setIsFeeSelectionModalVisible] = useState(false);
  const [isTransactionReplaceable, setIsTransactionReplaceable] = useState(false);
  const [addresses, setAddresses] = useState([]);
  const [units, setUnits] = useState([]);
  const [transactionMemo, setTransactionMemo] = useState('');
  const [networkTransactionFees, setNetworkTransactionFees] = useState(new NetworkTransactionFee(3, 2, 1));
  const [networkTransactionFeesIsLoading, setNetworkTransactionFeesIsLoading] = useState(false);
  const [customFee, setCustomFee] = useState(null);
  const [feePrecalc, setFeePrecalc] = useState({ current: null, slowFee: null, mediumFee: null, fastestFee: null });
  const [feeUnit, setFeeUnit] = useState();
  const [amountUnit, setAmountUnit] = useState();
  const [utxo, setUtxo] = useState(null);
  const [frozenBalance, setFrozenBlance] = useState(false);
  const [payjoinUrl, setPayjoinUrl] = useState(null);
  const [changeAddress, setChangeAddress] = useState();
  const [dumb, setDumb] = useState(false);
  const { isEditable = true } = routeParams;
  // if utxo is limited we use it to calculate available balance
  const balance = utxo ? utxo.reduce((prev, curr) => prev + curr.value, 0) : wallet?.getBalance();
  const allBalance = formatBalanceWithoutSuffix(balance, BitcoinUnit.BTC, true);

  // if cutomFee is not set, we need to choose highest possible fee for wallet balance
  // if there are no funds for even Slow option, use 1 sat/vbyte fee
  const feeRate = useMemo(() => {
    if (customFee) return customFee;
    if (feePrecalc.slowFee === null) return '1'; // wait for precalculated fees
    let initialFee;
    if (feePrecalc.fastestFee !== null) {
      initialFee = String(networkTransactionFees.fastestFee);
    } else if (feePrecalc.mediumFee !== null) {
      initialFee = String(networkTransactionFees.mediumFee);
    } else {
      initialFee = String(networkTransactionFees.slowFee);
    }
    return initialFee;
  }, [customFee, feePrecalc, networkTransactionFees]);

  // keyboad effects
  useEffect(() => {
    const _keyboardDidShow = () => {
      setIsAmountToolbarVisibleForAndroid(true);
    };

    const _keyboardDidHide = () => {
      setIsAmountToolbarVisibleForAndroid(false);
    };

    const didShow = Keyboard.addListener('keyboardDidShow', _keyboardDidShow);
    const didHide = Keyboard.addListener('keyboardDidHide', _keyboardDidHide);
    return () => {
      didShow.remove();
      didHide.remove();
    };
  }, []);

  useEffect(() => {
    // decode route params
    const currentAddress = addresses[scrollIndex.current];
    if (routeParams.uri) {
      try {
        const { address, amount, memo, payjoinUrl: pjUrl } = DeeplinkSchemaMatch.decodeBitcoinUri(routeParams.uri);

        setUnits(u => {
          u[scrollIndex.current] = BitcoinUnit.BTC; // also resetting current unit to BTC
          return [...u];
        });

        setAddresses(addrs => {
          if (currentAddress) {
            currentAddress.address = address;
            if (Number(amount) > 0) {
              currentAddress.amount = amount;
              currentAddress.amountSats = currency.btcToSatoshi(amount);
            }
            addrs[scrollIndex.current] = currentAddress;
            return [...addrs];
          } else {
            return [...addrs, { address, amount, amountSats: currency.btcToSatoshi(amount), key: String(Math.random()) }];
          }
        });

        if (memo?.trim().length > 0) {
          setTransactionMemo(memo);
        }
        setAmountUnit(BitcoinUnit.BTC);
        setPayjoinUrl(pjUrl);
      } catch (error) {
        console.log(error);
        Alert.alert(loc.errors.error, loc.send.details_error_decode);
      }
    } else if (routeParams.address) {
      const { amount, amountSats, unit = BitcoinUnit.BTC } = routeParams;
      setAddresses(addrs => {
        if (currentAddress) {
          currentAddress.address = routeParams.address;
          addrs[scrollIndex.current] = currentAddress;
          return [...addrs];
        } else {
          return [...addrs, { address: routeParams.address, key: String(Math.random()), amount, amountSats }];
        }
      });
      if (routeParams.memo?.trim().length > 0) {
        setTransactionMemo(routeParams.memo);
      }
      setUnits(u => {
        u[scrollIndex.current] = unit;
        return [...u];
      });
    } else {
      setAddresses([{ address: '', key: String(Math.random()) }]); // key is for the FlatList
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeParams.uri, routeParams.address]);

  useEffect(() => {
    // check if we have a suitable wallet
    const suitable = wallets.filter(w => w.chain === Chain.ONCHAIN && w.allowSend());
    if (suitable.length === 0) {
      Alert.alert(loc.errors.error, loc.send.details_wallet_before_tx);
      navigation.goBack();
      return;
    }
    const walletFromParams = routeParams.walletID && wallets.find(w => w.getID() === routeParams.walletID);
    const isWalletFromParamsSuitable = walletFromParams && walletFromParams.chain === Chain.ONCHAIN && walletFromParams.allowSend();
    const newWallet = isWalletFromParamsSuitable ? walletFromParams : suitable[0];
    setWallet(newWallet);
    setFeeUnit(newWallet.getPreferredBalanceUnit());
    setAmountUnit(newWallet.preferredBalanceUnit); // default for whole screen

    // we are ready!
    setIsLoading(false);

    // load cached fees
    AsyncStorage.getItem(NetworkTransactionFee.StorageKey)
      .then(res => {
        const fees = JSON.parse(res);
        if (!fees?.fastestFee) return;
        setNetworkTransactionFees(fees);
      })
      .catch(e => console.log('loading cached recommendedFees error', e));

    // load fresh fees from servers

    setNetworkTransactionFeesIsLoading(true);
    NetworkTransactionFees.recommendedFees()
      .then(async fees => {
        if (!fees?.fastestFee) return;
        setNetworkTransactionFees(fees);
        await AsyncStorage.setItem(NetworkTransactionFee.StorageKey, JSON.stringify(fees));
      })
      .catch(e => console.log('loading recommendedFees error', e))
      .finally(() => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setNetworkTransactionFeesIsLoading(false);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // change header and reset state on wallet change
  useEffect(() => {
    if (!wallet) return;
    setSelectedWallet(wallet.getID());

    // reset other values
    setUtxo(null);
    setChangeAddress(null);
    setIsTransactionReplaceable(wallet.type === HDSegwitBech32Wallet.type && !routeParams.noRbf);

    // update wallet UTXO
    wallet
      .fetchUtxo()
      .then(() => {
        // we need to re-calculate fees
        setDumb(v => !v);
      })
      .catch(e => console.log('fetchUtxo error', e));
  }, [wallet]); // eslint-disable-line react-hooks/exhaustive-deps

  // recalc fees in effect so we don't block render
  useEffect(() => {
    if (!wallet) return; // wait for it
    const fees = networkTransactionFees;
    const change = getChangeAddressFast();
    const requestedSatPerByte = Number(feeRate);
    const lutxo = utxo || wallet.getUtxo();
    let frozen = 0;
    if (!utxo) {
      // if utxo is not limited search for frozen outputs and calc it's balance
      frozen = wallet
        .getUtxo(true)
        .filter(o => !lutxo.some(i => i.txid === o.txid && i.vout === o.vout))
        .reduce((prev, curr) => prev + curr.value, 0);
    }

    const options = [
      { key: 'current', fee: requestedSatPerByte },
      { key: 'slowFee', fee: fees.slowFee },
      { key: 'mediumFee', fee: fees.mediumFee },
      { key: 'fastestFee', fee: fees.fastestFee },
    ];

    const newFeePrecalc = { ...feePrecalc };

    for (const opt of options) {
      let targets = [];
      for (const transaction of addresses) {
        if (transaction.amount === wallet.getBalance()) {
          // single output with MAX
          targets = [{ address: transaction.address }];
          break;
        }
        const value = parseInt(transaction.amountSats, 10);
        if (value > 0) {
          targets.push({ address: transaction.address, value });
        } else if (transaction.amount) {
          if (currency.btcToSatoshi(transaction.amount) > 0) {
            targets.push({ address: transaction.address, value: currency.btcToSatoshi(transaction.amount) });
          }
        }
      }

      // if targets is empty, insert dust
      if (targets.length === 0) {
        targets.push({ address: '36JxaUrpDzkEerkTf1FzwHNE1Hb7cCjgJV', value: 546 });
      }

      // replace wrong addresses with dump
      targets = targets.map(t => {
        if (!wallet.isAddressValid(t.address)) {
          return { ...t, address: '36JxaUrpDzkEerkTf1FzwHNE1Hb7cCjgJV' };
        } else {
          return t;
        }
      });

      let flag = false;
      while (true) {
        try {
          const { fee } = wallet.coinselect(lutxo, targets, opt.fee, change);

          newFeePrecalc[opt.key] = fee;
          break;
        } catch (e) {
          if (e.message.includes('Not enough') && !flag) {
            flag = true;
            // if we don't have enough funds, construct maximum possible transaction
            targets = targets.map((t, index) => (index > 0 ? { ...t, value: 546 } : { address: t.address }));
            continue;
          }

          newFeePrecalc[opt.key] = null;
          break;
        }
      }
    }

    setFeePrecalc(newFeePrecalc);
    setFrozenBlance(frozen);
  }, [wallet, networkTransactionFees, utxo, addresses, feeRate, dumb]); // eslint-disable-line react-hooks/exhaustive-deps

  // we need to re-calculate fees if user opens-closes coin control
  useFocusEffect(
    useCallback(() => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setDumb(v => !v);
    }, []),
  );

  const onWalletChange = id => {
    const newWallet = wallets.find(w => w.getID() === id);
    if (!newWallet) return;

    if (newWallet.chain !== Chain.ONCHAIN) {
      return navigation.replace('ScanLndInvoice', { walletID: id });
    }

    setWallet(newWallet);
  };

  const getChangeAddressFast = () => {
    if (changeAddress) return changeAddress; // cache

    let change;
    if (WatchOnlyWallet.type === wallet.type && !wallet.isHd()) {
      // plain watchonly - just get the address
      change = wallet.getAddress();
    } else if (WatchOnlyWallet.type === wallet.type || wallet instanceof AbstractHDElectrumWallet) {
      change = wallet._getInternalAddressByIndex(wallet.getNextFreeChangeAddressIndex());
    } else {
      // legacy wallets
      change = wallet.getAddress();
    }

    return change;
  };

  const getChangeAddressAsync = async () => {
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

  /**
   * TODO: refactor this mess, get rid of regexp, use https://github.com/bitcoinjs/bitcoinjs-lib/issues/890 etc etc
   *
   * @param data {String} Can be address or `bitcoin:xxxxxxx` uri scheme, or invalid garbage
   */
  const processAddressData = data => {
    const currentIndex = scrollIndex.current;
    setIsLoading(true);
    if (!data.replace) {
      // user probably scanned PSBT and got an object instead of string..?
      setIsLoading(false);
      return Alert.alert(loc.errors.error, loc.send.details_address_field_is_not_valid);
    }

    const dataWithoutSchema = data.replace('bitcoin:', '').replace('BITCOIN:', '');
    if (wallet.isAddressValid(dataWithoutSchema)) {
      setAddresses(addrs => {
        addrs[scrollIndex.current].address = dataWithoutSchema;
        return [...addrs];
      });
      setIsLoading(false);
      return;
    }

    let address = '';
    let options;
    try {
      if (!data.toLowerCase().startsWith('bitcoin:')) data = `bitcoin:${data}`;
      const decoded = DeeplinkSchemaMatch.bip21decode(data);
      address = decoded.address;
      options = decoded.options;
    } catch (error) {
      data = data.replace(/(amount)=([^&]+)/g, '').replace(/(amount)=([^&]+)&/g, '');
      const decoded = DeeplinkSchemaMatch.bip21decode(data);
      decoded.options.amount = 0;
      address = decoded.address;
      options = decoded.options;
    }

    console.log('options', options);
    if (btcAddressRx.test(address) || address.startsWith('bc1') || address.startsWith('BC1')) {
      setAddresses(addrs => {
        addrs[scrollIndex.current].address = address;
        addrs[scrollIndex.current].amount = options.amount;
        addrs[scrollIndex.current].amountSats = new BigNumber(options.amount).multipliedBy(100000000).toNumber();
        return [...addrs];
      });
      setUnits(u => {
        u[scrollIndex.current] = BitcoinUnit.BTC; // also resetting current unit to BTC
        return [...u];
      });
      setTransactionMemo(options.label || options.message);
      setAmountUnit(BitcoinUnit.BTC);
      setPayjoinUrl(options.pj || '');
      // RN Bug: contentOffset gets reset to 0 when state changes. Remove code once this bug is resolved.
      setTimeout(() => scrollView.current.scrollToIndex({ index: currentIndex, animated: false }), 50);
    }

    setIsLoading(false);
  };

  const createTransaction = async () => {
    Keyboard.dismiss();
    setIsLoading(true);
    const requestedSatPerByte = feeRate;
    for (const [index, transaction] of addresses.entries()) {
      let error;
      if (!transaction.amount || transaction.amount < 0 || parseFloat(transaction.amount) === 0) {
        error = loc.send.details_amount_field_is_not_valid;
        console.log('validation error');
      } else if (parseFloat(transaction.amountSats) <= 500) {
        error = loc.send.details_amount_field_is_less_than_minimum_amount_sat;
        console.log('validation error');
      } else if (!requestedSatPerByte || parseFloat(requestedSatPerByte) < 1) {
        error = loc.send.details_fee_field_is_not_valid;
        console.log('validation error');
      } else if (!transaction.address) {
        error = loc.send.details_address_field_is_not_valid;
        console.log('validation error');
      } else if (balance - transaction.amountSats < 0) {
        // first sanity check is that sending amount is not bigger than available balance
        error = frozenBalance > 0 ? loc.send.details_total_exceeds_balance_frozen : loc.send.details_total_exceeds_balance;
        console.log('validation error');
      } else if (transaction.address) {
        const address = transaction.address.trim().toLowerCase();
        if (address.startsWith('lnb') || address.startsWith('lightning:lnb')) {
          error = loc.send.provided_address_is_invoice;
          console.log('validation error');
        }
      }

      if (!error) {
        if (!wallet.isAddressValid(transaction.address)) {
          console.log('validation error');
          error = loc.send.details_address_field_is_not_valid;
        }
      }

      if (error) {
        scrollView.current.scrollToIndex({ index });
        setIsLoading(false);
        Alert.alert(loc.errors.error, error);
        ReactNativeHapticFeedback.trigger('notificationError', { ignoreAndroidSystemSettings: false });
        return;
      }
    }

    try {
      await createPsbtTransaction();
    } catch (Err) {
      setIsLoading(false);
      Alert.alert(loc.errors.error, Err.message);
      ReactNativeHapticFeedback.trigger('notificationError', { ignoreAndroidSystemSettings: false });
    }
  };

  const createPsbtTransaction = async () => {
    const change = await getChangeAddressAsync();
    const requestedSatPerByte = Number(feeRate);
    const lutxo = utxo || wallet.getUtxo();
    console.log({ requestedSatPerByte, lutxo: lutxo.length });

    const targets = [];
    for (const transaction of addresses) {
      if (transaction.amountSats === wallet.getBalance()) {
        // output with MAX, a target with no value signals to send all funds
        targets.push({ address: transaction.address });
        continue;
      }
      const value = parseInt(transaction.amountSats, 10);
      if (value > 0) {
        targets.push({ address: transaction.address, value });
      } else if (transaction.amount) {
        if (currency.btcToSatoshi(transaction.amount) > 0) {
          targets.push({ address: transaction.address, value: currency.btcToSatoshi(transaction.amount) });
        }
      }
    }

    const { tx, outputs, psbt, fee } = wallet.createTransaction(
      lutxo,
      targets,
      requestedSatPerByte,
      change,
      isTransactionReplaceable ? HDSegwitBech32Wallet.defaultRBFSequence : HDSegwitBech32Wallet.finalRBFSequence,
    );

    if (tx && routeParams.launchedBy && psbt) {
      console.warn('navigating back to ', routeParams.launchedBy);
      navigation.navigate(routeParams.launchedBy, { psbt });
    }

    if (wallet.type === WatchOnlyWallet.type) {
      // watch-only wallets with enabled HW wallet support have different flow. we have to show PSBT to user as QR code
      // so he can scan it and sign it. then we have to scan it back from user (via camera and QR code), and ask
      // user whether he wants to broadcast it
      navigation.navigate('PsbtWithHardwareWallet', {
        memo: transactionMemo,
        fromWallet: wallet,
        psbt,
        launchedBy: routeParams.launchedBy,
      });
      setIsLoading(false);
      return;
    }

    if (wallet.type === MultisigHDWallet.type) {
      navigation.navigate('PsbtMultisig', {
        memo: transactionMemo,
        psbtBase64: psbt.toBase64(),
        walletID: wallet.getID(),
        launchedBy: routeParams.launchedBy,
        isTxSigned: true,
      });
      setIsLoading(false);
      return;
    }

    txMetadata[tx.getId()] = {
      txhex: tx.toHex(),
      memo: transactionMemo,
    };
    await saveToDisk();

    let recipients = outputs.filter(({ address }) => address !== change);

    if (recipients.length === 0) {
      // special case. maybe the only destination in this transaction is our own change address..?
      // (ez can be the case for single-address wallet when doing self-payment for consolidation)
      recipients = outputs;
    }

    navigation.navigate('Confirm', {
      fee: new BigNumber(fee).dividedBy(100000000).toNumber(),
      memo: transactionMemo,
      walletID: wallet.getID(),
      tx: tx.toHex(),
      recipients,
      satoshiPerByte: requestedSatPerByte,
      payjoinUrl,
      psbt,
    });
    setIsLoading(false);
  };

  const handleCoinControl = () => {
    navigation.navigate('CoinControl', {
      walletID: wallet.getID(),
      onUTXOChoose: u => setUtxo(u),
    });
  };

  // because of https://github.com/facebook/react-native/issues/21718 we use
  // onScroll for android and onMomentumScrollEnd for iOS
  const handleRecipientsScrollEnds = e => {
    if (Platform.OS === 'android') return; // for android we use handleRecipientsScroll
    const contentOffset = e.nativeEvent.contentOffset;
    const viewSize = e.nativeEvent.layoutMeasurement;
    const index = Math.floor(contentOffset.x / viewSize.width);
    scrollIndex.current = index;
  };

  const handleRecipientsScroll = e => {
    if (Platform.OS === 'ios') return; // for iOS we use handleRecipientsScrollEnds
    const contentOffset = e.nativeEvent.contentOffset;
    const viewSize = e.nativeEvent.layoutMeasurement;
    const index = Math.floor(contentOffset.x / viewSize.width);
    scrollIndex.current = index;
  };

  const onUseAllPressed = () => {
    ReactNativeHapticFeedback.trigger('notificationWarning');
    Keyboard.dismiss();
    setUnits(u => {
      u[scrollIndex.current] = BitcoinUnit.BTC;
      return [...u];
    });
    setAddresses(addrs => {
      const currentBalance = wallet.getBalance();
      addrs[scrollIndex.current].amountSats = currentBalance;
      switch (units[scrollIndex.current]) {
        case BitcoinUnit.SATS:
        case BitcoinUnit.BTC:
          addrs[scrollIndex.current].amount = currency.satoshiToBTC(currentBalance);
          break;
        case BitcoinUnit.LOCAL_CURRENCY:
          addrs[scrollIndex.current].amount = currency.satoshiToLocalCurrency(currentBalance);
          break;
      }
      return [...addrs];
    });
  };

  const formatFee = fee => formatBalance(fee, feeUnit, true);

  const stylesHook = StyleSheet.create({
    loading: {
      backgroundColor: colors.background,
    },
    root: {
      backgroundColor: colors.elevated,
    },
    modalContent: {
      backgroundColor: colors.modal,
      borderTopColor: colors.borderTopColor,
      borderWidth: colors.borderWidth,
    },
    feeModalItemActive: {
      backgroundColor: colors.feeActive,
    },
    feeModalLabel: {
      color: colors.successColor,
    },
    feeModalTime: {
      backgroundColor: colors.successColor,
    },
    feeModalTimeText: {
      color: colors.background,
    },
    feeModalValue: {
      color: colors.successColor,
    },
    feeModalCustomText: {
      color: colors.buttonAlternativeTextColor,
    },
    of: {
      color: colors.feeText,
    },
    memo: {
      borderColor: colors.formBorder,
      borderBottomColor: colors.formBorder,
      backgroundColor: colors.inputBackgroundColor,
    },
    feeLabel: {
      color: colors.feeText,
    },
    feeModalItemDisabled: {
      backgroundColor: colors.buttonDisabledBackgroundColor,
    },
    feeModalItemTextDisabled: {
      color: colors.buttonDisabledTextColor,
    },
    feeRow: {
      backgroundColor: colors.feeLabel,
    },
    feeValue: {
      color: colors.feeValue,
    },
  });

  const renderFeeSelectionModal = () => {
    const nf = networkTransactionFees;
    const options = [
      {
        label: loc.send.fee_fast,
        time: loc.send.fee_10m,
        fee: feePrecalc.fastestFee,
        rate: nf.fastestFee,
        active: Number(feeRate) === nf.fastestFee,
      },
      {
        label: loc.send.fee_medium,
        time: loc.send.fee_3h,
        fee: feePrecalc.mediumFee,
        rate: nf.mediumFee,
        active: Number(feeRate) === nf.mediumFee,
        disabled: nf.mediumFee === nf.fastestFee,
      },
      {
        label: loc.send.fee_slow,
        time: loc.send.fee_1d,
        fee: feePrecalc.slowFee,
        rate: nf.slowFee,
        active: Number(feeRate) === nf.slowFee,
        disabled: nf.slowFee === nf.mediumFee || nf.slowFee === nf.fastestFee,
      },
    ];

    return (
      <BottomModal
        deviceWidth={width + width / 2}
        isVisible={isFeeSelectionModalVisible}
        onClose={() => setIsFeeSelectionModalVisible(false)}
      >
        <KeyboardAvoidingView enabled={!Platform.isPad} behavior={Platform.OS === 'ios' ? 'position' : null}>
          <View style={[styles.modalContent, stylesHook.modalContent]}>
            {options.map(({ label, time, fee, rate, active, disabled }, index) => (
              <TouchableOpacity
                accessibilityRole="button"
                key={label}
                disabled={disabled}
                onPress={() => {
                  setFeePrecalc(fp => ({ ...fp, current: fee }));
                  setIsFeeSelectionModalVisible(false);
                  setCustomFee(rate.toString());
                }}
                style={[styles.feeModalItem, active && styles.feeModalItemActive, active && !disabled && stylesHook.feeModalItemActive]}
              >
                <View style={styles.feeModalRow}>
                  <Text style={[styles.feeModalLabel, disabled ? stylesHook.feeModalItemTextDisabled : stylesHook.feeModalLabel]}>
                    {label}
                  </Text>
                  <View style={[styles.feeModalTime, disabled ? stylesHook.feeModalItemDisabled : stylesHook.feeModalTime]}>
                    <Text style={stylesHook.feeModalTimeText}>~{time}</Text>
                  </View>
                </View>
                <View style={styles.feeModalRow}>
                  <Text style={disabled ? stylesHook.feeModalItemTextDisabled : stylesHook.feeModalValue}>{fee && formatFee(fee)}</Text>
                  <Text style={disabled ? stylesHook.feeModalItemTextDisabled : stylesHook.feeModalValue}>
                    {rate} {loc.units.sat_vbyte}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              testID="feeCustom"
              accessibilityRole="button"
              style={styles.feeModalCustom}
              onPress={async () => {
                let error = loc.send.fee_satvbyte;
                while (true) {
                  let fee;

                  try {
                    fee = await prompt(loc.send.create_fee, error, true, 'numeric');
                  } catch (_) {
                    return;
                  }

                  if (!/^\d+$/.test(fee)) {
                    error = loc.send.details_fee_field_is_not_valid;
                    continue;
                  }

                  if (fee < 1) fee = '1';
                  fee = Number(fee).toString(); // this will remove leading zeros if any
                  setCustomFee(fee);
                  setIsFeeSelectionModalVisible(false);
                  return;
                }
              }}
            >
              <Text style={[styles.feeModalCustomText, stylesHook.feeModalCustomText]}>{loc.send.fee_custom}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </BottomModal>
    );
  };

  const renderCreateButton = () => {
    return (
      <View style={styles.createButton}>
        {isLoading ? (
          <ActivityIndicator />
        ) : (
          <BlueButton onPress={createTransaction} title={loc.send.details_next} testID="CreateTransactionButton" />
        )}
      </View>
    );
  };

  const renderBitcoinTransactionInfoFields = params => {
    const { item, index } = params;
    return (
      <View style={{ width }} testID={'Transaction' + index}>
        <AmountInput
          isLoading={isLoading}
          amount={item.amount ? item.amount.toString() : null}
          onAmountUnitChange={unit => {
            setAddresses(addrs => {
              const addr = addrs[index];

              switch (unit) {
                case BitcoinUnit.SATS:
                  addr.amountSats = parseInt(addr.amount, 10);
                  break;
                case BitcoinUnit.BTC:
                  addr.amountSats = currency.btcToSatoshi(addr.amount);
                  break;
                case BitcoinUnit.LOCAL_CURRENCY:
                  // also accounting for cached fiat->sat conversion to avoid rounding error
                  addr.amountSats = AmountInput.getCachedSatoshis(addr.amount) || currency.btcToSatoshi(currency.fiatToBTC(addr.amount));
                  break;
              }

              addrs[index] = addr;
              return [...addrs];
            });
            setUnits(u => {
              u[index] = unit;
              return [...u];
            });
          }}
          onChangeText={text => {
            setAddresses(addrs => {
              item.amount = text;
              switch (units[index] || amountUnit) {
                case BitcoinUnit.BTC:
                  item.amountSats = currency.btcToSatoshi(item.amount);
                  break;
                case BitcoinUnit.LOCAL_CURRENCY:
                  item.amountSats = currency.btcToSatoshi(currency.fiatToBTC(item.amount));
                  break;
                case BitcoinUnit.SATS:
                default:
                  item.amountSats = parseInt(text, 10);
                  break;
              }
              addrs[index] = item;
              return [...addrs];
            });
          }}
          unit={units[index] || amountUnit}
          editable={isEditable}
          disabled={!isEditable}
          inputAccessoryViewID={InputAccessoryAllFunds.InputAccessoryViewID}
          showMaxButton
          onPressMax={onUseAllPressed}
        />

        {frozenBalance > 0 && (
          <TouchableOpacity accessibilityRole="button" style={styles.frozenContainer} onPress={handleCoinControl}>
            <BlueText>
              {loc.formatString(loc.send.details_frozen, { amount: formatBalanceWithoutSuffix(frozenBalance, BitcoinUnit.BTC, true) })}
            </BlueText>
          </TouchableOpacity>
        )}

        <AddressInput
          onChangeText={text => {
            text = text.trim();
            const { address, amount, memo, payjoinUrl: pjUrl } = DeeplinkSchemaMatch.decodeBitcoinUri(text);
            setAddresses(addrs => {
              item.address = address || text;
              item.amount = amount || item.amount;
              addrs[index] = item;
              return [...addrs];
            });
            setTransactionMemo(memo || transactionMemo);
            setIsLoading(false);
            setPayjoinUrl(pjUrl);
          }}
          onBarScanned={processAddressData}
          address={item.address}
          isLoading={isLoading}
          inputAccessoryViewID={BlueDismissKeyboardInputAccessory.InputAccessoryViewID}
          launchedBy={name}
          editable={isEditable}
        />
        {addresses.length > 1 && (
          <Text style={[styles.of, stylesHook.of]}>{loc.formatString(loc._.of, { number: index + 1, total: addresses.length })}</Text>
        )}
      </View>
    );
  };

  if (isLoading || !wallet) {
    return (
      <View style={[styles.loading, stylesHook.loading]}>
        <BlueLoading />
      </View>
    );
  }

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={[styles.root, stylesHook.root]} onLayout={e => setWidth(e.nativeEvent.layout.width)}>
        <StatusBar barStyle="light-content" />
        <View>
          <KeyboardAvoidingView enabled={!Platform.isPad} behavior="position">
            <View style={styles.pickerContainer}>
              <BlueWalletSelect wallets={wallets} value={wallet?.getID()} onChange={onWalletChange} />
            </View>
            <FlatList
              keyboardShouldPersistTaps="always"
              scrollEnabled={addresses.length > 1}
              data={addresses}
              renderItem={renderBitcoinTransactionInfoFields}
              ref={scrollView}
              horizontal
              pagingEnabled
              removeClippedSubviews={false}
              onMomentumScrollBegin={Keyboard.dismiss}
              onMomentumScrollEnd={handleRecipientsScrollEnds}
              onScroll={handleRecipientsScroll}
              scrollEventThrottle={200}
              scrollIndicatorInsets={styles.scrollViewIndicator}
              contentContainerStyle={styles.scrollViewContent}
            />
            <View style={[styles.memo, stylesHook.memo]}>
              <TextInput
                onChangeText={setTransactionMemo}
                placeholder={loc.send.details_note_placeholder}
                placeholderTextColor="#81868e"
                value={transactionMemo}
                numberOfLines={1}
                style={styles.memoText}
                editable={!isLoading}
                onSubmitEditing={Keyboard.dismiss}
                inputAccessoryViewID={BlueDismissKeyboardInputAccessory.InputAccessoryViewID}
              />
            </View>
            <TouchableOpacity
              testID="chooseFee"
              accessibilityRole="button"
              onPress={() => setIsFeeSelectionModalVisible(true)}
              disabled={isLoading}
              style={styles.fee}
            >
              <Text style={[styles.feeLabel, stylesHook.feeLabel]}>{loc.send.create_fee}</Text>

              {networkTransactionFeesIsLoading ? (
                <ActivityIndicator />
              ) : (
                <View style={[styles.feeRow, stylesHook.feeRow]}>
                  <Text style={stylesHook.feeValue}>
                    {feePrecalc.current ? formatFee(feePrecalc.current) : feeRate + ' ' + loc.units.sat_vbyte}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
            {renderFeeSelectionModal()}
          </KeyboardAvoidingView>
        </View>
        {renderCreateButton()}
        <BlueDismissKeyboardInputAccessory />
        {Platform.select({
          ios: <InputAccessoryAllFunds canUseAll={balance > 0} onUseAllPressed={onUseAllPressed} balance={allBalance} />,
          android: isAmountToolbarVisibleForAndroid && (
            <InputAccessoryAllFunds canUseAll={balance > 0} onUseAllPressed={onUseAllPressed} balance={allBalance} />
          ),
        })}
      </View>
    </TouchableWithoutFeedback>
  );
};

export default SendDetails;

SendDetails.actionKeys = {
  SignPSBT: 'SignPSBT',
  SendMax: 'SendMax',
  AddRecipient: 'AddRecipient',
  RemoveRecipient: 'RemoveRecipient',
  AllowRBF: 'AllowRBF',
  ImportTransaction: 'ImportTransaction',
  ImportTransactionMultsig: 'ImportTransactionMultisig',
  ImportTransactionQR: 'ImportTransactionQR',
  CoinControl: 'CoinControl',
  CoSignTransaction: 'CoSignTransaction',
};

SendDetails.actionIcons = {
  SignPSBT: { iconType: 'SYSTEM', iconValue: 'signature' },
  SendMax: 'SendMax',
  AddRecipient: { iconType: 'SYSTEM', iconValue: 'person.badge.plus' },
  RemoveRecipient: { iconType: 'SYSTEM', iconValue: 'person.badge.minus' },
  AllowRBF: 'AllowRBF',
  ImportTransaction: { iconType: 'SYSTEM', iconValue: 'square.and.arrow.down' },
  ImportTransactionMultsig: { iconType: 'SYSTEM', iconValue: 'square.and.arrow.down.on.square' },
  ImportTransactionQR: { iconType: 'SYSTEM', iconValue: 'qrcode.viewfinder' },
  CoinControl: { iconType: 'SYSTEM', iconValue: 'switch.2' },
};

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    paddingTop: 20,
  },
  root: {
    flex: 1,
    justifyContent: 'space-between',
  },
  scrollViewContent: {
    flexDirection: 'row',
  },
  scrollViewIndicator: {
    top: 0,
    left: 8,
    bottom: 0,
    right: 8,
  },
  modalContent: {
    padding: 22,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    minHeight: 200,
  },
  feeModalItem: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginBottom: 10,
  },
  feeModalItemActive: {
    borderRadius: 8,
  },
  feeModalRow: {
    justifyContent: 'space-between',
    flexDirection: 'row',
    alignItems: 'center',
  },
  feeModalLabel: {
    fontSize: 22,
    fontWeight: '600',
  },
  feeModalTime: {
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  feeModalCustom: {
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feeModalCustomText: {
    fontSize: 15,
    fontWeight: '600',
  },
  createButton: {
    marginVertical: 16,
    marginHorizontal: 16,
    alignContent: 'center',
    minHeight: 44,
  },
  of: {
    alignSelf: 'flex-end',
    marginRight: 18,
    marginVertical: 8,
  },
  memo: {
    flexDirection: 'row',
    borderWidth: 1,
    borderBottomWidth: 0.5,
    minHeight: 44,
    height: 44,
    marginHorizontal: 20,
    alignItems: 'center',
    marginVertical: 8,
    borderRadius: 4,
  },
  memoText: {
    flex: 1,
    marginHorizontal: 8,
    minHeight: 33,
    color: '#81868e',
  },
  fee: {
    flexDirection: 'row',
    marginHorizontal: 20,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  feeLabel: {
    fontSize: 14,
  },
  feeRow: {
    minWidth: 40,
    height: 25,
    borderRadius: 4,
    justifyContent: 'space-between',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  frozenContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 8,
  },
  pickerContainer: { marginHorizontal: 16 },
});

SendDetails.navigationOptions = navigationStyle(
  {
    closeButton: true,
    headerHideBackButton: true,
  },
  options => ({
    ...options,
    title: loc.send.header,
  }),
);
