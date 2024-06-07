import React, { useCallback, useContext, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, View, StatusBar, Keyboard, ScrollView, StyleSheet } from 'react-native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import { useFocusEffect, useNavigation, useRoute, useTheme } from '@react-navigation/native';

import {
  BlueButton,
  BlueCard,
  BlueDismissKeyboardInputAccessory,
  BlueLoading,
  SafeBlueArea,
  BlueWalletSelect,
  BlueFormInput,
  BlueText,
} from '../../BlueComponents';
import navigationStyle from '../../components/navigationStyle';
import AddressInput from '../../components/AddressInput';
import AmountInput from '../../components/AmountInput';
import Lnurl from '../../class/lnurl';
import { BitcoinUnit, Chain } from '../../models/bitcoinUnits';
import Biometric from '../../class/biometrics';
import loc from '../../loc';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import alert from '../../components/Alert';
const currency = require('../../blue_modules/currency');

const ScanLndInvoice = () => {
  const { wallets } = useContext(BlueStorageContext);
  const { colors } = useTheme();
  const { walletID, uri, invoice } = useRoute().params;
  const name = useRoute().name;
  /** @type {LightningCustodianWallet} */
  const [wallet, setWallet] = useState(
    wallets.find(item => item.getID() === walletID) || wallets.find(item => item.chain === Chain.OFFCHAIN),
  );
  const { navigate, setParams, goBack, replace } = useNavigation();
  const [isLoading, setIsLoading] = useState(false);
  const [destination, setDestination] = useState('');
  const [unit, setUnit] = useState(BitcoinUnit.SATS);
  const [decoded, setDecoded] = useState();
  const [amount, setAmount] = useState();
  const [amountSat, setAmountSat] = useState();
  const [isAmountInitiallyEmpty, setIsAmountInitiallyEmpty] = useState();
  const [desc, setDesc] = useState();
  const [expiresIn, setExpiresIn] = useState();
  const stylesHook = StyleSheet.create({
    root: {
      backgroundColor: colors.elevated,
    },
    expiresIn: {
      color: colors.feeText,
      fontSize: 12,
      marginBottom: 5,
      marginHorizontal: 30,
    },
    fee: {
      fontSize: 14,
      color: colors.feeText,
    },
  });

  useEffect(() => {
    if (walletID && wallet?.getID() !== walletID) {
      setWallet(wallets.find(w => w.getID() === walletID));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletID]);

  useFocusEffect(
    useCallback(() => {
      if (!wallet) {
        ReactNativeHapticFeedback.trigger('notificationError', { ignoreAndroidSystemSettings: false });
        goBack();
        setTimeout(() => alert(loc.wallets.no_ln_wallet_error), 500);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [wallet]),
  );

  useEffect(() => {
    if (wallet && uri) {
      if (Lnurl.isLnurl(uri)) return processLnurlPay(uri);
      if (Lnurl.isLightningAddress(uri)) return setDestination(uri);

      let data = uri;
      // handling BIP21 w/BOLT11 support
      const ind = data.indexOf('lightning=');
      if (ind !== -1) {
        data = data.substring(ind + 10).split('&')[0];
      }

      data = data.replace('LIGHTNING:', '').replace('lightning:', '');
      console.log(data);

      let newDecoded;
      try {
        newDecoded = wallet.decodeInvoice(data);

        let newExpiresIn = (newDecoded.timestamp * 1 + newDecoded.expiry * 1) * 1000; // ms
        if (+new Date() > newExpiresIn) {
          newExpiresIn = loc.lnd.expired;
        } else {
          const time = Math.round((newExpiresIn - +new Date()) / (60 * 1000));
          newExpiresIn = loc.formatString(loc.lnd.expiresIn, { time });
        }
        Keyboard.dismiss();
        setParams({ uri: undefined, invoice: data });
        setIsAmountInitiallyEmpty(newDecoded.num_satoshis === '0');
        setDestination(data);
        setIsLoading(false);
        setUnit(BitcoinUnit.SATS);
        setAmount(newDecoded.num_satoshis);
        setAmountSat(newDecoded.num_satoshis);
        setExpiresIn(newExpiresIn);
        setDecoded(newDecoded);
        setDesc(newDecoded.description);
      } catch (Err) {
        ReactNativeHapticFeedback.trigger('notificationError', { ignoreAndroidSystemSettings: false });
        Keyboard.dismiss();
        setParams({ uri: undefined });
        setTimeout(() => alert(Err.message), 10);
        setIsLoading(false);
        setAmount();
        setAmountSat();
        setDestination();
        setExpiresIn();
        setDecoded();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);

  const processInvoice = data => {
    if (Lnurl.isLnurl(data)) return processLnurlPay(data);
    if (Lnurl.isLightningAddress(data)) return setDestination(data);
    setParams({ uri: data });
  };

  const processLnurlPay = () => {
    let error;
    if(amountSat === 0) {
      error = loc.send.details_amount_field_is_not_valid;
    }else if(!Lnurl.isLightningAddress(destination)) {
      error = loc.send.details_address_field_is_not_valid;
    }

    if (error) {
      alert(error);
      ReactNativeHapticFeedback.trigger('notificationError', { ignoreAndroidSystemSettings: false });
      return;
    }
    const isMax = amount === wallet.getBalance();
    navigate('SendDetailsRoot', {
      screen: 'LnurlPay',
      params: {
        destination: destination,
        amountSat: isMax ? Math.floor(amount * 0.97) : amountSat, // max 3% fee set by LNBits
        description: desc,
        walletID: walletID || wallet.getID(),
      },
    });
  };

  const processInvoicePay = async () => {
    if (!decoded) {
      return null;
    }

    const isBiometricsEnabled = await Biometric.isBiometricUseCapableAndEnabled();

    if (isBiometricsEnabled) {
      if (!(await Biometric.unlockWithBiometrics())) {
        return;
      }
    }

    setIsLoading(true);

    const newExpiresIn = (decoded.timestamp * 1 + decoded.expiry * 1) * 1000; // ms
    if (+new Date() > newExpiresIn) {
      setIsLoading(false);
      ReactNativeHapticFeedback.trigger('notificationError', { ignoreAndroidSystemSettings: false });
      return alert(loc.lnd.errorInvoiceExpired);
    }

    const currentUserInvoices = wallet.user_invoices_raw; // not fetching invoices, as we assume they were loaded previously
    if (currentUserInvoices.some(i => i.payment_hash === decoded.payment_hash)) {
      setIsLoading(false);
      ReactNativeHapticFeedback.trigger('notificationError', { ignoreAndroidSystemSettings: false });
      return alert(loc.lnd.sameWalletAsInvoiceError);
    }

    setIsLoading(false);
    return navigate('SendDetailsRoot', {
      screen: 'LnurlPay',
      params: {
        invoice: invoice,
        amountSat: amountSat,
        amountUnit: BitcoinUnit.SATS,
        description: decoded.description,
        walletID: walletID || wallet.getID(),
      },
    });
  };

  const next = () => {
    if (wallet.getBalance() < amount) {
      return alert(loc.send.details_total_exceeds_balance);
    }

    if (invoice) {
      return processInvoicePay();
    }
    processLnurlPay(destination);
  };

  const processTextForInvoice = text => {
    if (
      text.toLowerCase().startsWith('lnb') ||
      text.toLowerCase().startsWith('lightning:lnb') ||
      Lnurl.isLnurl(text) ||
      Lnurl.isLightningAddress(text)
    ) {
      processInvoice(text);
    } else {
      setDecoded(undefined);
      setExpiresIn(undefined);
      setDestination(text);
    }
  };

  const shouldDisablePayButton = () => {
    if (invoice && !decoded) {
      return true;
    } else {
      if (!amount) {
        return true;
      }
    }
    return !(amount > 0);
  };

  const getFees = () => {
    const min = 0;
    const max = Math.floor(amountSat * 0.03);
    return `${min} ${BitcoinUnit.SATS} - ${max} ${BitcoinUnit.SATS}`;
  };

  const onBlur = () => {
    processTextForInvoice(destination);
  };

  const onWalletChange = id => {
    const newWallet = wallets.find(w => w.getID() === id);
    if (!newWallet) return;

    if (newWallet.chain !== Chain.OFFCHAIN) {
      return replace('SendDetails', { walletID: id });
    }

    setParams({ walletID: id });
  };

  const getAreInputsDisabled = () => {
    if (invoice) {
      return !decoded || isLoading || decoded.num_satoshis > 0;
    }
  };

  const onUseAllPressed = () => {
    setAmount(wallet.getBalance());
    setAmountSat(wallet.getBalance());
    setUnit(BitcoinUnit.SATS);
  };

  const handleAmountInputChange = (text, newUnit) => {
    setAmount(text);
    
    let sats;
    switch (newUnit || unit) {
      case BitcoinUnit.BTC:
        sats = currency.btcToSatoshi(text);
        break;
      case BitcoinUnit.LOCAL_CURRENCY:
        sats = AmountInput.getCachedSatoshis(text) || currency.btcToSatoshi(currency.fiatToBTC(text));
        break;
      case BitcoinUnit.SATS:
        sats = parseInt(text, 10);
        break;
    }
    setAmountSat(sats);
  }

  if (wallet === undefined || !wallet) {
    return (
      <View style={[styles.loadingIndicator, stylesHook.root]}>
        <BlueLoading />
      </View>
    );
  }

  return (
    <SafeBlueArea style={stylesHook.root}>
      <StatusBar barStyle="light-content" />
      <View style={[styles.root, stylesHook.root]}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <KeyboardAvoidingView enabled behavior="position" keyboardVerticalOffset={20}>
            <View style={styles.pickerContainer}>
              <BlueWalletSelect wallets={wallets} value={wallet?.getID()} onChange={onWalletChange} />
            </View>

            <View>
              <AmountInput
                isLoading={isLoading}
                amount={amount}
                onAmountUnitChange={setUnit}
                onChangeText={handleAmountInputChange}
                disabled={getAreInputsDisabled()}
                unit={unit}
                inputAccessoryViewID={BlueDismissKeyboardInputAccessory.InputAccessoryViewID}
                showMaxButton
                onPressMax={onUseAllPressed}
              />
            </View>

            <AddressInput
              onChangeText={text => {
                text = text.trim();
                setDestination(text);
              }}
              onBarScanned={processInvoice}
              address={destination}
              isLoading={isLoading}
              placeholder={loc.lnd.placeholder}
              inputAccessoryViewID={BlueDismissKeyboardInputAccessory.InputAccessoryViewID}
              launchedBy={name}
              onBlur={onBlur}
              keyboardType="email-address"
            />

            {expiresIn !== undefined && (
              <View>
                <BlueText style={stylesHook.expiresIn}>{expiresIn}</BlueText>
              </View>
            )}

            <View style={styles.noteContainer}>
              <BlueFormInput
                placeholder={loc.send.details_note_placeholder}
                placeholderTextColor={colors.feeText}
                value={desc}
                onChangeText={setDesc}
                editable={!getAreInputsDisabled()}
                color={colors.feeText}
              />
            </View>
            <View style={styles.fee}>
              <BlueText style={stylesHook.fee}>{loc.send.create_fee}</BlueText>
              <BlueText style={stylesHook.fee}>{amountSat > 0 ? getFees() : '-'}</BlueText>
            </View>
          </KeyboardAvoidingView>
          <BlueCard>
            {isLoading ? (
              <View>
                <ActivityIndicator />
              </View>
            ) : (
              <View>
                <BlueButton title={loc.lnd.next} onPress={next} disabled={shouldDisablePayButton()} />
              </View>
            )}
          </BlueCard>
        </ScrollView>
      </View>
      <BlueDismissKeyboardInputAccessory />
    </SafeBlueArea>
  );
};

export default ScanLndInvoice;
ScanLndInvoice.navigationOptions = navigationStyle(
  {
    closeButton: true,
    headerHideBackButton: true,
  },
  opts => ({ ...opts, title: loc.send.header }),
);

const styles = StyleSheet.create({
  loadingIndicator: {
    flex: 1,
    justifyContent: 'center',
  },
  root: {
    flex: 1,
  },
  scroll: {
    flex: 1,
    justifyContent: 'space-between',
  },
  pickerContainer: { marginHorizontal: 16 },
  noteContainer: { marginHorizontal: 20, marginTop: 10 },
  fee: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: 8,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
