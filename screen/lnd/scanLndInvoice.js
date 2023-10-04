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
  const { wallets, fetchAndSaveWalletTransactions } = useContext(BlueStorageContext);
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
  const [isAmountInitiallyEmpty, setIsAmountInitiallyEmpty] = useState();
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
      if (Lnurl.isLightningAddress(uri)) return processLnurlPay(uri);

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
        setAmount(newDecoded.num_satoshis);
        setExpiresIn(newExpiresIn);
        setDecoded(newDecoded);
      } catch (Err) {
        ReactNativeHapticFeedback.trigger('notificationError', { ignoreAndroidSystemSettings: false });
        Keyboard.dismiss();
        setParams({ uri: undefined });
        setTimeout(() => alert(Err.message), 10);
        setIsLoading(false);
        setAmount();
        setDestination();
        setExpiresIn();
        setDecoded();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);
  const processInvoice = data => {
    if (Lnurl.isLnurl(data)) return processLnurlPay(data);
    if (Lnurl.isLightningAddress(data)) return processLnurlPay(data);
    setParams({ uri: data });
  };

  const processLnurlPay = data => {
    navigate('SendDetailsRoot', {
      screen: 'LnurlPay',
      params: {
        lnurl: data,
        walletID: walletID || wallet.getID(),
      },
    });
  };

  const pay = async () => {
    if (!decoded) {
      return null;
    }

    const isBiometricsEnabled = await Biometric.isBiometricUseCapableAndEnabled();

    if (isBiometricsEnabled) {
      if (!(await Biometric.unlockWithBiometrics())) {
        return;
      }
    }

    let amountSats = amount;
    switch (unit) {
      case BitcoinUnit.SATS:
        amountSats = parseInt(amountSats, 10); // nop
        break;
      case BitcoinUnit.BTC:
        amountSats = currency.btcToSatoshi(amountSats);
        break;
      case BitcoinUnit.LOCAL_CURRENCY:
        amountSats = currency.btcToSatoshi(currency.fiatToBTC(amountSats));
        break;
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

    try {
      await wallet.payInvoice(invoice, amountSats);
    } catch (Err) {
      console.log(Err.message);
      setIsLoading(false);
      ReactNativeHapticFeedback.trigger('notificationError', { ignoreAndroidSystemSettings: false });
      return alert(Err.message);
    }

    navigate('Success', {
      amount: amountSats,
      amountUnit: BitcoinUnit.SATS,
      invoiceDescription: decoded.description,
    });
    fetchAndSaveWalletTransactions(wallet.getID());
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
    if (!decoded) {
      return true;
    } else {
      if (!amount) {
        return true;
      }
    }
    return !(amount > 0);
    // return decoded.num_satoshis <= 0 || isLoading || isNaN(decoded.num_satoshis);
  };

  const getFees = () => {
    const min = Math.floor(decoded.num_satoshis * 0.003);
    const max = Math.floor(decoded.num_satoshis * 0.01) + 1;
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
                pointerEvents={isAmountInitiallyEmpty ? 'auto' : 'none'}
                isLoading={isLoading}
                amount={amount}
                onAmountUnitChange={setUnit}
                onChangeText={setAmount}
                disabled={!decoded || isLoading || decoded.num_satoshis > 0}
                unit={unit}
                inputAccessoryViewID={BlueDismissKeyboardInputAccessory.InputAccessoryViewID}
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
                value={decoded?.description}
                onChangeText={console.log}
                editable={false}
                color={colors.feeText}
              />
            </View>

            <View style={styles.fee}>
              <BlueText style={stylesHook.fee}>{loc.send.create_fee}</BlueText>
              <BlueText style={stylesHook.fee}>{decoded?.num_satoshis > 0 ? getFees() : '-'}</BlueText>
            </View>
            <BlueCard>
              {isLoading ? (
                <View>
                  <ActivityIndicator />
                </View>
              ) : (
                <View>
                  <BlueButton title={loc.lnd.payButton} onPress={pay} disabled={shouldDisablePayButton()} />
                </View>
              )}
            </BlueCard>
          </KeyboardAvoidingView>
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
