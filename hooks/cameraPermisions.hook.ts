import { useState, useEffect } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import loc from '../loc';

const useCameraPermissions = () => {
  const [cameraStatus, setCameraStatus] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        if (Platform.OS === 'ios' || Platform.OS === 'macos') {
          setCameraStatus(true);
          return;
        }
        const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA, {
          title: '',
          message: loc.send.permission_camera_message,
          buttonNeutral: loc.send.permission_storage_later,
          buttonNegative: loc._.no,
          buttonPositive: loc._.yes,
        });
        if (granted === PermissionsAndroid.RESULTS.GRANTED) {
          console.log('You can use the camera');
          setCameraStatus(true);
        } else {
          console.log('Camera permission denied');
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
