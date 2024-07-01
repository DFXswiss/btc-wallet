import React, { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-elements';
import navigationStyle from '../../components/navigationStyle';
import { BlueButton, BlueSpacing20, SecondButton } from '../../BlueComponents';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, useTheme } from '@react-navigation/native';
import { BolcardSecrets } from '../../models/boltcard';
import alert from '../../components/Alert';
import { useNtag424 } from '../../api/boltcards/hooks/ntag424.hook';
import { HoldCardModal } from '../../components/HoldCardModal';
import loc from '../../loc';

const WrittenCardError: React.FC = () => {
  const { navigate, goBack } = useNavigation();
  const { name } = useRoute();
  const { colors } = useTheme();
  const [secrets, setSecrets] = useState<BolcardSecrets>();
  const [isWaitingNFC, setIsWaitingNFC] = useState(false);
  const [isHoldCardModalVisible, setIsHoldCardModalVisible] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const { wipeCard, stopNfcSession } = useNtag424();

  const onCancelHoldCard = () => {
    stopNfcSession();
    setIsHoldCardModalVisible(false);
  };

  const onBarScanned = async (data: string) => {
    try {
      const secrets = JSON.parse(data) as BolcardSecrets;
      if (!secrets || !secrets.k0 || !secrets.k1 || !secrets.k2 || !secrets.k3 || !secrets.k4) {
        return alert('Invalid backup data');
      }
      setSecrets(secrets);
    } catch (error) {
      alert('Invalid backup data');
    }
  };

  const onPressScanBackup = async () => {
    navigate('ScanQRCodeRoot', {
      screen: 'ScanQRCode',
      params: {
        launchedBy: name,
        onBarScanned,
        showFileImportButton: false,
      },
    });
  };

  const onStartNFC = async () => {
    if (!secrets) return;
    setIsWaitingNFC(true);
    if (Platform.OS === 'android') setIsHoldCardModalVisible(true);
    try {
      await wipeCard(secrets);
      setIsSuccess(true);
      setTimeout(() => {
        navigate('AddBoltcard');
      }, 2000);
    } catch (_) {}
    setIsWaitingNFC(false);
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

  const renderErrorExplanation = () => {
    return (
      <View>
        <Text style={[styles.titleDesc, styles.textdescBold, stylesHooks.textdesc]}>{loc.boltcard.card_written_title}</Text>
        <BlueSpacing20 />
        <Text style={[styles.textdesc, styles.textdescBold, stylesHooks.textdesc]}>{loc.boltcard.card_written_message}</Text>
        <Text style={[styles.textdesc, styles.textdescBold, stylesHooks.textdesc]}>{loc.boltcard.how_to_reset}</Text>
        <BlueSpacing20 />
        <BlueSpacing20 />
      </View>
    );
  };

  const renderCompleteWipeCard = () => {
    return (
      <View>
        <Text style={[styles.titleDesc, styles.textdescBold, stylesHooks.textdesc]}>{loc.boltcard.now_tap}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={stylesHooks.root}>
      <View style={styles.descriptionContainer}>
        <View style={styles.circleContainer}>
          <Icon style={styles.iconStyle} type="material" name="vpn-key" color="#e73955" size={45} />
        </View>
        {Boolean(secrets) ? renderCompleteWipeCard() : renderErrorExplanation()}
      </View>
      <View style={styles.buttonContiner}>
        <View style={styles.scanContainer}>
          {Boolean(secrets) ? (
            <BlueButton title={loc.boltcard.start_nfc} onPress={onStartNFC} isLoading={isWaitingNFC} />
          ) : (
            <BlueButton title={loc.boltcard.scan_backup} onPress={onPressScanBackup} />
          )}
        </View>
        <SecondButton title={loc.boltcard.cancel} onPress={goBack} />
      </View>
      <HoldCardModal isHoldCardModalVisible={isHoldCardModalVisible} isSuccess={isSuccess} onCancelHoldCard={onCancelHoldCard} />
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
  scanContainer: {
    marginBottom: 10,
  },
});

WrittenCardError.navigationOptions = navigationStyle({}, options => ({
  ...options,
  title: loc.boltcard.title_restore,
}));

export default WrittenCardError;
