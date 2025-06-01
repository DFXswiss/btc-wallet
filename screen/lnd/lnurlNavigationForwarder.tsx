import React, { useContext, useEffect, useState } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { BlueLoading } from '../../BlueComponents';
import navigationStyle from '../../components/navigationStyle';
import loc from '../../loc';
import { useNavigation, useRoute, RouteProp, NavigationProp } from '@react-navigation/native';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import { OpenCryptoPayPaymentLink } from '../../class/open-crypto-pay';
import { BitcoinUnit, Chain } from '../../models/bitcoinUnits';
import { useWalletContext } from '../../contexts/wallet.context';
import Lnurl from '../../class/lnurl';
import { parse } from 'url';
import { AbstractWallet, HDSegwitBech32Wallet } from '../../class';
import BigNumber from 'bignumber.js';
import { AbstractHDElectrumWallet } from '../../class/wallets/abstract-hd-electrum-wallet';

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
  const [isOnchainPayment, setIsOnchainPayment] = useState(false);

  const getSuitableLightningWallet = (paymentLink: OpenCryptoPayPaymentLink) => {
    const lnDetails = paymentLink.getLightningPaymentRequestDetails();
    const amountLn = lnDetails?.amountSat;
    const lnWallet = wallets.find((w: any) => w.chain === Chain.OFFCHAIN);
    return lnWallet && Number(amountLn) < Number(lnWallet.getBalance()) ? lnWallet : null;
  };

  const isMainWalletSuitable = (paymentLink: OpenCryptoPayPaymentLink) => {
    const onchainDetails = paymentLink.getOnChainPaymentRequestDetails();
    const amountOnchain = onchainDetails?.amountSats;
    return onchainDetails && Number(amountOnchain) < Number(mainWallet?.getBalance()) ? mainWallet : null;
  };

  const getOnChainPaymentNavigation = async (paymentLink: OpenCryptoPayPaymentLink) => {
    if (!paymentLink.isOnChainPaymentRequestAvailable() || !mainWallet) {
      throw new Error('Onchain payment request not available');
    }

    const { amountSats, minFee } = paymentLink.getOnChainPaymentRequestDetails() as { amountSats: number; minFee: number };
    const { address, options } = await paymentLink.getOnchainRecipientDetails();
    if (!address) {
      throw new Error('Failed to get onchain recipient details');
    }

    const changeAddress =
      mainWallet instanceof AbstractHDElectrumWallet
        ? mainWallet._getInternalAddressByIndex(mainWallet.getNextFreeChangeAddressIndex())
        : mainWallet.getAddress();

    if (!changeAddress) {
      throw new Error('Failed to get change address');
    }

    const utxos = await mainWallet.getUtxo();

    const feeRate = Math.ceil(Number(minFee));
    const targets = [{ value: parseInt(amountSats.toString(), 10), address }];

    const { tx, outputs, fee } = mainWallet.createTransaction(
      utxos,
      targets,
      feeRate,
      changeAddress,
      HDSegwitBech32Wallet.finalRBFSequence,
    );

    if (!tx) {
      throw new Error('Failed to create transaction');
    }

    const nonChangeOutputs = outputs.filter(({ address }: any) => address !== changeAddress);
    const recipients = nonChangeOutputs.length > 0 ? nonChangeOutputs : outputs;

    return {
      fee: new BigNumber(fee).dividedBy(100000000).toNumber(),
      memo: options?.label,
      walletID: mainWallet.getID(),
      tx: tx.toHex(),
      recipients,
      satoshiPerByte: feeRate,
    };
  };

  const getLightningPaymentNavigation = async (wallet: AbstractWallet, paymentLink: OpenCryptoPayPaymentLink) => {
    const { amountSat, description } = paymentLink.getLightningPaymentRequestDetails();
    const { invoice } = await paymentLink.getLightningRecipientDetails();

    return {
        invoice,
        amountSat,
        amountUnit: BitcoinUnit.SATS,
        description,
        walletID: wallet.getID(),
      }; 
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
          throw new Error('Unsupported lnurl');
        }

        const suitableLightningWallet = getSuitableLightningWallet(paymentLink);
        if (suitableLightningWallet) {
          const navigationParams = await getLightningPaymentNavigation(suitableLightningWallet, paymentLink);
          return navigation.replace('SendDetailsRoot', {
            screen: 'LnurlPay',
            params: navigationParams,
          });
        }

        if (isMainWalletSuitable(paymentLink)) {
          setIsOnchainPayment(true);
          await mainWallet?.fetchUtxo();
          const navigationParams = await getOnChainPaymentNavigation(paymentLink);
          return navigation.replace('SendDetailsRoot', {
            screen: 'OpenCryptoPayCommitOnchain',
            params: {
              ...navigationParams,
              paymentLinkDetails: reply,
            },
          });
        }

        throw new Error('Unsupported lnurl');
      }

      if (reply.tag === Lnurl.TAG_PAY_REQUEST) {
        return navigation.replace('ScanLndInvoice', {
          uri: lnurl,
          walletID: isOffchain ? params?.walletID : undefined,
        });
      }

      if (reply.tag === Lnurl.TAG_WITHDRAW_REQUEST) {
        // TODO: create a new screen for this
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
      <Text style={styles.text}>{isOnchainPayment ? loc.lnd.lnurl_loader_text_onchain : loc.lnd.lnurl_loader_text}</Text>
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
