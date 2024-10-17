import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  StyleSheet,
  TouchableWithoutFeedback,
  View,
  ScrollView,
  Text,
  ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute, useTheme } from '@react-navigation/native';
import { BlueWalletSelect, BlueCopyTextToClipboard } from '../../BlueComponents';
import QRCodeComponent from '../../components/QRCodeComponent';
import navigationStyle from '../../components/navigationStyle';
import loc from '../../loc';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import { LightningLdsWallet } from '../../class/wallets/lightning-lds-wallet';
import { Icon } from 'react-native-elements';
import { Chain } from '../../models/bitcoinUnits';

const POLLING_INTERVAL = 3000;

interface RouteParams {
  walletID: string;
}

const LndPosReceive = () => {
  const { wallets, setSelectedWallet } = useContext(BlueStorageContext);
  const { walletID } = useRoute().params as RouteParams;
  const wallet: LightningLdsWallet = useMemo(() => wallets.find((item: any) => item.getID() === walletID), [walletID, wallets]);
  const { colors } = useTheme();
  const { setParams, replace } = useNavigation();
  const invoicePolling = useRef<NodeJS.Timer | undefined>();
  const [isWaitingForPayment, setIsWaitingForPayment] = useState<boolean>(false);
  const [invoiceAmount, setInvoiceAmount] = useState(0);
  const [isPaid, setIsPaid] = useState(false);

  const styleHooks = StyleSheet.create({
    root: {
      backgroundColor: colors.elevated,
    },
    colorText: {
      color: colors.foregroundColor,
    },
  });

  useEffect(() => {
    (async () => {
      initInvoicePolling();
    })();
    return () => {
      cancelInvoicePolling();
    };
  }, []);

  useEffect(() => {
    if (wallet && wallet.getID() !== walletID) {
      const newWallet = wallets.find(w => w.getID() === walletID);
      if (newWallet) {
        setSelectedWallet(newWallet.getID());
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletID]);

  const cancelInvoicePolling = async () => {
    if (invoicePolling.current) {
      clearInterval(invoicePolling.current);
      invoicePolling.current = undefined;
    }
  };

  const initInvoicePolling = () => {
    // internal state for polling process
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
        setIsWaitingForPayment(true);
        setInvoiceAmount(minSendable);
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

  const onWalletChange = (id: string) => {
    const newWallet = wallets.find(w => w.getID() === id);
    if (!newWallet) return;

    if (newWallet.chain !== Chain.OFFCHAIN) {
      return replace('ReceiveDetails', { walletID: id });
    }

    setParams({ walletID: id });
  };

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.grow}>
        <KeyboardAvoidingView behavior="position" contentContainerStyle={[styleHooks.root, styles.flex]} style={[styles.flex]}>
          <View style={[styles.flex, styles.grow]}>
            <View style={styles.pickerContainer}>
              <BlueWalletSelect wallets={wallets} value={wallet?.getID()} onChange={onWalletChange} />
            </View>
            <View style={[styles.contentContainer]}>
              <View>
                {isPaid && <Text style={[styleHooks.colorText, styles.qrTitle]}>Payment received successfully!</Text>}
                {!isPaid && isWaitingForPayment && <Text style={[styleHooks.colorText, styles.qrTitle]}>Waiting for payment...</Text>}
                {!isPaid && !isWaitingForPayment && <Text style={[styleHooks.colorText, styles.qrTitle]}>Please wait for cashier</Text>}
              </View>
              <View style={[styles.scrollBody]}>
                <QRCodeComponent value={wallet.getLnurl()} />
                <View style={styles.shareContainer}>
                  <BlueCopyTextToClipboard text={wallet.lnAddress} textStyle={styles.copyText} />
                </View>
              </View>
              <View style={{ justifyContent: 'center', alignItems: 'center' }}>
                {isWaitingForPayment && Boolean(invoiceAmount) && !isPaid && (
                  <>
                    <Text style={[styleHooks.colorText, styles.invoiceText]}>You will be charged: {invoiceAmount / 1000} sats</Text>
                    <ActivityIndicator size="large" />
                  </>
                )}
                {isPaid && (
                  <>
                    <Text style={[styleHooks.colorText, styles.invoiceText]}>We received {invoiceAmount / 1000} sats</Text>
                    <Icon name="check-circle" size={70} color={'#00b300'} />
                  </>
                )}
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
    marginTop: 16,
  },
  scrollBody: {
    marginTop: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  pickerContainer: { marginHorizontal: 16 },
  flex: {
    flex: 1,
  },
  grow: {
    flexGrow: 1,
  },
  buttonsContainer: {
    alignItems: 'center',
    marginVertical: 5,
  },
  copyText: {
    marginVertical: 16,
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
  invoiceText: { fontSize: 24, textAlign: 'center', marginVertical: 16 },
  successAnimation: {
    width: '100%',
    height: '100%',
    backgroundColor: '#FFF',
  },
});

export default LndPosReceive;
LndPosReceive.routeName = 'LndPosReceive';
LndPosReceive.navigationOptions = navigationStyle(
  {
    closeButton: true,
    headerHideBackButton: true,
  },
  opts => ({ ...opts, title: loc.receive.header }),
);
