import React, { useContext, useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Icon, Switch, Text } from 'react-native-elements';
import navigationStyle from '../../components/navigationStyle';
import { BlueButton, BlueSpacing20 } from '../../BlueComponents';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import { LightningLdsWallet } from '../../class/wallets/lightning-lds-wallet';
import { BolcardSecrets } from '../../models/boltcard';
import { AbstractWallet } from '../../class';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, useTheme } from '@react-navigation/native';
import { useNtag424 } from '../../api/boltcards/hooks/ntag424.hook';
import useLdsBoltcards from '../../api/boltcards/hooks/bolcards.hook';
import BoltCard from '../../class/boltcard';
import { HoldCardModal } from '../../components/HoldCardModal';
import loc from '../../loc';
import { getProgressStringGenerator } from '../../helpers/stringProgressBar';

const DeleteBolcard: React.FC = () => {
  const { wallets, saveToDisk } = useContext(BlueStorageContext);
  const { navigate } = useNavigation();
  const { colors } = useTheme();
  const { boltcardUid } = useRoute().params as { boltcardUid: string };
  const ldsWallet = wallets.find((w: AbstractWallet) => w.type === LightningLdsWallet.type) as LightningLdsWallet;
  const card = ldsWallet.getBoltcards().find((c: BoltCard) => c.uid === boltcardUid) as BoltCard;
  const [resetCard, setResetCard] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isHoldCardModalVisible, setIsHoldCardModalVisible] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [progressMessage, setProgressMessage] = useState('');
  const { deleteBoltcard } = useLdsBoltcards();
  const { startNfcSession, getCardUid, wipeCard, stopNfcSession, updateModalMessageIos } = useNtag424({ manualSessionControl: true });

  const onCancelHoldCard = () => {
    stopNfcSession();
    setIsHoldCardModalVisible(false);
  };

  useEffect(() => {
    return () => {
      stopNfcSession();
    };
  }, []);

  const updateProgress = async (message: string) => {
    if (Platform.OS === 'ios') return await updateModalMessageIos(message);
    if (Platform.OS === 'android') return setProgressMessage(message);
  };

  const handleOnPress = async () => {
    try {
      if (isLoading) return;
      setIsLoading(true);
      if(Platform.OS === 'android') setIsHoldCardModalVisible(true);
      const progress = getProgressStringGenerator(resetCard ? 3 : 2);

      if (resetCard) {
        await startNfcSession(`${loc.boltcard.tap_and_hold}\n\n${progress.initialMessage}`);
        if (Platform.OS === 'android') setIsHoldCardModalVisible(true);
        const cardUid = await getCardUid();
        updateProgress(`${loc.boltcard.writting_hold}\n\n${progress.next()}`);
        if (cardUid !== card.uid) throw new Error('Card UID mismatch');
        await wipeCard(card.secrets as BolcardSecrets);
        updateProgress(`${loc.boltcard.writting_hold}\n\n${progress.next()}`);
      }
      try {
        await deleteBoltcard(ldsWallet.getAdminKey(), card);
        updateProgress(`${loc.boltcard.writting_hold}\n\n${progress.next()}`);
      } catch (_) {
        console.log(_);
      }
      ldsWallet.deleteBoltcard(card);
      await saveToDisk();
      await stopNfcSession();
      setIsSuccess(true);
      setTimeout(() => {
        if (ldsWallet.getBoltcards().length > 0) {
          const lastCard = ldsWallet.getBoltcards().at(-1) as BoltCard;
          navigate('BoltCardDetails', {boltcardUid: lastCard.uid});
        } else {
          navigate('WalletTransactions');
        }
      }, 1000);
    } catch (error) {
      setIsLoading(false);
      stopNfcSession();
      console.error(error);
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
    switchTitle: {
      color: colors.foregroundColor,
    },
  });

  return (
    <SafeAreaView style={stylesHooks.root}>
      <View style={styles.descriptionContainer}>
        <View style={styles.circleContainer}>
          <Icon style={styles.iconStyle} type="material" name="delete-forever" color="#e73955" size={45} />
        </View>
        <View>
          <Text style={[styles.titleDesc, styles.textdescBold, stylesHooks.textdesc]}>{loc.boltcard.delete_card_title}</Text>
          <Text style={[styles.textdesc, styles.textdescBold, stylesHooks.textdesc]}>{`UID: ${boltcardUid}`}</Text>
          <BlueSpacing20 />
          <Text style={[styles.textdesc, styles.textdescBold, stylesHooks.textdesc]}>{loc.boltcard.how_to_delete}</Text>
          <Text style={[styles.textdesc, styles.textdescBold, stylesHooks.textdesc]}>{loc.boltcard.lost_card}</Text>
          <BlueSpacing20 />
          <BlueSpacing20 />
        </View>
      </View>
      <View style={styles.buttonContiner}>
        <View style={styles.switchContainer}>
          <Switch value={resetCard} onValueChange={setResetCard} />
          <Text style={[styles.switchTitle, stylesHooks.switchTitle]}>{loc.boltcard.also_wipe_card}</Text>
        </View>
        <BlueButton title={loc.boltcard.confirm_delete} onPress={handleOnPress} isLoading={isLoading} />
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
  circleContainer: {
    alignSelf: 'center',
    borderRadius: 50,
    borderColor: '#e73955',
    borderWidth: 3,
    marginBottom: 16,
  },
  iconStyle: {
    margin: 8,
  },
  descriptionContainer: {
    flexGrow: 1,
    alignContent: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  titleDesc: {
    fontWeight: '500',
    alignSelf: 'center',
    textAlign: 'center',
    marginBottom: 20,
    fontSize: 20,
  },
  textdesc: {
    fontWeight: '500',
    alignSelf: 'center',
    textAlign: 'center',
    fontSize: 16,
    marginBottom: 16,
  },
  textdescBold: {
    fontWeight: '700',
    alignSelf: 'center',
    textAlign: 'center',
  },
  buttonContiner: {
    marginHorizontal: 24,
    marginVertical: 18,
  },
  switchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginVertical: 20,
    marginLeft: 12,
  },
  switchTitle: {
    fontSize: 16,
  },
});

DeleteBolcard.navigationOptions = navigationStyle({}, options => ({
  ...options,
  title: loc.boltcard.title_delete,
}));

export default DeleteBolcard;
