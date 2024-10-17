import React, { useEffect, useRef, useState } from 'react';
import { useNavigation, useRoute, useTheme } from '@react-navigation/native';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import {
  BlueButton,
  BlueDismissKeyboardInputAccessory,
  BlueSpacing10,
  BlueSpacing20,
  SecondButton,
  Selector,
} from '../../../BlueComponents';
import { navigationStyleTx } from '../../../components/navigationStyle';
import { PaymentStatus, usePaymentLinks } from '../../../api/dfx/hooks/payment-link.hook';
import { Icon } from 'react-native-elements';
import useInputAmount from '../../../hooks/useInputAmount';
import { BitcoinUnit } from '../../../models/bitcoinUnits';
import { FiatUnit } from '../../../models/fiatUnit';
const currency = require('../../../blue_modules/currency');

interface RouteParams {
  walletID: string;
}

enum PosStatus {
  LOADING = 'LOADING',
  WAITING_CASHIER = 'WAITING_CASHIER',
  WAITING_PAYMENT = 'WAITING_PAYMENT',
  PAID = 'PAID',
  LOADING_PAYMENT_LINK = 'LOADING_PAYMENT_LINK',
  LOADING_PAYMENT_INFO = 'LOADING_PAYMENT_INFO',
  NOT_AVAILABLE = 'NOT_AVAILABLE',
}

