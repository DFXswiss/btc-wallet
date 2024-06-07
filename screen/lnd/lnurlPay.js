import React, { useState, useEffect, useContext } from 'react';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation, useRoute, useTheme } from '@react-navigation/native';

import {
  BlueButton,
  BlueCard,
  BlueCopyTextToClipboard,
  BlueDismissKeyboardInputAccessory,
  BlueLoading,
  BlueSpacing10,
  BlueSpacing20,
  BlueText,
  SafeBlueArea,
} from '../../BlueComponents';
import navigationStyle from '../../components/navigationStyle';
import AmountInput from '../../components/AmountInput';
import Lnurl from '../../class/lnurl';
import { BitcoinUnit } from '../../models/bitcoinUnits';
import loc from '../../loc';
import Biometric from '../../class/biometrics';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import alert from '../../components/Alert';
import { Text } from 'react-native-elements';
const currency = require('../../blue_modules/currency');

/**
 * if user has default currency - fiat, attempting to pay will trigger conversion from entered in input field fiat value
 * to satoshi, and attempt to pay this satoshi value, which might be a little bit off from `min` & `max` values
 * provided by LnUrl. thats why we cache initial precise conversion rate so the reverse conversion wont be off.
 */
const _cacheFiatToSat = {};

const LnurlPay = () => {
  const { wallets, fetchAndSaveWalletTransactions } = useContext(BlueStorageContext);
  const { walletID, lnurl, amountSat, destination, invoice, amountUnit, description } = useRoute().params;
  /** @type {LightningCustodianWallet} */
  const wallet = wallets.find(w => w.getID() === walletID);
  const [unit, setUnit] = useState(wallet.getPreferredBalanceUnit());
  const [isLoading, setIsLoading] = useState(true);
  const [_LN, setLN] = useState();
  const [payButtonDisabled, setPayButtonDisabled] = useState(true);
  const [payload, setPayload] = useState();
  const { pop, navigate } = useNavigation();
  const [amount, setAmount] = useState();
  const [desc, setDesc] = useState();
  const { colors } = useTheme();
  const stylesHook = StyleSheet.create({
    root: {
      backgroundColor: colors.background,
    },
    input: {
      color: colors.alternativeTextColor2,
    },
  });

  useEffect(() => {
    const isLightningAddress = destination && Lnurl.isLightningAddress(destination);
    if (lnurl || isLightningAddress) {
      const recepient = isLightningAddress ? destination : lnurl;
      const ln = new Lnurl(recepient, AsyncStorage);
      ln.callLnurlPayService()
        .then(setPayload)
        .catch(error => {
          alert(error.message);
          pop();
        });
      setLN(ln);
      setDesc(description);
      setIsLoading(false);
    }
  }, [lnurl, pop]);

  useEffect(() => {
    if (invoice) {
      setAmount(amountSat);
      setUnit(amountUnit);
      setIsLoading(false);
    }
  }, [invoice]);

  useEffect(() => {
    setPayButtonDisabled(isLoading);
  }, [isLoading]);

  useEffect(() => {
    if (payload) {
      /** @type {Lnurl} */
      const LN = _LN;
      let originalSatAmount;
      let newAmount = (originalSatAmount = amountSat ?? LN.getMin());
      if (!newAmount) {
        alert('Internal error: incorrect LNURL amount');
        return;
      }
      switch (unit) {
        case BitcoinUnit.BTC:
          newAmount = currency.satoshiToBTC(newAmount);
          break;
        case BitcoinUnit.LOCAL_CURRENCY:
          newAmount = currency.satoshiToLocalCurrency(newAmount, false);
          _cacheFiatToSat[newAmount] = originalSatAmount;
          break;
      }
      setAmount(newAmount);
      setDesc(payload?.description);
    }
  }, [payload]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleBolt11Invoice = async amountSats => {
    /** @type {Lnurl} */
    const LN = _LN;

    let bolt11payload;
    let comment;
    if (LN.getCommentAllowed()) {
      comment = description;
    }

    bolt11payload = await LN.requestBolt11FromLnurlPayService(amountSats, comment);
    await wallet.payInvoice(bolt11payload.pr);
    const decoded = wallet.decodeInvoice(bolt11payload.pr);
    setPayButtonDisabled(false);

    // success, probably
    ReactNativeHapticFeedback.trigger('notificationSuccess', { ignoreAndroidSystemSettings: false });
    if (wallet.last_paid_invoice_result && wallet.last_paid_invoice_result.payment_preimage) {
      await LN.storeSuccess(decoded.payment_hash, wallet.last_paid_invoice_result.payment_preimage);
    }

    navigate('SendDetailsRoot', {
      screen: 'LnurlPaySuccess',
      params: {
        paymentHash: decoded.payment_hash,
        justPaid: true,
        fromWalletID: walletID,
      },
    });
  };

  const handleLnInvoice = async amountSats => {
    await wallet.payInvoice(invoice, amountSats);
    const decoded = wallet.decodeInvoice(invoice);
    navigate('Success', {
      amount: amountSats,
      amountUnit: BitcoinUnit.SATS,
      invoiceDescription: decoded.description,
    });
    fetchAndSaveWalletTransactions(wallet.getID());
  };

  const pay = async () => {
    setPayButtonDisabled(true);

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
        if (_cacheFiatToSat[amount]) {
          amountSats = _cacheFiatToSat[amount];
        } else {
          amountSats = currency.btcToSatoshi(currency.fiatToBTC(amountSats));
        }
        break;
    }

    try {
      if (invoice) {
        await handleLnInvoice(amountSats);
      } else {
        await handleBolt11Invoice(amountSats);
      }

      fetchAndSaveWalletTransactions(wallet.getID());
      setIsLoading(false);
    } catch (Err) {
      console.log(Err.message);
      setIsLoading(false);
      setPayButtonDisabled(false);
      ReactNativeHapticFeedback.trigger('notificationError', { ignoreAndroidSystemSettings: false });
      return alert(Err.message);
    }
  };

  const getFees = () => {
    const min = 0;
    const max = Math.floor(amount * 0.03);
    return `${min} ${BitcoinUnit.SATS} - ${max} ${BitcoinUnit.SATS}`;
  };

  const renderGotPayload = () => {
    return (
      <SafeBlueArea style={styles.payRoot}>
        <ScrollView>
          <BlueCard>
            <AmountInput
              isLoading={isLoading}
              amount={amount && amount.toString()}
              onAmountUnitChange={setUnit}
              onChangeText={setAmount}
              disabled={true}
              unit={unit}
              inputAccessoryViewID={BlueDismissKeyboardInputAccessory.InputAccessoryViewID}
              inputStyle={stylesHook.input}
              unitStyle={stylesHook.input}
            />
            <BlueSpacing20 />
            {payload?.image && (
              <>
                <Image style={styles.img} source={{ uri: payload?.image }} />
                <BlueSpacing20 />
              </>
            )}
            {description && (
              <>
                <BlueText style={styles.alignSelfCenter}>{description}</BlueText>
                <BlueSpacing10 />
              </>
            )}
            {desc && (
              <>
                <BlueText style={styles.alignSelfCenter}>{desc}</BlueText>
                <BlueSpacing10 />
              </>
            )}
            {payload?.domain && (
              <>
                <BlueText style={styles.alignSelfCenter}>{payload?.domain}</BlueText>
                <BlueSpacing10 />
              </>
            )}
            {invoice && <BlueCopyTextToClipboard text={invoice} truncated />}
          </BlueCard>
        </ScrollView>
        <View style={styles.buttonContainer}>
          {payButtonDisabled ? (
            <BlueLoading />
          ) : (
            <>
              <Text style={styles.fees}>
                {loc.send.create_fee}: {getFees()}
              </Text>
              <BlueButton title={loc.lnd.payButton} onPress={pay} />
            </>
          )}
          <BlueSpacing20 />
        </View>
      </SafeBlueArea>
    );
  };

  return isLoading || wallet === undefined || amount === undefined ? (
    <View style={[styles.root, stylesHook.root]}>
      <BlueLoading />
    </View>
  ) : (
    renderGotPayload()
  );
};

export default LnurlPay;

const styles = StyleSheet.create({
  img: { width: 200, height: 200, alignSelf: 'center' },
  alignSelfCenter: {
    alignSelf: 'center',
  },
  root: {
    flex: 1,
    justifyContent: 'center',
  },
  buttonContainer: {
    paddingHorizontal: 16,
  },
  payRoot: {
    flex: 1,
  },
  fees: {
    flexDirection: 'row',
    color: '#37c0a1',
    fontSize: 14,
    marginVertical: 8,
    marginHorizontal: 24,
    paddingBottom: 6,
    fontWeight: '500',
    alignSelf: 'center',
  },
});

LnurlPay.navigationOptions = navigationStyle({
  title: '',
  closeButton: true,
  closeButtonFunc: ({ navigation }) => navigation.dangerouslyGetParent().popToTop(),
});
