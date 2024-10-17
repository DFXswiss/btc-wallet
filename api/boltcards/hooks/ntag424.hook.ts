import { useEffect } from 'react';
import NfcManager, { NfcTech, Ndef } from 'react-native-nfc-manager';
import { BolcardSecrets } from '../../../models/boltcard';
import Ntag424 from '../../../class/Ntag424';
import loc from '../../../loc';
import { Platform } from 'react-native';

interface CardKeys {
  k0: string;
  k1: string;
  k2: string;
  k3: string;
  k4: string;
  lnurlw_base: string;
}

type CardKeysWithUid = CardKeys & {
  uid: string;
  version: number;
};

type KeyVersions = {
  k0Version: string;
  k1Version: string;
  k2Version: string;
  k3Version: string;
  k4Version: string;
};

type CardReadDetails = KeyVersions & {
  uid?: string;
  version: any;
  lnurlw_base: string;
};

interface UseNtag424OptionsInterface {
  manualSessionControl?: boolean; // If true, session will not be stopped after each operation
}
interface UseNtag424Interface {
  startNfcSession: (message?: string) => Promise<NfcTech | null>;
  stopNfcSession: () => void;
  authCard: (cardDetails: CardReadDetails, secrets: BolcardSecrets) => Promise<BolcardSecrets | undefined>;
  getCardUid: () => Promise<string | undefined>;
  readCard: () => Promise<CardReadDetails | undefined>;
  writeCard: (cardDetails: CardKeys) => Promise<CardKeysWithUid>;
  wipeCard: (cardDetails: BolcardSecrets) => Promise<void>;
  updateModalMessageIos: (message: string) => Promise<void>;
}

const defaultOptions: UseNtag424OptionsInterface = {
  manualSessionControl: false,
};

