import React, { useEffect, useState } from 'react';
import { View, StyleSheet, StatusBar, ActivityIndicator } from 'react-native';
import navigationStyle from '../../components/navigationStyle';
import { Camera } from 'react-native-camera-kit-no-google';
import { BlueButton, BlueText } from '../../BlueComponents';
import useCameraPermissions from '../../hooks/cameraPermisions.hook';
import { useQrCodeScanner } from '../../hooks/qrCodeScaner.hook';
import useQrCodeImagePicker from '../../hooks/qrCodeImagePicker.hook';
import { useIsFocused, useNavigation, ParamListBase } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import loc from '../../loc';

const ScanImport: React.FC & { navigationOptions?: ReturnType<typeof navigationStyle> } = () => {
  const { isReadingQrCode, cameraCallback, setOnBarScanned, urHave, urTotal } = useQrCodeScanner();
  const { isProcessingImage, openImagePicker, setOnBarCodeInImage } = useQrCodeImagePicker();
  const { cameraStatus } = useCameraPermissions();
  const { replace } = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  const [isCameraActive, setIsCameraActive] = useState(true);
  const isFocused = useIsFocused();

  const delayedNavigationFunction = (func: () => void) => {
    setIsCameraActive(false);
    setTimeout(() => func(), 30);
  };

  const getIsProcessing = () => {
    return isReadingQrCode || isProcessingImage;
  };

  const onContentRead = async (data: any) => {
    if (getIsProcessing()) return;

    if (data && data.data) data = data.data + '';
    ReactNativeHapticFeedback.trigger('impactLight', { ignoreAndroidSystemSettings: false });

    if (data.length > 0) {
      delayedNavigationFunction(() => replace('ImportWalletDiscovery', { importText: data }));
    }
  };

  useEffect(() => {
    setOnBarScanned(onContentRead);
    setOnBarCodeInImage(onContentRead);
  }, []);

  const isCameraFocused = cameraStatus && isFocused && !isProcessingImage && isCameraActive;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      {isCameraFocused && (
        <Camera
          scanBarcode
          scanThrottleDelay={0}
          onReadCode={(event: any) => cameraCallback({ data: event?.nativeEvent?.codeStringValue })}
          style={styles.camera}
        />
      )}
      {getIsProcessing() && (
        <View style={styles.processingOverlay}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator style={styles.loadingIndicator} size={25} />
            {Boolean(urHave) && Boolean(urTotal) && (
              <BlueText style={styles.textExplanation}>{`${loc._.loading} ${urHave}/${urTotal}`}</BlueText>
            )}
          </View>
        </View>
      )}
      <View style={styles.explanationContainer}>
        <BlueText style={styles.textExplanation}>{loc.wallets.scan_import_explanation}</BlueText>
      </View>
      <View style={styles.actionsContainer}>
        <BlueButton
          style={styles.actionButton}
          onPress={openImagePicker}
          icon={{ name: 'image', type: 'material', color: '#ffffff', size: 38 }}
        />
        <BlueButton
          style={styles.actionButton}
          onPress={() => delayedNavigationFunction(() => replace('ImportWallet'))}
          icon={{ name: 'keyboard', type: 'material', color: '#ffffff', size: 38 }}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  processingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  loadingIndicator: {
    marginBottom: 5,
  },
  container: {
    flex: 1,
  },
  camera: {
    flex: 1,
  },
  loadingContainer: {
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
    paddingTop: '10%',
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  textExplanation: { paddingHorizontal: 30, textAlign: 'center', fontSize: 16, color: '#FFFFFFEE', fontWeight: '600' },
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
});

ScanImport.navigationOptions = navigationStyle(
  {
    closeButton: false,
    headerHideBackButton: true,
  },
  opts => ({ ...opts, title: loc.wallets.import_title }),
);

export default ScanImport;
