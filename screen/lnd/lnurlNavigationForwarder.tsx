import React, { useContext, useEffect } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { BlueLoading } from '../../BlueComponents';
import navigationStyle from '../../components/navigationStyle';
import loc from '../../loc';
import { useNavigation, useRoute, RouteProp, NavigationProp } from '@react-navigation/native';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import { OpenCryptoPayPaymentLink } from '../../class/open-crypto-pay';
import { Chain } from '../../models/bitcoinUnits';
import { useWalletContext } from '../../contexts/wallet.context';
import Lnurl from '../../class/lnurl';
import { parse } from 'url';

type RouteParams = {
  lnurl: string;
  [key: string]: any;
};

const LnurlNavigationForwarder = () => {
  const { wallets } = useContext(BlueStorageContext);
  const { wallet: mainWallet } = useWalletContext();
  const { params } = useRoute<RouteProp<{ params: RouteParams }>>();
  const { lnurl } = params || {};
  const navigation = useNavigation<NavigationProp<any>>();

  const getSuitableWalletId = (plDetails: any) => {
    const paymentLink = OpenCryptoPayPaymentLink.getInstanceFromResponse(plDetails);

    const lnDetails = paymentLink.getLightningPaymentRequestDetails();
    const amountLn = lnDetails?.amountSat;
    const lnWallet = wallets.find((w: any) => w.chain === Chain.OFFCHAIN);
    if (lnWallet && Number(amountLn) < Number(lnWallet.getBalance())) {
      return lnWallet.getID();
    }

    const onchainDetails = paymentLink.getOnChainPaymentRequestDetails();
    const amountOnchain = onchainDetails?.amountSats;
    if (onchainDetails && Number(amountOnchain) < Number(mainWallet?.getBalance())) {
      return mainWallet?.getID();
    }

    return null;
  };

  const getNavigationByLnurl = async (lnurl: string) => {
    const url = Lnurl.getUrlFromLnurl(lnurl);
    if (!url) return;

    const { query } = parse(url, true);

    const isOffchain = wallets.find((w: any) => w.getID() === params?.walletID)?.chain === Chain.OFFCHAIN;
    if (query.tag === Lnurl.TAG_LOGIN_REQUEST) {
      return navigation.navigate('LnurlAuth', {
        lnurl,
        walletID: isOffchain ? params?.walletID : undefined,
      });
    }

    try {
      const reply = await new Lnurl(url).fetchGet(url);

      if (OpenCryptoPayPaymentLink.isOpenCryptoPayResponse(reply)) {
        const paymentLink = OpenCryptoPayPaymentLink.getInstanceFromResponse(reply);
        if (!paymentLink.isPaymentRequestAvailable()) {
          return navigation.goBack();
        }

        const walletId = getSuitableWalletId(reply) || mainWallet?.getID();
        return navigation.replace('OpenCryptoPaySend', {
          plDetails: reply,
          walletID: walletId,
        });
      }
      
      if (reply.tag === Lnurl.TAG_PAY_REQUEST) {
        return navigation.replace('ScanLndInvoice', {
          uri: lnurl,
          walletID: isOffchain ? params?.walletID : undefined,
        });
      }

      if (reply.tag === Lnurl.TAG_WITHDRAW_REQUEST) { // TODO: create a new screen for this
        return navigation.replace('ReceiveDetailsRoot', {
          screen: 'LNDCreateInvoice',
          params: {
            uri: lnurl,
            walletID: isOffchain ? params?.walletID : undefined,
          },
        });
      }

      throw new Error('Unsupported lnurl');
    } catch (error) {
      console.error(error);
      navigation.goBack();
    }
  };

  useEffect(() => {
    getNavigationByLnurl(lnurl);
  }, [lnurl]);

  return (
    <View style={[styles.loadingIndicator]}>
      <BlueLoading style={styles.loading} />
      <Text style={styles.text}>{loc.lnd.lnurl_loader_text}</Text>
    </View>
  );
};

export default LnurlNavigationForwarder;
LnurlNavigationForwarder.navigationOptions = navigationStyle(
  {
    closeButton: true,
    headerBackVisible: false,
  },
  opts => ({ ...opts, title: loc.lnd.lnurl_loader_title }),
);

const styles = StyleSheet.create({
  loadingIndicator: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loading: {
    flex: undefined,
    marginBottom: 10,
  },
  text: {
    textAlign: 'center',
    color: 'white',
  },
});
