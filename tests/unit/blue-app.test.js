import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import RNSecureKeyStore, { ACCESSIBLE } from 'react-native-secure-key-store';
import * as Keychain from 'react-native-keychain';
import loc from '../../loc';
import {
  HDLegacyBreadwalletWallet,
  HDSegwitP2SHWallet,
  HDLegacyP2PKHWallet,
  WatchOnlyWallet,
  LegacyWallet,
  SegwitP2SHWallet,
  SegwitBech32Wallet,
  HDSegwitBech32Wallet,
  LightningCustodianWallet,
  HDLegacyElectrumSeedP2PKHWallet,
  HDSegwitElectrumSeedP2WPKHWallet,
  HDAezeedWallet,
  MultisigHDWallet,
  SLIP39SegwitP2SHWallet,
  SLIP39LegacyP2PKHWallet,
  SLIP39SegwitBech32Wallet,
} from '../../class';
import { LightningLdsWallet } from '../../class/wallets/lightning-lds-wallet';
import { TaprootLdsWallet } from '../../class/wallets/taproot-lds-wallet';
import { SparkWallet } from '../../class/wallets/spark-wallet';

jest.mock('../../blue_modules/BlueElectrum', () => ({ connectMain: jest.fn() }));
jest.mock('../../helpers/prompt', () => jest.fn());
jest.mock('react-native-secure-key-store', () => {
  const mem = {};
  const api = {
    get: jest.fn(async key => {
      if (!Object.prototype.hasOwnProperty.call(mem, key)) throw new Error('not found');
      return mem[key];
    }),
    set: jest.fn(async (key, value) => {
      mem[key] = value;
    }),
    remove: jest.fn(async key => {
      delete mem[key];
    }),
  };
  return {
    __esModule: true,
    default: api,
    ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
  };
});

const prompt = require('../../helpers/prompt');

const BlueApp = require('../../BlueApp');
const AppStorage = BlueApp.AppStorage;
const encryption = require('../../blue_modules/encryption');
const Realm = require('realm');
const BiometricModule = require('../../class/biometrics');
const Biometric = BiometricModule.default || BiometricModule;

Realm.UpdateMode = { Modified: 'modified' };
Realm.deleteFile = jest.fn();

const originalNavigator = global.navigator;
const originalPlatformOS = Platform.OS;

function makeRealm({ txs = [], keyValues = {} } = {}) {
  const created = [];
  return {
    close: jest.fn(),
    write: jest.fn(fn => fn()),
    create: jest.fn((name, obj, mode) => {
      created.push({ name, obj, mode });
      return obj;
    }),
    delete: jest.fn(),
    objectForPrimaryKey: jest.fn((cls, key) => {
      if (keyValues[key] == null) return undefined;
      return { value: keyValues[key] };
    }),
    objects: jest.fn(() => ({
      filtered: jest.fn(() => txs),
    })),
    created,
  };
}

const fromJsonBackup = [];

function installFromJson(WalletClass, ...results) {
  fromJsonBackup.push([WalletClass, WalletClass.fromJson]);
  const fn = jest.fn();
  if (results.length === 1) {
    fn.mockReturnValue(results[0]);
  } else {
    results.forEach(result => fn.mockReturnValueOnce(result));
  }
  WalletClass.fromJson = fn;
  return fn;
}

function restoreFromJson() {
  while (fromJsonBackup.length) {
    const [WalletClass, original] = fromJsonBackup.pop();
    WalletClass.fromJson = original;
  }
}

function stubWallet(type, extra = {}) {
  return {
    type,
    id: extra.id,
    secret: extra.secret || `secret-${type}`,
    current: extra.current,
    baseURI: extra.baseURI,
    _hdWalletInstance: extra._hdWalletInstance,
    _txs_by_external_index: extra._txs_by_external_index,
    _txs_by_internal_index: extra._txs_by_internal_index,
    _bip47_instance: extra._bip47_instance,
    getID: () => extra.id || type,
    init: jest.fn(),
    isHd: () => !!extra.isHd,
    isXpubValid: () => !!extra.isXpubValid,
    setBaseURI: jest.fn(function setBaseURI(uri) {
      this.baseURI = uri;
    }),
    prepareForSerialization: jest.fn(),
    fetchBalance: extra.fetchBalance || jest.fn().mockResolvedValue(undefined),
    fetchTransactions: extra.fetchTransactions || jest.fn().mockResolvedValue(undefined),
    getTransactions: extra.getTransactions || (() => []),
    getBalance: extra.getBalance || (() => 0),
    getPreferredBalanceUnit: extra.getPreferredBalanceUnit || (() => 'BTC'),
    getHideTransactionsInWalletsList: extra.getHideTransactionsInWalletsList || (() => false),
    allowBIP47: extra.allowBIP47 || (() => false),
    isBIP47Enabled: extra.isBIP47Enabled || (() => false),
    fetchBIP47SenderPaymentCodes: extra.fetchBIP47SenderPaymentCodes || jest.fn().mockResolvedValue(undefined),
    fetchPendingTransactions: extra.fetchPendingTransactions,
    fetchUserInvoices: extra.fetchUserInvoices,
  };
}

async function withNavigatorProduct(product, fn) {
  Object.defineProperty(global, 'navigator', {
    configurable: true,
    writable: true,
    value: product === undefined ? undefined : { product },
  });
  try {
    return await fn();
  } finally {
    Object.defineProperty(global, 'navigator', {
      configurable: true,
      writable: true,
      value: originalNavigator,
    });
  }
}

async function resetUnlockAttempts() {
  jest.spyOn(BlueApp, 'getWallets').mockReturnValue([]);
  jest.spyOn(BlueApp, 'migrateKeys').mockResolvedValue(undefined);
  jest.spyOn(BlueApp, 'storageIsEncrypted').mockResolvedValue(false);
  jest.spyOn(BlueApp, 'loadFromDisk').mockResolvedValue(false);
  await BlueApp.startAndDecrypt();
}

afterEach(() => {
  jest.useRealTimers();
  restoreFromJson();
  jest.restoreAllMocks();
  prompt.mockReset();
  Platform.OS = originalPlatformOS;
  Object.defineProperty(global, 'navigator', {
    configurable: true,
    writable: true,
    value: originalNavigator,
  });
  BlueApp.wallets = [];
  BlueApp.tx_metadata = {};
  BlueApp.cachedPassword = false;
});

