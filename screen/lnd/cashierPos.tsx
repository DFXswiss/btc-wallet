import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  StyleSheet,
  TextInput,
  TouchableWithoutFeedback,
  View,
  Image,
  Text,
  TouchableOpacity,
  Platform,
  ScrollView,
} from 'react-native';
import { useRoute, useTheme } from '@react-navigation/native';
import {
  BlueButton,
  BlueDismissKeyboardInputAccessory,
  BlueCopyTextToClipboard,
  SecondButton,
  BlueSpacing10,
  BlueSpacing20,
} from '../../BlueComponents';
import navigationStyle from '../../components/navigationStyle';
import loc from '../../loc';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import useInputAmount from '../../hooks/useInputAmount';
import { LightningLdsWallet } from '../../class/wallets/lightning-lds-wallet';
import { Icon } from 'react-native-elements';

const POLLING_INTERVAL = 3000;

interface RouteParams {
  walletID: string;
}

const CashierPos = () => {
  const { wallets } = useContext(BlueStorageContext);
  const { walletID } = useRoute().params as RouteParams;
  const wallet: LightningLdsWallet = useMemo(() => wallets.find((item: any) => item.getID() === walletID), [walletID, wallets]);
  const { colors } = useTheme();
  const { inputProps, amountSats, formattedUnit, changeToNextUnit, resetInput } = useInputAmount();
  const invoicePolling = useRef<NodeJS.Timer | undefined>();
  const [isWaitingForPayment, setIsWaitingForPayment] = useState<boolean>(false);
  const [invoiceAmount, setInvoiceAmount] = useState(0);
  const [isPaid, setIsPaid] = useState(false);

  const styleHooks = StyleSheet.create({
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
    colorText: {
      color: colors.foregroundColor,
    },
  });

  useEffect(() => {
    return () => {
      cancelInvoicePolling();
    };
  }, []);

  const cancelInvoicePolling = async () => {
    if (invoicePolling.current) {
      clearInterval(invoicePolling.current);
      invoicePolling.current = undefined;
    }
  };

  const initInvoicePolling = () => {
    // internal statefor polling process
    let timestamp = 0;
    let isChecking = false;
    let waitingForRestart = false;

    cancelInvoicePolling(); // clear any previous polling

    invoicePolling.current = setInterval(async () => {
      if (isChecking) return;
      isChecking = true;

      const { minSendable, maxSendable } = await wallet.queryLnurlPayService();

      // Waiting for a payment
      if (minSendable === maxSendable && minSendable > 1000 && !waitingForRestart) {
        if (timestamp === 0) timestamp = new Date().getTime() - POLLING_INTERVAL;
        const userInvoices = await wallet.getUserInvoices(20);
        const payedInvoice = i => {
          return i.timestamp * 1000 > timestamp && i.amt * 1000 === minSendable && i.ispaid;
        };
        const updatedUserInvoice = userInvoices.find(payedInvoice);
        if (updatedUserInvoice) {
          waitingForRestart = true;
          setIsWaitingForPayment(false);
          setIsPaid(true);
          resetInput();
          await wallet.adjustLnurlPayAmount(1, 1);

          setTimeout(() => {
            setInvoiceAmount(0);
            setIsPaid(false);
          }, POLLING_INTERVAL);
        }
      }

      // Waiting for the cashier to enter the amount
      if (minSendable === maxSendable && minSendable === 1000) {
        waitingForRestart = false;
        timestamp = 0;
        setIsWaitingForPayment(false);
        setInvoiceAmount(0);
      }

      isChecking = false;
    }, POLLING_INTERVAL);
  };

  const generateInvoice = async () => {
    try {
      await wallet.adjustLnurlPayAmount(amountSats, amountSats);
      setInvoiceAmount(amountSats);
      setIsWaitingForPayment(true);
      initInvoicePolling();
    } catch (error) {
      console.log(error);
    }
  };

  const cancelPurchase = async () => {
    await wallet.adjustLnurlPayAmount(1, 1);
    resetInput();
    setIsWaitingForPayment(false);
    setInvoiceAmount(0);
    cancelInvoicePolling();
  };

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.grow}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'android' ? undefined : 'position'}
          contentContainerStyle={[styleHooks.root, styles.flex]}
          style={[styles.flex]}
        >
          <View style={[styles.flex, styles.grow]}>
            <View style={[styles.contentContainer]}>
              <View style={[styles.scrollBody, styles.flex]}>
                <View>
                  {isPaid && (
                    <>
                      <Text style={[styleHooks.colorText, styles.qrTitle]}>Payment received successfully!</Text>
                      <Text style={[styleHooks.colorText, styles.qrTitle]}>{invoiceAmount} sats</Text>
                      <Icon name="check-circle" size={70} color={'#00b300'} />
                    </>
                  )}
                  {!isPaid && isWaitingForPayment && (
                    <Text style={[styleHooks.colorText, styles.qrTitle]}>Waiting for payment {invoiceAmount} sats...</Text>
                  )}
                  {!isPaid && !isWaitingForPayment && (
                    <Text style={[styleHooks.colorText, styles.qrTitle]}>Enter the amount and tap "Generate Invoice"</Text>
                  )}
                </View>
                <View style={styles.shareContainer}>
                  <BlueCopyTextToClipboard text={wallet.lnAddress} textStyle={styles.copyText} />
                </View>
              </View>
              <View style={styles.share}>
                <View style={[styles.customAmount, styleHooks.customAmount]}>
                  <TextInput
                    placeholderTextColor="#81868e"
                    placeholder="Amount"
                    style={[styles.customAmountText, styleHooks.customAmountText]}
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
                <BlueSpacing20 />
                <BlueButton onPress={generateInvoice} title="Generate Invoice" />
                <BlueSpacing20 />
                <SecondButton onPress={cancelPurchase} title="Cancel purchase" />
                <BlueSpacing10 />
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </ScrollView>
    </TouchableWithoutFeedback>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'space-between',
  },
  contentContainer: {
    flex: 1,
    flexGrow: 1,
    justifyContent: 'space-between',
  },
  scrollBody: {
    marginTop: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  share: {
    justifyContent: 'flex-end',
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 8,
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
  customAmountText: {
    flex: 1,
    marginHorizontal: 8,
    minHeight: 33,
  },
  pickerContainer: { marginHorizontal: 16 },
  inputUnit: {
    color: '#81868e',
    fontSize: 16,
    marginRight: 10,
    marginLeft: 10,
  },
  changeToNextUnitButton: {
    borderLeftColor: '#676b71',
    borderLeftWidth: 1,
    paddingHorizontal: 10,
  },
  flex: {
    flex: 1,
  },
  grow: {
    flexGrow: 1,
  },
  doneButton: {
    paddingHorizontal: 16,
  },
  buttonsContainer: {
    alignItems: 'center',
    marginVertical: 5,
  },
  copyText: {
    marginVertical: 16,
  },
  iosNfcButtonContainer: {
    marginVertical: 10,
  },
  shareContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  qrTitle: {
    fontWeight: 'bold',
    fontSize: 24,
    textAlign: 'center',
    marginVertical: 16,
  },
});

export default CashierPos;

CashierPos.routeName = 'CashierPos';
CashierPos.navigationOptions = navigationStyle(
  {
    closeButton: true,
    headerHideBackButton: true,
  },
  opts => ({ ...opts, title: loc.receive.header }),
);
