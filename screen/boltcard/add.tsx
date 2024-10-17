import React, { useContext, useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Image, Text } from 'react-native-elements';
import navigationStyle from '../../components/navigationStyle';
import { BlueButton } from '../../BlueComponents';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import { useLds } from '../../api/lds/hooks/lds.hook';
import { useWalletContext } from '../../contexts/wallet.context';
import { LightningLdsWallet } from '../../class/wallets/lightning-lds-wallet';
import useLdsBoltcards from '../../api/boltcards/hooks/bolcards.hook';
import { useNtag424 } from '../../api/boltcards/hooks/ntag424.hook';
import { AbstractWallet } from '../../class';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useTheme } from '@react-navigation/native';
import loc from '../../loc';
import BoltCard from '../../class/boltcard';
import { TypeError } from '../../helpers/ErrorCodes';
import { HoldCardModal } from '../../components/HoldCardModal';
import { getProgressStringGenerator } from '../../helpers/stringProgressBar';

const AddBoltcard: React.FC = () => {
  const { wallets, saveToDisk } = useContext(BlueStorageContext);
  const { navigate } = useNavigation();
  const { colors } = useTheme();
  const ldsWallet = wallets.find((w: AbstractWallet) => w.type === LightningLdsWallet.type) as LightningLdsWallet;
  const [isLoading, setIsLoading] = useState(false);
  const [isHoldCardModalVisible, setIsHoldCardModalVisible] = useState(false);
  const [progressMessage, setProgressMessage] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  const { address, signMessage } = useWalletContext();
  const { genFreshCardDetails, createBoltcard, getBoltcardSecret, getBoltcards } = useLdsBoltcards();
  const { startNfcSession, getCardUid, writeCard, stopNfcSession, updateModalMessageIos } = useNtag424({ manualSessionControl: true });
  const { getUser } = useLds();

  const updateInvoiceUrl = async () => {
    if (!ldsWallet.getLndhubInvoiceUrl()) {
      const mainAddress = address as string;
      const { lightning } = await getUser(mainAddress, m => signMessage(m, mainAddress));
      const btcWallet = lightning.wallets.find(w => w.asset.name === 'BTC') as any;
      const [lndhubInvoiceUrl] = btcWallet.lndhubInvoiceUrl.split('@');
      ldsWallet.setLndhubInvoiceUrl(lndhubInvoiceUrl);
    }
  };

  const updateCardsInStorage = async () => {
    const serverCards = await getBoltcards(ldsWallet.getAdminKey());
    const localCards = ldsWallet.getBoltcards();

    // Remove cards that are not in the server
    localCards.forEach(localCard => {
      const serverCard = serverCards.find(card => card.uid === localCard.uid);
      if (!serverCard) {
        ldsWallet.deleteBoltcard(localCard);
      }
    });

    // Add cards that are in the server but not in the local
    await Promise.all(
      serverCards.map(async serverCard => {
        const localCard = localCards.find(card => card.uid === serverCard.uid);
        if (!localCard) {
          const secrets = await getBoltcardSecret(serverCard);
          const boltcard = new BoltCard(serverCard, secrets);
          ldsWallet.addBoltcard(boltcard);
        }
      }),
    );
  };

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      try {
        await updateInvoiceUrl();
        await updateCardsInStorage();
        await saveToDisk();
      } catch (_) {}
      setIsLoading(false);
    })();
  }, []);

  const setupBoltcardErrorHandler = (error: any) => {
    if (!error.type) return console.log(error);
    switch (error.type) {
      case TypeError.AUTH_FAILED:
        if (error.code === '91ae') return navigate('WrittenCardError');
        break;
      case TypeError.OTHERS:
        if (error.code === '6982') return navigate('WrittenCardError');
        break;
      default:
        console.log(JSON.stringify(error));
    }
  };

  const onCancelHoldCard = () => {
    stopNfcSession();
    setIsHoldCardModalVisible(false);
  };

  const updateProgress = async (message: string) => {
    if (Platform.OS === 'ios') return await updateModalMessageIos(message);
    if (Platform.OS === 'android') return setProgressMessage(message);
  };

  const handleOnPress = async () => {
    try {
      setIsLoading(true);
      if (Platform.OS === 'android') setIsHoldCardModalVisible(true);

      const progress = getProgressStringGenerator(6);
      await startNfcSession(`${loc.boltcard.tap_and_hold}\n\n${progress.initialMessage}`);

      const cardUid = await getCardUid();
      updateProgress(`${loc.boltcard.writting_hold}\n\n${progress.next()}`);

      const freshCardDetails = await genFreshCardDetails();
      updateProgress(`${loc.boltcard.writting_hold}\n\n${progress.next()}`);

      const ldsAddress = ldsWallet.lnAddress as string;
      const [prefix] = ldsAddress.split('@');
      freshCardDetails.card_name = `${prefix} PAY CARD`;
      freshCardDetails.uid = cardUid as string;
      const serverDetails = await createBoltcard(ldsWallet.getAdminKey(), freshCardDetails);
      updateProgress(`${loc.boltcard.writting_hold}\n\n${progress.next()}`);

      const secrets = await getBoltcardSecret(serverDetails);
      updateProgress(`${loc.boltcard.writting_hold}\n\n${progress.next()}`);

      await writeCard(secrets);
      updateProgress(`${loc.boltcard.writting_hold}\n\n${progress.next()}`);

      const boltcard = new BoltCard(serverDetails, secrets);
      ldsWallet.addBoltcard(boltcard);
      await saveToDisk();
      stopNfcSession();
      updateProgress(`${loc.boltcard.writting_hold}\n\n${progress.next()}`);

      setIsSuccess(true);
      setTimeout(() => navigate('BoltCardDetails', { boltcardUid: boltcard.uid }), 2000);
    } catch (error: any) {
      stopNfcSession();
      setupBoltcardErrorHandler(error);
      setIsHoldCardModalVisible(false);
    } finally {
      setIsLoading(false);
    }
  };

  const stylesHooks = StyleSheet.create({
    root: {
      backgroundColor: colors.elevated,
      justifyContent: 'space-between',
      flex: 1,
    },
    textdesc: {
      color: colors.alternativeTextColor,
    },
  });

  return (
    <SafeAreaView style={stylesHooks.root}>
      <View style={styles.imageContainer}>
        <View style={styles.logoContainer}>
          <Image source={require('../../img/pay-card-link.png')} style={{ width: 1.3 * 60, height: 60 }} />
        </View>
      </View>
      <View style={styles.descriptionContainer}>
        <Text style={[styles.textdesc, styles.textdescBold, stylesHooks.textdesc]}>{loc.boltcard.how_to_create}</Text>
      </View>
      <View style={styles.buttonContiner}>
        <BlueButton title={loc.boltcard.create_boltcard} onPress={handleOnPress} isLoading={isLoading} />
      </View>
      <HoldCardModal
        message={progressMessage}
        isHoldCardModalVisible={isHoldCardModalVisible}
        isSuccess={isSuccess}
        onCancelHoldCard={onCancelHoldCard}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  imageContainer: {
    marginVertical: 24,
    alignItems: 'center',
  },
  descriptionContainer: {
    flexGrow: 1,
    alignContent: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  textdesc: {
    fontWeight: '500',
    alignSelf: 'center',
    textAlign: 'center',
    marginBottom: 16,
  },
  textdescBold: {
    fontWeight: '700',
    alignSelf: 'center',
    textAlign: 'center',
  },
  logoContainer: {
    padding: 4,
    borderRadius: 15,
  },
  boltcardLogo: {
    width: 100,
    height: 100,
    alignSelf: 'center',
  },
  buttonContiner: {
    paddingHorizontal: 24,
    marginVertical: 18,
  },
});

AddBoltcard.navigationOptions = navigationStyle({}, options => ({
  ...options,
  title: loc.boltcard.title_create,
}));

export default AddBoltcard;
