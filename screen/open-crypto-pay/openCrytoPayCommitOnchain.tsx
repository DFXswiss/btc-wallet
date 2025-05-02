import React, { useContext, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, TouchableOpacity, StyleSheet, Switch, View } from 'react-native';
import { Text } from 'react-native-elements';

import ReactNativeHapticFeedback from 'react-native-haptic-feedback';

import { BlueButton, BlueText, SafeBlueArea, BlueCard } from '../../BlueComponents';
import navigationStyle from '../../components/navigationStyle';
import { BitcoinUnit } from '../../models/bitcoinUnits';
import Biometric from '../../class/biometrics';
import loc, { formatBalance, formatBalanceWithoutSuffix } from '../../loc';
import Notifications from '../../blue_modules/notifications';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import { useNavigation, useRoute, useTheme } from '@react-navigation/native';
import alert from '../../components/Alert';
import { OpenCryptoPayPaymentLink } from '../../class/open-crypto-pay';
const currency = require('../../blue_modules/currency');
const Bignumber = require('bignumber.js');
const bitcoin = require('bitcoinjs-lib');

const OpenCrytoPayCommitOnchain = () => {
  const { wallets } = useContext(BlueStorageContext);
  const [isBiometricUseCapableAndEnabled, setIsBiometricUseCapableAndEnabled] = useState(false);
  const { params } = useRoute();
  const { recipients = [], walletID, fee, memo, tx, satoshiPerByte, paymentLinkDetails } = params;
  const [isLoading, setIsLoading] = useState(false);
  const [isServerError, setIsServerError] = useState(false);
  const wallet = wallets.find(w => w.getID() === walletID);
  const feeSatoshi = new Bignumber(fee).multipliedBy(100000000).toNumber();
  const { navigate, setOptions, replace } = useNavigation();
  const { colors } = useTheme();

  const stylesHook = StyleSheet.create({
    transactionDetailsTitle: {
      color: colors.foregroundColor,
    },
    transactionDetailsSubtitle: {
      color: colors.feeText,
    },
    transactionAmountFiat: {
      color: colors.feeText,
    },
    txDetails: {
      backgroundColor: colors.lightButton,
    },
    valueValue: {
      color: colors.alternativeTextColor2,
    },
    valueUnit: {
      color: colors.buttonTextColor,
    },
    root: {
      backgroundColor: colors.elevated,
    },
    payjoinWrapper: {
      backgroundColor: colors.buttonDisabledBackgroundColor,
    },
  });

  useEffect(() => {
    console.log('openCrytoPayCommitOnchain - useEffect');
    console.log('address = ', recipients);
    Biometric.isBiometricUseCapableAndEnabled().then(setIsBiometricUseCapableAndEnabled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setOptions({
      // eslint-disable-next-line react/no-unstable-nested-components
      headerRight: () => (
        <TouchableOpacity
          accessibilityRole="button"
          testID="TransactionDetailsButton"
          style={[styles.txDetails, stylesHook.txDetails]}
          onPress={async () => {
            if (isBiometricUseCapableAndEnabled) {
              if (!(await Biometric.unlockWithBiometrics())) {
                return;
              }
            }

            navigate('CreateTransaction', {
              fee,
              recipients,
              memo,
              tx,
              satoshiPerByte,
              wallet,
              feeSatoshi,
            });
          }}
        >
          <Text style={[styles.txText, stylesHook.valueUnit]}>{loc.send.create_details}</Text>
        </TouchableOpacity>
      ),
      headerLeft: () => null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colors, fee, feeSatoshi, isBiometricUseCapableAndEnabled, memo, recipients, satoshiPerByte, tx, wallet]);

  const send = async () => {
    setIsLoading(true);
    try {
      if(!paymentLinkDetails) {
        return;
      }

      const paymentLink = OpenCryptoPayPaymentLink.getInstanceFromResponse(paymentLinkDetails);
      const _tx = bitcoin.Transaction.fromHex(tx);
      const result = await paymentLink.commitOnchainPayment(_tx);

      if(result.error) {
        console.error('error', result);
        throw new Error(`${result.error} - ${result.message} - ${result.statusCode}`);
      }

      const amount = recipients.reduce((acc, recipient) => acc + recipient.value, 0);
      const amountFormatted = formatBalanceWithoutSuffix(amount, BitcoinUnit.BTC, false);

      ReactNativeHapticFeedback.trigger('notificationSuccess', { ignoreAndroidSystemSettings: false });
      navigate('Success', {
        fee: Number(feeSatoshi),
        amount: Number(amountFormatted),
      });
    } catch (error) {
      console.error('error', error);
      setIsServerError(true);
    } finally {
      setIsLoading(false);
    }
  };

  const _renderItem = ({ index, item }) => {
    return (
      <>
        <View style={styles.valueWrap}>
          <Text testID="TransactionValue" style={[styles.valueValue, stylesHook.valueValue]}>
            {currency.satoshiToBTC(item.value)}
          </Text>
          <Text style={[styles.valueUnit, stylesHook.valueValue]}>{' ' + loc.units[BitcoinUnit.BTC]}</Text>
        </View>
        <Text style={[styles.transactionAmountFiat, stylesHook.transactionAmountFiat]}>{currency.satoshiToLocalCurrency(item.value)}</Text>
        <BlueCard>
          <Text style={[styles.transactionDetailsTitle, stylesHook.transactionDetailsTitle]}>{loc.send.create_to}</Text>
          <Text testID="TransactionAddress" style={[styles.transactionDetailsSubtitle, stylesHook.transactionDetailsSubtitle]}>
            {item.address}
          </Text>
          {memo && (
            <>
              <Text style={[styles.transactionMemo, stylesHook.transactionDetailsTitle]}>{loc.send.create_memo}</Text>
              <Text testID="TransactionMemo" style={[styles.transactionDetailsSubtitle, stylesHook.transactionDetailsSubtitle]}>
                {memo}
              </Text>
            </>
          )}
        </BlueCard>
        {recipients.length > 1 && (
          <BlueText style={styles.valueOf}>{loc.formatString(loc._.of, { number: index + 1, total: recipients.length })}</BlueText>
        )}
      </>
    );
  };

  const renderSeparator = () => {
    return <View style={styles.separator} />;
  };

  const navigateToScanQrCode = () => {
    return replace('ScanCodeSendRoot', { screen: 'ScanCodeSend' });
  };

  return (
    <SafeBlueArea style={[styles.root, stylesHook.root]}>
      <View style={styles.cardTop}>
        <FlatList
          scrollEnabled={recipients.length > 1}
          extraData={recipients}
          data={recipients}
          renderItem={_renderItem}
          keyExtractor={(_item, index) => `${index}`}
          ItemSeparatorComponent={renderSeparator}
        />
      </View>
      <View style={styles.cardBottom}>
        <BlueCard>
          {isServerError ? <BlueText style={styles.serverError}>{loc.send.server_error}</BlueText> :
          <Text style={styles.cardText} testID="TransactionFee">
            {loc.send.create_fee}: {formatBalance(feeSatoshi, BitcoinUnit.BTC)} ({currency.satoshiToLocalCurrency(feeSatoshi)})
          </Text>
          }
          {isLoading ? <ActivityIndicator /> : <BlueButton disabled={isLoading} onPress={isServerError ? navigateToScanQrCode : send} title={isServerError ? loc.send.scan_qr_code : loc.send.confirm_sendNow} />}
        </BlueCard>
      </View>
    </SafeBlueArea>
  );
};

export default OpenCrytoPayCommitOnchain;

const styles = StyleSheet.create({
  transactionDetailsTitle: {
    fontWeight: '500',
    fontSize: 17,
    marginBottom: 2,
  },
  transactionDetailsSubtitle: {
    fontWeight: '500',
    fontSize: 15,
    marginBottom: 20,
  },
  transactionMemo: {
    fontWeight: '500',
    fontSize: 15,
    marginTop: 10,
  },
  transactionAmountFiat: {
    fontWeight: '500',
    fontSize: 15,
    marginVertical: 8,
    textAlign: 'center',
  },
  valueWrap: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  valueValue: {
    fontSize: 36,
    fontWeight: '700',
  },
  valueUnit: {
    fontSize: 16,
    marginHorizontal: 4,
    paddingBottom: 6,
    fontWeight: '600',
    alignSelf: 'flex-end',
  },
  valueOf: {
    alignSelf: 'flex-end',
    marginRight: 18,
    marginVertical: 8,
  },
  separator: {
    height: 0.5,
    margin: 16,
  },
  root: {
    paddingTop: 19,
    justifyContent: 'space-between',
  },
  cardTop: {
    flexGrow: 8,
    marginTop: 16,
    alignItems: 'center',
    maxHeight: '70%',
  },
  cardBottom: {
    flexGrow: 2,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  cardContainer: {
    flexGrow: 1,
    width: '100%',
  },
  cardText: {
    flexDirection: 'row',
    color: '#37c0a1',
    fontSize: 14,
    marginVertical: 8,
    marginHorizontal: 24,
    paddingBottom: 6,
    fontWeight: '500',
    alignSelf: 'center',
  },
  txDetails: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 80,
    borderRadius: 8,
    height: 38,
  },
  txText: {
    fontSize: 15,
    fontWeight: '600',
  },
  payjoinWrapper: {
    flexDirection: 'row',
    padding: 8,
    borderRadius: 6,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  payjoinText: {
    color: '#81868e',
    fontSize: 15,
    fontWeight: 'bold',
  },
  serverError: {
    alignSelf: 'center',
    marginBottom: 8,
    color: 'red',
    fontSize: 14,
  },
});

OpenCrytoPayCommitOnchain.navigationOptions = navigationStyle({}, opts => ({ ...opts, title: loc.send.confirm_header }));
