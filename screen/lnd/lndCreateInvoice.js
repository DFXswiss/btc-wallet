import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  StatusBar,
  StyleSheet,
  TextInput,
  Platform,
  TouchableWithoutFeedback,
  View,
  ScrollView,
} from 'react-native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import { useFocusEffect, useNavigation, useRoute, useTheme } from '@react-navigation/native';
import Share from 'react-native-share';
import {
  BlueAlertWalletExportReminder,
  BlueButton,
  BlueDismissKeyboardInputAccessory,
  BlueLoading,
  BlueWalletSelect,
  BlueCard,
  BlueButtonLink,
  BlueCopyTextToClipboard,
  BlueSpacing20,
} from '../../BlueComponents';
import QRCodeComponent from '../../components/QRCodeComponent';
import navigationStyle from '../../components/navigationStyle';
import AmountInput from '../../components/AmountInput';
import BottomModal from '../../components/BottomModal';
import * as NavigationService from '../../NavigationService';
import { BitcoinUnit, Chain } from '../../models/bitcoinUnits';
import loc, { formatBalance, formatBalancePlain } from '../../loc';
import Lnurl from '../../class/lnurl';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import Notifications from '../../blue_modules/notifications';
import alert from '../../components/Alert';
import { parse } from 'url'; // eslint-disable-line n/no-deprecated-api
const currency = require('../../blue_modules/currency');
const torrific = require('../../blue_modules/torrific');

