import React, { useState, useEffect, useContext } from 'react';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation, useRoute, useTheme } from '@react-navigation/native';

import {
  BlueButton,
  BlueCard,
  BlueDismissKeyboardInputAccessory,
  BlueLoading,
  BlueSpacing20,
  BlueText,
  SafeBlueArea,
} from '../../BlueComponents';
import navigationStyle from '../../components/navigationStyle';
import AmountInput from '../../components/AmountInput';
import Lnurl from '../../class/lnurl';
import { BitcoinUnit } from '../../models/bitcoinUnits';
import loc, { formatBalance } from '../../loc';
import Biometric from '../../class/biometrics';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import alert from '../../components/Alert';
const prompt = require('../../helpers/prompt');
const currency = require('../../blue_modules/currency');

/**
 * if user has default currency - fiat, attempting to pay will trigger conversion from entered in input field fiat value
 * to satoshi, and attempt to pay this satoshi value, which might be a little bit off from `min` & `max` values
 * provided by LnUrl. thats why we cache initial precise conversion rate so the reverse conversion wont be off.
 */
const _cacheFiatToSat = {};

const LnurlPay = () => {
  const { wallets } = useContext(BlueStorageContext);
  const { walletID, lnurl, amountSat } = useRoute().params;
  /** @type {LightningCustodianWallet} */
  const wallet = wallets.find(w => w.getID() === walletID);
  const [unit, setUnit] = useState(wallet.getPreferredBalanceUnit());
  const [isLoading, setIsLoading] = useState(true);
  const [_LN, setLN] = useState();
  const [payButtonDisabled, setPayButtonDisabled] = useState(true);
  const [payload, setPayload] = useState();
  const { pop, navigate } = useNavigation();
  const [amount, setAmount] = useState();
  const { colors } = useTheme();
  const stylesHook = StyleSheet.create({
    root: {
      backgroundColor: colors.background,
    },
  });

  useEffect(() => {
    if (lnurl) {
      const ln = new Lnurl(lnurl, AsyncStorage);
      ln.callLnurlPayService()
        .then(setPayload)
        .catch(error => {
          alert(error.message);
          pop();
        });
      setLN(ln);
      setIsLoading(false);
    }
  }, [lnurl, pop]);

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
    }
  }, [payload]); // eslint-disable-line react-hooks/exhaustive-deps

  const pay = async () => {
    setPayButtonDisabled(true);
    /** @type {Lnurl} */
    const LN = _LN;

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

    let bolt11payload;
    try {
      let comment;
      if (LN.getCommentAllowed()) {
        comment = await prompt('Comment', '', false, 'plain-text');
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
      setIsLoading(false);
    } catch (Err) {
      console.log(Err.message);
      setIsLoading(false);
      setPayButtonDisabled(false);
      ReactNativeHapticFeedback.trigger('notificationError', { ignoreAndroidSystemSettings: false });
      return alert(Err.message);
    }
  };

  const renderGotPayload = () => {
    return (
      <SafeBlueArea>
        <ScrollView contentContainertyle={{ justifyContent: 'space-around' }}>
          <BlueCard>
            <AmountInput
              isLoading={isLoading}
              amount={amount && amount.toString()}
              onAmountUnitChange={setUnit}
              onChangeText={setAmount}
              disabled={payload && payload.fixed}
              unit={unit}
              inputAccessoryViewID={BlueDismissKeyboardInputAccessory.InputAccessoryViewID}
            />
            <BlueText style={styles.alignSelfCenter}>
              {loc.formatString(loc.lndViewInvoice.please_pay_between_and, {
                min: formatBalance(payload?.min, unit),
                max: formatBalance(payload?.max, unit),
              })}
            </BlueText>
            <BlueSpacing20 />
            {payload?.image && (
              <>
                <Image style={styles.img} source={{ uri: payload?.image }} />
                <BlueSpacing20 />
              </>
            )}
            <BlueText style={styles.alignSelfCenter}>{payload?.description}</BlueText>
            <BlueText style={styles.alignSelfCenter}>{payload?.domain}</BlueText>
            <BlueSpacing20 />
            {payButtonDisabled ? <BlueLoading /> : <BlueButton title={loc.lnd.payButton} onPress={pay} />}
            <BlueSpacing20 />
          </BlueCard>
        </ScrollView>
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
});

LnurlPay.navigationOptions = navigationStyle({
  title: '',
  closeButton: true,
  closeButtonFunc: ({ navigation }) => navigation.dangerouslyGetParent().popToTop(),
});
