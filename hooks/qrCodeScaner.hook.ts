import { useRef, useState } from 'react';
import { BlueURDecoder, decodeUR, extractSingleWorkload } from '../blue_modules/ur';
import { Alert } from 'react-native';
import loc from '../loc';

const createHash = require('create-hash');
const Base43 = require('../blue_modules/base43');
const bitcoin = require('bitcoinjs-lib');

const HashIt = function (s: string): string {
  return createHash('sha256').update(s).digest().toString('hex');
};

// The bar-scanned consumer accepts either the wrapped `{ data }` payload or a bare
// string (see `onContentRead` in ScanCodeSend, which reads `data.data ? data.data : data`).
type BarScannedHandler = (data: { data: string } | string) => void;

export function useQrCodeScanner() {
  const [isLoading, setIsLoading] = useState(false);
  const [urTotal, setUrTotal] = useState(0);
  const [urHave, setUrHave] = useState(0);
  const [isLoadingAnimatedQRCode, setIsLoadingAnimatedQRCode] = useState(false);
  const [animatedQRCodeData, setAnimatedQRCodeData] = useState<Record<string, string>>({});
  const [onBarScanned, setOnBarScanned] = useState<BarScannedHandler>(() => () => {});

  const scannedCacheRef = useRef<Record<string, number>>({});
  const decoderRef = useRef<any>(null);

  const _onReadUniformResourceV2 = (part: string) => {
    if (!decoderRef.current) decoderRef.current = new BlueURDecoder();
    const decoder = decoderRef.current;
    try {
      decoder.receivePart(part);
      if (decoder.isComplete()) {
        const data = decoder.toString();
        decoderRef.current = null;
        scannedCacheRef.current = {};
        setUrTotal(0);
        setUrHave(0);
        setIsLoadingAnimatedQRCode(false);
        onBarScanned({ data });
      } else {
        setUrTotal(100);
        setUrHave(Math.floor(decoder.estimatedPercentComplete() * 100));
        setIsLoadingAnimatedQRCode(true);
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
        { cancelable: false },
      );
    }
  };

  /**
   *
   * @deprecated remove when we get rid of URv1 support
   */
  const _onReadUniformResource = (ur: string) => {
    try {
      const [index, total] = extractSingleWorkload(ur);
      animatedQRCodeData[index + 'of' + total] = ur;
      setUrTotal(total);
      setUrHave(Object.values(animatedQRCodeData).length);
      if (Object.values(animatedQRCodeData).length === total) {
        // URv1 fragments decode to a hex string (`origDecodeUr`); narrow accordingly.
        const payload = decodeUR(Object.values(animatedQRCodeData)) as string;
        const data = Buffer.from(payload, 'hex').toString().startsWith('psbt')
          ? Buffer.from(payload, 'hex').toString('base64')
          : Buffer.from(payload, 'hex').toString();
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
        { cancelable: false },
      );
    }
  };

  const cameraCallback = (ret: { data: string }) => {
    const h = HashIt(ret.data);
    const scannedCache = scannedCacheRef.current;
    if (scannedCache[h]) {
      // this QR was already scanned, prevent firing duplicate callbacks
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
      bitcoin.Psbt.fromHex(hex);
      onBarScanned({ data: Buffer.from(hex, 'hex').toString('base64') });
      return;
    } catch (_) {}

    if (!isLoading) {
      setIsLoading(true);
      try {
        onBarScanned(ret.data);
      } catch (e) {
        console.log(e);
      }
    }
    setIsLoading(false);
  };

  const handleOnSetOnBarScanned = (callback: BarScannedHandler) => setOnBarScanned(() => callback);

  return {
    isLoadingAnimatedQRCode,
    isReadingQrCode: isLoading || isLoadingAnimatedQRCode,
    urTotal,
    urHave,
    cameraCallback,
    setOnBarScanned: handleOnSetOnBarScanned,
  };
}
