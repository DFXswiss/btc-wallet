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
import { lnurlPaySuccessDisplay } from './lnurlPaySuccess';
import { randomBytes } from '../../class/rng';
import { LightningCustodianWallet } from '../../class/wallets/lightning-custodian-wallet';
import { LightningLdsWallet } from '../../class/wallets/lightning-lds-wallet';
import { SendPaymentMethod_Tags } from '@breeztech/breez-sdk-spark-react-native';
import { SparkPaymentFeeQuoteError, SparkWallet } from '../../class/wallets/spark-wallet';
import { BitcoinUnit } from '../../models/bitcoinUnits';
import loc from '../../loc';
import Biometric from '../../class/biometrics';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import { useSparkContext } from '../../api/spark/contexts/spark.context';
import { subscribeOutgoingPayment } from '../../api/spark/outgoing-payment';
import alert from '../../components/Alert';
import { Text } from 'react-native-elements';
import { isFreeDomain, isInternalDomain } from '../../helpers/freeLightningDomains';
import { reportError } from '../../helpers/errors';
const currency = require('../../blue_modules/currency');

/** LNDHub (custodian / LDS) waives fees for listed domains. Spark does not. */
function walletWaivesDomainFees(fromWallet) {
  return fromWallet.type === LightningCustodianWallet.type || fromWallet.type === LightningLdsWallet.type;
}

/**
 * if user has default currency - fiat, attempting to pay will trigger conversion from entered in input field fiat value
 * to satoshi, and attempt to pay this satoshi value, which might be a little bit off from `min` & `max` values
 * provided by LnUrl. thats why we cache initial precise conversion rate so the reverse conversion wont be off.
 */
const _cacheFiatToSat = {};

/** Unresolved Spark attempts. Survives leaving the screen and an app restart. */
const SPARK_SEED_STORAGE_KEY = 'sparkUnresolvedPaymentSeeds';
const unresolvedSparkSeeds = new Map();
const sparkSeedKeyByPaymentId = new Map();
const unsentSparkSeeds = new Set();
let sparkSeedsLoaded = null;
let sparkSeedsPersisted = false;

function sparkSeedKey(destination, amountSats, operationId) {
  return `${destination}\0${amountSats}\0${operationId || ''}`;
}

function sparkSeedStoragePayload() {
  return JSON.stringify({
    seeds: Object.fromEntries(unresolvedSparkSeeds),
    payments: Object.fromEntries(sparkSeedKeyByPaymentId),
  });
}

function applySparkSeedStorage(raw) {
  if (!raw) return;
  const parsed = JSON.parse(raw);
  for (const [key, seed] of Object.entries(parsed.seeds || {})) {
    if (!unresolvedSparkSeeds.has(key)) unresolvedSparkSeeds.set(key, seed);
  }
  for (const [id, key] of Object.entries(parsed.payments || {})) {
    if (!sparkSeedKeyByPaymentId.has(id)) sparkSeedKeyByPaymentId.set(id, key);
  }
  if (unresolvedSparkSeeds.size > 0) sparkSeedsPersisted = true;
}

async function loadSparkSeeds() {
  if (sparkSeedsLoaded) return sparkSeedsLoaded;
  try {
    const raw = await AsyncStorage.getItem(SPARK_SEED_STORAGE_KEY);
    applySparkSeedStorage(raw);
    sparkSeedsLoaded = Promise.resolve();
  } catch (error) {
    sparkSeedsLoaded = null;
    throw error;
  }
  return sparkSeedsLoaded;
}

function persistSparkSeeds() {
  if (unresolvedSparkSeeds.size === 0) {
    if (!sparkSeedsPersisted) return Promise.resolve();
    sparkSeedsPersisted = false;
    return AsyncStorage.removeItem(SPARK_SEED_STORAGE_KEY);
  }
  sparkSeedsPersisted = true;
  return AsyncStorage.setItem(SPARK_SEED_STORAGE_KEY, sparkSeedStoragePayload());
}

function keyForSparkSeed(seed) {
  for (const [key, kept] of unresolvedSparkSeeds) {
    if (kept === seed) return key;
  }
  return undefined;
}

