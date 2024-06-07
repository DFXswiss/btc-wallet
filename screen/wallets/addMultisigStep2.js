import React, { useContext, useRef, useState, useEffect, useMemo } from 'react';
import { FlatList, LayoutAnimation, Platform, StyleSheet, Text, View } from 'react-native';
import { Icon } from 'react-native-elements';
import { useNavigation, useRoute, useTheme } from '@react-navigation/native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';

import { BlueButton } from '../../BlueComponents';
import navigationStyle from '../../components/navigationStyle';
import { MultisigCosigner, MultisigHDWallet } from '../../class';
import loc from '../../loc';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import { BlueURDecoder, encodeUR } from '../../blue_modules/ur';
import QRCodeComponent from '../../components/QRCodeComponent';
import alert from '../../components/Alert';
import { Camera } from 'react-native-camera-kit';
const createHash = require('create-hash');

const prompt = require('../../helpers/prompt');
const A = require('../../blue_modules/analytics');
const staticCache = {};
let decoder = false;

const WalletsAddMultisigStep2 = () => {
  const { wallets, addWallet, saveToDisk, isElectrumDisabled, sleep } = useContext(BlueStorageContext);
  const mainWallet = useMemo(() => wallets[0], [wallets]);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const { m, n, format, walletLabel } = useRoute().params;
  const [cosigners, setCosigners] = useState([]); // array of cosigners user provided. if format [cosigner, fp, path]
  const [isLoading, setIsLoading] = useState(false);
  const [cosignerXpubURv2, setCosignerXpubURv2] = useState(''); // string displayed in renderCosignersXpubModal()
  const scannedCache = {};
  const quorum = useRef(new Array(n));

  useEffect(() => {
    if (cosigners.length === 0) {
      const cosignersCopy = [...cosigners];
      cosignersCopy.push([mainWallet.getSecret(), false, false]);
      setCosigners(cosignersCopy);
      viewKey(cosignersCopy[0]);
    }
  }, []);

  const stylesHook = StyleSheet.create({
    root: {
      flex: 1,
      justifyContent: 'space-between',
      backgroundColor: colors.elevated,
    },
    keyCircle: {
      backgroundColor: colors.msSuccessBG,
    },
    keyCircleUncheck: {
      backgroundColor: colors.buttonDisabledBackgroundColor,
    },
    keyCircleText: { color: colors.alternativeTextColor, fontSize: 18, fontWeight: 'bold' },
  });

  const onCreate = async () => {
    setIsLoading(true);
    await sleep(100);
    try {
      await _onCreate(); // this can fail with "Duplicate fingerprint" error or other
    } catch (e) {
      setIsLoading(false);
      alert(e.message);
      console.log('create MS wallet error', e);
    }
  };

  const _onCreate = async () => {
    const w = new MultisigHDWallet();
    w.setM(m);
    switch (format) {
      case MultisigHDWallet.FORMAT_P2WSH:
        w.setNativeSegwit();
        w.setDerivationPath(MultisigHDWallet.PATH_NATIVE_SEGWIT);
        break;
      case MultisigHDWallet.FORMAT_P2SH_P2WSH:
      case MultisigHDWallet.FORMAT_P2SH_P2WSH_ALT:
        w.setWrappedSegwit();
        w.setDerivationPath(MultisigHDWallet.PATH_WRAPPED_SEGWIT);
        break;
      case MultisigHDWallet.FORMAT_P2SH:
        w.setLegacy();
        w.setDerivationPath(MultisigHDWallet.PATH_LEGACY);
        break;
      default:
        throw new Error('This should never happen');
    }
    for (const cc of cosigners) {
      const fp = cc[1] || getFpCacheForMnemonics(cc[0], cc[3]);
      w.addCosigner(cc[0], fp, cc[2], cc[3]);
    }
    w.setLabel(walletLabel);
    if (!isElectrumDisabled) {
      await w.fetchBalance();
    }

    addWallet(w);
    await saveToDisk();
    A(A.ENUM.CREATED_WALLET);
    ReactNativeHapticFeedback.trigger('notificationSuccess', { ignoreAndroidSystemSettings: false });
    navigation.dangerouslyGetParent().goBack();
  };

  const getPath = () => {
    let path = '';
    switch (format) {
      case MultisigHDWallet.FORMAT_P2WSH:
        path = MultisigHDWallet.PATH_NATIVE_SEGWIT;
        break;
      case MultisigHDWallet.FORMAT_P2SH_P2WSH:
      case MultisigHDWallet.FORMAT_P2SH_P2WSH_ALT:
        path = MultisigHDWallet.PATH_WRAPPED_SEGWIT;
        break;
      case MultisigHDWallet.FORMAT_P2SH:
        path = MultisigHDWallet.PATH_LEGACY;
        break;
      default:
        throw new Error('This should never happen');
    }
    return path;
  };

  const viewKey = cosigner => {
    if (MultisigHDWallet.isXpubValid(cosigner[0])) {
      setCosignerXpubURv2(encodeUR(MultisigCosigner.exportToJson(cosigner[1], cosigner[0], cosigner[2]))[0]);
    } else {
      const path = getPath();
      const xpub = getXpubCacheForMnemonics(cosigner[0]);
      const fp = getFpCacheForMnemonics(cosigner[0], cosigner[3]);
      setCosignerXpubURv2(encodeUR(MultisigCosigner.exportToJson(fp, xpub, path))[0]);
    }
  };

  const getXpubCacheForMnemonics = seed => {
    const path = getPath();
    return staticCache[seed + path] || setXpubCacheForMnemonics(seed);
  };

  const setXpubCacheForMnemonics = seed => {
    const path = getPath();
    const w = new MultisigHDWallet();
    w.setDerivationPath(path);
    staticCache[seed + path] = w.convertXpubToMultisignatureXpub(MultisigHDWallet.seedToXpub(seed, path));
    return staticCache[seed + path];
  };

  const getFpCacheForMnemonics = (seed, passphrase) => {
    return staticCache[seed + (passphrase ?? '')] || setFpCacheForMnemonics(seed, passphrase);
  };

  const setFpCacheForMnemonics = (seed, passphrase) => {
    staticCache[seed + (passphrase ?? '')] = MultisigHDWallet.mnemonicToFingerprint(seed, passphrase);
    return staticCache[seed + (passphrase ?? '')];
  };

  const tryUsingXpub = async xpub => {
    if (!MultisigHDWallet.isXpubForMultisig(xpub)) {
      setIsLoading(false);
      alert(loc.multisig.not_a_multisignature_xpub);
      return;
    }
    let fp;
    try {
      fp = await prompt(loc.multisig.input_fp, loc.multisig.input_fp_explain, true, 'plain-text');
      fp = (fp + '').toUpperCase();
      if (!MultisigHDWallet.isFpValid(fp)) fp = '00000000';
    } catch {
      return setIsLoading(false);
    }
    let path;
    try {
      path = await prompt(
        loc.multisig.input_path,
        loc.formatString(loc.multisig.input_path_explain, { default: getPath() }),
        true,
        'plain-text',
      );
      if (!MultisigHDWallet.isPathValid(path)) path = getPath();
    } catch {
      return setIsLoading(false);
    }

    setIsLoading(false);

    const cosignersCopy = [...cosigners];
    cosignersCopy.push([xpub, fp, path]);
    if (Platform.OS !== 'android') LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setCosigners(cosignersCopy);
  };

  const HashIt = function (s) {
    return createHash('sha256').update(s).digest().toString('hex');
  };

  const _onReadUniformResourceV2 = part => {
    if (!decoder) decoder = new BlueURDecoder();
    try {
      decoder.receivePart(part);
      if (decoder.isComplete()) {
        const data = decoder.toString();
        decoder = false; // nullify for future use (?)
        onBarScanned({ data });
      }
    } catch (error) {}
  };

  const onBarCodeRead = ret => {
    const h = HashIt(ret.data);
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

    try {
      onBarScanned(ret.data);
    } catch (e) {
      console.log(e);
    }
  };

  const onBarScanned = ret => {
    if (!ret.data) ret = { data: ret };

    try {
      let retData = JSON.parse(ret.data);
      if (Array.isArray(retData) && retData.length === 1) {
        // UR:CRYPTO-ACCOUNT now parses as an array of accounts, even if it is just one,
        // so in case of cosigner data its gona be an array of 1 cosigner account. lets pop it for
        // the code that expects it
        retData = retData.pop();
        ret.data = JSON.stringify(retData);
      }
    } catch (_) {}

    if (!new MultisigCosigner(ret.data).isValid()) {
      return alert(loc.multisig.not_a_multisignature_xpub);
    }

    if (ret.data.toUpperCase().startsWith('UR')) {
      alert('BC-UR not decoded. This should never happen');
    } else {
      if (MultisigHDWallet.isXpubValid(ret.data) && !MultisigHDWallet.isXpubForMultisig(ret.data)) {
        return alert(loc.multisig.not_a_multisignature_xpub);
      }
      if (MultisigHDWallet.isXpubValid(ret.data)) {
        return tryUsingXpub(ret.data);
      }

      let cosigner = new MultisigCosigner(ret.data);
      if (!cosigner.isValid()) return alert(loc.multisig.invalid_cosigner);
      if (cosigner.howManyCosignersWeHave() > 1) {
        // lets look for the correct cosigner. thats probably gona be the one with specific corresponding path,
        // for example m/48'/0'/0'/2' if user chose to setup native segwit in BW
        for (const cc of cosigner.getAllCosigners()) {
          switch (format) {
            case MultisigHDWallet.FORMAT_P2WSH:
              if (cc.getPath().startsWith('m/48') && cc.getPath().endsWith("/2'")) {
                // found it
                cosigner = cc;
              }
              break;
            case MultisigHDWallet.FORMAT_P2SH_P2WSH:
            case MultisigHDWallet.FORMAT_P2SH_P2WSH_ALT:
              if (cc.getPath().startsWith('m/48') && cc.getPath().endsWith("/1'")) {
                // found it
                cosigner = cc;
              }
              break;
            case MultisigHDWallet.FORMAT_P2SH:
              if (cc.getPath().startsWith('m/45')) {
                // found it
                cosigner = cc;
              }
              break;
            default:
              throw new Error('This should never happen');
          }
        }
      }

      for (const existingCosigner of cosigners) {
        if (existingCosigner[0] === cosigner.getXpub()) return;
      }

      // now, validating that cosigner is in correct format:

      let correctFormat = false;
      switch (format) {
        case MultisigHDWallet.FORMAT_P2WSH:
          if (cosigner.getPath().startsWith('m/48') && cosigner.getPath().endsWith("/2'")) {
            correctFormat = true;
          }
          break;
        case MultisigHDWallet.FORMAT_P2SH_P2WSH:
        case MultisigHDWallet.FORMAT_P2SH_P2WSH_ALT:
          if (cosigner.getPath().startsWith('m/48') && cosigner.getPath().endsWith("/1'")) {
            correctFormat = true;
          }
          break;
        case MultisigHDWallet.FORMAT_P2SH:
          if (cosigner.getPath().startsWith('m/45')) {
            correctFormat = true;
          }
          break;
        default:
          throw new Error('This should never happen');
      }

      if (!correctFormat) return alert(loc.formatString(loc.multisig.invalid_cosigner_format, { format }));

      const cosignersCopy = [...cosigners];
      cosignersCopy.push([cosigner.getXpub(), cosigner.getFp(), cosigner.getPath()]);
      if (Platform.OS !== 'android') LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      ReactNativeHapticFeedback.trigger('notificationSuccess', { ignoreAndroidSystemSettings: false });
      setCosigners(cosignersCopy);
    }
  };

  const KeyCircleCheck = () => (
    <View style={[styles.keyCircle, stylesHook.keyCircle]}>
      <Icon size={24} name="check" type="ionicons" color={colors.msSuccessCheck} />
    </View>
  );

  const KeyCircleUncheck = ({ text }) => (
    <View style={[styles.keyCircle, stylesHook.keyCircleUncheck]}>
      <Text style={stylesHook.keyCircleText}>{text}</Text>
    </View>
  );

  const _renderKeyItem = el => {
    const isChecked = el.index < cosigners.length;
    return isChecked ? <KeyCircleCheck /> : <KeyCircleUncheck text={el.index + 1} />;
  };

  return (
    <View style={[styles.root, stylesHook.root]}>
      <View>
        <FlatList
          contentContainerStyle={styles.keyCircleContainer}
          data={quorum.current}
          renderItem={_renderKeyItem}
          keyExtractor={(_item, index) => `${index}`}
        />
      </View>
      <View style={[styles.qrContainer]}>
        <QRCodeComponent value={cosignerXpubURv2} size={290} />
      </View>
      <View style={styles.cameraContainer}>
        <Camera scanBarcode onReadCode={event => onBarCodeRead({ data: event?.nativeEvent?.codeStringValue })} style={styles.camera} />
      </View>
      <View style={styles.buttonContainer}>
        <BlueButton isLoading={isLoading} title={loc.multisig.create} onPress={onCreate} disabled={cosigners.length !== n} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  keyCircleContainer: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    marginBottom: 3,
  },
  keyCircle: {
    width: 42,
    height: 42,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraContainer: {
    position: 'relative',
    height: '40%',
  },
  camera: {
    flex: 1,
  },
  qrContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 5,
  },
  buttonContainer: { marginTop: 10, marginHorizontal: 32, marginBottom: 10 },
});

WalletsAddMultisigStep2.navigationOptions = navigationStyle({
  headerTitle: null,
  gestureEnabled: false,
  swipeEnabled: false,
});

export default WalletsAddMultisigStep2;
