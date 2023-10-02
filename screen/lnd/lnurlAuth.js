import React, { useState, useContext, useCallback, useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { BlueButton, BlueCard, BlueLoading, BlueSpacing20, BlueSpacing40, BlueText, SafeBlueArea } from '../../BlueComponents';
import navigationStyle from '../../components/navigationStyle';
import Lnurl from '../../class/lnurl';
import loc from '../../loc';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import { useRoute, useTheme } from '@react-navigation/native';
import URL from 'url';
import { SuccessView } from '../send/success';

const AuthState = {
  USER_PROMPT: 0,
  IN_PROGRESS: 1,
  SUCCESS: 2,
  ERROR: 3,
};

const LnurlAuth = () => {
  const { wallets } = useContext(BlueStorageContext);
  const { walletID, lnurl } = useRoute().params;
  const wallet = useMemo(() => wallets.find(w => w.getID() === walletID), [wallets, walletID]);
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

  const authenticate = useCallback(() => {
    const address = Lnurl.getLnurlFromAddress(wallet.lnAddress);
    const signature = wallet.addressOwnershipProof;
    const additionalParams =
      parsedLnurl.hostname?.endsWith('dfx.swiss') && address && signature ? { address: address.toUpperCase(), signature } : undefined;

    wallet
      .authenticate(LN, additionalParams)
      .then(() => {
        setAuthState(AuthState.SUCCESS);
        setErrMsg('');
      })
      .catch(err => {
        setAuthState(AuthState.ERROR);
        setErrMsg(err);
      });
  }, [wallet, parsedLnurl.hostname, LN]);

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
  closeButtonFunc: ({ navigation }) => navigation.dangerouslyGetParent().popToTop(),
});
