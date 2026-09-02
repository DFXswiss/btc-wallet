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
import { useNavigation, useRoute, useTheme, ParamListBase } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
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
import { AbstractWallet } from '../../class';
import { LightningLdsWallet } from '../../class/wallets/lightning-lds-wallet';
import { SparkWallet } from '../../class/wallets/spark-wallet';
import { majorTomToGroundControl, tryToObtainPermissions } from '../../blue_modules/notifications';
import useInputAmount from '../../hooks/useInputAmount';
import { SuccessView } from '../send/success';
import { useNFC } from '../../hooks/nfc.hook';
import BoltCard from '../../class/boltcard';
import { reportError } from '../../helpers/errors';

interface RouteParams {
  walletID: string;
}

const LNDReceive = () => {
  const { wallets, saveToDisk, setSelectedWallet, fetchAndSaveWalletTransactions } = useContext(BlueStorageContext);
  const { walletID } = useRoute().params as RouteParams;
  const wallet = useMemo(() => wallets.find((item: any) => item.getID() === walletID), [walletID, wallets]);
  const { colors } = useTheme();
  const { setParams, getParent } = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  const [isInvoiceLoading, setIsInvoiceLoading] = useState(false);
  const [description, setDescription] = useState('');
  const { inputProps, amountSats, formattedUnit, changeToNextUnit } = useInputAmount();
  const [invoiceRequest, setInvoiceRequest] = useState();
  const [invoiceAmountSats, setInvoiceAmountSats] = useState<number | undefined>();
  const invoicePolling = useRef<NodeJS.Timeout | undefined>(undefined);
  const invoicePollTimeout = useRef<NodeJS.Timeout | undefined>(undefined);
  const pollGeneration = useRef(0);
  const [isPaid, setIsPaid] = useState(false);
  const [receiveMethod, setReceiveMethod] = useState<'lightning' | 'onchain'>('lightning');
  const receiveMethodRef = useRef(receiveMethod);
  const [onchainAddress, setOnchainAddress] = useState<string | undefined>();
  const [isOnchainLoading, setIsOnchainLoading] = useState(false);
  const inputAmountRef = useRef<TextInput | null>(null);
  const inputDescriptionRef = useRef<TextInput | null>(null);
  const { isNfcActive, startReading, stopReading } = useNFC();
  const isSpark = wallet?.type === SparkWallet.type;
  const isOnchainReceive = isSpark && receiveMethod === 'onchain';

  const styleHooks = StyleSheet.create({
    customAmount: {
      borderColor: colors.formBorder,
      borderBottomColor: colors.formBorder,
      backgroundColor: colors.inputBackgroundColor,
    },
    customAmountText: {
      color: colors.foregroundColor,
    },
    missingAddress: {
      color: colors.foregroundColor,
    },
    methodSwitchTrack: {
      backgroundColor: colors.buttonDisabledBackgroundColor,
    },
    methodSwitchTabActive: {
      backgroundColor: colors.modal,
    },
    methodSwitchText: {
      color: colors.foregroundColor,
    },
    onchainHint: {
      color: colors.alternativeTextColor,
    },
    root: {
      backgroundColor: colors.elevated,
    },
  });

  useEffect(() => {
    receiveMethodRef.current = receiveMethod;
  }, [receiveMethod]);

  useEffect(() => {
    return () => {
      cancelInvoicePolling();
      stopReading();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletID]);

  useEffect(() => {
    if (wallet && wallet.getID() !== walletID) {
      const newWallet = wallets.find((w: AbstractWallet) => w.getID() === walletID);
      if (newWallet) {
        setSelectedWallet(newWallet.getID());
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletID]);

  useEffect(() => {
    if (!isSpark || !isOnchainReceive || !wallet) {
      return;
    }
    if (typeof wallet.depositAddress === 'string' && wallet.depositAddress) {
      setOnchainAddress(wallet.depositAddress);
      setIsOnchainLoading(false);
      return;
    }
    let cancelled = false;
    setIsOnchainLoading(true);
    setOnchainAddress(undefined);
    (async () => {
      try {
        const address = await wallet.getDepositAddress();
        if (cancelled) return;
        setOnchainAddress(address || undefined);
        if (address) {
          await saveToDisk();
        }
      } catch {
        if (cancelled) return;
        setOnchainAddress(undefined);
      } finally {
        if (!cancelled) setIsOnchainLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSpark, isOnchainReceive, walletID]);

  const cancelInvoicePolling = () => {
    pollGeneration.current += 1;
    if (invoicePollTimeout.current) {
      clearTimeout(invoicePollTimeout.current);
      invoicePollTimeout.current = undefined;
    }
    if (invoicePolling.current) {
      clearInterval(invoicePolling.current);
      invoicePolling.current = undefined;
    }
  };

  const initInvoicePolling = (invoice: string, paymentHash?: string) => {
    cancelInvoicePolling(); // clear any previous polling
    const generation = pollGeneration.current;
    let isChecking = false;
    let hasReportedPollError = false;
    invoicePolling.current = setInterval(async () => {
      if (isChecking) return;
      isChecking = true;
      try {
        const userInvoices = await wallet.getUserInvoices(20);
        if (generation !== pollGeneration.current) {
          return;
        }
        const updatedUserInvoice = userInvoices.find(
          (i: {
            payment_request: string;
            payment_hash?: string;
            ispaid: boolean;
            description?: string;
            timestamp: number;
            expire_time: number;
          }) => i.payment_request === invoice || (Boolean(paymentHash) && i.payment_hash === paymentHash),
        );
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
          // Keep watching an open invoice on the on-chain tab; only skip
          // creating a replacement while Lightning is not visible.
          if (receiveMethodRef.current === 'lightning') {
            generateInvoice();
          }
        }
      } catch (error) {
        if (generation !== pollGeneration.current) {
          return;
        }
        if (hasReportedPollError) {
          return;
        }
        hasReportedPollError = true;
        reportError('lndReceive: invoice poll failed', error);
      } finally {
        isChecking = false;
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

    try {
      if (amountSats === 0 || isNaN(amountSats)) {
        cancelInvoicePolling();
        setInvoiceRequest(undefined);
        return;
      }
      const invoiceAmount = amountSats;
      const invoiceRequest = await wallet.addInvoice(invoiceAmount, description);
      ReactNativeHapticFeedback.trigger('notificationSuccess', { ignoreAndroidSystemSettings: false });
      const decoded = await wallet.decodeInvoice(invoiceRequest);
      await tryToObtainPermissions();
      majorTomToGroundControl([], [decoded.payment_hash], []);

      cancelInvoicePolling();
      const generation = pollGeneration.current;
      invoicePollTimeout.current = setTimeout(async () => {
        invoicePollTimeout.current = undefined;
        try {
          await wallet.getUserInvoices(1);
        } catch (error) {
          reportError('lndReceive: prefetch invoices failed', error);
        }
        if (generation !== pollGeneration.current) {
          return;
        }
        initInvoicePolling(invoiceRequest, decoded.payment_hash);
        await saveToDisk();
      }, 1000);

      setInvoiceRequest(invoiceRequest);
      setInvoiceAmountSats(invoiceAmount);
      if (Platform.OS === 'android' && wallet.type === LightningLdsWallet.type) {
        startReading(handleNfcRead(invoiceRequest));
      }
    } catch (error) {
      ReactNativeHapticFeedback.trigger('notificationError', { ignoreAndroidSystemSettings: false });
      alert(error instanceof Error ? error.message : String(error));
    } finally {
      setIsInvoiceLoading(false);
    }
  };

  const onWalletChange = (id: string) => {
    if (id === wallet?.getID()) return;

    const newWallet = wallets.find((w: AbstractWallet) => w.getID() === id);
    if (!newWallet) return;

    if (newWallet.chain !== Chain.OFFCHAIN) {
      return { name: 'ReceiveDetails', params: { walletID: id } };
    }

    setParams({ walletID: id });
  };

  const handleOnBlur = () => {
    const isFocusOnSomeInput = inputAmountRef.current?.isFocused() || inputDescriptionRef.current?.isFocused();
    if (!isFocusOnSomeInput) {
      generateInvoice();
    }
  };

  const displayedOnchainAddress =
    onchainAddress || (typeof wallet?.depositAddress === 'string' && wallet.depositAddress ? wallet.depositAddress : undefined);
  const copyText = isOnchainReceive ? displayedOnchainAddress : invoiceRequest || wallet?.lnAddress;
  const qrValue = isOnchainReceive ? displayedOnchainAddress : invoiceRequest || wallet?.getLnurl?.() || wallet?.lnAddress;
  const isQrLoading = isInvoiceLoading || (isOnchainReceive && isOnchainLoading && !displayedOnchainAddress);

  const handleShareButtonPressed = () => {
    Share.open({ message: (isOnchainReceive ? displayedOnchainAddress : invoiceRequest || wallet.lnAddress) || '' }).catch(() => {});
  };

  if (isPaid) {
    return (
      <View style={styles.root}>
        <SuccessView amount={invoiceAmountSats} amountUnit={BitcoinUnit.SATS} invoiceDescription={description} shouldAnimate={true} />
        <View style={styles.doneButton}>
          <BlueButton onPress={() => getParent<NativeStackNavigationProp<ParamListBase>>()?.popToTop()} title={loc.send.success_done} />
          <BlueSpacing40 />
        </View>
      </View>
    );
  }

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.grow}>
        <KeyboardAvoidingView behavior="position" contentContainerStyle={[styleHooks.root, styles.flex]} style={styles.flex}>
          <View style={[styles.flex, styles.grow]}>
            <View style={styles.pickerContainer}>
              <BlueWalletSelect wallets={wallets} value={wallet?.getID()} onChange={onWalletChange} />
            </View>
            {isSpark ? (
              <View style={styles.methodSwitch} testID="SparkReceiveMethodSwitch">
                <View style={[styles.methodSwitchTrack, styleHooks.methodSwitchTrack]}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityState={{ selected: receiveMethod === 'lightning' }}
                    testID="SparkReceiveLightning"
                    onPress={() => {
                      if (receiveMethod === 'lightning') return;
                      setReceiveMethod('lightning');
                      if (amountSats > 0) {
                        generateInvoice();
                      }
                    }}
                    style={[styles.methodSwitchTab, receiveMethod === 'lightning' && styleHooks.methodSwitchTabActive]}
                  >
                    <Text
                      style={[
                        styles.methodSwitchText,
                        receiveMethod === 'lightning' && styles.methodSwitchTextActive,
                        styleHooks.methodSwitchText,
                      ]}
                    >
                      {loc.wallets.lightning_spark_receive_lightning}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityState={{ selected: receiveMethod === 'onchain' }}
                    testID="SparkReceiveOnchain"
                    onPress={() => {
                      if (!(typeof wallet?.depositAddress === 'string' && wallet.depositAddress)) {
                        setIsOnchainLoading(true);
                      }
                      setReceiveMethod('onchain');
                    }}
                    style={[styles.methodSwitchTab, receiveMethod === 'onchain' && styleHooks.methodSwitchTabActive]}
                  >
                    <Text
                      style={[
                        styles.methodSwitchText,
                        receiveMethod === 'onchain' && styles.methodSwitchTextActive,
                        styleHooks.methodSwitchText,
                      ]}
                    >
                      {loc.wallets.lightning_spark_receive_onchain}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
            <View style={styles.contentContainer}>
              <View style={[styles.scrollBody, styles.flex]}>
                {isQrLoading ? (
                  <ActivityIndicator />
                ) : qrValue ? (
                  <>
                    <QRCodeComponent value={qrValue} />
                    <View style={styles.shareContainer}>
                      <BlueCopyTextToClipboard
                        text={copyText || ''}
                        truncated={Boolean(invoiceRequest) && !isOnchainReceive}
                        textStyle={styles.copyText}
                      />
                      <TouchableOpacity accessibilityRole="button" onPress={handleShareButtonPressed}>
                        <Image resizeMode="stretch" source={require('../../img/share-icon.png')} style={styles.shareIcon} />
                      </TouchableOpacity>
                    </View>
                    {isOnchainReceive && displayedOnchainAddress ? (
                      <Text style={[styles.onchainHint, styleHooks.onchainHint]}>{loc.wallets.lightning_spark_onchain_confirmations}</Text>
                    ) : null}
                  </>
                ) : (
                  <Text style={[styles.missingAddress, styleHooks.missingAddress]}>{loc.wallets.lightning_spark_address_unavailable}</Text>
                )}
              </View>
              <View style={styles.share}>
                {isOnchainReceive ? null : (
                  <>
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
                  </>
                )}
                {invoiceRequest && wallet.type === LightningLdsWallet.type ? (
                  <View>
                    {Platform.select({
                      ios: (
                        <View style={styles.iosNfcButtonContainer}>
                          <SecondButton
                            onPress={startNfcOnIos}
                            disabled={!invoiceRequest}
                            title="Use Boltcard"
                            image={{ source: require('../../img/bolt-card.png') }}
                          />
                        </View>
                      ),
                      android: (
                        <View style={styles.buttonsContainer}>
                          <Image source={require('../../img/bolt-card.png')} style={styles.boltCardIcon} />
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
  shareIcon: {
    width: 18,
    height: 20,
  },
  boltCardIcon: {
    width: 40,
    height: 40,
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
  pickerContainer: { marginHorizontal: 16 },
  methodSwitch: {
    marginHorizontal: 16,
    marginTop: 8,
    alignItems: 'center',
  },
  methodSwitchTrack: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 8,
  },
  methodSwitchTab: {
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  methodSwitchText: {
    fontWeight: 'normal',
  },
  methodSwitchTextActive: {
    fontWeight: 'bold',
  },
  onchainHint: {
    textAlign: 'center',
    paddingHorizontal: 24,
    marginTop: 8,
    fontSize: 14,
  },
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
  missingAddress: {
    textAlign: 'center',
    paddingHorizontal: 24,
    marginVertical: 16,
    fontSize: 16,
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