function dropSparkSeed(seed) {
  unsentSparkSeeds.delete(seed);
  const key = keyForSparkSeed(seed);
  if (!key) return;
  unresolvedSparkSeeds.delete(key);
  for (const [id, storedKey] of sparkSeedKeyByPaymentId) {
    if (storedKey === key) sparkSeedKeyByPaymentId.delete(id);
  }
}

async function createSparkPaymentSeed(seedRef, destination, amountSats, operationId) {
  await loadSparkSeeds();
  if (seedRef.current) return seedRef.current;
  const key = sparkSeedKey(destination, amountSats, operationId);
  const kept = unresolvedSparkSeeds.get(key);
  if (kept) {
    seedRef.current = kept;
    return kept;
  }
  // A finished attempt must not reuse its key. An unresolved one must, or a
  // later tap sends the payment a second time.
  const seed = (await randomBytes(16)).toString('hex');
  seedRef.current = seed;
  unresolvedSparkSeeds.set(key, seed);
  unsentSparkSeeds.add(seed);
  await persistSparkSeeds();
  return seed;
}

function keepUnresolvedSparkSeed(seedRef, paymentId, paymentHash) {
  const seed = seedRef?.current;
  if (seed) unsentSparkSeeds.delete(seed);
  const key = seed && keyForSparkSeed(seed);
  if (key && paymentId) sparkSeedKeyByPaymentId.set(paymentId, key);
  if (key && paymentHash) sparkSeedKeyByPaymentId.set(paymentHash, key);
  return persistSparkSeeds();
}

function forgetSparkPaymentSeed(seedRef) {
  const seed = seedRef?.current;
  if (seedRef) seedRef.current = undefined;
  if (!seed) return persistSparkSeeds();
  dropSparkSeed(seed);
  return persistSparkSeeds();
}

subscribeOutgoingPayment(payment => {
  if (!payment || payment.status === 'pending') return;
  const ids = [payment.paymentId, payment.paymentHash].filter(Boolean);
  let dropped = false;
  for (const id of ids) {
    const key = sparkSeedKeyByPaymentId.get(id);
    const seed = key && unresolvedSparkSeeds.get(key);
    if (!seed) continue;
    dropSparkSeed(seed);
    dropped = true;
  }
  if (dropped) persistSparkSeeds();
});

export function __resetSparkPaymentSeedsForTests() {
  unresolvedSparkSeeds.clear();
  sparkSeedKeyByPaymentId.clear();
  unsentSparkSeeds.clear();
  sparkSeedsLoaded = null;
  sparkSeedsPersisted = false;
}

/**
 * Spark address a Spark wallet pays directly. A max amount and a comment have no Spark
 * destination, so those payments are refused instead of falling back to Lightning.
 */
function directSparkAddress(LN, fromWallet, isMax, description) {
  if (!LN || fromWallet.type !== SparkWallet.type || isMax) return undefined;
  if (LN.getCommentAllowed() && description) return undefined;
  return LN.getSparkAddress();
}

