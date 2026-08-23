import React, { useState, useEffect, useContext, useRef } from 'react';
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
  SecondButton,
} from '../../BlueComponents';
import navigationStyle from '../../components/navigationStyle';
import AmountInput from '../../components/AmountInput';
import Lnurl from '../../class/lnurl';
import { LightningCustodianWallet } from '../../class/wallets/lightning-custodian-wallet';
import { LightningLdsWallet } from '../../class/wallets/lightning-lds-wallet';
import { SparkWallet, sparkMaxSendFeeSats } from '../../class/wallets/spark-wallet';
import { BitcoinUnit } from '../../models/bitcoinUnits';
import loc from '../../loc';
import Biometric from '../../class/biometrics';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import { useSparkContext } from '../../api/spark/contexts/spark.context';
import alert from '../../components/Alert';
import { Text } from 'react-native-elements';
import { isFreeDomain, isInternalDomain } from '../../helpers/freeLightningDomains';
import { reportError } from '../../helpers/errors';
const currency = require('../../blue_modules/currency');

/** LNDHub (custodian / LDS) waives fees for listed domains. Spark does not. */
function walletWaivesDomainFees(fromWallet) {
  if (!fromWallet) return false;
  return fromWallet.type === LightningCustodianWallet.type || fromWallet.type === LightningLdsWallet.type;
}

/**
 * if user has default currency - fiat, attempting to pay will trigger conversion from entered in input field fiat value
 * to satoshi, and attempt to pay this satoshi value, which might be a little bit off from `min` & `max` values
 * provided by LnUrl. thats why we cache initial precise conversion rate so the reverse conversion wont be off.
 */
const _cacheFiatToSat = {};

