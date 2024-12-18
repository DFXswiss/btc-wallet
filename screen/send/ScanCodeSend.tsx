import React, { useContext, useEffect, useState } from 'react';
import { View, StyleSheet, StatusBar, ActivityIndicator, TouchableOpacity, Image } from 'react-native';
import navigationStyle from '../../components/navigationStyle';
import { Camera } from 'react-native-camera-kit';
import { BlueButton, BlueText } from '../../BlueComponents';
import useCameraPermissions from '../../hooks/cameraPermisions.hook';
import { useQrCodeScanner } from '../../hooks/qrCodeScaner.hook';
import useQrCodeImagePicker from '../../hooks/qrCodeImagePicker.hook';
import BlueClipboard from '../../blue_modules/clipboard';
import DeeplinkSchemaMatch from '../../class/deeplink-schema-match';
import { useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import { Chain } from '../../models/bitcoinUnits';
import { useWalletContext } from '../../contexts/wallet.context';
import loc from '../../loc';
import { MultisigHDWallet } from '../../class/wallets/multisig-hd-wallet';

const bitcoin = require('bitcoinjs-lib');

const ScanCodeSend: React.FC = () => {
  const { wallets } = useContext(BlueStorageContext);
  const { wallet: mainWallet } = useWalletContext();
  const multisigWallet = wallets.find(w => w.type === MultisigHDWallet.type);
  const { params } = useRoute();
  const { isReadingQrCode, cameraCallback, setOnBarScanned, urHave, urTotal } = useQrCodeScanner();
  const { isProcessingImage, openImagePicker, setOnBarCodeInImage } = useQrCodeImagePicker();
  const { cameraStatus } = useCameraPermissions();
  const { navigate, goBack, setOptions, replace } = useNavigation();
  const [isCameraActive, setIsCameraActive] = useState(true);
  const isFocused = useIsFocused();

  const delayedNavigationFunction = (func: () => void) => {
    setIsCameraActive(false);
    setTimeout(() => func(), 30);
  };

  const importPsbt = base64Psbt => {
    try {
      if (Boolean(multisigWallet)) {
        delayedNavigationFunction(() =>
          replace('SendDetailsRoot', {
            screen: 'PsbtMultisig',
            params: {
              psbtBase64: base64Psbt,
              walletID: multisigWallet.getID(),
            },
          }),
        );
      }
    } catch (_) {}
  };

  const onContentRead = (data: any) => {
    const destinationString = data.data ? data.data : data;

    if (DeeplinkSchemaMatch.isPossiblyPSBTString(destinationString)) {
      importPsbt(destinationString);
      return;
    }

    if (DeeplinkSchemaMatch.isBothBitcoinAndLightning(destinationString)) {
      const selectedWallet = wallets.find(w => w.getID() === params?.walletID);
      const lightningWallet = wallets.find(w => w.chain === Chain.OFFCHAIN);
      const uri = DeeplinkSchemaMatch.isBothBitcoinAndLightning(destinationString);
      const destinationWallet = selectedWallet || lightningWallet || mainWallet;
      const route = DeeplinkSchemaMatch.isBothBitcoinAndLightningOnWalletSelect(destinationWallet, uri);
      ReactNativeHapticFeedback.trigger('impactLight', { ignoreAndroidSystemSettings: false });
      delayedNavigationFunction(() => replace(...route));
    } else if (
      DeeplinkSchemaMatch.isPossiblyLightningDestination(destinationString) ||
      DeeplinkSchemaMatch.isPossiblyOnChainDestination(destinationString)
    ) {
      DeeplinkSchemaMatch.navigationRouteFor({ url: destinationString }, completionValue => {
        ReactNativeHapticFeedback.trigger('impactLight', { ignoreAndroidSystemSettings: false });
        delayedNavigationFunction(() => replace(...completionValue));
      });
    } else {
      delayedNavigationFunction(() => goBack());
    }
  };

  useEffect(() => {
    setOnBarScanned(onContentRead);
    setOnBarCodeInImage(onContentRead);
    setOptions({
      headerRight: () => (
        <TouchableOpacity style={styles.closeButton} onPress={() => delayedNavigationFunction(() => goBack())}>
          <Image source={require('../../img/close-white.png')} />
        </TouchableOpacity>
      ),
    });
  }, []);

  const readFromClipboard = async () => {
    await BlueClipboard().setReadClipboardAllowed(true);
    const clipboard = await BlueClipboard().getClipboardContent();
    if (clipboard) {
      setTimeout(() => onContentRead(clipboard), 100);
    }
  };

  const isLoading = isReadingQrCode || isProcessingImage;
  const isCameraFocused = cameraStatus && isFocused && !isProcessingImage && isCameraActive;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      {isCameraFocused && (
        <Camera
          scanBarcode
          onReadCode={(event: any) => cameraCallback({ data: event?.nativeEvent?.codeStringValue })}
          style={styles.camera}
        />
      )}
      {isLoading && (
        <View style={styles.loadingContainer}>
          <View>
            <ActivityIndicator style={{ marginBottom: 5 }} size={25} />
            <BlueText style={styles.textExplanation}>
              {loc._.loading} {urHave}/{urTotal}
            </BlueText>
          </View>
        </View>
      )}
      <View style={styles.explanationContainer}>
        <BlueText style={styles.textExplanation}>{loc.send.scan_bitcoin_qr}</BlueText>
      </View>
      <View style={styles.actionsContainer}>
        <BlueButton
          style={styles.actionButton}
          onPress={openImagePicker}
          icon={{ name: 'image', type: 'material', color: '#ffffff', size: 38 }}
        />
        <BlueButton
          style={styles.actionButton}
          onPress={() => navigate('ScanCodeSendRoot', { screen: 'ManualEnterAddress', params: { walletID: params?.walletID } })}
          icon={{ name: 'keyboard', type: 'material', color: '#ffffff', size: 38 }}
        />
        <BlueButton
          style={styles.actionButton}
          onPress={readFromClipboard}
          icon={{ name: 'content-paste', type: 'material', color: '#ffffff', size: 38 }}
        />
      </View>
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
    right: '35%',
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
});

ScanCodeSend.navigationOptions = navigationStyle(
  {
    closeButton: false,
    headerHideBackButton: true,
  },
  opts => ({ ...opts, title: loc.send.header }),
);

export default ScanCodeSend;
