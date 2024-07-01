import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, View, StatusBar, Keyboard, ScrollView, StyleSheet } from 'react-native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import { useFocusEffect, useNavigation, useRoute, useTheme } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
import DeeplinkSchemaMatch from '../../class/deeplink-schema-match';
const currency = require('../../blue_modules/currency');

const ScanLndInvoice = () => {
  const { wallets } = useContext(BlueStorageContext);
  const { colors } = useTheme();
  const { walletID, uri } = useRoute().params;
  const name = useRoute().name;
  /** @type {LightningCustodianWallet} */
  const wallet = useMemo(
    () => wallets.find(item => item.getID() === walletID) || wallets.find(item => item.chain === Chain.OFFCHAIN),
    [walletID, wallets],
  );
  const { navigate, setParams, goBack, replace } = useNavigation();
  const [isLoading, setIsLoading] = useState(false);
  const [destination, setDestination] = useState('');
  const [unit, setUnit] = useState(BitcoinUnit.SATS);
  const [decoded, setDecoded] = useState();
  const [amount, setAmount] = useState();
  const [isAmountInputDisabled, setIsAmountInputDisabled] = useState(false);
  const [amountSat, setAmountSat] = useState();
  const [desc, setDesc] = useState();
  const [isDescDisabled, setIsDescDisabled] = useState(false);
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

  const onWalletChange = id => {
    const newWallet = wallets.find(w => w.getID() === id);
    if (!newWallet) return;

    if (newWallet.chain !== Chain.OFFCHAIN) {
      return replace('SendDetails', { walletID: id });
    }

    setParams({ walletID: id });
  };

  useFocusEffect(
    useCallback(() => {
      if (!wallet) {
        ReactNativeHapticFeedback.trigger('notificationError', { ignoreAndroidSystemSettings: false });
        goBack();
        setTimeout(() => alert(loc.wallets.no_ln_wallet_error), 500);
      } else {
        setParams({ walletID: wallet.getID() });
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [wallet]),
  );

  const setLnurlDestination = async destinationString => {
    setIsLoading(true);
    const ln = new Lnurl(destinationString, AsyncStorage);
    await ln.callLnurlPayService();
    setDestination(destinationString);
    setUnit(BitcoinUnit.SATS);
    handleAmountInputChange(ln.getAmount() || 1, BitcoinUnit.SATS);
    setIsAmountInputDisabled(false);
    setDesc(ln.getDescription());
    setIsDescDisabled(Boolean(ln.getDescription()));
    setIsLoading(false);
  };

  const setLightningAddressDestination = destinationString => {
    setDestination(destinationString);
    setIsAmountInputDisabled(false);
    setIsDescDisabled(false);
  };

  const setLightningInvoiceDestination = destinationString => {
    let data = destinationString;
    // handling BIP21 w/BOLT11 support
    const ind = data.indexOf('lightning=');
    if (ind !== -1) {
      data = data.substring(ind + 10).split('&')[0];
    }
    data = data.replace('LIGHTNING:', '').replace('lightning:', '');
    setDestination(data);
    const decodedInvoice = wallet.decodeInvoice(data);
    setDecoded(decodedInvoice);
    const { num_satoshis: sats, description } = decodedInvoice;
    setUnit(BitcoinUnit.SATS);
    handleAmountInputChange(sats.toString(), BitcoinUnit.SATS);
    setIsAmountInputDisabled(true);
    setDesc(description);
    setIsDescDisabled(Boolean(description));
    let newExpiresIn = (decodedInvoice.timestamp * 1 + decodedInvoice.expiry * 1) * 1000; // ms
    if (+new Date() > newExpiresIn) {
      newExpiresIn = loc.lnd.expired;
    } else {
      const time = Math.round((newExpiresIn - +new Date()) / (60 * 1000));
      newExpiresIn = loc.formatString(loc.lnd.expiresIn, { time });
    }
    setExpiresIn(newExpiresIn);
  };

  const processDestination = destinationString => {
    Keyboard.dismiss();
    if (Lnurl.isLnurl(destinationString)) return setLnurlDestination(destinationString);
    if (Lnurl.isLightningAddress(destinationString)) return setLightningAddressDestination(destinationString);
    if (
      DeeplinkSchemaMatch.isLightningInvoice(destinationString) ||
      DeeplinkSchemaMatch.isBothBitcoinAndLightning(destinationString) ||
      DeeplinkSchemaMatch.isTestnetLightningInvoice(destinationString)
    )
      return setLightningInvoiceDestination(destinationString);
  };

  const clearAllInputs = () => {
    Keyboard.dismiss();
    setAmount();
    setAmountSat();
    setDestination();
    setExpiresIn();
    setDecoded();
    setDesc();
    setIsAmountInputDisabled(false);
    setIsDescDisabled(false);
    setIsLoading(false);
  };

  useEffect(() => {
    if (wallet && uri) {
      try {
        processDestination(uri);
      } catch (Err) {
        ReactNativeHapticFeedback.trigger('notificationError', { ignoreAndroidSystemSettings: false });
        setTimeout(() => alert(Err.message), 10);
        Keyboard.dismiss();
        clearAllInputs();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);

  const onBlur = () => {
    processDestination(destination);
  };

  const showError = errMessage => {
    alert(errMessage);
    ReactNativeHapticFeedback.trigger('notificationError', { ignoreAndroidSystemSettings: false });
  };

  const processLnurlPay = () => {
    if (amountSat <= 0) return showError(loc.send.details_amount_field_is_not_valid);

    const isMax = amountSat === wallet.getBalance();
    const maxFee = Math.round(amountSat * 0.03);
    const remainingBalance = wallet.getBalance() - amountSat;
    if (!isMax && maxFee > remainingBalance) return showError(loc.lnd.error_balance_for_insuficient_fee);

    navigate('SendDetailsRoot', {
      screen: 'LnurlPay',
      params: {
        lnurl: destination,
        amountSat: isMax ? Math.floor(amountSat * 0.97) : amountSat, // max 3% fee set by LNBits
        description: desc,
        walletID: walletID || wallet.getID(),
      },
    });
  };

  const processInvoicePay = async () => {
    if (!decoded) return null;
    if (amountSat === 0) return showError(loc.lnd.error_tip_invoice_not_supported);

    const newExpiresIn = (decoded.timestamp * 1 + decoded.expiry * 1) * 1000; // ms
    if (+new Date() > newExpiresIn) return showError(loc.lnd.errorInvoiceExpired);

    const currentUserInvoices = wallet.user_invoices_raw; // not fetching invoices, as we assume they were loaded previously
    if (currentUserInvoices.some(i => i.payment_hash === decoded.payment_hash)) return showError(loc.lnd.sameWalletAsInvoiceError);

    return navigate('SendDetailsRoot', {
      screen: 'LnurlPay',
      params: {
        invoice: destination,
        amountSat: amountSat,
        amountUnit: BitcoinUnit.SATS,
        description: decoded.description,
        walletID: walletID || wallet.getID(),
      },
    });
  };

  const next = () => {
    if (Lnurl.isLnurl(destination) || Lnurl.isLightningAddress(destination)) return processLnurlPay();
    if (
      DeeplinkSchemaMatch.isLightningInvoice(destination) ||
      DeeplinkSchemaMatch.isBothBitcoinAndLightning(destination) ||
      DeeplinkSchemaMatch.isTestnetLightningInvoice(destination)
    )
      return processInvoicePay();

    // make sure we have a valid destination
    alert(loc.send.details_address_field_is_not_valid);
  };

  const getFees = () => {
    const min = 0;
    const max = Math.floor(amountSat * 0.03);
    return `${min} ${BitcoinUnit.SATS} - ${max} ${BitcoinUnit.SATS}`;
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

  if (isLoading) {
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
              <BlueWalletSelect wallets={wallets} value={walletID} onChange={onWalletChange} />
            </View>

            <View>
              <AmountInput
                isLoading={isLoading}
                amount={amount}
                onAmountUnitChange={setUnit}
                onChangeText={handleAmountInputChange}
                disabled={isAmountInputDisabled}
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
              onBarScanned={processDestination}
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
                editable={!isDescDisabled}
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
                <BlueButton title={loc.lnd.next} onPress={next} />
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
