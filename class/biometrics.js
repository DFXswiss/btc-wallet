import ReactNativeBiometrics, { BiometryTypes } from 'react-native-biometrics';
import { Platform, Alert } from 'react-native';
import * as NavigationService from '../NavigationService';
import { StackActions, CommonActions } from '@react-navigation/native';
import RNSecureKeyStore from 'react-native-secure-key-store';
import loc from '../loc';
import { useContext } from 'react';
import { BlueStorageContext } from '../blue_modules/storage-context';
import alert from '../components/Alert';

const rnBiometrics = new ReactNativeBiometrics({ allowDeviceCredentials: true });

const mapBiometryType = type => {
  switch (type) {
    case BiometryTypes.FaceID:
      return Biometric.FaceID;
    case BiometryTypes.TouchID:
      return Biometric.TouchID;
    case BiometryTypes.Biometrics:
      return Biometric.Biometrics;
    default:
      return false;
  }
};

function Biometric() {
  const { getItem, setItem } = useContext(BlueStorageContext);
  Biometric.STORAGEKEY = 'Biometrics';
  Biometric.FaceID = 'Face ID';
  Biometric.TouchID = 'Touch ID';
  Biometric.Biometrics = 'Biometrics';

  Biometric.isDeviceBiometricCapable = async () => {
    try {
      const { available } = await rnBiometrics.isSensorAvailable();
      return available;
    } catch (e) {
      console.error('Biometrics: isDeviceBiometricCapable failed', e);
      Biometric.setBiometricUseEnabled(false);
      return false;
    }
  };

  Biometric.biometricType = async () => {
    try {
      const { available, biometryType } = await rnBiometrics.isSensorAvailable();
      if (!available) return false;
      return mapBiometryType(biometryType);
    } catch (e) {
      console.error('Biometrics: biometricType failed', e);
    }
    return false;
  };

  Biometric.isBiometricUseEnabled = async () => {
    try {
      const enabledBiometrics = await getItem(Biometric.STORAGEKEY);
      return !!enabledBiometrics;
    } catch (_) {}

    return false;
  };

  Biometric.isBiometricUseCapableAndEnabled = async () => {
    const isBiometricUseEnabled = await Biometric.isBiometricUseEnabled();
    const isDeviceBiometricCapable = await Biometric.isDeviceBiometricCapable();
    return isBiometricUseEnabled && isDeviceBiometricCapable;
  };

  Biometric.setBiometricUseEnabled = async value => {
    await setItem(Biometric.STORAGEKEY, value === true ? '1' : '');
  };

  Biometric.unlockWithBiometrics = async () => {
    const isDeviceBiometricCapable = await Biometric.isDeviceBiometricCapable();
    if (!isDeviceBiometricCapable) return false;
    try {
      const { success } = await rnBiometrics.simplePrompt({ promptMessage: loc.settings.biom_conf_identity });
      return !!success;
    } catch (error) {
      console.error('Biometrics: authentication failed', error);
      return false;
    }
  };

  Biometric.clearKeychain = async () => {
    await RNSecureKeyStore.remove('data');
    await RNSecureKeyStore.remove('data_encrypted');
    await RNSecureKeyStore.remove(Biometric.STORAGEKEY);
    NavigationService.dispatch(StackActions.replace('WalletsRoot'));
  };

  Biometric.requestDevicePasscode = async () => {
    const isDeviceBiometricCapable = await Biometric.isDeviceBiometricCapable();
    if (!isDeviceBiometricCapable) {
      alert(loc.settings.biom_no_passcode);
      return;
    }
    const isAuthenticated = await Biometric.unlockWithBiometrics();
    if (!isAuthenticated) return;
    Alert.alert(
      loc.settings.encrypt_tstorage,
      loc.settings.biom_remove_decrypt,
      [
        { text: loc._.cancel, style: 'cancel' },
        {
          text: loc._.ok,
          style: 'destructive',
          onPress: () => Biometric.clearKeychain(),
        },
      ],
      { cancelable: false },
    );
  };

  Biometric.showKeychainWipeAlert = () => {
    if (Platform.OS === 'ios') {
      Alert.alert(
        loc.settings.encrypt_tstorage,
        loc.settings.biom_10times,
        [
          {
            text: loc._.cancel,
            onPress: () => {
              NavigationService.dispatch(
                CommonActions.setParams({
                  index: 0,
                  routes: [{ name: 'UnlockWithScreenRoot' }, { params: { unlockOnComponentMount: false } }],
                }),
              );
            },
            style: 'cancel',
          },
          {
            text: loc._.ok,
            onPress: () => Biometric.requestDevicePasscode(),
            style: 'default',
          },
        ],
        { cancelable: false },
      );
    }
  };
  return null;
}

export default Biometric;