describe('AppStorage.setItem, getItem and migrateKeys', () => {
  it('writes and reads through the secure key store when navigator.product is ReactNative', async () => {
    await withNavigatorProduct('ReactNative', async () => {
      const storage = new AppStorage();
      RNSecureKeyStore.set.mockClear();
      RNSecureKeyStore.get.mockClear();
      RNSecureKeyStore.set.mockResolvedValueOnce('ok');
      RNSecureKeyStore.get.mockResolvedValueOnce('stored');

      await expect(storage.setItem('k', 'v')).resolves.toBe('ok');
      expect(RNSecureKeyStore.set).toHaveBeenCalledWith('k', 'v', { accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
      await expect(storage.getItem('k')).resolves.toBe('stored');
      expect(RNSecureKeyStore.get).toHaveBeenCalledWith('k');
    });
  });

  it('writes and reads through AsyncStorage when navigator.product is not ReactNative', async () => {
    await withNavigatorProduct('Gecko', async () => {
      const storage = new AppStorage();
      const setSpy = jest.spyOn(AsyncStorage, 'setItem').mockResolvedValueOnce(undefined);
      const getSpy = jest.spyOn(AsyncStorage, 'getItem').mockResolvedValueOnce('from-async');
      RNSecureKeyStore.set.mockClear();
      RNSecureKeyStore.get.mockClear();

      await storage.setItem('async-k', 'async-v');
      expect(setSpy).toHaveBeenCalledWith('async-k', 'async-v');
      expect(RNSecureKeyStore.set).not.toHaveBeenCalled();
      await expect(storage.getItem('async-k')).resolves.toBe('from-async');
      expect(getSpy).toHaveBeenCalledWith('async-k');
      expect(RNSecureKeyStore.get).not.toHaveBeenCalled();
    });
  });

  it('does not touch the secure key store when navigator is missing', async () => {
    await withNavigatorProduct(undefined, async () => {
      const storage = new AppStorage();
      RNSecureKeyStore.get.mockClear();
      await storage.migrateKeys();
      expect(RNSecureKeyStore.get).not.toHaveBeenCalled();
    });
  });

  it('copies a present secure-store key into AsyncStorage and removes it from the key store', async () => {
    await withNavigatorProduct('ReactNative', async () => {
      RNSecureKeyStore.get.mockReset();
      RNSecureKeyStore.remove.mockReset();
      RNSecureKeyStore.get.mockImplementation(async key => {
        if (key === AppStorage.HANDOFF_STORAGE_KEY) return 'handoff-on';
        throw new Error('not found');
      });
      RNSecureKeyStore.remove.mockResolvedValue(undefined);
      AsyncStorage.setItem.mockClear();
      AsyncStorage.setItem.mockResolvedValue(undefined);

      await new AppStorage().migrateKeys();

      expect(AsyncStorage.setItem).toHaveBeenCalledWith(AppStorage.HANDOFF_STORAGE_KEY, 'handoff-on');
      expect(RNSecureKeyStore.remove).toHaveBeenCalledWith(AppStorage.HANDOFF_STORAGE_KEY);
    });
  });

  it('does not copy an empty secure-store value into AsyncStorage', async () => {
    await withNavigatorProduct('ReactNative', async () => {
      RNSecureKeyStore.get.mockReset();
      RNSecureKeyStore.remove.mockReset();
      RNSecureKeyStore.get.mockResolvedValue('');
      AsyncStorage.setItem.mockClear();

      await new AppStorage().migrateKeys();

      expect(RNSecureKeyStore.get).toHaveBeenCalledTimes(3);
      expect(AsyncStorage.setItem).not.toHaveBeenCalled();
      expect(RNSecureKeyStore.remove).not.toHaveBeenCalled();
    });
  });

  it('swallows a missing secure-store key and continues migrating the remaining keys', async () => {
    await withNavigatorProduct('ReactNative', async () => {
      RNSecureKeyStore.get.mockReset();
      RNSecureKeyStore.remove.mockReset();
      RNSecureKeyStore.get
        .mockRejectedValueOnce(new Error('not found'))
        .mockResolvedValueOnce('dnt')
        .mockResolvedValueOnce('');
      RNSecureKeyStore.remove.mockResolvedValue(undefined);
      AsyncStorage.setItem.mockClear();
      AsyncStorage.setItem.mockResolvedValue(undefined);

      await new AppStorage().migrateKeys();

      expect(RNSecureKeyStore.get).toHaveBeenCalledTimes(3);
      expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(AppStorage.DO_NOT_TRACK, 'dnt');
      expect(RNSecureKeyStore.remove).toHaveBeenCalledWith(AppStorage.DO_NOT_TRACK);
    });
  });
});

describe('AppStorage.getItemWithFallbackToRealm, storageIsEncrypted, isPasswordInUse and decryptData', () => {
  it('returns the keychain value when getItem succeeds', async () => {
    const storage = new AppStorage();
    jest.spyOn(storage, 'getItem').mockResolvedValueOnce('from-keychain');
    jest.spyOn(storage, 'openRealmKeyValue');
    await expect(storage.getItemWithFallbackToRealm('data')).resolves.toBe('from-keychain');
    expect(storage.openRealmKeyValue).not.toHaveBeenCalled();
  });

  it('returns the realm value when the keychain read fails and realm has the key', async () => {
    const storage = new AppStorage();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(storage, 'getItem').mockRejectedValueOnce(new Error('keychain down'));
    const realm = makeRealm({ keyValues: { data: 'from-realm' } });
    jest.spyOn(storage, 'openRealmKeyValue').mockResolvedValueOnce(realm);

    await expect(storage.getItemWithFallbackToRealm('data')).resolves.toBe('from-realm');
    expect(realm.close).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('getItemWithFallbackToRealm: recovered 10 bytes from realm for "data"');
  });

  it('returns null when the keychain read fails and realm has no value for the key', async () => {
    const storage = new AppStorage();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(storage, 'getItem').mockRejectedValueOnce(new Error('keychain down'));
    const realm = makeRealm({ keyValues: {} });
    jest.spyOn(storage, 'openRealmKeyValue').mockResolvedValueOnce(realm);

    await expect(storage.getItemWithFallbackToRealm('missing')).resolves.toBeNull();
    expect(realm.close).toHaveBeenCalled();
  });

  it('returns null when realm has the key but an empty value', async () => {
    const storage = new AppStorage();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(storage, 'getItem').mockRejectedValueOnce(new Error('keychain down'));
    const realm = makeRealm({ keyValues: { data: '' } });
    jest.spyOn(storage, 'openRealmKeyValue').mockResolvedValueOnce(realm);

    await expect(storage.getItemWithFallbackToRealm('data')).resolves.toBeNull();
    expect(realm.close).toHaveBeenCalled();
  });

  it('reports storage as encrypted only when the encrypted flag is present', async () => {
    const storage = new AppStorage();
    jest.spyOn(storage, 'getItemWithFallbackToRealm').mockResolvedValueOnce('1');
    await expect(storage.storageIsEncrypted()).resolves.toBe(true);
    storage.getItemWithFallbackToRealm.mockResolvedValueOnce(null);
    await expect(storage.storageIsEncrypted()).resolves.toBe(false);
  });

  it('treats storage as not encrypted when reading the flag throws', async () => {
    const storage = new AppStorage();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const readError = new Error('unavailable');
    jest.spyOn(storage, 'getItemWithFallbackToRealm').mockRejectedValueOnce(readError);
    await expect(storage.storageIsEncrypted()).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(`storageIsEncrypted: failed to read "${AppStorage.FLAG_ENCRYPTED}", assuming not encrypted`, readError);
  });

  it('isPasswordInUse is true only for a password that decrypts a bucket, and false when the read throws', async () => {
    const storage = new AppStorage();
    const payload = JSON.stringify({ wallets: [], tx_metadata: {} });
    const bucket = encryption.encrypt(payload, 'right-password');
    jest.spyOn(storage, 'getItem').mockResolvedValue(JSON.stringify([bucket]));
    await expect(storage.isPasswordInUse('right-password')).resolves.toBe(true);
    await expect(storage.isPasswordInUse('wrong-password')).resolves.toBe(false);
    storage.getItem.mockRejectedValueOnce(new Error('no data'));
    await expect(storage.isPasswordInUse('right-password')).resolves.toBe(false);
  });

  it('decryptData returns false when no bucket decrypts', () => {
    const storage = new AppStorage();
    const bucket = encryption.encrypt(JSON.stringify({ wallets: [], tx_metadata: {} }), 'right-password');
    expect(storage.decryptData(JSON.stringify([bucket]), 'wrong-password')).toBe(false);
  });
});

describe('AppStorage.decryptStorage', () => {
  it('throws when the password does not match the cached password', async () => {
    const storage = new AppStorage();
    storage.cachedPassword = 'cached';
    await expect(storage.decryptStorage('other')).rejects.toThrow('Incorrect password. Please, try again.');
  });
});

describe('AppStorage realm helpers', () => {
  it('opens the wallet-transactions realm with a path derived from the default password, and a different path when a password is cached', async () => {
    const storage = new AppStorage();
    Realm.open.mockClear();
    storage.cachedPassword = false;
    await storage.getRealm();
    expect(Realm.open).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringMatching(/-wallettransactions\.realm$/),
        encryptionKey: expect.any(Int8Array),
        schema: [
          expect.objectContaining({
            name: 'WalletTransactions',
          }),
        ],
      }),
    );
    const defaultPath = Realm.open.mock.calls[0][0].path;

    Realm.open.mockClear();
    storage.cachedPassword = 'user-password';
    await storage.getRealm();
    const cachedPath = Realm.open.mock.calls[0][0].path;
    expect(cachedPath).not.toBe(defaultPath);
    expect(cachedPath).toMatch(/-wallettransactions\.realm$/);
  });

  it('reuses the keychain realm encryption key when one is already stored', async () => {
    const storage = new AppStorage();
    Keychain.getGenericPassword.mockResolvedValueOnce({ password: 'ab'.repeat(64) });
    Keychain.setGenericPassword.mockClear();
    Realm.open.mockClear();
    await storage.openRealmKeyValue();
    expect(Keychain.getGenericPassword).toHaveBeenCalledWith({ service: 'realm_encryption_key' });
    expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
    expect(Realm.open).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'keyvalue.realm',
        encryptionKey: expect.any(Int8Array),
        schema: [expect.objectContaining({ name: 'KeyValue', primaryKey: 'key' })],
      }),
    );
  });

  it('creates and stores a new realm encryption key when the keychain has none', async () => {
    const storage = new AppStorage();
    Keychain.getGenericPassword.mockResolvedValueOnce(undefined);
    Keychain.setGenericPassword.mockClear();
    await storage.openRealmKeyValue();
    expect(Keychain.setGenericPassword).toHaveBeenCalledWith('realm_encryption_key', expect.stringMatching(/^[0-9a-f]{128}$/), {
      service: 'realm_encryption_key',
    });
  });

  it('writes a KeyValue row in UpdateMode.Modified', () => {
    const storage = new AppStorage();
    const realm = makeRealm();
    storage.saveToRealmKeyValue(realm, 'flag', '1');
    expect(realm.write).toHaveBeenCalled();
    expect(realm.create).toHaveBeenCalledWith('KeyValue', { key: 'flag', value: '1' }, Realm.UpdateMode.Modified);
  });

  it('deletes the keyvalue.realm file', () => {
    const storage = new AppStorage();
    Realm.deleteFile.mockClear();
    storage.purgeRealmKeyValueFile();
    expect(Realm.deleteFile).toHaveBeenCalledWith({ path: 'keyvalue.realm' });
  });
});

