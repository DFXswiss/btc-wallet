import React, { useContext, useEffect, useMemo, useState } from 'react';
import { RouteProp, useNavigation, useRoute, useTheme } from '@react-navigation/native';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BlueButton, SafeBlueArea } from '../../BlueComponents';
import { navigationStyleTx } from '../../components/navigationStyle';
import loc from '../../loc';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import { AbstractWallet, HDSegwitBech32Wallet, WatchOnlyWallet } from '../../class';
import { AbstractHDElectrumWallet } from '../../class/wallets/abstract-hd-electrum-wallet';
import NetworkTransactionFees from '../../models/networkTransactionFees';
import BigNumber from 'bignumber.js';
import { Chain } from '../../models/bitcoinUnits';
import { useSwap } from '../../api/dfx/hooks/swap.hook';
import { useWalletContext } from '../../contexts/wallet.context';
import { LightningLdsWallet } from '../../class/wallets/lightning-lds-wallet';
import { SwapInfo } from '../../api/dfx/definitions/swap';
const currency = require('../../blue_modules/currency');

type SwapRouteProps = RouteProp<
  {
    params: {
      routeId: string;
      amount: string;
      'wallet-id': string;
    };
  },
  'params'
>;

const Swap = () => {
  const navigation = useNavigation();
  const { wallets, sleep } = useContext(BlueStorageContext);
  const { colors } = useTheme();
  const { routeId, amount, 'wallet-id': walletId } = useRoute<SwapRouteProps>().params;
  const { getInfo } = useSwap();
  const [isLoading, setIsLoading] = useState(false);
  const [swapInfo, setSwapInfo] = useState<SwapInfo>();
  const [changeAddress, setChangeAddress] = useState<string>();

  const { walletID: onchainWalletId } = useWalletContext();
  const lnWallet = useMemo(() => wallets.find((w: AbstractWallet) => w.type === LightningLdsWallet.type), [wallets]);

  const stylesHook = StyleSheet.create({
    container: {
      backgroundColor: colors.elevated,
    },
    text: {
      color: colors.backupText,
    },
    textAmount: {
      color: colors.mainColor,
    },
  });

  useEffect(() => {
    (async () => {
      if (!routeId) return;

      const swapOnchainInfo = await getInfo(onchainWalletId as string, Number(routeId)).catch(() => null);
      const swapLnInfo = lnWallet && (await getInfo(lnWallet?.getID() as string, Number(routeId)).catch(() => null));
      const swap = swapOnchainInfo || swapLnInfo;

      if (swap) {
        setSwapInfo(swap);
        setIsLoading(false);
      } else {
        navigation.goBack();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletId, routeId]);

  async function handleConfirm() {
    const wallet = wallets.find((w: any) => w.getID() === walletId);
    if (!wallet) return;

    if (wallet.chain === Chain.ONCHAIN) {
      const isTransactionReplaceable = wallet.type === HDSegwitBech32Wallet.type;

      const networkTransactionFees = await NetworkTransactionFees.recommendedFees();
      const changeAddress = await getChangeAddressAsync(wallet);
      const requestedSatPerByte = Number(networkTransactionFees.fastestFee);
      const lutxo = wallet.getUtxo();
      const targets = [{ address: swapInfo?.deposit.address, value: currency.btcToSatoshi(amount) }];
      const { tx, outputs, psbt, fee } = wallet.createTransaction(
        lutxo,
        targets,
        requestedSatPerByte,
        changeAddress,
        isTransactionReplaceable ? HDSegwitBech32Wallet.defaultRBFSequence : HDSegwitBech32Wallet.finalRBFSequence,
      );

      let recipients = outputs.filter(({ address }: { address: string }) => address !== changeAddress);

      if (recipients.length === 0) {
        // special case. maybe the only destination in this transaction is our own change address..?
        // (ez can be the case for single-address wallet when doing self-payment for consolidation)
        recipients = outputs;
      }

      navigation.navigate('Confirm', {
        fee: new BigNumber(fee).dividedBy(100000000).toNumber(),
        memo: '',
        walletID: wallet.getID(),
        tx: tx.toHex(),
        recipients,
        satoshiPerByte: requestedSatPerByte,
        payjoinUrl: undefined,
        psbt,
      });
    } else if (wallet.type === LightningLdsWallet.type) {
      navigation.navigate('LnurlPay', {
        lnurl: swapInfo?.deposit.address,
        walletID: wallet.getID(),
        amountSat: currency.btcToSatoshi(amount),
      });
    } else {
      Alert.alert('Unsupported wallet type');
    }
  }

  function handleError(e: any) {
    Alert.alert('Something went wrong', e.message?.toString(), [
      {
        text: loc._.ok,
        onPress: () => {},
        style: 'default',
      },
    ]);
  }

  const getChangeAddressAsync = async (wallet: any) => {
    if (changeAddress) return changeAddress; // cache

    let change;
    if (WatchOnlyWallet.type === wallet.type && !wallet.isHd()) {
      // plain watchonly - just get the address
      change = wallet.getAddress();
    } else {
      // otherwise, lets call widely-used getChangeAddressAsync()
      try {
        change = await Promise.race([sleep(2000), wallet.getChangeAddressAsync()]);
      } catch (_) {}

      if (!change) {
        // either sleep expired or getChangeAddressAsync threw an exception
        if (wallet instanceof AbstractHDElectrumWallet) {
          change = wallet._getInternalAddressByIndex(wallet.getNextFreeChangeAddressIndex());
        } else {
          // legacy wallets
          change = wallet.getAddress();
        }
      }
    }

    if (change) setChangeAddress(change); // cache

    return change;
  };

  return isLoading || !swapInfo ? (
    <View style={[styles.loading, stylesHook.container]}>
      <ActivityIndicator />
    </View>
  ) : (
    <SafeBlueArea style={stylesHook.container}>
      <ScrollView contentContainerStyle={styles.contentContainer}>
        <View style={styles.contentContainer}>
          <View style={styles.info}>
            <Text style={styles.infoHeader}>{loc.swap.spend}</Text>
          </View>
          <View style={styles.infoContainer}>
            <View style={styles.amountContainer}>
              <Text style={[styles.amount, stylesHook.textAmount]}>{amount}</Text>
              <Text style={[styles.asset, stylesHook.textAmount]}>BTC</Text>
            </View>
            <Text style={stylesHook.text}>{loc.formatString(loc.swap.network_spending, { blockchain: swapInfo.blockchain })}</Text>
          </View>
          <View style={styles.infoContainer}>
            <Text style={styles.infoHeader}>{loc.swap.to}</Text>
            <Text style={stylesHook.text}>{swapInfo?.deposit?.address}</Text>
          </View>
          <View style={styles.infoContainer}>
            <Text style={styles.infoHeader}>{loc.swap.receiving}</Text>
            <Text style={stylesHook.text}>
              {loc.formatString(loc.swap.network_receiving, { asset: swapInfo?.asset?.dexName, blockchain: swapInfo?.asset?.blockchain })}
            </Text>
          </View>
          <View style={[styles.infoContainer, styles.growing]}>
            {/* 
            <Icon style={styles.icon} name="information-outline" type="material-community" size={16} color="#FFF" />
            <Text style={stylesHook.text}>{loc.sell.info}</Text>
          */}
          </View>
          <View style={styles.buttonContainer}>
            <View style={styles.button}>
              <BlueButton onPress={() => handleConfirm().catch(handleError)} title={loc.swap.confirm} />
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeBlueArea>
  );
};

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
  },
  scrollableContainer: {
    flexGrow: 1,
    flexShrink: 0,
  },
  contentContainer: {
    flex: 1,
    alignItems: 'center',
    padding: 16,
  },
  amountContainer: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'flex-end',
    width: '100%',
    marginBottom: 6,
  },
  amount: {
    fontWeight: '700',
    fontSize: 35,
    lineHeight: 41.77,
  },
  asset: {
    fontWeight: '600',
    fontSize: 15,
    lineHeight: 17.9,
    marginLeft: 5,
    marginBottom: 5,
  },
  info: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    alignSelf: 'flex-start',
    marginBottom: 15,
  },
  infoContainer: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    alignSelf: 'flex-start',
    marginBottom: 30,
  },
  growing: {
    flexGrow: 1,
    flexDirection: 'row',
  },
  infoHeader: {
    fontWeight: '700',
    fontSize: 16,
    lineHeight: 19,
    color: '#fff',
    marginBottom: 4,
  },
  buttonContainer: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  button: {
    alignContent: 'center',
    minHeight: 44,
    minWidth: 220,
  },
  icon: {
    marginRight: 5,
  },
});

Swap.navigationOptions = navigationStyleTx({}, options => ({
  ...options,
  title: loc.swap.header,
}));

export default Swap;
