import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import LottieView from 'lottie-react-native';
import { View, StyleSheet, SafeAreaView } from 'react-native';
import { Text } from 'react-native-elements';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, useRoute, useTheme } from '@react-navigation/native';

import { BlueButton, BlueCard } from '../../BlueComponents';
import { BitcoinUnit } from '../../models/bitcoinUnits';
import loc from '../../loc';
import TransactionIncomingIcon from '../../components/icons/TransactionIncomingIcon';
import TransactionOutgoingIcon from '../../components/icons/TransactionOutgoingIcon';
import Lnurl from '../../class/lnurl';

const Success = () => {
  const pop = () => {
    dangerouslyGetParent().pop();
  };
  const { colors } = useTheme();
  const { dangerouslyGetParent } = useNavigation();
  const { amount, fee, amountUnit = BitcoinUnit.BTC, invoiceDescription = '', onDonePressed = pop } = useRoute().params;
  const stylesHook = StyleSheet.create({
    root: {
      backgroundColor: colors.elevated,
    },
    amountValue: {
      color: colors.alternativeTextColor2,
    },
    amountUnit: {
      color: colors.alternativeTextColor2,
    },
  });
  useEffect(() => {
    console.log('send/success - useEffect');
  }, []);

  return (
    <SafeAreaView style={[styles.root, stylesHook.root]}>
      <SuccessView
        amount={amount}
        amountUnit={amountUnit}
        fee={fee}
        invoiceDescription={invoiceDescription}
        onDonePressed={onDonePressed}
      />
      <View style={styles.buttonContainer}>
        <BlueButton onPress={onDonePressed} title={loc.send.success_done} />
      </View>
    </SafeAreaView>
  );
};

export default Success;

export const SuccessView = ({ amount, amountUnit, fee = 0, invoiceDescription, shouldAnimate = true, paymentHash, walletID }) => {
  const { navigate } = useNavigation();
  const [animationFinished, setAnimationFinished] = useState(false);
  const [isRepeatable, setIsRepeatable] = useState(false);
  const [description, setDescription] = useState('');
  const [lnurl, setLnurl] = useState();

  const animationRef = useRef();
  const { colors } = useTheme();

  const stylesHook = StyleSheet.create({
    amountValue: {
      color: colors.alternativeTextColor2,
    },
    amountUnit: {
      color: colors.alternativeTextColor2,
    },
  });

  useEffect(() => {
    if (shouldAnimate && animationRef.current) {
      /*
      https://github.com/lottie-react-native/lottie-react-native/issues/832#issuecomment-1008209732
      Temporary workaround until Lottie is fixed.
      */
      setTimeout(() => {
        animationRef.current?.reset();
        animationRef.current?.play();
      }, 100);
      setTimeout(() => setAnimationFinished(true), 2000);
    }
  }, [colors, shouldAnimate]);

  const loadPossibleLNURL = async () => {
    try {
      const LN = new Lnurl(false, AsyncStorage);
      let localPaymentHash = paymentHash;
      if (typeof localPaymentHash === 'object') {
        localPaymentHash = Buffer.from(paymentHash.data).toString('hex');
      }
      const loaded = await LN.loadSuccessfulPayment(localPaymentHash);
      if (loaded) {
        setIsRepeatable(!LN.getDisposable());
        setDescription(LN.getDescription());
        setLnurl(LN.getLnurl());
      }
    } catch (_) {}
  };

  useEffect(() => {
    loadPossibleLNURL();
  }, [paymentHash]);

  return (
    <View style={styles.root}>
      <View>
        {amount && (
          <BlueCard style={styles.amount}>
            <View style={styles.view}>
              <Text style={[styles.amountValue, stylesHook.amountValue]}>{amount}</Text>
              <Text style={[styles.amountUnit, stylesHook.amountUnit]}>{' ' + loc.units[amountUnit]}</Text>
            </View>
            <View style={styles.memo}>
              <Text numberOfLines={0} style={styles.memoText}>
                {description || invoiceDescription}
              </Text>
            </View>
          </BlueCard>
        )}
        <View style={styles.iconsContainer}>
          <View style={styles.ready}>
            <LottieView
              style={styles.lottie}
              source={require('../../img/bluenice.json')}
              autoPlay={shouldAnimate}
              ref={animationRef}
              loop={false}
              progress={shouldAnimate ? 0 : 1}
              colorFilters={[
                {
                  keypath: 'spark',
                  color: colors.success,
                },
                {
                  keypath: 'circle',
                  color: colors.success,
                },
                {
                  keypath: 'Oval',
                  color: colors.successCheck,
                },
              ]}
              resizeMode="center"
            />
          </View>
          {(animationFinished || !shouldAnimate) && (
            <View style={styles.txDirectionIcon}>{amount > 0 ? <TransactionIncomingIcon /> : <TransactionOutgoingIcon />}</View>
          )}
        </View>
        <BlueCard style={styles.amount}>
          {amount < 0 && (
            <View style={styles.view}>
              <Text style={styles.feeText}>
                {loc.send.create_fee.toLowerCase()}: {Math.abs(fee)} {loc.units[BitcoinUnit.SATS]}
              </Text>
            </View>
          )}
        </BlueCard>
      </View>

      {isRepeatable && (
        <BlueCard>
          <BlueButton
            onPress={() => {
              navigate('SendDetailsRoot', {
                screen: 'LnurlPay',
                params: {
                  lnurl,
                  walletID
                },
              });
            }}
            title={loc._.repeat}
            icon={{ name: 'refresh', type: 'font-awesome', color: '#9aa0aa' }}
          />
        </BlueCard>
      )}
    </View>
  );
};

SuccessView.propTypes = {
  amount: PropTypes.number,
  amountUnit: PropTypes.string,
  fee: PropTypes.number,
  invoiceDescription: PropTypes.string,
  shouldAnimate: PropTypes.bool,
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingTop: 19,
    justifyContent: 'space-between',
  },
  buttonContainer: {
    paddingHorizontal: 58,
    paddingBottom: 16,
  },
  amount: {
    alignItems: 'center',
  },
  view: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  amountValue: {
    fontSize: 36,
    fontWeight: '600',
  },
  amountUnit: {
    fontSize: 16,
    marginHorizontal: 4,
    paddingBottom: 6,
    fontWeight: '600',
    alignSelf: 'flex-end',
  },
  feeText: {
    color: '#37c0a1',
    fontSize: 14,
    marginHorizontal: 4,
    paddingVertical: 6,
    fontWeight: '500',
    alignSelf: 'center',
  },
  iconsContainer: {
    alignSelf: 'center',
    marginBottom: 20,
  },
  txDirectionIcon: {
    alignSelf: 'flex-end',
  },
  memo: {
    alignItems: 'center',
    marginVertical: 8,
  },
  memoText: {
    color: '#9aa0aa',
    fontSize: 14,
  },
  ready: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignSelf: 'center',
    alignItems: 'center',
    marginBottom: 13,
  },
  lottie: {
    width: 200,
    height: 200,
  },
});