const CashierDfxPos = () => {
  const { navigate } = useNavigation();
  const { walletID } = useRoute().params as RouteParams;
  const [sellRoutes, setSellRoutes] = useState<SellRoute[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<null | number>(null);
  const [fiatUnit, setFiatUnit] = useState('CHF');
  const [invoiceAmount, setInvoiceAmount] = useState(0);
  const [posStatus, setPosStatus] = useState(PosStatus.LOADING);
  const [isCanceling, setIsCanceling] = useState(false);
  const [isGeneratingInvoice, setIsGeneratingInvoice] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const { inputProps, inputAmount, formattedUnit, resetInput } = useInputAmount(BitcoinUnit.LOCAL_CURRENCY);
  const { getPaymentRoutes, getPaymentLink, createPaymentLink, waitPayment, createPayment, cancelPayment } = usePaymentLinks();
  const waitingController = useRef<AbortController | null>(null);
  const { colors } = useTheme();

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

  const onPaymentResolved = (p: any) => {
    switch (p.payment.status) {
      case PaymentStatus.CANCELLED:
      case PaymentStatus.EXPIRED:
        setPosStatus(PosStatus.WAITING_CASHIER);
        break;

      case PaymentStatus.COMPLETED:
        setPosStatus(PosStatus.PAID);
        break;
    }
  };

  const onPendingPayment = (p: any) => {
    setPosStatus(PosStatus.WAITING_PAYMENT);
    setInvoiceAmount(p.amount);
    if (waitingController.current) waitingController.current.abort();
    const controller = new AbortController();
    waitingController.current = controller;
    waitPayment(walletID, p.externalId, controller.signal).then(onPaymentResolved);
  };

  const handleRouteChanged = async (route: any) => {
    try {
      setPosStatus(PosStatus.LOADING_PAYMENT_INFO);

      const currencyRoute = route?.currency.name as string;
      const symbol = FiatUnit[currencyRoute];
      await currency.setPrefferedCurrency(symbol);
      await currency.init();
      setSelectedRoute(route.id);
      setFiatUnit(currencyRoute);
      resetInput();

      let paymentLinkData = await getPaymentLink(walletID, route.id).catch(() => null);
      if (!paymentLinkData) paymentLinkData = await createPaymentLink(walletID, route.id);

      const { payment: paymentData } = paymentLinkData;
      if (paymentData && paymentData.status === PaymentStatus.PENDING) {
        onPendingPayment(paymentData);
        setPosStatus(PosStatus.WAITING_PAYMENT);
      } else {
        setPosStatus(PosStatus.WAITING_CASHIER);
      }
    } catch (error) {
      console.log(error);
      setPosStatus(PosStatus.NOT_AVAILABLE);
    }
  };

  const onRouteChange = async (routeId: number) => {
    const route = sellRoutes.find(r => r.id === routeId);
    if (route) handleRouteChanged(route);
  };

  useEffect(() => {
    (async () => {
      const { sell } = await getPaymentRoutes(walletID);
      const route = sell[0];
      setSellRoutes(sell);
      handleRouteChanged(route);
      setIsLoading(false);
    })();

    return () => {
      if (waitingController.current) waitingController.current.abort();
    };
  }, []);

  const generateInvoice = async () => {
    try {
      setIsGeneratingInvoice(true);
      const { payment: paymentData } = await createPayment(walletID, selectedRoute as number, Number(inputAmount));
      onPendingPayment(paymentData);
      resetInput();
    } catch (error) {
      console.log(error);
    } finally {
      setIsGeneratingInvoice(false);
    }
  };

  const cancelPurchase = async () => {
    try {
      setIsCanceling(true);
      await cancelPayment(walletID, selectedRoute as number);
    } catch (error) {
      console.log(error);
    } finally {
      setIsCanceling(false);
      setPosStatus(PosStatus.WAITING_CASHIER);
    }
  };

  const getRouteItems = () =>
    sellRoutes.map(r => ({
      label: `Route ${r.id} - ${r.currency.name}/${r.iban.substring(0, 4)}***${r.iban.substring(r.iban.length - 4)}`,
      value: r.id,
    }));

  if (isLoading) {
    return (
      <View style={[styles.loading]}>
        <ActivityIndicator />
      </View>
    );
  }

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
              <View style={styles.pickerContainer}>
                <Selector items={getRouteItems()} selectedValue={selectedRoute} onValueChange={onRouteChange} />
              </View>
              <View style={[styles.scrollBody, styles.flex]}>
                <View>
                  {posStatus === PosStatus.PAID && (
                    <>
                      <Text style={[styleHooks.colorText, styles.qrTitle]}>Payment received successfully!</Text>
                      <Text style={[styleHooks.colorText, styles.qrTitle]}>
                        {invoiceAmount} {fiatUnit}
                      </Text>
                      <Icon name="check-circle" size={70} color={'#00b300'} />
                    </>
                  )}
                  {posStatus === PosStatus.WAITING_PAYMENT && (
                    <>
                      <Text style={[styleHooks.colorText, styles.qrTitle]}>
                        Waiting for payment {invoiceAmount} {fiatUnit}
                      </Text>
                      <ActivityIndicator />
                    </>
                  )}
                  {posStatus === PosStatus.WAITING_CASHIER && (
                    <Text style={[styleHooks.colorText, styles.qrTitle]}>Enter the amount and tap "Generate Invoice"</Text>
                  )}
                  {posStatus === PosStatus.LOADING_PAYMENT_INFO && (
                    <>
                      <Text style={[styleHooks.colorText, styles.qrTitle]}>Loading payment information...</Text>
                      <ActivityIndicator />
                    </>
                  )}
                </View>
                <View style={styles.shareContainer}></View>
              </View>
              <View style={styles.share}>
                {posStatus === PosStatus.WAITING_CASHIER && (
                  <>
                    <View style={[styles.customAmount, styleHooks.customAmount]}>
                      <TextInput
                        placeholderTextColor="#81868e"
                        placeholder="Amount"
                        style={[styles.customAmountText, styleHooks.customAmountText]}
                        inputAccessoryViewID={BlueDismissKeyboardInputAccessory.InputAccessoryViewID}
                        {...inputProps}
                      />
                      <Text style={styles.inputUnit}>{formattedUnit}</Text>
                    </View>
                    <BlueSpacing20 />
                    <BlueButton onPress={generateInvoice} title="Generate Invoice" isLoading={isGeneratingInvoice} />
                  </>
                )}
                {posStatus === PosStatus.WAITING_PAYMENT && (
                  <>
                    <BlueButton onPress={cancelPurchase} title="Cancel purchase" isLoading={isCanceling} />
                    <BlueSpacing10 />
                    {!isCanceling && (
                      <SecondButton
                        onPress={() => navigate('ReceiveDfxPos', { walletID, paymentRouteId: selectedRoute })}
                        title="Show QR code"
                      />
                    )}
                  </>
                )}
                {posStatus === PosStatus.PAID && (
                  <>
                    <BlueButton onPress={() => setPosStatus(PosStatus.WAITING_CASHIER)} title="New purchase" />
                  </>
                )}
                <BlueSpacing20 />
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </ScrollView>
    </TouchableWithoutFeedback>
  );
};

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
  },
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
  pickerContainer: { margin: 16 },
  inputUnit: {
    color: '#81868e',
    fontSize: 16,
    marginRight: 10,
    marginLeft: 10,
  },
  flex: {
    flex: 1,
  },
  grow: {
    flexGrow: 1,
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

CashierDfxPos.navigationOptions = navigationStyleTx({}, options => ({
  ...options,
  title: 'DFX Point of Sale',
}));

export default CashierDfxPos;

interface SellRoute {
  id: number;
  active: boolean;
  currency: {
    id: number;
    name: string;
  };
  iban: string;
}