const LNDCreateInvoice = () => {
  const { wallets, saveToDisk, setSelectedWallet, isTorDisabled } = useContext(BlueStorageContext);
  const { walletID, uri } = useRoute().params;
  const wallet = useRef(wallets.find(item => item.getID() === walletID) || wallets.find(item => item.chain === Chain.OFFCHAIN));
  const { colors } = useTheme();
  const { navigate, dangerouslyGetParent, goBack, setParams, replace } = useNavigation();
  const [unit, setUnit] = useState(wallet.current?.getPreferredBalanceUnit() || BitcoinUnit.BTC);
  const [amount, setAmount] = useState();
  const [isLoading, setIsLoading] = useState(true);
  const [description, setDescription] = useState('');
  const [lnurlParams, setLnurlParams] = useState();
  const [isCustomModalVisible, setIsCustomModalVisible] = useState(false);

  const styleHooks = StyleSheet.create({
    modalContent: {
      backgroundColor: colors.modal,
      borderTopColor: colors.foregroundColor,
      borderWidth: colors.borderWidth,
    },
    modalButton: {
      backgroundColor: colors.modalButton,
    },
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

  const renderReceiveDetails = async () => {
    try {
      wallet.current.setUserHasSavedExport(true);
      await saveToDisk();
      if (uri) {
        await processLnurl(uri);
      }
    } catch (e) {
      console.log(e);
    }
    setIsLoading(false);
  };

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

  useFocusEffect(
    useCallback(() => {
      if (wallet.current) {
        setSelectedWallet(walletID);
        if (wallet.current.getUserHasSavedExport()) {
          renderReceiveDetails();
        } else {
          BlueAlertWalletExportReminder({
            onSuccess: () => renderReceiveDetails(),
            onFailure: () => {
              dangerouslyGetParent().pop();
              NavigationService.navigate('WalletExportRoot', {
                screen: 'WalletExport',
                params: {
                  walletID,
                },
              });
            },
          });
        }
      } else {
        ReactNativeHapticFeedback.trigger('notificationError', { ignoreAndroidSystemSettings: false });
        alert(loc.wallets.add_ln_wallet_first);
        goBack();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [wallet]),
  );

  const createInvoice = async (invoiceAmount = amount, invoiceDescription = description, withdrawParams = lnurlParams) => {
    setIsLoading(true);
    try {
      switch (unit) {
        case BitcoinUnit.SATS:
          invoiceAmount = parseInt(invoiceAmount, 10); // basically nop
          break;
        case BitcoinUnit.BTC:
          invoiceAmount = currency.btcToSatoshi(invoiceAmount);
          break;
        case BitcoinUnit.LOCAL_CURRENCY:
          // trying to fetch cached sat equivalent for this fiat amount
          invoiceAmount = AmountInput.getCachedSatoshis(invoiceAmount) || currency.btcToSatoshi(currency.fiatToBTC(invoiceAmount));
          break;
      }

      if (withdrawParams) {
        const { min, max } = withdrawParams;
        if (invoiceAmount < min || invoiceAmount > max) {
          let text;
          if (invoiceAmount < min) {
            text =
              unit === BitcoinUnit.SATS
                ? loc.formatString(loc.receive.minSats, { min })
                : loc.formatString(loc.receive.minSatsFull, { min, currency: formatBalance(min, unit) });
          } else {
            text =
              unit === BitcoinUnit.SATS
                ? loc.formatString(loc.receive.maxSats, { max })
                : loc.formatString(loc.receive.maxSatsFull, { max, currency: formatBalance(max, unit) });
          }
          ReactNativeHapticFeedback.trigger('notificationError', { ignoreAndroidSystemSettings: false });
          alert(text);
          setIsLoading(false);
          return;
        }
      }

      const invoiceRequest = await wallet.current.addInvoice(invoiceAmount, invoiceDescription);
      ReactNativeHapticFeedback.trigger('notificationSuccess', { ignoreAndroidSystemSettings: false });

      // lets decode payreq and subscribe groundcontrol so we can receive push notification when our invoice is paid
      /** @type LightningCustodianWallet */
      const decoded = await wallet.current.decodeInvoice(invoiceRequest);
      await Notifications.tryToObtainPermissions();
      Notifications.majorTomToGroundControl([], [decoded.payment_hash], []);

      // send to lnurl-withdraw callback url if that exists
      if (withdrawParams) {
        const { callback, k1 } = withdrawParams;
        const callbackUrl = callback + (callback.indexOf('?') !== -1 ? '&' : '?') + 'k1=' + k1 + '&pr=' + invoiceRequest;

        let reply;
        if (!isTorDisabled && callbackUrl.includes('.onion')) {
          const api = new torrific.Torsbee();
          const torResponse = await api.get(callbackUrl);
          reply = torResponse.body;
          if (reply && typeof reply === 'string') reply = JSON.parse(reply);
        } else {
          const resp = await fetch(callbackUrl, { method: 'GET' });
          if (resp.status >= 300) {
            const text = await resp.text();
            throw new Error(text);
          }
          reply = await resp.json();
        }

        if (reply.status === 'ERROR') {
          throw new Error('Reply from server: ' + reply.reason);
        }
      }

      setTimeout(async () => {
        // wallet object doesnt have this fresh invoice in its internals, so we refetch it and only then save
        await wallet.current.fetchUserInvoices(1);
        await saveToDisk();
      }, 1000);

      dismissCustomAmountModal();

      navigate('LNDViewInvoice', {
        invoice: invoiceRequest,
        walletID: wallet.current.getID(),
      });
    } catch (Err) {
      ReactNativeHapticFeedback.trigger('notificationError', { ignoreAndroidSystemSettings: false });
      setIsLoading(false);
      alert(Err.message);
    }
  };

  const processLnurl = async data => {
    setIsLoading(true);
    if (!wallet.current) {
      ReactNativeHapticFeedback.trigger('notificationError', { ignoreAndroidSystemSettings: false });
      alert(loc.wallets.no_ln_wallet_error);
      return goBack();
    }

    // decoding the lnurl
    const url = Lnurl.getUrlFromLnurl(data);
    const { query } = parse(url, true);

    if (query.tag === Lnurl.TAG_LOGIN_REQUEST) {
      navigate('LnurlAuth', {
        lnurl: data,
        walletID: walletID ?? wallet.current.getID(),
      });
      return;
    }

    // calling the url
    let reply;
    try {
      if (!isTorDisabled && url.includes('.onion')) {
        const api = new torrific.Torsbee();
        const torResponse = await api.get(url);
        reply = torResponse.body;
        if (reply && typeof reply === 'string') reply = JSON.parse(reply);
      } else {
        const resp = await fetch(url, { method: 'GET' });
        if (resp.status >= 300) {
          throw new Error('Bad response from server');
        }
        reply = await resp.json();
        if (reply.status === 'ERROR') {
          throw new Error('Reply from server: ' + reply.reason);
        }
      }

      if (reply.tag === Lnurl.TAG_PAY_REQUEST) {
        // we are here by mistake. user wants to SEND to lnurl-pay, but he is on a screen that creates
        // invoices (including through lnurl-withdraw)
        navigate('SendDetailsRoot', {
          screen: 'ScanLndInvoice',
          params: {
            uri: data,
            walletID: walletID ?? wallet.current.getID(),
          },
        });
        return;
      }

      if (reply.tag !== Lnurl.TAG_WITHDRAW_REQUEST) {
        throw new Error('Unsupported lnurl');
      }

      // amount that comes from lnurl is always in sats
      let newAmount = (reply.maxWithdrawable / 1000).toString();
      const sats = newAmount;
      switch (unit) {
        case BitcoinUnit.SATS:
          // nop
          break;
        case BitcoinUnit.BTC:
          newAmount = currency.satoshiToBTC(newAmount);
          break;
        case BitcoinUnit.LOCAL_CURRENCY:
          newAmount = formatBalancePlain(newAmount, BitcoinUnit.LOCAL_CURRENCY);
          AmountInput.setCachedSatoshis(newAmount, sats);
          break;
      }

      // setting the invoice creating screen with the parameters
      const withdrawParams = {
        k1: reply.k1,
        callback: reply.callback,
        fixed: reply.minWithdrawable === reply.maxWithdrawable,
        min: (reply.minWithdrawable || 0) / 1000,
        max: reply.maxWithdrawable / 1000,
      };

      setLnurlParams(withdrawParams);
      setAmount(newAmount);
      setDescription(reply.defaultDescription);

      await createInvoice(newAmount, reply.defaultDescription, withdrawParams);
      setIsLoading(false);
    } catch (Err) {
      Keyboard.dismiss();
      setIsLoading(false);
      ReactNativeHapticFeedback.trigger('notificationError', { ignoreAndroidSystemSettings: false });
      alert(Err.message);
    }
  };
  const dismissCustomAmountModal = () => {
    Keyboard.dismiss();
    setIsCustomModalVisible(false);
  };

  const showCustomAmountModal = () => {
    setIsCustomModalVisible(true);
  };

  const renderCustomAmountModal = () => {
    return (
      <BottomModal isVisible={isCustomModalVisible} onClose={dismissCustomAmountModal}>
        <KeyboardAvoidingView enabled={!Platform.isPad} behavior={Platform.OS === 'ios' ? 'position' : null}>
          <View style={[styles.modalContent, styleHooks.modalContent]}>
            <AmountInput
              isLoading={isLoading}
              amount={amount}
              onAmountUnitChange={setUnit}
              onChangeText={setAmount}
              disabled={isLoading || (lnurlParams && lnurlParams.fixed)}
              unit={unit}
              inputAccessoryViewID={BlueDismissKeyboardInputAccessory.InputAccessoryViewID}
            />
            <View style={[styles.customAmount, styleHooks.customAmount]}>
              <TextInput
                onChangeText={setDescription}
                placeholder={loc.receive.details_label}
                value={description}
                numberOfLines={1}
                placeholderTextColor="#81868e"
                style={[styles.customAmountText, styleHooks.customAmountText]}
                editable={!isLoading}
                onSubmitEditing={Keyboard.dismiss}
                inputAccessoryViewID={BlueDismissKeyboardInputAccessory.InputAccessoryViewID}
              />
            </View>
            <BlueSpacing20 />
            <View>
              <BlueButton
                testID="CustomAmountSaveButton"
                style={[styles.modalButton, styleHooks.modalButton]}
                title={loc.receive.details_create}
                onPress={() => createInvoice()}
              />
              <BlueSpacing20 />
            </View>
            <BlueSpacing20 />
          </View>
        </KeyboardAvoidingView>
      </BottomModal>
    );
  };

  const onWalletChange = id => {
    const newWallet = wallets.find(w => w.getID() === id);
    if (!newWallet) return;

    if (newWallet.chain !== Chain.OFFCHAIN) {
      return replace('ReceiveDetails', { walletID: id });
    }

    setParams({ walletID: id });
  };

  if (!wallet.current || isLoading) {
    return (
      <View style={[styles.root, styleHooks.root]}>
        <StatusBar barStyle="light-content" />
        <BlueLoading />
      </View>
    );
  }

  const handleShareButtonPressed = () => {
    Share.open({ message: wallet.current.lnAddress }).catch(error => console.log(error));
  };

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={[styles.root, styleHooks.root]}>
        <StatusBar barStyle="light-content" />

        <View style={styles.pickerContainer}>
          <BlueWalletSelect wallets={wallets} value={wallet.current?.getID()} onChange={onWalletChange} />
        </View>

        {wallet.current ? (
          <ScrollView contentContainerStyle={styles.root} keyboardShouldPersistTaps="always">
            <View style={styles.scrollBody}>
              <QRCodeComponent value={wallet.current.lnAddress} />
              <BlueCopyTextToClipboard text={wallet.current.lnAddress} />
            </View>
            <View style={styles.share}>
              <BlueCard>
                <BlueButtonLink
                  style={styles.link}
                  testID="SetCustomAmountButton"
                  title={loc.receive.details_setAmount}
                  onPress={showCustomAmountModal}
                />
                <BlueButton onPress={handleShareButtonPressed} title={loc.receive.details_share} />
              </BlueCard>
            </View>
            {renderCustomAmountModal()}
          </ScrollView>
        ) : (
          <BlueLoading />
        )}
      </View>
    </TouchableWithoutFeedback>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'space-between',
  },
  scrollBody: {
    marginTop: 32,
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
  link: {
    marginVertical: 16,
    paddingHorizontal: 32,
  },
  modalContent: {
    padding: 22,
    justifyContent: 'center',
    alignItems: 'center',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    minHeight: 350,
    height: 350,
  },
  modalButton: {
    paddingVertical: 14,
    paddingHorizontal: 70,
    maxWidth: '80%',
    borderRadius: 50,
    fontWeight: '700',
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
});

export default LNDCreateInvoice;
LNDCreateInvoice.routeName = 'LNDCreateInvoice';
LNDCreateInvoice.navigationOptions = navigationStyle(
  {
    closeButton: true,
    headerHideBackButton: true,
  },
  opts => ({ ...opts, title: loc.receive.header }),
);
