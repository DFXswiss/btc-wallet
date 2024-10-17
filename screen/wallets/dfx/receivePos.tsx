import React, { useEffect, useRef, useState } from 'react';
import { useRoute, useTheme } from '@react-navigation/native';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { BlueSpacing10, BlueSpacing20, Selector } from '../../../BlueComponents';
import { navigationStyleTx } from '../../../components/navigationStyle';
import { PaymentStatus, usePaymentLinks } from '../../../api/dfx/hooks/payment-link.hook';
import { Icon } from 'react-native-elements';
import QRCodeComponent from '../../../components/QRCodeComponent';

interface RouteParams {
  walletID: string;
  paymentRouteId?: string;
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

const ReceiveDfxPos = () => {
  const { walletID, paymentRouteId } = useRoute().params as RouteParams;
  const [sellRoutes, setSellRoutes] = useState<SellRoute[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<null | number>(null);
  const [fiatUnit, setFiatUnit] = useState('CHF');
  const [invoiceAmount, setInvoiceAmount] = useState(0);
  const [lnurl, setLnurl] = useState('');
  const [posStatus, setPosStatus] = useState(PosStatus.LOADING);
  const [isLoading, setIsLoading] = useState(true);
  const { getPaymentRoutes, getPaymentLink, createPaymentLink, waitPayment } = usePaymentLinks();
  const waitingController = useRef<AbortController | null>(null);
  const { colors } = useTheme();

  const styleHooks = StyleSheet.create({
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
        setTimeout(() => {
          setPosStatus(PosStatus.WAITING_CASHIER);
        }, 6 * 1000);
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
      setSelectedRoute(route.id);
      setFiatUnit(currencyRoute);

      let paymentLinkData = await getPaymentLink(walletID, route.id).catch(() => null);
      if (!paymentLinkData) paymentLinkData = await createPaymentLink(walletID, route.id);
      setLnurl(paymentLinkData.lnurl);

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
      const route = paymentRouteId ? sell.find(s => s.id === paymentRouteId) : sell[0];
      setSellRoutes(sell);
      handleRouteChanged(route);
      setIsLoading(false);
    })();

    return () => {
      if (waitingController.current) waitingController.current.abort();
    };
  }, []);

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
                    </>
                  )}
                  {posStatus === PosStatus.WAITING_PAYMENT && (
                    <>
                      <Text style={[styleHooks.colorText, styles.qrTitle]}>
                        Waiting for payment {invoiceAmount} {fiatUnit}
                      </Text>
                      <BlueSpacing10 />
                    </>
                  )}
                  {posStatus === PosStatus.WAITING_CASHIER && (
                    <Text style={[styleHooks.colorText, styles.qrTitle]}>Please wait for cashier</Text>
                  )}
                  {posStatus === PosStatus.LOADING_PAYMENT_INFO && (
                    <>
                      <Text style={[styleHooks.colorText, styles.qrTitle]}>Loading payment information...</Text>
                      <BlueSpacing10 />
                    </>
                  )}
                  <View style={{ alignItems: 'center', justifyContent: 'center' }}>
                    <QRCodeComponent value={lnurl} />
                  </View>
                  {posStatus === PosStatus.PAID && (
                    <>
                      <Text style={[styleHooks.colorText, styles.qrTitle]}>
                        {invoiceAmount} {fiatUnit}
                      </Text>
                      <Icon name="check-circle" size={70} color={'#00b300'} />
                    </>
                  )}
                  {(posStatus === PosStatus.LOADING_PAYMENT_INFO || posStatus === PosStatus.WAITING_PAYMENT) && (
                    <>
                      <BlueSpacing20 />
                      <ActivityIndicator />
                    </>
                  )}
                </View>
                <View style={styles.shareContainer}></View>
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
    paddingHorizontal: 16,
  },
  pickerContainer: { margin: 16 },
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

ReceiveDfxPos.navigationOptions = navigationStyleTx({}, options => ({
  ...options,
  title: 'DFX Point of Sale',
}));

export default ReceiveDfxPos;

interface SellRoute {
  id: number;
  active: boolean;
  currency: {
    id: number;
    name: string;
  };
  iban: string;
}