describe('AppStorage.loadFromDisk', () => {
  async function loadWalletJsons(storage, walletObjs, extras = {}) {
    jest.spyOn(storage, 'getItemWithFallbackToRealm').mockResolvedValue(
      JSON.stringify({
        wallets: walletObjs.map(obj => JSON.stringify(obj)),
        tx_metadata: extras.tx_metadata || {},
      }),
    );
    const realm = extras.realm || makeRealm();
    jest.spyOn(storage, 'getRealm').mockResolvedValue(realm);
    const ok = await storage.loadFromDisk();
    return { ok, realm };
  }

  it('returns false when there is no persisted data', async () => {
    const storage = new AppStorage();
    jest.spyOn(storage, 'getItemWithFallbackToRealm').mockResolvedValueOnce(null);
    await expect(storage.loadFromDisk()).resolves.toBe(false);
    expect(storage.wallets).toEqual([]);
  });

  it('returns false when the persisted payload has no wallets array', async () => {
    const storage = new AppStorage();
    jest.spyOn(storage, 'getItemWithFallbackToRealm').mockResolvedValueOnce(JSON.stringify({ tx_metadata: {} }));
    jest.spyOn(storage, 'getRealm').mockResolvedValueOnce(makeRealm());
    await expect(storage.loadFromDisk()).resolves.toBe(false);
  });

  it('caches the password when decryption succeeds', async () => {
    const storage = new AppStorage();
    const wallet = stubWallet(LegacyWallet.type, { id: 'legacy-1' });
    installFromJson(LegacyWallet, wallet);
    const payload = JSON.stringify({
      wallets: [JSON.stringify({ type: LegacyWallet.type })],
      tx_metadata: { tx1: { memo: 'hi' } },
    });
    const bucket = encryption.encrypt(payload, 'good-password');
    jest.spyOn(storage, 'getItemWithFallbackToRealm').mockResolvedValueOnce(JSON.stringify([bucket]));
    jest.spyOn(storage, 'getRealm').mockResolvedValueOnce(makeRealm());

    await expect(storage.loadFromDisk('good-password')).resolves.toBe(true);
    expect(storage.cachedPassword).toBe('good-password');
    expect(storage.wallets).toHaveLength(1);
    expect(storage.tx_metadata).toEqual({ tx1: { memo: 'hi' } });
  });

  it('returns false when the password does not decrypt any bucket', async () => {
    const storage = new AppStorage();
    const bucket = encryption.encrypt(JSON.stringify({ wallets: [], tx_metadata: {} }), 'good-password');
    jest.spyOn(storage, 'getItemWithFallbackToRealm').mockResolvedValueOnce(JSON.stringify([bucket]));
    await expect(storage.loadFromDisk('bad-password')).resolves.toBe(false);
    expect(storage.wallets).toEqual([]);
  });

  it('skips an HD watch-only wallet whose xpub is invalid and keeps a non-HD watch-only wallet', async () => {
    const storage = new AppStorage();
    const watchPlain = stubWallet(WatchOnlyWallet.type, { id: 'watch-plain', isHd: false });
    const watchBad = stubWallet(WatchOnlyWallet.type, { id: 'watch-bad-xpub', isHd: true, isXpubValid: false });
    const watchGood = stubWallet(WatchOnlyWallet.type, { id: 'watch-good-xpub', isHd: true, isXpubValid: true });
    installFromJson(WatchOnlyWallet, watchPlain, watchBad, watchGood);

    const { ok } = await loadWalletJsons(storage, [
      { type: WatchOnlyWallet.type },
      { type: WatchOnlyWallet.type },
      { type: WatchOnlyWallet.type },
    ]);

    expect(ok).toBe(true);
    expect(storage.wallets.map(wallet => wallet.getID())).toEqual(['watch-plain', 'watch-good-xpub']);
    expect(watchPlain.init).toHaveBeenCalled();
    expect(watchBad.init).toHaveBeenCalled();
    expect(watchGood.init).toHaveBeenCalled();
  });

  it('splits an aezeed secret at the first colon into mnemonic and passphrase', async () => {
    const storage = new AppStorage();
    const withColon = stubWallet(HDAezeedWallet.type, { id: 'aezeed-colon', secret: 'abandon:passphrase' });
    const withoutColon = stubWallet(HDAezeedWallet.type, { id: 'aezeed-plain', secret: 'abandon-only' });
    installFromJson(HDAezeedWallet, withColon, withoutColon);

    const { ok } = await loadWalletJsons(storage, [{ type: HDAezeedWallet.type }, { type: HDAezeedWallet.type }]);

    expect(ok).toBe(true);
    expect(withColon.secret).toBe('abandon');
    expect(withColon.passphrase).toBe('passphrase');
    expect(withoutColon.secret).toBe('abandon-only');
    expect(storage.wallets.map(wallet => wallet.getID())).toEqual(['aezeed-colon', 'aezeed-plain']);
  });

  it('deserializes each lightning family, applying baseURI, the LNDHub fallback, and neither', async () => {
    const storage = new AppStorage();
    const lndBase = stubWallet(LightningCustodianWallet.type, { id: 'lnd-base', baseURI: 'https://lndhub.example' });
    const ldsHub = stubWallet(LightningLdsWallet.type, { id: 'lds-hub' });
    const taproot = stubWallet(TaprootLdsWallet.type, { id: 'taproot' });
    installFromJson(LightningCustodianWallet, lndBase);
    installFromJson(LightningLdsWallet, ldsHub);
    installFromJson(TaprootLdsWallet, taproot);

    const lndhubError = new Error('lndhub missing');
    let lndhubReads = 0;
    jest.spyOn(AsyncStorage, 'getItem').mockImplementation(async key => {
      if (key !== AppStorage.LNDHUB) return null;
      lndhubReads += 1;
      if (lndhubReads === 1) throw lndhubError;
      if (lndhubReads === 2) return 'https://fallback-lndhub.example';
      return null;
    });
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { ok } = await loadWalletJsons(storage, [
      { type: LightningCustodianWallet.type },
      { type: LightningLdsWallet.type },
      { type: TaprootLdsWallet.type },
    ]);

    expect(ok).toBe(true);
    expect(storage.wallets.map(wallet => wallet.getID())).toEqual(['lnd-base', 'lds-hub', 'taproot']);
    expect(lndBase.setBaseURI).toHaveBeenCalledWith('https://lndhub.example');
    expect(ldsHub.setBaseURI).toHaveBeenCalledWith('https://fallback-lndhub.example');
    expect(taproot.setBaseURI).not.toHaveBeenCalled();
    expect(lndBase.init).toHaveBeenCalled();
    expect(ldsHub.init).toHaveBeenCalled();
    expect(taproot.init).toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith('loadFromDisk: failed to read LNDHub URI from storage', lndhubError);
    expect(AsyncStorage.getItem).toHaveBeenCalledWith(AppStorage.LNDHUB);
  });

  it('does not append a second wallet that shares an ID with one already loaded', async () => {
    const storage = new AppStorage();
    const first = stubWallet(SegwitBech32Wallet.type, { id: 'dup' });
    installFromJson(SegwitBech32Wallet, first);

    const { ok } = await loadWalletJsons(storage, [{ type: SegwitBech32Wallet.type }, { type: SegwitBech32Wallet.type }]);

    expect(ok).toBe(true);
    expect(storage.wallets).toEqual([first]);
    expect(SegwitBech32Wallet.fromJson).toHaveBeenCalledTimes(2);
  });

  it('loads each on-chain, slip39 and spark type, and uses LegacyWallet for an unknown type', async () => {
    const storage = new AppStorage();
    const classes = [
      SegwitBech32Wallet,
      SegwitP2SHWallet,
      HDLegacyP2PKHWallet,
      HDSegwitP2SHWallet,
      HDSegwitBech32Wallet,
      HDLegacyBreadwalletWallet,
      HDLegacyElectrumSeedP2PKHWallet,
      HDSegwitElectrumSeedP2WPKHWallet,
      MultisigHDWallet,
      SLIP39SegwitP2SHWallet,
      SLIP39LegacyP2PKHWallet,
      SLIP39SegwitBech32Wallet,
      SparkWallet,
    ];
    const stubs = classes.map(WalletClass => {
      const wallet = stubWallet(WalletClass.type, { id: WalletClass.type });
      installFromJson(WalletClass, wallet);
      return wallet;
    });
    const legacy = stubWallet(LegacyWallet.type, { id: 'legacy' });
    const unknown = stubWallet(LegacyWallet.type, { id: 'unknown-default' });
    installFromJson(LegacyWallet, legacy, unknown);

    const { ok, realm } = await loadWalletJsons(storage, [
      ...classes.map(WalletClass => ({ type: WalletClass.type })),
      { type: LegacyWallet.type },
      { type: 'not-a-known-wallet' },
    ]);

    expect(ok).toBe(true);
    expect(storage.wallets.map(wallet => wallet.getID())).toEqual([...stubs.map(wallet => wallet.getID()), 'legacy', 'unknown-default']);
    expect(realm.close).toHaveBeenCalled();
  });

  it('continues loading wallets when getRealm throws', async () => {
    const storage = new AppStorage();
    const wallet = stubWallet(LegacyWallet.type);
    installFromJson(LegacyWallet, wallet);
    const realmError = new Error('realm unavailable');
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(storage, 'getRealm').mockRejectedValueOnce(realmError);
    jest.spyOn(storage, 'getItemWithFallbackToRealm').mockResolvedValueOnce(
      JSON.stringify({ wallets: [JSON.stringify({ type: LegacyWallet.type })], tx_metadata: {} }),
    );

    await expect(storage.loadFromDisk()).resolves.toBe(true);
    expect(storage.wallets).toHaveLength(1);
    expect(console.error).toHaveBeenCalledWith('loadFromDisk: getRealm failed, wallet tx cache unavailable', realmError);
  });

  it('still appends a wallet when inflateWalletFromRealm throws', async () => {
    const storage = new AppStorage();
    const wallet = stubWallet(LegacyWallet.type);
    installFromJson(LegacyWallet, wallet);
    const inflateError = new Error('inflate failed');
    jest.spyOn(storage, 'inflateWalletFromRealm').mockImplementation(() => {
      throw inflateError;
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(storage, 'getRealm').mockResolvedValueOnce(makeRealm());
    jest.spyOn(storage, 'getItemWithFallbackToRealm').mockResolvedValueOnce(
      JSON.stringify({ wallets: [JSON.stringify({ type: LegacyWallet.type })], tx_metadata: {} }),
    );

    await expect(storage.loadFromDisk()).resolves.toBe(true);
    expect(storage.wallets).toEqual([wallet]);
    expect(console.error).toHaveBeenCalledWith('loadFromDisk: failed to inflate wallet from realm', inflateError);
  });
});

describe('AppStorage.inflateWalletFromRealm and offloadWalletToRealm', () => {
  it('pushes external and internal rows onto an HD wallet instance, creating the index array on first insert', () => {
    const storage = new AppStorage();
    const realm = makeRealm({
      txs: [
        { internal: false, index: 0, tx: JSON.stringify({ hash: 'ext-1' }) },
        { internal: false, index: 0, tx: JSON.stringify({ hash: 'ext-2' }) },
        { internal: true, index: 2, tx: JSON.stringify({ hash: 'int-1' }) },
        { internal: true, index: 2, tx: JSON.stringify({ hash: 'int-2' }) },
      ],
    });
    const wallet = {
      getID: () => 'hd',
      _hdWalletInstance: { _txs_by_external_index: {}, _txs_by_internal_index: {} },
    };
    storage.inflateWalletFromRealm(realm, wallet);
    expect(wallet._hdWalletInstance._txs_by_external_index[0]).toEqual([{ hash: 'ext-1' }, { hash: 'ext-2' }]);
    expect(wallet._hdWalletInstance._txs_by_internal_index[2]).toEqual([{ hash: 'int-1' }, { hash: 'int-2' }]);
  });

  it('pushes external and internal rows onto a non-HD wallet, creating the index array on first insert', () => {
    const storage = new AppStorage();
    const realm = makeRealm({
      txs: [
        { internal: false, index: 1, tx: JSON.stringify({ hash: 'e' }) },
        { internal: false, index: 1, tx: JSON.stringify({ hash: 'e2' }) },
        { internal: true, index: 0, tx: JSON.stringify({ hash: 'i' }) },
        { internal: true, index: 0, tx: JSON.stringify({ hash: 'i2' }) },
      ],
    });
    const wallet = {
      getID: () => 'plain',
      _txs_by_external_index: {},
      _txs_by_internal_index: {},
    };
    storage.inflateWalletFromRealm(realm, wallet);
    expect(wallet._txs_by_external_index[1]).toEqual([{ hash: 'e' }, { hash: 'e2' }]);
    expect(wallet._txs_by_internal_index[0]).toEqual([{ hash: 'i' }, { hash: 'i2' }]);
  });

  it('turns a non-array external index into a flat array for untagged realm rows and appends to an existing array', () => {
    const storage = new AppStorage();
    const realmNew = makeRealm({ txs: [{ internal: null, tx: JSON.stringify({ hash: 'flat' }) }] });
    const unset = { getID: () => 'unset' };
    storage.inflateWalletFromRealm(realmNew, unset);
    expect(unset._txs_by_external_index).toEqual([{ hash: 'flat' }]);

    const realmExisting = makeRealm({ txs: [{ internal: undefined, tx: JSON.stringify({ hash: 'more' }) }] });
    const existing = { getID: () => 'existing', _txs_by_external_index: [{ hash: 'already' }] };
    storage.inflateWalletFromRealm(realmExisting, existing);
    expect(existing._txs_by_external_index).toEqual([{ hash: 'already' }, { hash: 'more' }]);
  });

  it('falls back to an empty array when an untagged row meets a falsy external-index list that Array.isArray reports as an array', () => {
    const storage = new AppStorage();
    const realm = makeRealm({ txs: [{ internal: null, tx: JSON.stringify({ hash: 'flat' }) }] });
    const wallet = { getID: () => 'falsy-list', _txs_by_external_index: 0 };
    const realIsArray = Array.isArray.bind(Array);
    const spy = jest.spyOn(Array, 'isArray').mockImplementation(value => {
      if (value === 0) return true;
      return realIsArray(value);
    });
    try {
      storage.inflateWalletFromRealm(realm, wallet);
      expect(wallet._txs_by_external_index).toEqual([{ hash: 'flat' }]);
    } finally {
      spy.mockRestore();
    }
  });

  it('writes a single-address wallet as a flat list of WalletTransactions rows', () => {
    const storage = new AppStorage();
    const realm = makeRealm();
    const wallet = {
      getID: () => 'flat-id',
      _txs_by_external_index: [{ hash: 'a' }, { hash: 'b' }],
    };
    storage.offloadWalletToRealm(realm, wallet);
    expect(realm.delete).toHaveBeenCalled();
    expect(realm.create).toHaveBeenNthCalledWith(
      1,
      'WalletTransactions',
      { walletid: 'flat-id', tx: JSON.stringify({ hash: 'a' }) },
      Realm.UpdateMode.Modified,
    );
    expect(realm.create).toHaveBeenNthCalledWith(
      2,
      'WalletTransactions',
      { walletid: 'flat-id', tx: JSON.stringify({ hash: 'b' }) },
      Realm.UpdateMode.Modified,
    );
  });

  it('writes indexed external and internal rows from the HD instance when present', () => {
    const storage = new AppStorage();
    const realm = makeRealm();
    const wallet = {
      getID: () => 'hd-id',
      _hdWalletInstance: {
        _txs_by_external_index: { 0: [{ hash: 'ext' }] },
        _txs_by_internal_index: { 4: [{ hash: 'int' }] },
      },
    };
    storage.offloadWalletToRealm(realm, wallet);
    expect(realm.create).toHaveBeenCalledWith(
      'WalletTransactions',
      { walletid: 'hd-id', internal: false, index: 0, tx: JSON.stringify({ hash: 'ext' }) },
      Realm.UpdateMode.Modified,
    );
    expect(realm.create).toHaveBeenCalledWith(
      'WalletTransactions',
      { walletid: 'hd-id', internal: true, index: 4, tx: JSON.stringify({ hash: 'int' }) },
      Realm.UpdateMode.Modified,
    );
  });

  it('writes indexed rows from the wallet itself when there is no HD instance', () => {
    const storage = new AppStorage();
    const realm = makeRealm();
    const wallet = {
      getID: () => 'plain-id',
      _txs_by_external_index: { 1: [{ hash: 'e' }] },
      _txs_by_internal_index: { 2: [{ hash: 'i' }] },
    };
    storage.offloadWalletToRealm(realm, wallet);
    expect(realm.create).toHaveBeenCalledWith(
      'WalletTransactions',
      { walletid: 'plain-id', internal: false, index: 1, tx: JSON.stringify({ hash: 'e' }) },
      Realm.UpdateMode.Modified,
    );
    expect(realm.create).toHaveBeenCalledWith(
      'WalletTransactions',
      { walletid: 'plain-id', internal: true, index: 2, tx: JSON.stringify({ hash: 'i' }) },
      Realm.UpdateMode.Modified,
    );
  });

  it('does not write when the wallet has no transaction index', () => {
    const storage = new AppStorage();
    const realm = makeRealm();
    storage.offloadWalletToRealm(realm, { getID: () => 'empty' });
    expect(realm.write).not.toHaveBeenCalled();
  });
});

describe('AppStorage.saveToDisk', () => {
  it('skips boolean slots, strips tx caches and bip47, offloads to realm, and returns true', async () => {
    const storage = new AppStorage();
    const realm = makeRealm();
    const kv = makeRealm();
    jest.spyOn(storage, 'getRealm').mockResolvedValue(realm);
    jest.spyOn(storage, 'openRealmKeyValue').mockResolvedValue(kv);
    const saved = {};
    jest.spyOn(storage, 'setItem').mockImplementation(async (key, value) => {
      saved[key] = value;
    });
    const offload = jest.spyOn(storage, 'offloadWalletToRealm');

    const hd = stubWallet('HDsegwitBech32', {
      id: 'hd',
      current: 'drop-me',
      _hdWalletInstance: { _txs_by_external_index: { 0: [{ hash: 'e' }] }, _txs_by_internal_index: { 0: [{ hash: 'i' }] } },
      _txs_by_external_index: { 0: [{ hash: 'e' }] },
      _bip47_instance: { notification: true },
    });
    storage.wallets = [true, hd];

    await expect(storage.saveToDisk()).resolves.toBe(true);
    expect(offload).toHaveBeenCalledWith(realm, hd);
    expect(hd.prepareForSerialization).toHaveBeenCalled();
    expect(realm.close).toHaveBeenCalled();
    expect(kv.close).toHaveBeenCalled();
    const parsed = JSON.parse(saved.data);
    expect(parsed.wallets).toHaveLength(1);
    const cloned = JSON.parse(parsed.wallets[0]);
    expect(cloned.current).toBeUndefined();
    expect(cloned._bip47_instance).toBeUndefined();
    expect(cloned._txs_by_external_index).toEqual({});
    expect(cloned._hdWalletInstance._txs_by_external_index).toEqual({});
    expect(saved[AppStorage.FLAG_ENCRYPTED]).toBe('');
  });

  it('replaces only the used encrypted bucket and keeps the others', async () => {
    const storage = new AppStorage();
    const payload0 = JSON.stringify({ wallets: [JSON.stringify({ type: 'legacy', id: 'a' })], tx_metadata: {} });
    const payload1 = JSON.stringify({ wallets: [JSON.stringify({ type: 'legacy', id: 'b' })], tx_metadata: {} });
    const buckets = [encryption.encrypt(payload0, 'pw-a'), encryption.encrypt(payload1, 'pw-b'), 'untouched-cipher'];
    storage.decryptData(JSON.stringify(buckets), 'pw-b');
    storage.cachedPassword = 'pw-b';
    storage.wallets = [stubWallet(LegacyWallet.type, { id: 'saved' })];
    jest.spyOn(storage, 'getItemWithFallbackToRealm').mockResolvedValue(JSON.stringify(buckets));
    jest.spyOn(storage, 'getRealm').mockResolvedValue(makeRealm());
    jest.spyOn(storage, 'openRealmKeyValue').mockResolvedValue(makeRealm());
    const saved = {};
    jest.spyOn(storage, 'setItem').mockImplementation(async (key, value) => {
      saved[key] = value;
    });

    await expect(storage.saveToDisk()).resolves.toBe(true);
    const next = JSON.parse(saved.data);
    expect(next).toHaveLength(3);
    expect(next[0]).toBe(buckets[0]);
    expect(next[2]).toBe('untouched-cipher');
    expect(next[1]).not.toBe(buckets[1]);
    const replaced = JSON.parse(encryption.decrypt(next[1], 'pw-b'));
    expect(replaced.wallets).toHaveLength(1);
    expect(JSON.parse(replaced.wallets[0])).toEqual(
      expect.objectContaining({ id: 'saved', type: LegacyWallet.type }),
    );
    expect(saved[AppStorage.FLAG_ENCRYPTED]).toBe('1');
  });

  it('decrypts each bucket when usedBucketNum is unset, replacing the one that matches the cached password', async () => {
    const storage = new AppStorage();
    const mem = { data: JSON.stringify(['not-our-bucket']) };
    jest.spyOn(storage, 'getItem').mockImplementation(async key => mem[key]);
    jest.spyOn(storage, 'setItem').mockImplementation(async (key, value) => {
      mem[key] = value;
    });
    jest.spyOn(storage, 'getItemWithFallbackToRealm').mockImplementation(async key => mem[key]);
    jest.spyOn(storage, 'getRealm').mockResolvedValue(makeRealm());
    jest.spyOn(storage, 'openRealmKeyValue').mockResolvedValue(makeRealm());

    await storage.createFakeStorage('later-password');
    storage.wallets = [stubWallet(LegacyWallet.type, { id: 'after-fake' })];
    await expect(storage.saveToDisk()).resolves.toBe(true);
    const next = JSON.parse(mem.data);
    expect(next[0]).toBe('not-our-bucket');
    const replaced = JSON.parse(encryption.decrypt(next[1], 'later-password'));
    expect(replaced.wallets).toHaveLength(1);
    expect(JSON.parse(replaced.wallets[0])).toEqual(
      expect.objectContaining({ id: 'after-fake', type: LegacyWallet.type }),
    );
  });

  it('still saves wallet data when getRealm throws', async () => {
    const storage = new AppStorage();
    const realmError = new Error('no realm');
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(storage, 'getRealm').mockRejectedValueOnce(realmError);
    jest.spyOn(storage, 'openRealmKeyValue').mockResolvedValue(makeRealm());
    jest.spyOn(storage, 'setItem').mockResolvedValue(undefined);
    storage.wallets = [stubWallet(LegacyWallet.type)];
    await expect(storage.saveToDisk()).resolves.toBe(true);
    expect(console.error).toHaveBeenCalledWith('saveToDisk: getRealm failed, tx cache will not be written', realmError);
  });

  it('returns false and purges the realm key-value file when persistence fails with a realm decryption error', async () => {
    const storage = new AppStorage();
    jest.spyOn(storage, 'getRealm').mockResolvedValue(makeRealm());
    jest.spyOn(storage, 'setItem').mockResolvedValue(undefined);
    const decryptError = new Error('Realm file decryption failed: hmac mismatch');
    jest.spyOn(storage, 'openRealmKeyValue').mockRejectedValue(decryptError);
    const purge = jest.spyOn(storage, 'purgeRealmKeyValueFile').mockReturnValue(undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(storage.saveToDisk()).resolves.toBe(false);
    expect(purge).toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('saveToDisk: failed to persist wallet data', decryptError);
    expect(warn).toHaveBeenCalledWith('saveToDisk: realm file decryption failed, purging realm key-value database file');
  });

  it('returns false without purging when persistence fails for a reason other than realm decryption', async () => {
    const storage = new AppStorage();
    jest.spyOn(storage, 'getRealm').mockResolvedValue(makeRealm());
    const diskError = new Error('disk full');
    jest.spyOn(storage, 'setItem').mockRejectedValue(diskError);
    const purge = jest.spyOn(storage, 'purgeRealmKeyValueFile');
    jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(storage.saveToDisk()).resolves.toBe(false);
    expect(purge).not.toHaveBeenCalled();
  });

  it('queues overlapping saveToDisk calls and logs when more than ten are already in flight', async () => {
    jest.useFakeTimers();
    const storage = new AppStorage();
    const realm = makeRealm();
    let release;
    const gate = new Promise(resolve => {
      release = resolve;
    });
    jest.spyOn(storage, 'getRealm').mockImplementation(() => gate.then(() => realm));
    jest.spyOn(storage, 'openRealmKeyValue').mockResolvedValue(makeRealm());
    jest.spyOn(storage, 'setItem').mockResolvedValue(undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    const first = storage.saveToDisk();
    await Promise.resolve();
    const rest = [];
    for (let i = 0; i < 10; i++) {
      rest.push(storage.saveToDisk());
    }
    expect(error).toHaveBeenCalledWith(
      'saveToDisk: too many concurrent save attempts, last actions were not saved',
      expect.any(Error),
      11,
    );

    release();
    await expect(first).resolves.toBe(true);
    const restPromise = Promise.all(rest);
    await jest.runAllTimersAsync();
    const results = await restPromise;
    expect(results.every(value => value === true)).toBe(true);
  });
});

describe('AppStorage.deleteWallet, fetchers, getters and sleep', () => {
  it('removes the wallet whose ID matches and keeps the others', () => {
    const storage = new AppStorage();
    const keep = stubWallet('keep', { id: 'keep' });
    const drop = stubWallet('drop', { id: 'drop' });
    storage.wallets = [keep, drop, stubWallet('keep-2', { id: 'keep' })];
    storage.deleteWallet(drop);
    expect(storage.wallets.map(wallet => wallet.getID())).toEqual(['keep', 'keep']);
  });

  it('fetchWalletBalances fetches one wallet by index, including index 0, and all wallets when index is omitted', async () => {
    const storage = new AppStorage();
    const first = stubWallet('a', { id: 'a' });
    const second = stubWallet('b', { id: 'b' });
    storage.wallets = [first, second];
    await storage.fetchWalletBalances(0);
    expect(first.fetchBalance).toHaveBeenCalledTimes(1);
    expect(second.fetchBalance).not.toHaveBeenCalled();
    await storage.fetchWalletBalances(1);
    expect(second.fetchBalance).toHaveBeenCalledTimes(1);
    await storage.fetchWalletBalances(9);
    expect(first.fetchBalance).toHaveBeenCalledTimes(1);
    await storage.fetchWalletBalances();
    expect(first.fetchBalance).toHaveBeenCalledTimes(2);
    expect(second.fetchBalance).toHaveBeenCalledTimes(2);
  });

  it('fetchWalletTransactions fetches pending invoices only for the wallet at index, and for every wallet when index is omitted', async () => {
    const storage = new AppStorage();
    const withExtras = stubWallet('ln', {
      id: 'ln',
      fetchPendingTransactions: jest.fn().mockResolvedValue(undefined),
      fetchUserInvoices: jest.fn().mockResolvedValue(undefined),
    });
    const without = stubWallet('onchain', { id: 'onchain' });
    storage.wallets = [without, withExtras];
    await storage.fetchWalletTransactions(0);
    expect(without.fetchTransactions).toHaveBeenCalledTimes(1);
    expect(withExtras.fetchTransactions).not.toHaveBeenCalled();
    expect(without.fetchPendingTransactions).toBeUndefined();
    await storage.fetchWalletTransactions(1);
    expect(withExtras.fetchTransactions).toHaveBeenCalledTimes(1);
    expect(withExtras.fetchPendingTransactions).toHaveBeenCalledTimes(1);
    expect(withExtras.fetchUserInvoices).toHaveBeenCalledTimes(1);
    await storage.fetchWalletTransactions();
    expect(without.fetchTransactions).toHaveBeenCalledTimes(2);
    expect(withExtras.fetchTransactions).toHaveBeenCalledTimes(2);
  });

  it('fetchSenderPaymentCodes fetches only BIP47-enabled wallets, returns early otherwise, and logs failures', async () => {
    const storage = new AppStorage();
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const enabled = stubWallet('en', {
      id: 'en',
      allowBIP47: () => true,
      isBIP47Enabled: () => true,
      fetchBIP47SenderPaymentCodes: jest.fn().mockResolvedValue(undefined),
    });
    const allowedOff = stubWallet('off', { id: 'off', allowBIP47: () => true, isBIP47Enabled: () => false });
    const disallowed = stubWallet('no', { id: 'no', allowBIP47: () => false, isBIP47Enabled: () => true });
    const throwing = stubWallet('boom', {
      id: 'boom',
      allowBIP47: () => true,
      isBIP47Enabled: () => true,
      fetchBIP47SenderPaymentCodes: jest.fn().mockRejectedValue(new Error('bip47 down')),
    });

    storage.wallets = [enabled];
    await storage.fetchSenderPaymentCodes(0);
    expect(enabled.fetchBIP47SenderPaymentCodes).toHaveBeenCalledTimes(1);

    storage.wallets = [allowedOff];
    await storage.fetchSenderPaymentCodes(0);
    expect(allowedOff.fetchBIP47SenderPaymentCodes).not.toHaveBeenCalled();

    storage.wallets = [disallowed];
    await storage.fetchSenderPaymentCodes(0);
    expect(disallowed.fetchBIP47SenderPaymentCodes).not.toHaveBeenCalled();

    storage.wallets = [];
    await storage.fetchSenderPaymentCodes(0);
    expect(error).toHaveBeenCalledWith('fetchSenderPaymentCodes: failed for wallet index 0', expect.any(Error));

    storage.wallets = [disallowed, enabled, throwing, allowedOff];
    await storage.fetchSenderPaymentCodes();
    expect(enabled.fetchBIP47SenderPaymentCodes).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith('fetchSenderPaymentCodes: failed for wallet', expect.any(Error));
  });

  it('getWallets returns the wallet list', () => {
    const storage = new AppStorage();
    const wallets = [stubWallet('a')];
    storage.wallets = wallets;
    expect(storage.getWallets()).toBe(wallets);
  });

  it('getTransactions returns the txs of one wallet by index, including index 0', () => {
    const storage = new AppStorage();
    const first = stubWallet('a', { id: 'a', getTransactions: () => [{ hash: 'a1' }] });
    const second = stubWallet('b', { id: 'b', getTransactions: () => [{ hash: 'b1' }] });
    storage.wallets = [first, second];
    expect(storage.getTransactions(0)).toEqual([{ hash: 'a1' }]);
    expect(storage.getTransactions(1)).toEqual([{ hash: 'b1' }]);
  });

  it('getTransactions annotates, sorts newest first, hides opted-out wallets unless asked, and applies the limit', () => {
    const storage = new AppStorage();
    const visible = stubWallet('vis', {
      id: 'vis',
      getPreferredBalanceUnit: () => 'BTC',
      getHideTransactionsInWalletsList: () => false,
      getTransactions: () => [
        { hash: 'old', received: '2020-01-01T00:00:00.000Z' },
        { hash: 'new', received: '2021-01-01T00:00:00.000Z' },
      ],
    });
    const hidden = stubWallet('hid', {
      id: 'hid',
      getPreferredBalanceUnit: () => 'SATS',
      getHideTransactionsInWalletsList: () => true,
      getTransactions: () => [{ hash: 'secret', received: '2022-01-01T00:00:00.000Z' }],
    });
    storage.wallets = [visible, hidden];

    const listed = storage.getTransactions(null, 1);
    expect(listed).toHaveLength(1);
    expect(listed[0].hash).toBe('new');
    expect(listed[0].walletID).toBe('vis');
    expect(listed[0].walletPreferredBalanceUnit).toBe('BTC');

    const all = storage.getTransactions(undefined, Infinity, true);
    expect(all.map(tx => tx.hash)).toEqual(['secret', 'new', 'old']);
    expect(all[0].walletID).toBe('hid');
  });

  it('getBalance sums every wallet', () => {
    const storage = new AppStorage();
    storage.wallets = [stubWallet('a', { getBalance: () => 3 }), stubWallet('b', { getBalance: () => 4 })];
    expect(storage.getBalance()).toBe(7);
  });

  it('sleep resolves after the given delay', async () => {
    jest.useFakeTimers();
    const storage = new AppStorage();
    const pending = storage.sleep(25);
    await jest.advanceTimersByTimeAsync(25);
    await expect(pending).resolves.toBeUndefined();
  });
});

describe('AppStorage preference flags', () => {
  const flags = [
    { get: 'isAdvancedModeEnabled', set: 'setIsAdvancedModeEnabled', key: AppStorage.ADVANCED_MODE_ENABLED, failDefault: false },
    { get: 'isLdsDevEnabled', set: 'setIsLdsDevEnabled', key: AppStorage.FF_LDS_DEV_API, failDefault: false },
    { get: 'isPOSmodeEnabled', set: 'setIsPOSmodeEnabled', key: AppStorage.POS_MODE, failDefault: false },
    { get: 'isHideBalanceEnabled', set: 'setIsHideBalanceEnabled', key: AppStorage.HIDE_BALANCE, failDefault: false },
    { get: 'isPrivacyBlurEnabled', set: 'setIsPrivacyBlurEnabled', key: AppStorage.PRIVACY_BLUR_ENABLED, failDefault: true },
    { get: 'isDfxPOSEnabled', set: 'setIsDfxPOSEnabled', key: AppStorage.DFX_POS, failDefault: false },
    { get: 'isDfxSwapEnabled', set: 'setIsDfxSwapEnabled', key: AppStorage.DFX_SWAP, failDefault: false },
    { get: 'isHandoffEnabled', set: 'setIsHandoffEnabled', key: AppStorage.HANDOFF_STORAGE_KEY, failDefault: false },
    { get: 'isDoNotTrackEnabled', set: 'setDoNotTrack', key: AppStorage.DO_NOT_TRACK, failDefault: false },
  ];

  it.each(flags)('$get is true when the stored flag is set, false when it is empty, and $failDefault when the read throws', async ({ get, key, failDefault }) => {
    const storage = new AppStorage();
    const getItem = jest.spyOn(AsyncStorage, 'getItem');
    getItem.mockResolvedValueOnce('1');
    await expect(storage[get]()).resolves.toBe(true);
    expect(getItem).toHaveBeenCalledWith(key);
    getItem.mockResolvedValueOnce('');
    await expect(storage[get]()).resolves.toBe(false);
    getItem.mockRejectedValueOnce(new Error('read failed'));
    await expect(storage[get]()).resolves.toBe(failDefault);
  });

  it.each(flags)('$set writes "1" when enabled and an empty string when disabled', async ({ set, key }) => {
    const storage = new AppStorage();
    const setItem = jest.spyOn(AsyncStorage, 'setItem').mockResolvedValue(undefined);
    await storage[set](true);
    expect(setItem).toHaveBeenCalledWith(key, '1');
    await storage[set](false);
    expect(setItem).toHaveBeenCalledWith(key, '');
  });

  it('getCameraPermissionLastAskedTime parses a stored timestamp and returns 0 when none is stored', async () => {
    const storage = new AppStorage();
    const getItem = jest.spyOn(AsyncStorage, 'getItem');
    getItem.mockResolvedValueOnce('1700000000000');
    await expect(storage.getCameraPermissionLastAskedTime()).resolves.toBe(1700000000000);
    getItem.mockResolvedValueOnce(null);
    await expect(storage.getCameraPermissionLastAskedTime()).resolves.toBe(0);
  });

  it('setCameraPermissionLastAskedTime stores the timestamp as a string', async () => {
    const storage = new AppStorage();
    const setItem = jest.spyOn(AsyncStorage, 'setItem').mockResolvedValue(undefined);
    await storage.setCameraPermissionLastAskedTime(42);
    expect(setItem).toHaveBeenCalledWith(AppStorage.CAMERA_PERMISSION_LAST_ASKED_TIME, '42');
  });
});

describe('startAndDecrypt', () => {
  beforeEach(async () => {
    Biometric.showKeychainWipeAlert = jest.fn();
    prompt.mockReset();
    await resetUnlockAttempts();
    jest.restoreAllMocks();
    Biometric.showKeychainWipeAlert = jest.fn();
  });

  it('returns true without migrating or loading when wallets are already present', async () => {
    jest.spyOn(BlueApp, 'getWallets').mockReturnValue([stubWallet('already')]);
    const migrate = jest.spyOn(BlueApp, 'migrateKeys');
    const load = jest.spyOn(BlueApp, 'loadFromDisk');
    await expect(BlueApp.startAndDecrypt()).resolves.toBe(true);
    expect(migrate).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it('migrates keys and returns true when storage is empty and not encrypted', async () => {
    jest.spyOn(BlueApp, 'getWallets').mockReturnValue([]);
    const migrate = jest.spyOn(BlueApp, 'migrateKeys').mockResolvedValue(undefined);
    jest.spyOn(BlueApp, 'storageIsEncrypted').mockResolvedValue(false);
    jest.spyOn(BlueApp, 'loadFromDisk').mockResolvedValue(false);
    await expect(BlueApp.startAndDecrypt()).resolves.toBe(true);
    expect(migrate).toHaveBeenCalledTimes(1);
    expect(prompt).not.toHaveBeenCalled();
  });

  it('returns true when loadFromDisk succeeds without a password', async () => {
    jest.spyOn(BlueApp, 'getWallets').mockReturnValue([]);
    jest.spyOn(BlueApp, 'migrateKeys').mockResolvedValue(undefined);
    jest.spyOn(BlueApp, 'storageIsEncrypted').mockResolvedValue(false);
    jest.spyOn(BlueApp, 'loadFromDisk').mockResolvedValue(true);
    await expect(BlueApp.startAndDecrypt()).resolves.toBe(true);
    expect(BlueApp.loadFromDisk).toHaveBeenCalledWith(false);
  });

  it('keeps asking for a password until one is entered, then loads with it', async () => {
    jest.spyOn(BlueApp, 'getWallets').mockReturnValue([]);
    jest.spyOn(BlueApp, 'migrateKeys').mockResolvedValue(undefined);
    jest.spyOn(BlueApp, 'storageIsEncrypted').mockResolvedValue(true);
    jest.spyOn(BlueApp, 'loadFromDisk').mockResolvedValue(true);
    prompt.mockResolvedValueOnce('').mockResolvedValueOnce('entered-password');

    await expect(BlueApp.startAndDecrypt()).resolves.toBe(true);
    expect(prompt).toHaveBeenNthCalledWith(1, loc._.enter_password, loc._.storage_is_encrypted, false);
    expect(prompt).toHaveBeenNthCalledWith(2, loc._.enter_password, loc._.storage_is_encrypted, false);
    expect(BlueApp.loadFromDisk).toHaveBeenCalledWith('entered-password');
  });

  it('retries loadFromDisk once after a keystore exception and returns true when the retry succeeds', async () => {
    jest.useFakeTimers();
    jest.spyOn(BlueApp, 'getWallets').mockReturnValue([]);
    jest.spyOn(BlueApp, 'migrateKeys').mockResolvedValue(undefined);
    jest.spyOn(BlueApp, 'storageIsEncrypted').mockResolvedValue(false);
    const firstError = new Error('keystore');
    jest.spyOn(BlueApp, 'loadFromDisk').mockRejectedValueOnce(firstError).mockResolvedValueOnce(true);
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    const pending = BlueApp.startAndDecrypt();
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
    expect(jest.getTimerCount()).toBeGreaterThan(0);
    await jest.advanceTimersByTimeAsync(3000);
    await expect(pending).resolves.toBe(true);
    expect(BlueApp.loadFromDisk).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith('startAndDecrypt: failed to load wallets from disk, retrying', firstError);
  });

  it('returns true when both load attempts throw and there is no password', async () => {
    jest.useFakeTimers();
    jest.spyOn(BlueApp, 'getWallets').mockReturnValue([]);
    jest.spyOn(BlueApp, 'migrateKeys').mockResolvedValue(undefined);
    jest.spyOn(BlueApp, 'storageIsEncrypted').mockResolvedValue(false);
    const firstError = new Error('first');
    const secondError = new Error('second');
    jest.spyOn(BlueApp, 'loadFromDisk').mockRejectedValueOnce(firstError).mockRejectedValueOnce(secondError);
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    const pending = BlueApp.startAndDecrypt();
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
    expect(jest.getTimerCount()).toBeGreaterThan(0);
    await jest.advanceTimersByTimeAsync(3000);
    await expect(pending).resolves.toBe(true);
    expect(error).toHaveBeenCalledWith('startAndDecrypt: second attempt to load wallets from disk failed', secondError);
  });

  it('re-prompts with the bad-password title after a failed decrypt and succeeds on the retry', async () => {
    jest.spyOn(BlueApp, 'getWallets').mockReturnValue([]);
    jest.spyOn(BlueApp, 'migrateKeys').mockResolvedValue(undefined);
    jest.spyOn(BlueApp, 'storageIsEncrypted').mockResolvedValue(true);
    jest.spyOn(BlueApp, 'loadFromDisk').mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    prompt.mockResolvedValue('pw');
    Platform.OS = 'ios';

    await expect(BlueApp.startAndDecrypt()).resolves.toBe(true);
    expect(prompt).toHaveBeenNthCalledWith(1, loc._.enter_password, loc._.storage_is_encrypted, false);
    expect(prompt).toHaveBeenNthCalledWith(2, loc._.bad_password, loc._.storage_is_encrypted, false);
    expect(BlueApp.loadFromDisk).toHaveBeenCalledTimes(2);
  });

  it('shows the keychain wipe alert and returns false after ten failed iOS decrypts', async () => {
    jest.spyOn(BlueApp, 'getWallets').mockReturnValue([]);
    jest.spyOn(BlueApp, 'migrateKeys').mockResolvedValue(undefined);
    jest.spyOn(BlueApp, 'storageIsEncrypted').mockResolvedValue(true);
    jest.spyOn(BlueApp, 'loadFromDisk').mockResolvedValue(false);
    prompt.mockResolvedValue('wrong');
    Platform.OS = 'ios';

    await expect(BlueApp.startAndDecrypt()).resolves.toBe(false);
    expect(BlueApp.loadFromDisk).toHaveBeenCalledTimes(10);
    expect(Biometric.showKeychainWipeAlert).toHaveBeenCalledTimes(1);
  });

  it('keeps retrying past ten failed decrypts on non-iOS until loadFromDisk succeeds', async () => {
    jest.spyOn(BlueApp, 'getWallets').mockReturnValue([]);
    jest.spyOn(BlueApp, 'migrateKeys').mockResolvedValue(undefined);
    jest.spyOn(BlueApp, 'storageIsEncrypted').mockResolvedValue(true);
    let calls = 0;
    jest.spyOn(BlueApp, 'loadFromDisk').mockImplementation(async () => {
      calls += 1;
      return calls > 10;
    });
    prompt.mockResolvedValue('pw');
    Platform.OS = 'android';

    await expect(BlueApp.startAndDecrypt()).resolves.toBe(true);
    expect(calls).toBe(11);
    expect(Biometric.showKeychainWipeAlert).not.toHaveBeenCalled();
  });
});
