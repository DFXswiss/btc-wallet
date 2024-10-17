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
  ActivityIndicator,
  Platform,
  ScrollView,
} from 'react-native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import { useNavigation, useRoute, useTheme } from '@react-navigation/native';
import Share from 'react-native-share';
import {
  BlueButton,
  BlueDismissKeyboardInputAccessory,
  BlueWalletSelect,
  BlueCopyTextToClipboard,
  BlueSpacing40,
  SecondButton,
  BlueSpacing10,
} from '../../BlueComponents';
import QRCodeComponent from '../../components/QRCodeComponent';
import navigationStyle from '../../components/navigationStyle';
import { BitcoinUnit, Chain } from '../../models/bitcoinUnits';
import loc from '../../loc';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import Notifications from '../../blue_modules/notifications';
import useInputAmount from '../../hooks/useInputAmount';
import { SuccessView } from '../send/success';
import { useNFC } from '../../hooks/nfc.hook';
import BoltCard from '../../class/boltcard';
import { useReplaceModalScreen } from '../../hooks/replaceModalScreen.hook';

interface RouteParams {
  walletID: string;
}

const LNDReceive = () => {
  const { wallets, saveToDisk, setSelectedWallet, fetchAndSaveWalletTransactions } = useContext(BlueStorageContext);
  const { walletID } = useRoute().params as RouteParams;
  const wallet = useMemo(() => wallets.find((item: any) => item.getID() === walletID), [walletID, wallets]);
  const { colors } = useTheme();
  // @ts-ignore - useNavigation non-sense
  const { setParams, getParent, navigate } = useNavigation();
  const replace = useReplaceModalScreen();
  const [isInvoiceLoading, setIsInvoiceLoading] = useState(false);
  const [description, setDescription] = useState('');
  const { inputProps, amountSats, formattedUnit, changeToNextUnit } = useInputAmount();
  const [invoiceRequest, setInvoiceRequest] = useState();
  const invoicePolling = useRef<NodeJS.Timer | undefined>();
  const [isPaid, setIsPaid] = useState(false);
  const inputAmountRef = useRef<TextInput | null>(null);
  const inputDescriptionRef = useRef<TextInput | null>(null);
  const { isNfcActive, startReading, stopReading } = useNFC();

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
    return () => {
      cancelInvoicePolling();
      stopReading();
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

  const initInvoicePolling = (invoice: any) => {
    cancelInvoicePolling(); // clear any previous polling
    invoicePolling.current = setInterval(async () => {
      const userInvoices = await wallet.getUserInvoices(20);
      const updatedUserInvoice = userInvoices.find(i => i.payment_request === invoice);
      if (!updatedUserInvoice) {
        return;
      }

      if (updatedUserInvoice.ispaid) {
        cancelInvoicePolling();
        setInvoiceRequest(undefined);
        if (updatedUserInvoice.description) {
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

  const handleNfcRead = (pr: string) => async (payload: string) => {
    setIsInvoiceLoading(true);
    if (BoltCard.isBoltcardWidthdrawUrl(payload)) {
      await stopReading();
      const { isError, reason } = await BoltCard.widthdraw(payload, pr);
      if (isError) {
        alert(reason);
        setIsInvoiceLoading(false);
      }
    }
  };

  const startNfcOnIos = () => {
    if (isNfcActive) stopReading();
    if (invoiceRequest) {
      startReading(handleNfcRead(invoiceRequest));
    }
  };

  const generateInvoice = async () => {
    if (isInvoiceLoading) return;
    if (isNfcActive) stopReading();
    setIsInvoiceLoading(true);
    Keyboard.dismiss();

    if (amountSats === 0 || isNaN(amountSats)) {
      setInvoiceRequest(undefined);
      setIsInvoiceLoading(false);
      return;
    }
    const invoiceRequest = await wallet.addInvoice(amountSats, description);
    ReactNativeHapticFeedback.trigger('notificationSuccess', { ignoreAndroidSystemSettings: false });
    const decoded = await wallet.decodeInvoice(invoiceRequest);
    await Notifications.tryToObtainPermissions();
    Notifications.majorTomToGroundControl([], [decoded.payment_hash], []);

    setTimeout(async () => {
      await wallet.getUserInvoices(1);
      initInvoicePolling(invoiceRequest);
      await saveToDisk();
    }, 1000);

    setInvoiceRequest(invoiceRequest);
    if (Platform.OS === 'android') startReading(handleNfcRead(invoiceRequest));
    setIsInvoiceLoading(false);
  };

  const onWalletChange = (id: string) => {
    const newWallet = wallets.find(w => w.getID() === id);
    if (!newWallet) return;

    if (newWallet.chain !== Chain.OFFCHAIN) {
      return replace({ name: 'ReceiveDetails', params: { walletID: id } });
    }
    
    setParams({ walletID: id });
    navigate('LNDReceive', { walletID: id });
  };

  const handleOnBlur = () => {
    const isFocusOnSomeInput = inputAmountRef.current?.isFocused() || inputDescriptionRef.current?.isFocused();
    if (!isFocusOnSomeInput) {
      generateInvoice();
    }
  };

  const handleShareButtonPressed = () => {
    Share.open({ message: invoiceRequest ? invoiceRequest : wallet.lnAddress }).catch(error => console.log(error));
  };

  if (isPaid) {
    return (
      <View style={styles.root}>
        <SuccessView amount={amountSats} amountUnit={BitcoinUnit.SATS} invoiceDescription={description} shouldAnimate={true} />
        <View style={styles.doneButton}>
          <BlueButton onPress={() => getParent().popToTop()} title={loc.send.success_done} />
          <BlueSpacing40 />
        </View>
      </View>
    );
  }

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.grow}>
        <KeyboardAvoidingView behavior="position" contentContainerStyle={[styleHooks.root, styles.flex]} style={[styles.flex]}>
          <View style={[styles.flex, styles.grow]}>
            <View style={styles.pickerContainer}>
              <BlueWalletSelect wallets={wallets} value={wallet?.getID()} onChange={onWalletChange} />
            </View>
            <View style={[styles.contentContainer]}>
              <View style={[styles.scrollBody, styles.flex]}>
                {isInvoiceLoading ? (
                  <ActivityIndicator />
                ) : (
                  <>
                    <QRCodeComponent value={invoiceRequest ? invoiceRequest : wallet.getLnurl?.() || wallet.lnAddress} />
                    <View style={styles.shareContainer}>
                      <BlueCopyTextToClipboard
                        text={invoiceRequest || wallet.lnAddress}
                        truncated={Boolean(invoiceRequest)}
                        textStyle={styles.copyText}
                      />
                      <TouchableOpacity accessibilityRole="button" onPress={handleShareButtonPressed}>
                        <Image resizeMode="stretch" source={require('../../img/share-icon.png')} style={{ width: 18, height: 20 }} />
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </View>
              <View style={styles.share}>
                <View style={[styles.customAmount, styleHooks.customAmount]}>
                  <TextInput
                    ref={inputAmountRef}
                    placeholderTextColor="#81868e"
                    placeholder="Amount (optional)"
                    style={[styles.customAmountText, styleHooks.customAmountText]}
                    inputAccessoryViewID={BlueDismissKeyboardInputAccessory.InputAccessoryViewID}
                    onBlur={handleOnBlur}
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
                    ref={inputDescriptionRef}
                    onChangeText={setDescription}
                    placeholder={`${loc.receive.details_label} (optional)`}
                    value={description}
                    numberOfLines={1}
                    placeholderTextColor="#81868e"
                    style={[styles.customAmountText, styleHooks.customAmountText]}
                    onBlur={handleOnBlur}
                  />
                </View>
                {invoiceRequest ? (
                  <View>
                    {Platform.select({
                      ios: (
                        <View style={styles.iosNfcButtonContainer}>
                          <SecondButton
                            onPress={startNfcOnIos}
                            disabled={!Boolean(invoiceRequest)}
                            title={'Use Boltcard'}
                            image={{ source: require('../../img/bolt-card.png') }}
                          />
                        </View>
                      ),
                      android: (
                        <View style={styles.buttonsContainer}>
                          <Image source={require('../../img/bolt-card.png')} style={{ width: 40, height: 40 }} />
                        </View>
                      ),
                    })}
                    <BlueSpacing10 />
                  </View>
                ) : (
                  <>
                    <BlueSpacing40 />
                    <BlueSpacing40 />
                  </>
                )}
              </View>
              <BlueDismissKeyboardInputAccessory onPress={generateInvoice} />
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
});

export default LNDReceive;
LNDReceive.routeName = 'LNDReceive';
LNDReceive.navigationOptions = navigationStyle(
  {
    closeButton: true,
    headerBackVisible: false,
  },
  opts => ({ ...opts, title: loc.receive.header }),
);
