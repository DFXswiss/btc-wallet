import React, { useContext, useEffect, useRef, useState } from 'react';
import { Image, View, TouchableOpacity, StatusBar, Platform, StyleSheet, Alert } from 'react-native';
import { Camera } from 'react-native-camera-kit-no-google';
import { Icon, Text } from 'react-native-elements';
import { launchImageLibrary } from 'react-native-image-picker';
import { decodeUR, extractSingleWorkload, BlueURDecoder } from '../../blue_modules/ur';
import { useNavigation, useRoute, useIsFocused, useTheme } from '@react-navigation/native';
import loc from '../../loc';
import { BlueLoading, BlueText } from '../../BlueComponents';
import alert from '../../components/Alert';
import { HoldCardModal } from '../../components/HoldCardModal';
import { useNtag424 } from '../../api/boltcards/hooks/ntag424.hook';
import useLdsBoltcards from '../../api/boltcards/hooks/bolcards.hook';

import RNQRGenerator from 'rn-qr-generator';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import useCameraPermissions from '../../hooks/cameraPermisions.hook';
const createHash = require('create-hash');
const fs = require('../../blue_modules/fs');
const Base43 = require('../../blue_modules/base43');
const bitcoin = require('bitcoinjs-lib');

const styles = StyleSheet.create({
  nfcImage: {
    width: 30,
    height: 30,
  },
  nfcText: {
    color: 'white',
  },
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  closeTouch: {
    width: 40,
    height: 40,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    borderRadius: 20,
    position: 'absolute',
    right: 16,
    top: 44,
  },
  closeImage: {
    alignSelf: 'center',
  },
  imagePickerTouch: {
    width: 40,
    height: 40,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    borderRadius: 20,
    position: 'absolute',
    left: 24,
    bottom: 48,
  },
  nfcTouch: {
    height: 40,
    justifyContent: 'center',
    borderRadius: 20,
    position: 'absolute',
    right: 20,
    bottom: 48,
    flexDirection: 'row',
    alignItems: 'center',
  },
  nfcTouchContent: {
    flexDirection: 'row',
    alignItems: 'center',
    borderColor: 'white',
    borderWidth: 1,
    borderRadius: 50,
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  filePickerTouch: {
    width: 40,
    height: 40,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    borderRadius: 20,
    position: 'absolute',
    left: 96,
    bottom: 48,
  },
  openSettingsContainer: {
    flex: 1,
    justifyContent: 'center',
    alignContent: 'center',
    alignItems: 'center',
  },
  backdoorButton: {
    width: 40,
    height: 40,
    backgroundColor: 'rgba(0,0,0,0.1)',
    position: 'absolute',
  },
  backdoorInputWrapper: { position: 'absolute', left: '5%', top: '0%', width: '90%', height: '70%', backgroundColor: 'white' },
  progressWrapper: { position: 'absolute', alignSelf: 'center', alignItems: 'center', top: '50%', padding: 8, borderRadius: 8 },
  backdoorInput: {
    height: '50%',
    marginTop: 5,
    marginHorizontal: 20,
    borderWidth: 1,
    borderRadius: 4,
    textAlignVertical: 'top',
  },
});

const ScanQRCode = () => {
  const [isLoading, setIsLoading] = useState(false);
  const navigation = useNavigation();
  const route = useRoute();
  const showFileImportButton = route.params.showFileImportButton || false;
  const { launchedBy, onBarScanned, onDismiss, onBarScannerDismissWithoutData = () => {} } = route.params;
  const scannedCacheRef = useRef({});
  const decoderRef = useRef(null);
  const { colors } = useTheme();
  const isFocused = useIsFocused();
  const [urTotal, setUrTotal] = useState(0);
  const [urHave, setUrHave] = useState(0);
  const [animatedQRCodeData, setAnimatedQRCodeData] = useState({});
  const [holdCardModalVisible, setHoldCardModalVisible] = useState(false);
  const { cameraStatus } = useCameraPermissions();
  const { startNfcSession, authCard, readCard, stopNfcSession } = useNtag424({ manualSessionControl: true });
  const { genFreshCardDetails } = useLdsBoltcards();
  const { revalidateBalancesInterval } = useContext(BlueStorageContext);

  const stylesHook = StyleSheet.create({
    openSettingsContainer: {
      backgroundColor: colors.brandingColor,
    },
    progressWrapper: { backgroundColor: colors.brandingColor, borderColor: colors.foregroundColor, borderWidth: 4 },
    backdoorInput: {
      borderColor: colors.formBorder,
      borderBottomColor: colors.formBorder,
      backgroundColor: colors.inputBackgroundColor,
      color: colors.foregroundColor,
    },
  });

  useEffect(() => {
    return () => {
      stopNfcSession();
    };
  }, []);

  useEffect(() => {
    revalidateBalancesInterval();
  }, []);

  const HashIt = function (s) {
    return createHash('sha256').update(s).digest().toString('hex');
  };

  const _onReadUniformResourceV2 = part => {
    if (!decoderRef.current) decoderRef.current = new BlueURDecoder();
    const decoder = decoderRef.current;
    try {
      decoder.receivePart(part);
      if (decoder.isComplete()) {
        const data = decoder.toString();
        decoderRef.current = null;
        scannedCacheRef.current = {};
        if (launchedBy) {
          navigation.navigate(launchedBy, {});
        }
        onBarScanned({ data });
      } else {
        setUrTotal(100);
        setUrHave(Math.floor(decoder.estimatedPercentComplete() * 100));
      }
    } catch (error) {
      console.warn(error);
      setIsLoading(true);
      Alert.alert(
        loc.send.scan_error,
        loc._.invalid_animated_qr_code_fragment,
        [
          {
            text: loc._.ok,
            onPress: () => {
              setIsLoading(false);
            },
            style: 'default',
          },
        ],
        { cancelabe: false },
      );
    }
  };

  /**
   *
   * @deprecated remove when we get rid of URv1 support
   */
  const _onReadUniformResource = ur => {
    try {
      const [index, total] = extractSingleWorkload(ur);
      animatedQRCodeData[index + 'of' + total] = ur;
      setUrTotal(total);
      setUrHave(Object.values(animatedQRCodeData).length);
      if (Object.values(animatedQRCodeData).length === total) {
        const payload = decodeUR(Object.values(animatedQRCodeData));
        // lets look inside that data
        let data = false;
        if (Buffer.from(payload, 'hex').toString().startsWith('psbt')) {
          // its a psbt, and whoever requested it expects it encoded in base64
          data = Buffer.from(payload, 'hex').toString('base64');
        } else {
          // its something else. probably plain text is expected
          data = Buffer.from(payload, 'hex').toString();
        }
        if (launchedBy) {
          navigation.navigate(launchedBy, {});
        }
        onBarScanned({ data });
      } else {
        setAnimatedQRCodeData(animatedQRCodeData);
      }
    } catch (error) {
      console.warn(error);
      setIsLoading(true);
      Alert.alert(
        loc.send.scan_error,
        loc._.invalid_animated_qr_code_fragment,
        [
          {
            text: loc._.ok,
            onPress: () => {
              setIsLoading(false);
            },
            style: 'default',
          },
        ],
        { cancelabe: false },
      );
    }
  };

  const onBarCodeRead = ret => {
    const h = HashIt(ret.data);
    const scannedCache = scannedCacheRef.current;
    if (scannedCache[h]) {
      // this QR was already scanned by this ScanQRCode, lets prevent firing duplicate callbacks
      return;
    }
    scannedCache[h] = +new Date();

    if (ret.data.toUpperCase().startsWith('UR:CRYPTO-ACCOUNT')) {
      return _onReadUniformResourceV2(ret.data);
    }

    if (ret.data.toUpperCase().startsWith('UR:CRYPTO-PSBT')) {
      return _onReadUniformResourceV2(ret.data);
    }

    if (ret.data.toUpperCase().startsWith('UR:CRYPTO-OUTPUT')) {
      return _onReadUniformResourceV2(ret.data);
    }

    if (ret.data.toUpperCase().startsWith('UR:BYTES')) {
      const splitted = ret.data.split('/');
      if (splitted.length === 3 && splitted[1].includes('-')) {
        return _onReadUniformResourceV2(ret.data);
      }
    }

    if (ret.data.toUpperCase().startsWith('UR')) {
      return _onReadUniformResource(ret.data);
    }

    // is it base43? stupid electrum desktop
    try {
      const hex = Base43.decode(ret.data);
      bitcoin.Psbt.fromHex(hex); // if it doesnt throw - all good

      if (launchedBy) {
        navigation.navigate(launchedBy, {});
      }
      onBarScanned({ data: Buffer.from(hex, 'hex').toString('base64') });
      return;
    } catch (_) {}

    if (!isLoading) {
      setIsLoading(true);
      try {
        if (launchedBy) {
          navigation.navigate(launchedBy, {});
        }
        onBarScanned(ret.data);
      } catch (e) {
        console.log(e);
      }
    }
    setIsLoading(false);
  };

  const showFilePicker = async () => {
    setIsLoading(true);
    const { data } = await fs.showFilePickerAndReadFile();
    if (data) onBarCodeRead({ data });
    setIsLoading(false);
  };

  const showImagePicker = () => {
    if (!isLoading) {
      setIsLoading(true);
      launchImageLibrary(
        {
          title: null,
          mediaType: 'photo',
          takePhotoButtonTitle: null,
          maxHeight: 800,
          maxWidth: 600,
          selectionLimit: 1,
        },
        response => {
          if (response.didCancel) {
            setIsLoading(false);
          } else {
            const asset = response.assets[0];
            if (asset.uri) {
              RNQRGenerator.detect({ uri: decodeURI(asset.uri.toString()) })
                .then(result => {
                  if (result) {
                    onBarCodeRead({ data: result.values[0] });
                  }
                })
                .catch(() => {
                  alert(loc.send.qr_error_no_qrcode);
                })
                .finally(() => {
                  setIsLoading(false);
                });
            } else {
              setIsLoading(false);
            }
          }
        },
      );
    }
  };

  const dismiss = () => {
    onBarScannerDismissWithoutData();
    if (launchedBy) {
      navigation.navigate(launchedBy, {});
    } else {
      navigation.goBack();
    }
    if (onDismiss) onDismiss();
  };

  const startNfc = async () => {
    if (Platform.OS === 'android') setHoldCardModalVisible(true);
    try {
      await startNfcSession();

      const card = await readCard();
      const secretsGuess = await genFreshCardDetails();
      const authKeys = await authCard(card, secretsGuess);

      if (launchedBy) {
        navigation.navigate(launchedBy, {});
      }
      onBarScanned({ data: { ...card, secrets: authKeys } });
    } catch (error) {
      setHoldCardModalVisible(false);
      console.log('#### error ###', error, error?.message, error.constructor?.name);
    }
    stopNfcSession();
  };

  const stopNFC = () => {
    stopNfcSession();
    setHoldCardModalVisible(false);
  };

  return isLoading ? (
    <View style={styles.root}>
      <BlueLoading />
    </View>
  ) : (
    <View style={styles.root}>
      <StatusBar hidden />
      {isFocused && cameraStatus && !holdCardModalVisible ? (
        <Camera
          style={styles.root}
          scanBarcode
          scanThrottleDelay={0}
          resizeMode="cover"
          onReadCode={event => onBarCodeRead({ data: event?.nativeEvent?.codeStringValue })}
          showFrame={false}
        />
      ) : null}
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={loc._.close} style={styles.closeTouch} onPress={dismiss}>
        <Image style={styles.closeImage} source={require('../../img/close-white.png')} />
      </TouchableOpacity>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={loc._.pick_image}
        style={styles.imagePickerTouch}
        onPress={showImagePicker}
      >
        <Icon name="image" type="font-awesome" color="#ffffff" />
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={loc._.pick_image} style={styles.nfcTouch} onPress={startNfc}>
        <View style={styles.nfcTouchContent}>
          <Image source={require('../../img/nfc.png')} style={styles.nfcImage} />
          <Text style={styles.nfcText}>NFC</Text>
        </View>
      </TouchableOpacity>
      {showFileImportButton && (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={loc._.pick_file}
          style={styles.filePickerTouch}
          onPress={showFilePicker}
        >
          <Icon name="file-import" type="font-awesome-5" color="#ffffff" />
        </TouchableOpacity>
      )}
      {urTotal > 0 && (
        <View style={[styles.progressWrapper, stylesHook.progressWrapper]} testID="UrProgressBar">
          <BlueText>{loc.wallets.please_continue_scanning}</BlueText>
          <BlueText>
            {urHave} / {urTotal}
          </BlueText>
        </View>
      )}
      <HoldCardModal isHoldCardModalVisible={holdCardModalVisible} onCancelHoldCard={stopNFC} />
    </View>
  );
};

export default ScanQRCode;