export function useNtag424({ manualSessionControl } = defaultOptions): UseNtag424Interface {
  useEffect(() => {
    Ntag424.setSendAPDUCommand(async (commandBytes: number[]) => {
      const response = Platform.OS == 'ios' ? await NfcManager.sendCommandAPDUIOS(commandBytes) : await NfcManager.transceive(commandBytes);
      let newResponse: any = response;
      if (Platform.OS == 'android') {
        newResponse = {};
        newResponse.response = response.slice(0, -2);
        newResponse.sw1 = response.slice(-2, -1);
        newResponse.sw2 = response.slice(-1);
      }
      return newResponse;
    });

    return () => {
      NfcManager.cancelTechnologyRequest();
    };
  }, []);

  const startNfcSession = (message?: string) =>
    NfcManager.requestTechnology(NfcTech.IsoDep, { alertMessage: message ?? loc.boltcard.alert_message_write_card });

  const stopNfcSession = () => NfcManager.cancelTechnologyRequest();

  const tryStartNfcSession = async () => {
    if (manualSessionControl) return; // only start manually calling startNfcSession
    await startNfcSession();
  };

  const tryStopNfcSession = () => {
    if (manualSessionControl) return; // only stop manually calling stopNfcSession
    stopNfcSession();
  };

  const getCardUid = async (): Promise<string | undefined> => {
    try {
      await tryStartNfcSession();
      const tag = await NfcManager.getTag();
      if (!tag) return;
      return tag.id;
    } catch (error) {
      throw error;
    } finally {
      tryStopNfcSession();
    }
  };

  const readCard = async (): Promise<CardReadDetails | undefined> => {
    try {
      await tryStartNfcSession();
      const tag = await NfcManager.getTag();
      if (!tag) return;

      let ndefMessage = '';
      try {
        ndefMessage = Ndef.uri.decodePayload(tag.ndefMessage?.[0]?.payload);
      } catch (_) {}

      await Ntag424.isoSelectFileApplication();

      const uid = tag.id;
      const cardVersion = await Ntag424.getVersion();
      const key0Version = await Ntag424.getKeyVersion('00');
      const key1Version = await Ntag424.getKeyVersion('01');
      const key2Version = await Ntag424.getKeyVersion('02');
      const key3Version = await Ntag424.getKeyVersion('03');
      const key4Version = await Ntag424.getKeyVersion('04');

      return {
        uid,
        version: cardVersion,
        lnurlw_base: ndefMessage,
        k0Version: key0Version,
        k1Version: key1Version,
        k2Version: key2Version,
        k3Version: key3Version,
        k4Version: key4Version,
      };
    } catch (error) {
      throw error;
    } finally {
      tryStopNfcSession();
    }
  };

  const authCard = async (cardDetails: CardReadDetails, secrets: BolcardSecrets): Promise<BolcardSecrets | undefined> => {
    try {
      await tryStartNfcSession();

      const defaultKey = '00000000000000000000000000000000';
      const k0guess = cardDetails.k0Version === '01' ? secrets.k0 : defaultKey;
      const k1guess = cardDetails.k1Version === '01' ? secrets.k1 : defaultKey;
      const k2guess = cardDetails.k2Version === '01' ? secrets.k2 : defaultKey;
      const k3guess = cardDetails.k3Version === '01' ? secrets.k3 : defaultKey;
      const k4guess = cardDetails.k4Version === '01' ? secrets.k4 : defaultKey;

      const k0 = await Ntag424.AuthEv2First('00', k0guess).then(() => k0guess);
      const k1 = await Ntag424.AuthEv2First('01', k1guess).then(() => k1guess);
      const k2 = await Ntag424.AuthEv2First('02', k2guess).then(() => k2guess);
      const k3 = await Ntag424.AuthEv2First('03', k3guess).then(() => k3guess);
      const k4 = await Ntag424.AuthEv2First('04', k4guess).then(() => k4guess);

      return {
        ...secrets,
        ...{ k0, k1, k2, k3, k4 },
      };
    } catch (error: any) {
      if (error.code === '91ae') return;
      throw error;
    } finally {
      tryStopNfcSession();
    }
  };

  const writeCard = async (cardDetails: CardKeys): Promise<CardKeysWithUid> => {
    try {
      await tryStartNfcSession();

      const ndefMessage = `${cardDetails.lnurlw_base}?p=00000000000000000000000000000000&c=0000000000000000`;
      const message = [Ndef.uriRecord(ndefMessage)];
      const bytes = Ndef.encodeMessage(message);
      await Ntag424.setNdefMessage(bytes);

      const key0 = '00000000000000000000000000000000';
      await Ntag424.AuthEv2First('00', key0);

      const piccOffset = ndefMessage.indexOf('p=') + 9;
      const macOffset = ndefMessage.indexOf('c=') + 9;
      await Ntag424.setBoltCardFileSettings(piccOffset, macOffset);
      await Ntag424.changeKey('01', key0, cardDetails.k1, '01');
      await Ntag424.changeKey('02', key0, cardDetails.k2, '01');
      await Ntag424.changeKey('03', key0, cardDetails.k3, '01');
      await Ntag424.changeKey('04', key0, cardDetails.k4, '01');
      await Ntag424.changeKey('00', key0, cardDetails.k0, '01');

      const ndef = await Ntag424.readData('060000');
      const setNdefMessage = Ndef.uri.decodePayload(ndef);
      const httpsLNURL = setNdefMessage.replace('lnurlw://', 'https://');
      fetch(httpsLNURL)
        .then(r => r.json())
        .then(() => console.log('Boltcard server request success'));

      await Ntag424.AuthEv2First('00', cardDetails.k0);

      const params: any = {};
      setNdefMessage.replace(/[?&]+([^=&]+)=([^&]*)/gi, function (m, key, value) {
        params[key] = value;
      });
      if (!params['p'] || !params['c']) throw new Error('Invalid lnurlw data');

      const uid = await Ntag424.getCardUid();
      const pVal = params['p'];
      const cVal = params['c'].slice(0, 16);
      const { pTest, cTest } = await Ntag424.testPAndC(pVal, cVal, uid, cardDetails.k1, cardDetails.k2);
      if (!pTest || !cTest) throw new Error(`Test failed for p: ${pTest} and c: ${cTest}`);
      tryStopNfcSession();

      return { ...cardDetails, uid, version: 1 };
    } catch (error: any) {
      tryStopNfcSession();
      throw error;
    }
  };

  const wipeCard = async (cardDetails: BolcardSecrets) => {
    try {
      await tryStartNfcSession();
      const defaultKey = '00000000000000000000000000000000';
      await Ntag424.AuthEv2First('00', cardDetails.k0);
      await Ntag424.resetFileSettings();
      await Ntag424.changeKey('01', cardDetails.k1, defaultKey, '00');
      await Ntag424.changeKey('02', cardDetails.k2, defaultKey, '00');
      await Ntag424.changeKey('03', cardDetails.k3, defaultKey, '00');
      await Ntag424.changeKey('04', cardDetails.k4, defaultKey, '00');
      await Ntag424.changeKey('00', cardDetails.k0, defaultKey, '00');
      const message = [Ndef.uriRecord('')];
      const bytes = Ndef.encodeMessage(message);
      await Ntag424.setNdefMessage(bytes);
    } catch (error: any) {
      tryStopNfcSession();
      throw error;
    } finally {
      tryStopNfcSession();
    }
  };

  const updateModalMessageIos = async (message: string) => NfcManager.setAlertMessageIOS(message);

  return { startNfcSession, updateModalMessageIos, stopNfcSession, authCard, getCardUid, readCard, writeCard, wipeCard };
}
