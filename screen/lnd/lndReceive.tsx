import React, { useContext, useEffect, useRef, useState } from 'react';
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
  ActivityIndicator,
} from 'react-native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import { useNavigation, useRoute, useTheme } from '@react-navigation/native';
import Share from 'react-native-share';
import { BlueButton, BlueDismissKeyboardInputAccessory, BlueWalletSelect, BlueCard, BlueCopyTextToClipboard, BlueSpacing20, BlueSpacing40 } from '../../BlueComponents';
import QRCodeComponent from '../../components/QRCodeComponent';
import navigationStyle from '../../components/navigationStyle';
import { BitcoinUnit, Chain } from '../../models/bitcoinUnits';
import loc from '../../loc';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import Notifications from '../../blue_modules/notifications';
import useInputAmount from '../../hooks/useInputAmount';
import { SuccessView } from '../send/success';

interface RouteParams {
  walletID: string;
}

const LNDReceive = () => {
  const { wallets, saveToDisk, setSelectedWallet, fetchAndSaveWalletTransactions } = useContext(BlueStorageContext);
  const { walletID } = useRoute().params as RouteParams;
  const wallet = useRef(
    wallets.find((item: any) => item.getID() === walletID) || wallets.find((item: any) => item.chain === Chain.OFFCHAIN),
  );
  const { colors } = useTheme();
  // @ts-ignore - useNavigation non-sense
  const { replace, dangerouslyGetParent } = useNavigation();
  const [isInvoiceLoading, setIsInvoiceLoading] = useState(false);
  const [description, setDescription] = useState('');
  const { inputProps, amountSats, formattedUnit, changeToNextUnit } = useInputAmount();
  const [invoiceRequest, setInvoiceRequest] = useState();
  const invoicePolling = useRef<NodeJS.Timer | undefined>();
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
  });

  useEffect(() => {
    if (wallet.current && wallet.current.getID() !== walletID) {
      const newWallet = wallets.find(w => w.getID() === walletID);
      if (newWallet) {
        wallet.current = newWallet;
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

  const initInvoicePolling = (invoice: any) => {
    cancelInvoicePolling(); // clear any previous polling
    invoicePolling.current = setInterval(async () => {
      const userInvoices = await wallet.current.getUserInvoices(20);
      const updatedUserInvoice = userInvoices.find(i => i.payment_request === invoice);
      if (!updatedUserInvoice) {
        cancelInvoicePolling();
        setInvoiceRequest(undefined);
        return;
      }

      if (updatedUserInvoice.ispaid) {
        cancelInvoicePolling();
        setInvoiceRequest(undefined);
        if(updatedUserInvoice.description){
          setDescription(updatedUserInvoice.description);
        }
        setIsPaid(true);
        fetchAndSaveWalletTransactions(walletID);
        return;
      }

      const currentDate = new Date();
      const now = (currentDate.getTime() / 1000) | 0; // eslint-disable-line no-bitwise
      const invoiceExpiration = updatedUserInvoice.timestamp + updatedUserInvoice.expire_time;
      if (now > invoiceExpiration) {
        cancelInvoicePolling();
        setInvoiceRequest(undefined);
        generateInvoice(); // invoice expired, generate new one
        return;
      }
    }, 3000);
  };

  const generateInvoice = async () => {
    if (!Keyboard.isVisible()) return;
    Keyboard.dismiss();

    if (amountSats === 0 || isNaN(amountSats)) {
      setInvoiceRequest(undefined);
      return;
    }
    setIsInvoiceLoading(true);
    const invoiceRequest = await wallet.current.addInvoice(amountSats, description);
    ReactNativeHapticFeedback.trigger('notificationSuccess', { ignoreAndroidSystemSettings: false });
    const decoded = await wallet.current.decodeInvoice(invoiceRequest);
    await Notifications.tryToObtainPermissions();
    Notifications.majorTomToGroundControl([], [decoded.payment_hash], []);

    setTimeout(async () => {
      await wallet.current.getUserInvoices(1);
      initInvoicePolling(invoiceRequest);
      await saveToDisk();
    }, 1000);

    setInvoiceRequest(invoiceRequest);
    setIsInvoiceLoading(false);
  };

  useEffect(() => {
    const keyboardDidHideListener = Keyboard.addListener('keyboardDidHide', generateInvoice);
    return () => {
      keyboardDidHideListener.remove();
      cancelInvoicePolling();
    };
  }, []);

  const onWalletChange = (id: string) => {
    const newWallet = wallets.find(w => w.getID() === id);
    if (!newWallet) return;

    if (newWallet.chain !== Chain.OFFCHAIN) {
      return replace('ReceiveDetails', { walletID: id });
    }
  };

  const handleShareButtonPressed = () => {
    Share.open({ message: invoiceRequest ? invoiceRequest : wallet.current.lnAddress }).catch(error => console.log(error));
  };

  if (isPaid) {
    return (
      <View style={styles.root}>
        <SuccessView amount={amountSats} amountUnit={BitcoinUnit.SATS} invoiceDescription={description} shouldAnimate={true} />
        <View style={styles.doneButton}>
          <BlueButton onPress={() => dangerouslyGetParent().popToTop()} title={loc.send.success_done} />
          <BlueSpacing40 />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior="position" style={[styles.root, styleHooks.root]}>
      <TouchableWithoutFeedback onPress={generateInvoice} accessible={false}>
        <View style={styles.allVerticalSpace}>
          <View style={styles.pickerContainer}>
            <BlueWalletSelect wallets={wallets} value={wallet.current?.getID()} onChange={onWalletChange} />
          </View>
          <View style={styles.allHeight}>
            <View style={[styles.scrollBody]}>
              <View style={styles.grow} />
              {isInvoiceLoading ? (
                <ActivityIndicator />
              ) : (
                <>
                  <QRCodeComponent value={invoiceRequest ? invoiceRequest : wallet.current.lnAddress} />
                  <BlueCopyTextToClipboard text={invoiceRequest || wallet.current.lnAddress} truncated={Boolean(invoiceRequest)} />
                </>
              )}
              <View style={styles.grow} />
            </View>
            <View style={styles.share}>
              <View style={[styles.customAmount, styleHooks.customAmount]}>
                <TextInput
                  placeholderTextColor="#81868e"
                  placeholder="Amount (optional)"
                  style={[styles.customAmountText, styleHooks.customAmountText]}
                  inputAccessoryViewID={BlueDismissKeyboardInputAccessory.InputAccessoryViewID}
                  onSubmitEditing={generateInvoice}
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
              <View style={[styles.customAmount, styleHooks.customAmount]}>
                <TextInput
                  onChangeText={setDescription}
                  placeholder={`${loc.receive.details_label} (optional)`}
                  value={description}
                  numberOfLines={1}
                  placeholderTextColor="#81868e"
                  style={[styles.customAmountText, styleHooks.customAmountText]}
                  onSubmitEditing={generateInvoice}
                />
              </View>
              <BlueCard>
                <BlueButton onPress={handleShareButtonPressed} title={loc.receive.details_share} />
              </BlueCard>
            </View>
          </View>
        </View>
      </TouchableWithoutFeedback>
      <BlueDismissKeyboardInputAccessory onPress={generateInvoice} />
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'space-between',
  },
  scrollBody: {
    marginTop: 16,
    flexGrow: 1,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  share: {
    justifyContent: 'flex-end',
    paddingVertical: 16,
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
  allHeight: {
    flex: 1,
  },
  grow: {
    flexGrow: 1,
  },
  allVerticalSpace: {
    height: '100%',
  },
  doneButton: {
    paddingHorizontal: 16,
  }
});

export default LNDReceive;
LNDReceive.routeName = 'LNDReceive';
LNDReceive.navigationOptions = navigationStyle(
  {
    closeButton: true,
    headerHideBackButton: true,
  },
  opts => ({ ...opts, title: loc.receive.header }),
);
