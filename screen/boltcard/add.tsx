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

const AddBoltcard: React.FC = () => {
  const { wallets, saveToDisk } = useContext(BlueStorageContext);
  const { navigate, replace } = useNavigation();
  const { colors } = useTheme();
  const ldsWallet = wallets.find((w: AbstractWallet) => w.type === LightningLdsWallet.type) as LightningLdsWallet;
  const [isLoading, setIsLoading] = useState(false);
  const [isHoldCardModalVisible, setIsHoldCardModalVisible] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const { address, signMessage } = useWalletContext();
  const { genFreshCardDetails, createBoltcard, getBoltcards, getBoltcardSecret, updateBoltcard } = useLdsBoltcards();
  const { writeCard, stopNfcSession } = useNtag424();
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

  const checkAlreadyCreatedBoltcard = async () => {
    if (!ldsWallet.getBoltcard()) {
      const [cardInServer] = await getBoltcards(ldsWallet.getInvoiceId());
      
      let serverDetails = cardInServer
      if(!serverDetails){
        const adminKey = ldsWallet.getAdminKey();
        const freshCardDetails = await genFreshCardDetails();
        const ldsAddress = ldsWallet.lnAddress as string;
        const [prefix] = ldsAddress.split('@');
        freshCardDetails.card_name = `${prefix} PAY CARD`;
        serverDetails = await createBoltcard(adminKey, freshCardDetails);
      }

      const secrets = await getBoltcardSecret(serverDetails);
      const boltcard = new BoltCard(serverDetails, secrets);
      ldsWallet.setBoltcard(boltcard);
    }
  };

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      try {
        await updateInvoiceUrl();
        await checkAlreadyCreatedBoltcard();
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

  const setupCardAndServer = async () => {
    const adminKey = ldsWallet.getAdminKey();
    const boltcard = ldsWallet.getBoltcard() as BoltCard;
    const { uid } = await writeCard(boltcard.secrets);
    boltcard.isPhisicalCardWritten = true;
    const updated = await updateBoltcard(adminKey, { ...boltcard, uid }); // To set the real uid from the phisical card
    boltcard.uid = updated.uid;
    await saveToDisk();
  };

  const cardWrittenSucces = async () => {
    setIsSuccess(true);
    setTimeout(() => {
      replace('BoltCardDetails');
    }, 2000);
  };

  const onCancelHoldCard = () => {
    stopNfcSession();
    setIsHoldCardModalVisible(false);
  };

  const handleOnPress = async () => {
    try {
      setIsLoading(true);
      if (Platform.OS === 'android') setIsHoldCardModalVisible(true);
      await setupCardAndServer();
      cardWrittenSucces();
    } catch (error: any) {
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
      <HoldCardModal isHoldCardModalVisible={isHoldCardModalVisible} isSuccess={isSuccess} onCancelHoldCard={onCancelHoldCard} />
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
