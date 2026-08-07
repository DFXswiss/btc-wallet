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
import { Utxo } from '../class/wallets/types';
import { BlueText } from '../BlueComponents';
import { LightningLdsWallet } from '../class/wallets/lightning-lds-wallet';
import { useWalletContext } from '../contexts/wallet.context';
import { DfxMaxAmount } from '../helpers/dfxMaxAmount';
import { Utils } from '../helpers/utils';

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
      case 'de':
        return [BuyDe, SellDe, SwapEn];
      case 'fr':
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

  const getEstimatedOnChainFee = async (lutxo: Utxo[]) => {
    const changeAddress = await getChangeAddressAsync(wallet);
    const dustTarget = [{ address: '36JxaUrpDzkEerkTf1FzwHNE1Hb7cCjgJV' }];
    const networkTransactionFees = await NetworkTransactionFees.recommendedFees();
    await AsyncStorage.setItem(NetworkTransactionFee.StorageKey, JSON.stringify(networkTransactionFees));
    // dummy transaction, not to be broadcasted
    const { fee } = wallet.createTransaction(lutxo, dustTarget, Number(networkTransactionFees.fastestFee), changeAddress, false);
    return fee;
  };

  // For onchain Sell/Swap this fetches a fresh UTXO set and sizes the estimate off its actual
  // total value, rather than the separately-cached wallet.getBalance() - that cache is only
  // updated by a background poll that's suspended while the DFX widget has the app backgrounded,
  // so it can't be trusted as the "what did we actually propose" baseline DfxMaxAmount relies on.
  // Returns the sweepable total alongside the estimate so the caller can hand DfxMaxAmount the
  // exact same snapshot the estimate was computed from, instead of re-reading wallet.getUtxo()
  // later (wallet.utxo is a shared, mutable field - a second, later read isn't guaranteed to
  // still match, e.g. if an unrelated fetchUtxo() elsewhere resolves in between).
  const getBalanceByDfxService = async (service: DfxService): Promise<{ maxBalance: number; sweepableBalance: number }> => {
    if (wallet.chain === Chain.ONCHAIN && (service === DfxService.SELL || service === DfxService.SWAP)) {
      await Utils.withRetry(() => wallet.fetchUtxo());
      const lutxo: Utxo[] = wallet.getUtxo();
      const sweepableBalance = Utils.sumUtxoValue(lutxo);
      try {
        const fee = await getEstimatedOnChainFee(lutxo);
        return { maxBalance: sweepableBalance - fee, sweepableBalance };
      } catch (_) {
        return { maxBalance: 0, sweepableBalance };
      }
    }

    const balance = wallet.getBalance();
    const maxBalance = service === DfxService.SELL || service === DfxService.SWAP ? balance - balance * 0.03 : balance;
    return { maxBalance, sweepableBalance: balance };
  };

  const handleOpenServices = async (service: DfxService) => {
    setIsHandlingOpenServices(true);
    try {
      const { maxBalance, sweepableBalance } = await getBalanceByDfxService(service);
      if (wallet.chain === Chain.ONCHAIN && (service === DfxService.SELL || service === DfxService.SWAP)) {
        await DfxMaxAmount.remember(wallet.getID(), service, maxBalance, sweepableBalance);
      }
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
                    <View style={[styles.posWrapper, { backgroundColor: colors.background }]}>
                      <TouchableOpacity
                        onPress={handleOpenDfxPosMode}
                        disabled={isHandlingOpenServices || !isDfxAvailable}
                        style={styles.posButton}
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
  posWrapper: {
    height: '100%',
  },
  posButton: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 60,
    padding: 10,
  },
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
    marginVertical: 6,
    gap: 10,
  },
});
