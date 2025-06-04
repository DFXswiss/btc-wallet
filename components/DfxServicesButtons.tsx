import React, { useState, useContext, useMemo } from 'react';
import { ActivityIndicator, Alert, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useNavigation, useTheme } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Chain } from '../models/bitcoinUnits';
import { WatchOnlyWallet } from '../class';
import loc from '../loc';
import { BlueStorageContext } from '../blue_modules/storage-context';
import { ImageButton } from '../components/ImageButton';
import { DfxService, useDfxSessionContext } from '../api/dfx/contexts/session.context';
import BigNumber from 'bignumber.js';

import BuyEn from '../img/dfx/buttons/buy_en.png';
import SellEn from '../img/dfx/buttons/sell_en.png';
import BuyDe from '../img/dfx/buttons/buy_de.png';
import SellDe from '../img/dfx/buttons/sell_de.png';
import BuyFr from '../img/dfx/buttons/buy_fr.png';
import SellFr from '../img/dfx/buttons/sell_fr.png';
import BuyIt from '../img/dfx/buttons/buy_it.png';
import SellIt from '../img/dfx/buttons/sell_it.png';
import SwapEn from '../img/dfx/buttons/swap.png';
import NetworkTransactionFees, { NetworkTransactionFee } from '../models/networkTransactionFees';
import { AbstractHDElectrumWallet } from '../class/wallets/abstract-hd-electrum-wallet';
import { BlueText } from '../BlueComponents';
import { LightningLdsWallet } from '../class/wallets/lightning-lds-wallet';
import { useWalletContext } from '../contexts/wallet.context';

const currency = require('../blue_modules/currency');

