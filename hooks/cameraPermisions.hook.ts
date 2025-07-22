import { useState, useEffect, useContext } from 'react';
import { Alert, Linking, Platform } from 'react-native';
import { check, request, PERMISSIONS, RESULTS } from 'react-native-permissions';
import { BlueStorageContext } from '../blue_modules/storage-context';
import loc from '../loc';

export const isCameraAuthorizationStatusGranted = async () => {
  const status = await check(Platform.OS === 'android' ? PERMISSIONS.ANDROID.CAMERA : PERMISSIONS.IOS.CAMERA);
  return status === RESULTS.GRANTED;
};

export const requestCameraAuthorization = () => {
  return request(Platform.OS === 'android' ? PERMISSIONS.ANDROID.CAMERA : PERMISSIONS.IOS.CAMERA);
};

const useCameraPermissions = () => {
  const { cameraPermissionLastAskedTime, setCameraPermissionLastAskedTimeAsyncStorage } = useContext(BlueStorageContext);
  const [cameraStatus, setCameraStatus] = useState(false);

  const updateCameraPermissionLastAskedTime = () => {
    setCameraPermissionLastAskedTimeAsyncStorage(Date.now());
  };

  const isCameraPermissionLastAskedTimeExpired = () => {
    return Date.now() - cameraPermissionLastAskedTime > 1000 * 60 * 60 * 24 * 7; // 1 week
  };

  useEffect(() => {
    (async () => {
      try {
        const isGranted = await isCameraAuthorizationStatusGranted();
        if (isGranted) {
          setCameraStatus(true);
          return;
        }

        const granted = await requestCameraAuthorization();
        if (granted === RESULTS.GRANTED) {
          setCameraStatus(true);
        } else if (granted === RESULTS.BLOCKED && isCameraPermissionLastAskedTimeExpired()) {
          updateCameraPermissionLastAskedTime();
          Alert.alert(
            loc.send.permission_camera_title,
            loc.send.permission_camera_message,
            [
              {
                text: loc.send.permission_camera_open_settings,
                onPress: () => Linking.openSettings(),
              },
              {
                text: 'Cancel',
                style: 'cancel',
              },
            ],
          );
        } else {
          setCameraStatus(false);
        }
      } catch (err) {
        console.warn(err);
      }
    })();
  }, []);

  return { cameraStatus };
};

export default useCameraPermissions;