const LnurlPay = () => {
  const { wallets, refreshAllWalletTransactions } = useContext(BlueStorageContext);
  const { outgoingPayment } = useSparkContext();
  const { params } = useRoute();
  const { walletID, lnurl, amountSat, destination, invoice, sparkInvoice, sparkAddress, amountUnit, description, free, isMax, routeId } = params;
  /** @type {LightningCustodianWallet} */
  const wallet = wallets.find(w => w.getID() === walletID);
  const [unit, setUnit] = useState(wallet.getPreferredBalanceUnit());
  const [isLoading, setIsLoading] = useState(true);
  const [_LN, setLN] = useState();
  const [payButtonDisabled, setPayButtonDisabled] = useState(true);
  const [isPaymentPending, setIsPaymentPending] = useState(false);
  const pendingPayRef = useRef();
  const payInFlightRef = useRef(false);
  const sparkPaymentSeedRef = useRef();
  const [payload, setPayload] = useState();
  const { pop, navigate, goBack } = useNavigation();
  const [amount, setAmount] = useState();
  const [desc, setDesc] = useState();
  const [isTxFree, setIsTxFree] = useState(false);
  const [sparkFee, setSparkFee] = useState();
  const [sparkFeeQuote, setSparkFeeQuote] = useState();
  const [sparkMaxFeeQuote, setSparkMaxFeeQuote] = useState();
  const [sparkFeeQuoteError, setSparkFeeQuoteError] = useState();
  const [quoteRetry, setQuoteRetry] = useState(0);
  const [lnurlInvoiceQuote, setLnurlInvoiceQuote] = useState();
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
    if (sparkInvoice || sparkAddress) {
      setAmount(amountSat);
      setUnit(BitcoinUnit.SATS);
      setIsLoading(false);
      setIsTxFree(false);
    }
  }, [sparkInvoice, sparkAddress, amountSat]);

  useEffect(() => {
    let isCurrent = true;
    setSparkFee(undefined);
    setSparkFeeQuote(undefined);
    setSparkMaxFeeQuote(undefined);
    setLnurlInvoiceQuote(undefined);
    setSparkFeeQuoteError(undefined);
    const paymentRequest = invoice || sparkInvoice || sparkAddress;
    if (wallet.type !== SparkWallet.type || !paymentRequest || !(amountSat > 0)) {
      return () => {
        isCurrent = false;
      };
    }

    wallet
      .getPaymentFeeQuote(paymentRequest, amountSat)
      .then(quote => {
        if (isCurrent) {
          setSparkFeeQuote(quote);
          setSparkFee(quote.feeSats);
        }
      })
      .catch(() => {
        if (isCurrent) setSparkFeeQuoteError(loc.send.server_error);
      });

    return () => {
      isCurrent = false;
    };
  }, [amountSat, description, invoice, isMax, payload, sparkInvoice, sparkAddress, wallet, _LN, quoteRetry]);

  useEffect(() => {
    const quoteAmountSats = amountSat ?? _LN?.getMin();
    if (wallet.type !== SparkWallet.type || invoice || sparkInvoice || sparkAddress || !payload || !(quoteAmountSats > 0) || !_LN)
      return undefined;
    let isCurrent = true;
    const comment = _LN.getCommentAllowed() ? description : undefined;
    const quoteInvoice = () =>
      _LN
        .requestBolt11FromLnurlPayService(quoteAmountSats, comment)
        .then(({ pr }) => wallet.getPaymentFeeQuote(pr, quoteAmountSats).then(quote => ({ pr, quote })))
        .then(result => {
          if (!isCurrent) return;
          setLnurlInvoiceQuote({ invoice: result.pr, quote: result.quote });
          setSparkFeeQuote(result.quote);
          setSparkFee(result.quote.feeSats);
        })
        .catch(() => {
          if (isCurrent) setSparkFeeQuoteError(loc.send.server_error);
        });
    const lnurlSparkAddress = directSparkAddress(_LN, wallet, isMax, description);
    if (lnurlSparkAddress) {
      // The receiver's limits apply to a Spark transfer just as they do to an invoice.
      Promise.resolve()
        .then(() => {
          _LN.assertAmountInRange(quoteAmountSats);
          return wallet.getPaymentFeeQuote(lnurlSparkAddress, quoteAmountSats);
        })
        .then(quote => {
          if (!isCurrent) return;
          setSparkFeeQuote(quote);
          setSparkFee(quote.feeSats);
        })
        // Without a Spark quote the payment can still go out as an invoice.
        .catch(() => (isCurrent ? quoteInvoice() : undefined));
      return () => {
        isCurrent = false;
      };
    }
    if (isMax) {
      wallet
        .getLnurlMaxFeeQuote(_LN.getLnurlPayRequestDetails(), quoteAmountSats, comment)
        .then(quote => {
          if (!isCurrent) return;
          setSparkMaxFeeQuote(quote);
          setSparkFee(quote.feeSats);
        })
        .catch(() => {
          if (isCurrent) setSparkFeeQuoteError(loc.send.server_error);
        });
      return () => {
        isCurrent = false;
      };
    }
    quoteInvoice();
    return () => {
      isCurrent = false;
    };
  }, [amountSat, description, invoice, isMax, payload, sparkInvoice, sparkAddress, wallet, _LN, quoteRetry]);

  useEffect(() => {
    setPayButtonDisabled(isLoading);
  }, [isLoading]);

  const navigateLnurlSuccess = (paymentHash, fee, LN) => {
    let lnurlPay;
    try {
      lnurlPay = lnurlPaySuccessDisplay(LN);
    } catch (error) {
      reportError('lnurlPay: failed to prepare LNURL success display', error);
    }
    navigate('SendDetailsRoot', {
      screen: 'LnurlPaySuccess',
      params: {
        paymentHash,
        ...(fee === undefined ? {} : { fee }),
        justPaid: true,
        fromWalletID: walletID,
        ...(lnurlPay ? { lnurlPay } : {}),
      },
    });
  };

  const finishLnurlSuccess = async (paymentHash, fee, LN) => {
    ReactNativeHapticFeedback.trigger('notificationSuccess', { ignoreAndroidSystemSettings: false });
    const preimage = wallet.last_paid_invoice_result && wallet.last_paid_invoice_result.payment_preimage;
    if (preimage && LN) {
      try {
        await LN.storeSuccess(paymentHash, preimage);
      } catch (error) {
        reportError('lnurlPay: failed to store LNURL success', error);
      }
    }
    navigateLnurlSuccess(paymentHash, fee, LN);
  };

  const finishInvoiceSuccess = (amountSats, fee, decoded) => {
    ReactNativeHapticFeedback.trigger('notificationSuccess', { ignoreAndroidSystemSettings: false });
    navigate('Success', {
      amount: amountSats,
      amountUnit: BitcoinUnit.SATS,
      ...(fee === undefined ? {} : { fee }),
      invoiceDescription: decoded.description,
    });
  };

  // Only a terminal status of the watched payment ends the pending state; another payment's settlement must not.
  const watchedHash = pendingPayRef.current?.paymentHash;
  const outgoingIsWatched = !watchedHash || !outgoingPayment?.paymentHash || watchedHash === outgoingPayment.paymentHash;
  const watchedIsTerminal = outgoingIsWatched && (outgoingPayment?.status === 'completed' || outgoingPayment?.status === 'failed');
  const showPending = isPaymentPending && !watchedIsTerminal;

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
        finishLnurlSuccess(watching.paymentHash, watching.fee, watching.LN).catch(error => {
          reportError('lnurlPay: failed to finish LNURL success', error);
        });
      } else if (watching.kind === 'sparkInvoice' || watching.kind === 'sparkAddress') {
        if (sparkPaymentSeedRef.current === watching.seed) {
          forgetSparkPaymentSeed(sparkPaymentSeedRef);
        }
        finishInvoiceSuccess(watching.amountSats, watching.fee, watching.decoded);
      } else {
        finishInvoiceSuccess(watching.amountSats, watching.fee, watching.decoded);
      }
      return;
    }

    if (outgoingPayment.status === 'failed') {
      if (watching.seed && sparkPaymentSeedRef.current === watching.seed) {
        forgetSparkPaymentSeed(sparkPaymentSeedRef);
      }
      setIsPaymentPending(false);
      payInFlightRef.current = false;
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

    if (isMax && wallet.type === SparkWallet.type) {
      const result = await wallet.payLnurlMax(LN.getLnurlPayRequestDetails(), amountSats, comment, sparkMaxFeeQuote);
      LN.setSdkSuccessAction(result?.lnurlSuccessAction);
      if (result && result.status === 'pending') {
        pendingPayRef.current = {
          kind: 'lnurl',
          paymentHash: result.paymentHash,
          fee: result.fee,
          LN,
        };
        setIsPaymentPending(true);
        setPayButtonDisabled(true);
        return;
      }
      if (result && result.status !== 'completed') {
        payInFlightRef.current = false;
        setPayButtonDisabled(false);
        return;
      }

      await finishLnurlSuccess(result?.paymentHash, result?.fee, LN);
      return;
    }

    const bolt11payload = lnurlInvoiceQuote?.invoice
      ? { pr: lnurlInvoiceQuote.invoice }
      : await LN.requestBolt11FromLnurlPayService(amountSats, comment);
    if (wallet.type !== SparkWallet.type) {
      const result = await wallet.payInvoice(bolt11payload.pr);
      const decoded = wallet.decodeInvoice(bolt11payload.pr);
      if (result && result.status === 'pending') {
        pendingPayRef.current = {
          kind: 'lnurl',
          paymentHash: result.paymentHash || decoded.payment_hash,
          fee: result.fee,
          LN,
        };
        setIsPaymentPending(true);
        setPayButtonDisabled(true);
        return;
      }
      if (result && result.status !== 'completed') {
        payInFlightRef.current = false;
        setPayButtonDisabled(false);
        return;
      }
      await finishLnurlSuccess(decoded.payment_hash, result?.fee, LN);
      return;
    }
    const quote = lnurlInvoiceQuote?.quote || (await wallet.getPaymentFeeQuote(bolt11payload.pr, amountSats));
    if (!lnurlInvoiceQuote) {
      setLnurlInvoiceQuote({ invoice: bolt11payload.pr, quote });
      setSparkFeeQuote(quote);
      setSparkFee(quote.feeSats);
      payInFlightRef.current = false;
      setPayButtonDisabled(false);
      return;
    }
    const result = await wallet.payInvoice(bolt11payload.pr, amountSats, quote);
    const decoded = wallet.decodeInvoice(bolt11payload.pr);
    if (result && result.status === 'pending') {
      pendingPayRef.current = {
        kind: 'lnurl',
        paymentHash: result.paymentHash || decoded.payment_hash,
        fee: result.fee,
        LN,
      };
      setIsPaymentPending(true);
      setPayButtonDisabled(true);
      return;
    }
    if (result && result.status !== 'completed') {
      payInFlightRef.current = false;
      setPayButtonDisabled(false);
      return;
    }

    await finishLnurlSuccess(decoded.payment_hash, result?.fee, LN);
  };

  const handleLnInvoice = async amountSats => {
    const result = await wallet.payInvoice(invoice, amountSats, sparkFeeQuote);
    const decoded = wallet.decodeInvoice(invoice);
    if (result && result.status === 'pending') {
      pendingPayRef.current = {
        kind: 'invoice',
        paymentHash: result.paymentHash || decoded.payment_hash,
        amountSats,
        fee: result.fee,
        decoded,
      };
      setIsPaymentPending(true);
      setPayButtonDisabled(true);
      return;
    }
    if (result && result.status !== 'completed') {
      payInFlightRef.current = false;
      setPayButtonDisabled(false);
      return;
    }

    finishInvoiceSuccess(amountSats, result?.fee, decoded);
  };

  const handleSparkAddress = async (amountSats, destination) => {
    const seed = await createSparkPaymentSeed(sparkPaymentSeedRef, destination, amountSats, routeId);
    const result = await wallet.paySparkAddress(destination, amountSats, seed, sparkFeeQuote);
    const decoded = {};
    if (result && result.status === 'pending') {
      pendingPayRef.current = {
        kind: 'sparkAddress',
        paymentHash: result.paymentHash,
        amountSats,
        fee: result.fee,
        decoded,
        seed,
      };
      setIsPaymentPending(true);
      setPayButtonDisabled(true);
      await keepUnresolvedSparkSeed(sparkPaymentSeedRef, result.paymentId, result.paymentHash);
      return;
    }
    if (result && result.status !== 'completed') {
      forgetSparkPaymentSeed(sparkPaymentSeedRef);
      payInFlightRef.current = false;
      setPayButtonDisabled(false);
      return;
    }

    forgetSparkPaymentSeed(sparkPaymentSeedRef);
    finishInvoiceSuccess(amountSats, result?.fee, decoded);
  };

  const handleSparkInvoice = async (amountSats, destination) => {
    const seed = await createSparkPaymentSeed(sparkPaymentSeedRef, destination, amountSats, routeId);
    const result = await wallet.paySparkInvoice(destination, amountSats, seed, sparkFeeQuote);
    const decoded = {};
    if (result && result.status === 'pending') {
      pendingPayRef.current = {
        kind: 'sparkInvoice',
        paymentHash: result.paymentHash,
        amountSats,
        fee: result.fee,
        decoded,
        seed,
      };
      setIsPaymentPending(true);
      setPayButtonDisabled(true);
      await keepUnresolvedSparkSeed(sparkPaymentSeedRef, result.paymentId, result.paymentHash);
      return;
    }
    if (result && result.status !== 'completed') {
      forgetSparkPaymentSeed(sparkPaymentSeedRef);
      payInFlightRef.current = false;
      setPayButtonDisabled(false);
      return;
    }

    forgetSparkPaymentSeed(sparkPaymentSeedRef);
    finishInvoiceSuccess(amountSats, result?.fee, decoded);
  };

  const pay = async () => {
    if (payInFlightRef.current) return;
    payInFlightRef.current = true;
    setPayButtonDisabled(true);

    try {
      const isBiometricsEnabled = await Biometric.isBiometricUseCapableAndEnabled();
      if (isBiometricsEnabled) {
        if (!(await Biometric.unlockWithBiometrics())) {
          payInFlightRef.current = false;
          setPayButtonDisabled(false);
          return;
        }
      }

      let amountSats = amount;
      switch (unit) {
        case BitcoinUnit.SATS:
          amountSats = Number(amountSats);
          if (!Number.isInteger(amountSats)) {
            payInFlightRef.current = false;
            setPayButtonDisabled(false);
            return alert(loc.lnd.error_tip_invoice_not_supported);
          }
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

      if (sparkAddress || sparkInvoice) {
        const sparkDestination = sparkAddress || sparkInvoice;
        if (sparkFeeQuote?.method === SendPaymentMethod_Tags.SparkAddress) {
          await handleSparkAddress(amountSats, sparkDestination);
        } else {
          await handleSparkInvoice(amountSats, sparkDestination);
        }
      } else if (invoice) {
        await handleLnInvoice(amountSats);
      } else if (sparkFeeQuote?.method === SendPaymentMethod_Tags.SparkAddress && directSparkAddress(_LN, wallet, isMax, description)) {
        _LN.assertAmountInRange(amountSats);
        await handleSparkAddress(amountSats, directSparkAddress(_LN, wallet, isMax, description));
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
      const preSendFailure =
        Err instanceof SparkPaymentFeeQuoteError ||
        Err?.message === loc.send.insufficient_funds ||
        Err?.message === loc.lnd.error_tip_invoice_not_supported;
      // A fee or balance error is thrown before sendPayment. Forgetting the seed
      // there drops the key of a send that may already be in flight.
      if (Err?.message === loc.wallets.lightning_spark_payment_failed) {
        await forgetSparkPaymentSeed(sparkPaymentSeedRef);
      } else if (preSendFailure && unsentSparkSeeds.has(sparkPaymentSeedRef.current)) {
        await forgetSparkPaymentSeed(sparkPaymentSeedRef);
      } else if (sparkPaymentSeedRef.current && !preSendFailure) {
        await keepUnresolvedSparkSeed(sparkPaymentSeedRef);
      }
      setLnurlInvoiceQuote(undefined);
      if (Err instanceof SparkPaymentFeeQuoteError) {
        setSparkFee(undefined);
        setSparkFeeQuote(undefined);
        setSparkMaxFeeQuote(undefined);
        setQuoteRetry(retry => retry + 1);
      }
      setIsLoading(false);
      payInFlightRef.current = false;
      setPayButtonDisabled(false);
      ReactNativeHapticFeedback.trigger('notificationError', { ignoreAndroidSystemSettings: false });
      return alert(Err.message);
    }
  };

  const getFees = () => {
    const min = 0;
    const max = Math.round(amountSat * 0.03);
    return `${min} ${BitcoinUnit.SATS} - ${max} ${BitcoinUnit.SATS}`;
  };

  const isInsufficientFunds = () => {
    if (wallet.type === SparkWallet.type && !isMax && typeof sparkFee === 'number') {
      return amountSat + sparkFee > wallet.getBalance();
    }
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
            {(invoice || sparkInvoice || sparkAddress) && (
              <BlueCopyTextToClipboard text={invoice || sparkInvoice || sparkAddress} truncated />
            )}
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
                    {loc.send.create_fee}:{' '}
                    {wallet.type === SparkWallet.type
                      ? sparkFeeQuoteError || (sparkFee === undefined ? '-' : `${sparkFee} ${BitcoinUnit.SATS}`)
                      : isTxFree
                        ? loc._.free
                        : getFees()}
                  </Text>
                  {wallet.type === SparkWallet.type && sparkFeeQuoteError && (
                    <SecondButton title={loc.wallets.list_tryagain} onPress={() => setQuoteRetry(value => value + 1)} />
                  )}
                  <BlueButton
                    title={loc.lnd.payButton}
                    onPress={pay}
                    disabled={
                      isInsufficientFunds() ||
                      (wallet.type === SparkWallet.type && ((isMax && !sparkMaxFeeQuote) || (!isMax && !sparkFeeQuote)))
                    }
                  />
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
