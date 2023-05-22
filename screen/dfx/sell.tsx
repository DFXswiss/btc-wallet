import React, { useContext, useEffect, useMemo, useState } from 'react';
import { RouteProp, useNavigation, useRoute, useTheme } from '@react-navigation/native';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BlueButton, SafeBlueArea } from '../../BlueComponents';
import { navigationStyleTx } from '../../components/navigationStyle';
import loc from '../../loc';
import { useSell } from '../../api/hooks/sell.hook';
import { useFiat } from '../../api/hooks/fiat.hook';
import { SellInfo } from '../../api/definitions/sell';
import { Icon } from 'react-native-elements';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import { HDSegwitBech32Wallet, WatchOnlyWallet } from '../../class';
import { AbstractHDElectrumWallet } from '../../class/wallets/abstract-hd-electrum-wallet';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetworkTransactionFees, { NetworkTransactionFee } from '../../models/networkTransactionFees';
import BigNumber from 'bignumber.js';
const currency = require('../../blue_modules/currency');

type SellRouteProps = RouteProp<
  {
    params: {
      routeId: string;
      amount: string;
    };
  },
  'params'
>;

const Sell = () => {
  const navigation = useNavigation();
  const { wallets, sleep } = useContext(BlueStorageContext);
  const { colors } = useTheme();
  const { routeId, amount } = useRoute<SellRouteProps>().params;
  const { getInfo: getSellInfo } = useSell();
  const { toDescription } = useFiat();
  const [isLoading, setIsLoading] = useState(true);
  const [sell, setSell] = useState<SellInfo>();

  const wallet = useMemo(() => wallets?.[0], [wallets]);
  const [changeAddress, setChangeAddress] = useState<string>();
  const [isTransactionReplaceable, setIsTransactionReplaceable] = useState(false);
  const [networkTransactionFees, setNetworkTransactionFees] = useState(new NetworkTransactionFee(3, 2, 1));

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
    setIsTransactionReplaceable(wallet.type === HDSegwitBech32Wallet.type);

    // load cached fees
    AsyncStorage.getItem(NetworkTransactionFee.StorageKey)
      .then(res => {
        if (!res) return;
        const fees = JSON.parse(res);
        if (!fees?.fastestFee) return;
        setNetworkTransactionFees(fees);
      })
      .catch(e => console.log('loading cached recommendedFees error', e));

    // load fresh fees from servers
    NetworkTransactionFees.recommendedFees()
      .then(async fees => {
        if (!fees?.fastestFee) return;
        setNetworkTransactionFees(fees);
        await AsyncStorage.setItem(NetworkTransactionFee.StorageKey, JSON.stringify(fees));
      })
      .catch(e => console.log('loading recommendedFees error', e));
  }, [wallet]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!routeId) {
      return;
    }
    getSellInfo(+routeId)
      .then(setSell)
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [routeId]);

  async function handleConfirm() {
    if (!wallet) return;
    const changeAddress = await getChangeAddressAsync();
    const requestedSatPerByte = Number(networkTransactionFees.fastestFee);
    const lutxo = wallet.getUtxo();
    const targets = [{ address: sell?.deposit.address, value: currency.btcToSatoshi(amount) }];
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
  }

  function handleError(e: any) {
    Alert.alert('Something went wrong', '' + e, [
      {
        text: loc._.ok,
        onPress: () => {},
        style: 'default',
      },
    ]);
  }

  const getChangeAddressAsync = async () => {
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

  return isLoading || !sell ? (
    <View style={[styles.loading, stylesHook.container]}>
      <ActivityIndicator />
    </View>
  ) : (
    <SafeBlueArea style={stylesHook.container}>
      <ScrollView contentContainerStyle={styles.contentContainer}>
        <View style={styles.contentContainer}>
          <View style={styles.amountContainer}>
            <Text style={[styles.amount, stylesHook.textAmount]}>{amount}</Text>
            <Text style={[styles.asset, stylesHook.textAmount]}>BTC</Text>
          </View>
          <View style={styles.infoContainer}>
            <Text style={styles.infoHeader}>{loc.sell.bankAccount}</Text>
            <Text style={stylesHook.text}>{sell.iban}</Text>
          </View>
          <View style={styles.infoContainer}>
            <Text style={styles.infoHeader}>{loc.sell.currency}</Text>
            <Text style={stylesHook.text}>
              {sell.currency.name} - {toDescription(sell.currency)}
            </Text>
          </View>
          <View style={[styles.infoContainer, styles.growing]}>
            <Icon style={styles.icon} name="information-outline" type="material-community" size={16} color="#FFF" />
            <Text style={stylesHook.text}>{loc.sell.info}</Text>
          </View>
          <View style={styles.buttonContainer}>
            <View style={styles.button}>
              <BlueButton onPress={() => handleConfirm().catch(handleError)} title={loc.sell.confirm} testID="SellConfirm" />
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
    marginBottom: 30,
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

Sell.navigationOptions = navigationStyleTx({}, options => ({
  ...options,
  title: loc.sell.header,
}));

export default Sell;
