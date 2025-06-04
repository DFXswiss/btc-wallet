import React, { useContext, useEffect, useState } from 'react';
import { View, StyleSheet, StatusBar, ActivityIndicator, Alert } from 'react-native';
import navigationStyle from '../../components/navigationStyle';
import { Camera } from 'react-native-camera-kit';
import { BlueButton, BlueText } from '../../BlueComponents';
import useCameraPermissions from '../../hooks/cameraPermisions.hook';
import { useQrCodeScanner } from '../../hooks/qrCodeScaner.hook';
import useQrCodeImagePicker from '../../hooks/qrCodeImagePicker.hook';
import BlueClipboard from '../../blue_modules/clipboard';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import { useWalletContext } from '../../contexts/wallet.context';
import loc from '../../loc';
import { ManualTextModal } from '../../components/ManualTextModal';
import { MultisigHDWallet } from '../../class/wallets/multisig-hd-wallet';

const ImportMultisignature: React.FC = () => {
  const { addWallet, saveToDisk, isElectrumDisabled } = useContext(BlueStorageContext);
  const { wallet: mainWallet } = useWalletContext();
  const [isLoading, setIsLoading] = useState(false);
  const { isReadingQrCode, isLoadingAnimatedQRCode, urTotal, urHave, cameraCallback, setOnBarScanned } = useQrCodeScanner();
  const { isProcessingImage, openImagePicker, setOnBarCodeInImage } = useQrCodeImagePicker();
  const { cameraStatus } = useCameraPermissions();
  const { navigate } = useNavigation();
  const [isCameraActive, setIsCameraActive] = useState(true);
  const [isManualTextModalVisible, setIsManualTextModalVisible] = useState(false);
  const [threshold, setThreshold] = useState(0);
  const [quorum, setQuorum] = useState(0);
  const [isError, setIsError] = useState(false);
  const isFocused = useIsFocused();

  const delayedNavigationFunction = (func: () => void) => {
    setIsCameraActive(false);
    setTimeout(() => func(), 30);
  };

  const tryParseWallet = async (data: any) => {
    try {
      const content = data.data ? data.data : data;
      if (!content) return;

      const multisigWallet = new MultisigHDWallet();
      multisigWallet.setSecret(content);
      if (multisigWallet.getM() === 0 || multisigWallet.getN() === 0) throw new Error(loc.multisig.invalid_multisig_descriptor);
      setThreshold(multisigWallet.getM());
      setQuorum(multisigWallet.getN());
      await new Promise(resolve => setTimeout(resolve, 100));

      const derivationPath = multisigWallet.getDerivationPath();
      const ownXpub = multisigWallet.convertXpubToMultisignatureXpub(MultisigHDWallet.seedToXpub(mainWallet?.getSecret(), derivationPath));
      const ownZpub = MultisigHDWallet.xpubToZpub(ownXpub);
      const ownXpubFromZpub = MultisigHDWallet.zpubToXpub(ownZpub);
      const isPartOfMultisig = multisigWallet.getCosigners().some(cosigner => cosigner === ownXpub || cosigner === ownZpub || cosigner === ownXpubFromZpub || cosigner === mainWallet?.getSecret());
      if (!isPartOfMultisig) throw new Error(loc.multisig.not_part_of_multisig);

      multisigWallet.getCosigners().forEach((cosigner, index) => {
        if (cosigner === mainWallet?.getSecret()) return;
        if (cosigner === ownXpub || cosigner === ownZpub || cosigner === ownXpubFromZpub) return multisigWallet.replaceCosignerXpubWithSeed(index + 1, mainWallet?.getSecret() as string, '');
        if (MultisigHDWallet.isXpubForMultisig(cosigner)) return;
        // Then it should be a seed? try to replace it
        multisigWallet.replaceCosignerSeedWithXpub(index + 1);
      });

      multisigWallet.setLabel(loc.multisig.default_label);
      if (!isElectrumDisabled) await multisigWallet.fetchBalance();

      addWallet(multisigWallet);
      saveToDisk();
      delayedNavigationFunction(() => navigate('WalletTransactions'));
    } catch (error: any) {
      console.log(error);
      setIsError(true);
      setThreshold(0);
      setQuorum(0);
      Alert.alert(loc.multisig.import_multisig, error.message, [
        {
          text: loc._.ok,
          onPress: () => {
            setIsError(false);
            setIsLoading(false);
            setThreshold(0);
            setQuorum(0);
          },
        },
      ]);
    }
  };

  const onReadCode = (data: any) => {
    if (isError) return;
    if (isLoading && !isLoadingAnimatedQRCode) return;
    setIsLoading(true);
    setTimeout(() => {
      cameraCallback(data);
    }, 10);
  };

  const onReadCodeFromImageOrText = (data: any) => {
    setIsLoading(true);
    tryParseWallet(data);
  };

  useEffect(() => {
    setOnBarScanned(tryParseWallet);
  }, []);

  useEffect(() => {
    setOnBarCodeInImage(onReadCodeFromImageOrText);
  }, []);

  const readFromClipboard = async () => {
    await BlueClipboard().setReadClipboardAllowed(true);
    const clipboard = await BlueClipboard().getClipboardContent();
    if (clipboard) {
      setIsLoading(true);
      setTimeout(() => {
        tryParseWallet(clipboard);
      }, 100);
    }
  };

  const showLoading = isReadingQrCode || isProcessingImage || isLoading;
  const isCameraFocused = cameraStatus && isFocused && !isProcessingImage && isCameraActive && !isManualTextModalVisible;
  const isPotentialMultisig = threshold > 0 && quorum > 0;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      {isCameraFocused && (
        <Camera
          scanBarcode={!isError}
          onReadCode={(event: any) => onReadCode({ data: event?.nativeEvent?.codeStringValue })}
          style={styles.camera}
        />
      )}
      <View style={styles.explanationContainer}>
        <BlueText style={styles.textExplanation}>{loc.multisig.scan_qr}</BlueText>
      </View>
      {showLoading && (
        <View style={styles.loadingContainer}>
          <View style={styles.contentLoadingContainer}>
            <ActivityIndicator style={{ marginBottom: 5 }} size={25} />
            <BlueText style={styles.loadingText}>{loc._.loading}</BlueText>
            {isLoadingAnimatedQRCode && !isPotentialMultisig && <BlueText style={styles.progressText}>{urHave + '/' + urTotal}</BlueText>}
            {isPotentialMultisig && (
              <>
                <BlueText style={styles.progressText}>{loc.formatString(loc.multisig.calculating_cosigners, { m: threshold, n: quorum })}</BlueText>
              </>
            )}
          </View>
        </View>
      )}
      <View style={styles.actionsContainer}>
        <BlueButton
          style={styles.actionButton}
          onPress={openImagePicker}
          icon={{ name: 'image', type: 'material', color: '#ffffff', size: 38 }}
        />
        <BlueButton
          style={styles.actionButton}
          onPress={() => setIsManualTextModalVisible(true)}
          icon={{ name: 'keyboard', type: 'material', color: '#ffffff', size: 38 }}
        />
        <BlueButton
          style={styles.actionButton}
          onPress={readFromClipboard}
          icon={{ name: 'content-paste', type: 'material', color: '#ffffff', size: 38 }}
        />
      </View>
      <ManualTextModal
        title={loc.multisig.enter_descriptor}
        isVisible={isManualTextModalVisible}
        onMessageAccepted={onReadCodeFromImageOrText}
        validateMessage={() => true}
        onClose={() => setIsManualTextModalVisible(false)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  camera: {
    flex: 1,
  },
  loadingContainer: {
    position: 'absolute',
    top: '42%',
    display: 'flex',
    width: '100%',
    flexDirection: 'column',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  contentLoadingContainer: {
    backgroundColor: '#000000CC',
    padding: 25,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
  },
  explanationContainer: {
    backgroundColor: '#000000AA',
    position: 'absolute',
    top: '0%',
    paddingBottom: '14%',
    paddingTop: '22%',
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  textExplanation: { width: '50%', textAlign: 'center', fontSize: 16, color: '#FFFFFFEE', fontWeight: '600' },
  loadingText: { textAlign: 'center', fontSize: 16, color: '#FFFFFFEE', fontWeight: '600' },
  actionsContainer: {
    backgroundColor: '#000000AA',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 35,
    paddingBottom: 70,
    position: 'absolute',
    bottom: 0,
    width: '100%',
  },
  actionButton: {
    width: 70,
    height: 70,
    backgroundColor: '#5a5a5a99',
    justifyContent: 'center',
    borderRadius: 20,
    marginHorizontal: 10,
  },
  closeButton: {
    minWidth: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressText: {
    marginTop: 5,
    fontSize: 12,
    color: '#FFFFFFEE',
    fontWeight: '600',
    textAlign: 'center',
  },
});

ImportMultisignature.navigationOptions = navigationStyle(
  {
    closeButton: false,
    headerHideBackButton: true,
  },
  opts => ({ ...opts, title: loc.multisig.import_multisig }),
);

export default ImportMultisignature;