const DfxServicesButtons = ({ walletID }: { walletID: string }) => {
  const { wallet: mainWallet } = useWalletContext();
  const { wallets, isDfxPos, isDfxSwap } = useContext(BlueStorageContext);
  const { navigate } = useNavigation<any>();
  const { colors } = useTheme();
  const { isAvailable: isDfxAvailable, openServices } = useDfxSessionContext();
  const [isHandlingOpenServices, setIsHandlingOpenServices] = useState(false);
  const [changeAddress, setChangeAddress] = useState('');

  const wallet = useMemo(() => {
    const selectedWallet = wallets.find((w: AbstractHDElectrumWallet) => w.getID() === walletID);
    const lndWallet = wallets.find((w: AbstractHDElectrumWallet) => w.type === LightningLdsWallet.type);
    return selectedWallet || lndWallet || mainWallet;
  }, [wallets, walletID]);

  const getButtonImages = (lang: string) => {
    switch (lang) {
      case 'en':
        return [BuyEn, SellEn, SwapEn];
      case 'de_de':
        return [BuyDe, SellDe, SwapEn];
      case 'fr_fr':
        return [BuyFr, SellFr, SwapEn];
      case 'it':
        return [BuyIt, SellIt, SwapEn];
      default:
        return [BuyEn, SellEn, SwapEn];
    }
  };

  const language = loc.getLanguage()?.toLowerCase();
  const buttonImages = useMemo(() => getButtonImages(language), [language]);

  const getChangeAddressAsync = async (wallet: AbstractHDElectrumWallet) => {
    if (changeAddress) return changeAddress; // cache

    let change;
    // @ts-ignore - isHd is not a function on AbstractHDElectrumWallet
    if (WatchOnlyWallet.type === wallet.type && !wallet.isHd()) {
      change = wallet.getAddress();
    } else {
      try {
        change = await Promise.race([new Promise(resolve => setTimeout(resolve, 2000)), wallet.getChangeAddressAsync()]);
      } catch (_) {}

      if (!change) {
        if (wallet instanceof AbstractHDElectrumWallet) {
          change = wallet._getInternalAddressByIndex(wallet.getNextFreeChangeAddressIndex());
        } else {
          // legacy wallets
          // @ts-ignore - getAddress is not a function on AbstractHDElectrumWallet
          change = wallet.getAddress();
        }
      }
    }
    if (change) setChangeAddress(change); // cache
    return change;
  };

  const getEstimatedOnChainFee = async () => {
    const lutxo = wallet.getUtxo();
    const changeAddress = await getChangeAddressAsync(wallet);
    const dustTarget = [{ address: '36JxaUrpDzkEerkTf1FzwHNE1Hb7cCjgJV' }];
    const networkTransactionFees = await NetworkTransactionFees.recommendedFees();
    await AsyncStorage.setItem(NetworkTransactionFee.StorageKey, JSON.stringify(networkTransactionFees));
    // dummy transaction, not to be broadcasted
    const { fee } = wallet.createTransaction(lutxo, dustTarget, Number(networkTransactionFees.fastestFee), changeAddress, false);
    return fee;
  };

  const getBalanceByDfxService = async (service: DfxService) => {
    const balance = wallet.getBalance();
    if (service === DfxService.SELL || service === DfxService.SWAP) {
      try {
        const fee = wallet.chain === Chain.ONCHAIN ? await getEstimatedOnChainFee() : balance * 0.03;
        return balance - fee;
      } catch (_) {
        return 0;
      }
    }
    return balance;
  };

  const handleOpenServices = async (service: DfxService) => {
    setIsHandlingOpenServices(true);
    try {
      const maxBalance = await getBalanceByDfxService(service);
      await openServices(wallet.getID(), new BigNumber(currency.satoshiToBTC(maxBalance)).toString(), service);
    } catch (e: any) {
      Alert.alert('Something went wrong', e.message?.toString(), [
        {
          text: loc._.ok,
          onPress: () => {},
          style: 'default',
        },
      ]);
    }
    setIsHandlingOpenServices(false);
  };

  const handleOpenDfxPosMode = async () => {
    navigate('ReceiveDetailsRoot', {
      screen: 'CashierDfxPos',
      params: { walletID: wallet.getID() },
    });
  };

  return (
    <View style={styles.dfxContainer}>
      {isDfxAvailable ? (
        <>
          <BlueText>{loc.wallets.external_services}</BlueText>
          <View style={styles.dfxButtonContainer}>
            {isHandlingOpenServices ? (
              <ActivityIndicator />
            ) : (
              <>
                <View>
                  <ImageButton
                    imageStyle={styles.tileImageStyle}
                    source={buttonImages[0]}
                    onPress={() => handleOpenServices(DfxService.BUY)}
                    disabled={isHandlingOpenServices || !isDfxAvailable}
                  />
                </View>
                {isDfxSwap && (
                  <View>
                    <ImageButton
                      imageStyle={styles.tileImageStyle}
                      source={buttonImages[2]}
                      onPress={() => handleOpenServices(DfxService.SWAP)}
                      disabled={isHandlingOpenServices || !isDfxAvailable}
                    />
                  </View>
                )}
                <View>
                  <ImageButton
                    source={buttonImages[1]}
                    onPress={() => handleOpenServices(DfxService.SELL)}
                    disabled={isHandlingOpenServices || !isDfxAvailable}
                  />
                </View>
                {isDfxPos && (
                  <View>
                    <View style={{ backgroundColor: colors.background, height: '100%' }}>
                      <TouchableOpacity
                        onPress={handleOpenDfxPosMode}
                        disabled={isHandlingOpenServices || !isDfxAvailable}
                        style={{ justifyContent: 'center', alignItems: 'center', width: 60, padding: 10 }}
                      >
                        <BlueText>Point</BlueText>
                        <BlueText>of</BlueText>
                        <BlueText>Sale</BlueText>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </>
            )}
          </View>
        </>
      ) : null}
    </View>
  );
};

export default DfxServicesButtons;

const styles = StyleSheet.create({
  tileImageStyle: {
    borderRadius: 5,
  },
  dfxContainer: {
    backgroundColor: '#0A345A',
    alignItems: 'center',
    height: 110,
  },
  dfxButtonContainer: {
    flexGrow: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 10,
    gap: 10,
  },
});
