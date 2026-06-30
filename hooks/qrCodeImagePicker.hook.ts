import { useState } from 'react';
import { launchImageLibrary, ImageLibraryOptions } from 'react-native-image-picker';
import loc from '../loc';
import RNQRGenerator from 'rn-qr-generator';

const useQrCodeImagePicker = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [onBarCodeRead, setOnBarCodeRead] = useState<(data: { data: string }) => void>(() => () => {});

  const openImagePicker = () => {
    if (!isLoading) {
      setIsLoading(true);
      const options: ImageLibraryOptions = {
        mediaType: 'photo',
        maxHeight: 800,
        maxWidth: 600,
        selectionLimit: 1,
      };
      launchImageLibrary(options, response => {
        if (response.didCancel) {
          setIsLoading(false);
        } else {
          const asset = response.assets?.[0];
          if (asset?.uri) {
            RNQRGenerator.detect({ uri: decodeURI(asset.uri.toString()) })
              .then(result => {
                if (result && result.values && result.values.length > 0) {
                  onBarCodeRead({ data: result.values[0] });
                }
              })
              .catch(error => {
                alert(loc.send.qr_error_no_qrcode);
              })
              .finally(() => {
                setIsLoading(false);
              });
          } else {
            setIsLoading(false);
          }
        }
      });
    }
  };

  const handleOnSetOnBarScanned = (callback: (data: { data: string }) => void) => setOnBarCodeRead(() => callback);

  return {
    isProcessingImage: isLoading,
    openImagePicker,
    setOnBarCodeInImage: handleOnSetOnBarScanned,
  };
};

export default useQrCodeImagePicker;
