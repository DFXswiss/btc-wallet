import { useState } from 'react';
import { launchImageLibrary } from 'react-native-image-picker';
import loc from '../loc';
const LocalQRCode = require('@remobile/react-native-qrcode-local-image');

const useQrCodeImagePicker = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [onBarCodeRead, setOnBarCodeRead] = useState(() => () => {});

  const openImagePicker = () => {
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
              const uri = asset.uri.toString().replace('file://', '');
              LocalQRCode.decode(uri, (error, result) => {
                if (!error) {
                  onBarCodeRead({ data: result });
                  setIsLoading(false);
                } else {
                  alert(loc.send.qr_error_no_qrcode);
                  setIsLoading(false);
                }
              });
            } else {
              setIsLoading(false);
            }
          }
        },
      );
    }
  };

  const handleOnSetOnBarScanned = callback => setOnBarCodeRead(() => callback);

  return {
    isProcessingImage: isLoading,
    openImagePicker,
    setOnBarCodeInImage: handleOnSetOnBarScanned,
  };
};

export default useQrCodeImagePicker;
