import React, { useState, useContext, useCallback, useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import { BlueButton, BlueCard, BlueLoading, BlueSpacing20, BlueSpacing40, BlueText, SafeBlueArea } from '../../BlueComponents';
import navigationStyle from '../../components/navigationStyle';
import Lnurl from '../../class/lnurl';
import loc from '../../loc';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import { useFocusEffect, useNavigation, useRoute, useTheme } from '@react-navigation/native';
import URL from 'url';
import { SuccessView } from '../send/success';
import { getLightningWallet } from '../../helpers/lightning-wallet';
import { SparkWallet } from '../../class/wallets/spark-wallet';
import alert from '../../components/Alert';
import { useSparkContext } from '../../api/spark/contexts/spark.context';
import { useAuth } from '../../api/dfx/hooks/auth.hook';

const AuthState = {
  USER_PROMPT: 0,
  IN_PROGRESS: 1,
  SUCCESS: 2,
  ERROR: 3,
};

const LnurlAuth = () => {
  const { wallets } = useContext(BlueStorageContext);
  const { lnurl } = useRoute().params;
  const { signLnurlAuthK1 } = useSparkContext();
  const { getSignMessage } = useAuth();
  const { goBack } = useNavigation();
  const wallet = useMemo(() => getLightningWallet(wallets), [wallets]);
  const LN = useMemo(() => new Lnurl(lnurl), [lnurl]);
  const parsedLnurl = useMemo(
    () => (lnurl ? URL.parse(Lnurl.getUrlFromLnurl(lnurl), true) : {}), // eslint-disable-line n/no-deprecated-api
    [lnurl],
  );
  const [authState, setAuthState] = useState(AuthState.USER_PROMPT);
  const [errMsg, setErrMsg] = useState('');
  const { colors } = useTheme();
  const stylesHook = StyleSheet.create({
    root: {
      backgroundColor: colors.background,
    },
  });

  useFocusEffect(
    useCallback(() => {
      if (!wallet) {
        ReactNativeHapticFeedback.trigger('notificationError', { ignoreAndroidSystemSettings: false });
        goBack();
        setTimeout(() => alert(loc.wallets.add_ln_wallet_first), 500);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [wallet]),
  );

  const isDfxLogin = parsedLnurl.hostname === 'dfx.swiss' || Boolean(parsedLnurl.hostname?.endsWith('.dfx.swiss'));

  const onAuthResult = promise =>
    promise
      .then(() => {
        setAuthState(AuthState.SUCCESS);
        setErrMsg('');
      })
      .catch(err => {
        setAuthState(AuthState.ERROR);
        const errorString = `${err}`;
        setErrMsg(err instanceof Error ? (err.message ?? errorString) : errorString);
      });

  const authenticate = useCallback(() => {
    // DFX login for a Spark wallet: the identity key signs k1, and the Spark address with its DFX signature
    // is the account, the same pair the in-app DFX sign-in uses.
    if (wallet.type === SparkWallet.type && isDfxLogin) {
      onAuthResult(
        (async () => {
          const address = await wallet.getSparkAddress();
          if (!address) throw new Error(loc.wallets.lightning_spark_address_unavailable);
          const signature = await wallet.signCompactMessage(getSignMessage(address));
          await LN.authenticateSigned(signLnurlAuthK1, { address, signature, wallet: 'DFX Bitcoin' });
        })(),
      );
      return;
    }
    if (typeof wallet.authenticate !== 'function') {
      setAuthState(AuthState.ERROR);
      setErrMsg(loc.wallets.lightning_spark_lnurl_auth_unsupported);
      return;
    }

    const address = Lnurl.getLnurlFromAddress(wallet.lnAddress);
    const signature = wallet.addressOwnershipProof;
    const additionalParams =
      isDfxLogin && address && signature ? { address: address.toUpperCase(), signature, wallet: 'DFX Bitcoin' } : undefined;

    onAuthResult(wallet.authenticate(LN, additionalParams));
    // onAuthResult only sets state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, isDfxLogin, LN, signLnurlAuthK1, getSignMessage]);

  if (!parsedLnurl || !wallet || authState === AuthState.IN_PROGRESS)
    return (
      <View style={[styles.root, stylesHook.root]}>
        <BlueLoading />
      </View>
    );

  return (
    <SafeBlueArea style={styles.root}>
      {authState === AuthState.USER_PROMPT && (
        <>
          <ScrollView>
            <BlueCard>
              <BlueText style={styles.alignSelfCenter}>{loc.lnurl_auth[`${parsedLnurl.query.action || 'auth'}_question_part_1`]}</BlueText>
              <BlueText style={styles.domainName}>{parsedLnurl.hostname}</BlueText>
              <BlueText style={styles.alignSelfCenter}>{loc.lnurl_auth[`${parsedLnurl.query.action || 'auth'}_question_part_2`]}</BlueText>
              <BlueSpacing40 />
              <BlueButton title={loc.lnurl_auth.authenticate} onPress={authenticate} />
              <BlueSpacing40 />
            </BlueCard>
          </ScrollView>
        </>
      )}

      {authState === AuthState.SUCCESS && (
        <>
          <SuccessView />
          <BlueSpacing20 />
          <BlueText style={styles.alignSelfCenter}>
            {loc.formatString(loc.lnurl_auth[`${parsedLnurl.query.action || 'auth'}_answer`], { hostname: parsedLnurl.hostname })}
          </BlueText>
          <BlueSpacing20 />
        </>
      )}

      {authState === AuthState.ERROR && (
        <BlueCard>
          <BlueSpacing20 />
          <BlueText style={styles.alignSelfCenter}>
            {loc.formatString(loc.lnurl_auth.could_not_auth, { hostname: parsedLnurl.hostname })}
          </BlueText>
          <BlueText style={styles.alignSelfCenter}>{errMsg}</BlueText>
          <BlueSpacing20 />
        </BlueCard>
      )}
    </SafeBlueArea>
  );
};

export default LnurlAuth;

const styles = StyleSheet.create({
  alignSelfCenter: {
    alignSelf: 'center',
  },
  domainName: {
    alignSelf: 'center',
    fontWeight: 'bold',
    fontSize: 25,
    paddingVertical: 10,
  },
  root: {
    flex: 1,
    justifyContent: 'center',
  },
});

LnurlAuth.navigationOptions = navigationStyle({
  title: '',
  closeButton: true,
  closeButtonFunc: ({ navigation }) => navigation.getParent().popToTop(),
});