const LnurlPay = () => {
  const { wallets, refreshAllWalletTransactions } = useContext(BlueStorageContext);
  const { outgoingPayment } = useSparkContext();
  const { walletID, lnurl, amountSat, destination, invoice, amountUnit, description, free } = useRoute().params;
  /** @type {LightningCustodianWallet} */
  const wallet = wallets.find(w => w.getID() === walletID);
  const [unit, setUnit] = useState(wallet.getPreferredBalanceUnit());
  const [isLoading, setIsLoading] = useState(true);
  const [_LN, setLN] = useState();
  const [payButtonDisabled, setPayButtonDisabled] = useState(true);
  const [isPaymentPending, setIsPaymentPending] = useState(false);
  const pendingPayRef = useRef();
  const [payload, setPayload] = useState();
  const { pop, navigate, goBack } = useNavigation();
  const [amount, setAmount] = useState();
  const [desc, setDesc] = useState();
  const [isTxFree, setIsTxFree] = useState(false);
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
        .then(p => {
          const domain = ln.getDomain();
          setIsTxFree(walletWaivesDomainFees(wallet) && (isInternalDomain(domain) || isFreeDomain(domain)));
          setPayload(p);
        })
        .catch(error => {
          alert(error.message);
          pop();
        });
      setLN(ln);
      setIsLoading(false);
    }
  }, [lnurl, destination, pop, wallet]);

  useEffect(() => {
    if (lnurl || (destination && Lnurl.isLightningAddress(destination))) {
      setDesc(description);
    }
  }, [description, lnurl, destination]);

  useEffect(() => {
    if (invoice) {
      setAmount(amountSat);
      setUnit(amountUnit);
      setIsLoading(false);
      setIsTxFree(Boolean(free) && walletWaivesDomainFees(wallet));
    }
  }, [invoice, amountSat, amountUnit, free, wallet]);

  useEffect(() => {
    setPayButtonDisabled(isLoading);
  }, [isLoading]);

  const navigateLnurlSuccess = paymentHash => {
    navigate('SendDetailsRoot', {
      screen: 'LnurlPaySuccess',
      params: {
        paymentHash,
        justPaid: true,
        fromWalletID: walletID,
      },
    });
  };

  const finishLnurlSuccess = async (paymentHash, LN) => {
    ReactNativeHapticFeedback.trigger('notificationSuccess', { ignoreAndroidSystemSettings: false });
    const preimage = wallet.last_paid_invoice_result && wallet.last_paid_invoice_result.payment_preimage;
    if (preimage && LN) {
      await LN.storeSuccess(paymentHash, preimage);
    }
    navigateLnurlSuccess(paymentHash);
  };

  const finishInvoiceSuccess = (amountSats, decoded) => {
    ReactNativeHapticFeedback.trigger('notificationSuccess', { ignoreAndroidSystemSettings: false });
    navigate('Success', {
      amount: amountSats,
      amountUnit: BitcoinUnit.SATS,
      invoiceDescription: decoded.description,
    });
  };

  const showPending = isPaymentPending && outgoingPayment?.status !== 'completed' && outgoingPayment?.status !== 'failed';

  useEffect(() => {
    if (!outgoingPayment || outgoingPayment.status === 'pending') return;
    const watching = pendingPayRef.current;
    if (!watching) return;
    if (watching.paymentHash && outgoingPayment.paymentHash && watching.paymentHash !== outgoingPayment.paymentHash) {
      return;
    }

    if (outgoingPayment.status === 'completed') {
      if (outgoingPayment.preimage) {
        wallet.last_paid_invoice_result = { payment_preimage: outgoingPayment.preimage };
      }
      pendingPayRef.current = undefined;
      refreshAllWalletTransactions();
      if (watching.kind === 'lnurl') {
        finishLnurlSuccess(watching.paymentHash, watching.LN).catch(error => {
          reportError('lnurlPay: failed to store LNURL success', error);
          navigateLnurlSuccess(watching.paymentHash);
        });
      } else {
        finishInvoiceSuccess(watching.amountSats, watching.decoded);
      }
      return;
    }

    if (outgoingPayment.status === 'failed') {
      setIsPaymentPending(false);
      setPayButtonDisabled(false);
      pendingPayRef.current = undefined;
      ReactNativeHapticFeedback.trigger('notificationError', { ignoreAndroidSystemSettings: false });
      alert(loc.wallets.lightning_spark_payment_failed);
    }
    // finish helpers close over navigation and wallet; they are stable for this screen instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outgoingPayment]);

  useEffect(() => {
    if (payload) {
      /** @type {Lnurl} */
      const LN = _LN;
      let originalSatAmount;
      let newAmount = (originalSatAmount = amountSat ?? LN.getMin());
      if (!newAmount) {
        alert('Internal error: incorrect LNURL amount');
        goBack();
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

    let comment;
    if (LN.getCommentAllowed()) {
      comment = description;
    }

    const bolt11payload = await LN.requestBolt11FromLnurlPayService(amountSats, comment);
    const result = await wallet.payInvoice(bolt11payload.pr);
    const decoded = wallet.decodeInvoice(bolt11payload.pr);
    if (result && result.status === 'pending') {
      pendingPayRef.current = { kind: 'lnurl', paymentHash: result.paymentHash || decoded.payment_hash, LN };
      setIsPaymentPending(true);
      setPayButtonDisabled(true);
      return;
    }

    await finishLnurlSuccess(decoded.payment_hash, LN);
  };

  const handleLnInvoice = async amountSats => {
    const result = await wallet.payInvoice(invoice, amountSats);
    const decoded = wallet.decodeInvoice(invoice);
    if (result && result.status === 'pending') {
      pendingPayRef.current = { kind: 'invoice', paymentHash: result.paymentHash || decoded.payment_hash, amountSats, decoded };
      setIsPaymentPending(true);
      setPayButtonDisabled(true);
      return;
    }

    finishInvoiceSuccess(amountSats, decoded);
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

      if (pendingPayRef.current) {
        setIsLoading(false);
        return;
      }

      refreshAllWalletTransactions();
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
    const max = wallet.type === SparkWallet.type ? sparkMaxSendFeeSats(amountSat) : Math.round(amountSat * 0.03);
    return `${min} ${BitcoinUnit.SATS} - ${max} ${BitcoinUnit.SATS}`;
  };

  const isInsufficientFunds = () => {
    return amountSat > wallet.getBalance();
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
            {description && desc !== description && (
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
          {showPending ? (
            <BlueText style={styles.pending}>{loc.wallets.lightning_spark_payment_in_transit}</BlueText>
          ) : payButtonDisabled ? (
            <BlueLoading />
          ) : (
            <>
              {isInsufficientFunds() ? (
                <>
                  <Text style={styles.insufficientFunds}>{loc.send.insufficient_funds}</Text>
                  <SecondButton title={loc._.cancel} onPress={goBack} />
                </>
              ) : (
                <>
                  <Text style={styles.fees}>
                    {loc.send.create_fee}: {isTxFree ? loc._.free : getFees()}
                  </Text>
                  <BlueButton title={loc.lnd.payButton} onPress={pay} disabled={isInsufficientFunds()} />
                </>
              )}
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
  insufficientFunds: {
    color: 'red',
    fontSize: 14,
    marginVertical: 8,
    marginHorizontal: 24,
    alignSelf: 'center',
  },
  pending: {
    color: '#37c0a1',
    fontSize: 14,
    marginVertical: 8,
    marginHorizontal: 24,
    paddingBottom: 6,
    fontWeight: '500',
    textAlign: 'center',
    alignSelf: 'center',
  },
});

LnurlPay.navigationOptions = navigationStyle({
  title: '',
  closeButton: true,
  closeButtonFunc: ({ navigation }) => navigation.getParent().popToTop(),
});
