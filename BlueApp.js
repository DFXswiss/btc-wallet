import Biometric from './class/biometrics';
import { Platform } from 'react-native';
import loc from './loc';
import AsyncStorage from '@react-native-async-storage/async-storage';
import RNSecureKeyStore, { ACCESSIBLE } from 'react-native-secure-key-store';
import * as Keychain from 'react-native-keychain';
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
} from './class/';
import { randomBytes } from './class/rng';
import alert from './components/Alert';
import { LightningLdsWallet } from './class/wallets/lightning-lds-wallet';
import { TaprootLdsWallet } from './class/wallets/taproot-lds-wallet';

const encryption = require('./blue_modules/encryption');
const Realm = require('realm');
const createHash = require('create-hash');
let usedBucketNum = false;
let savingInProgress = 0; // its both a flag and a counter of attempts to write to disk
const prompt = require('./helpers/prompt');
const currency = require('./blue_modules/currency');
const BlueElectrum = require('./blue_modules/BlueElectrum');
BlueElectrum.connectMain();

class AppStorage {
  static FLAG_ENCRYPTED = 'data_encrypted';
  static LNDHUB = 'lndhub';
  static ADVANCED_MODE_ENABLED = 'advancedmodeenabled';
  static DO_NOT_TRACK = 'donottrack';
  static HANDOFF_STORAGE_KEY = 'HandOff';
  static PAY_CARD = 'PAY_CARD';
  static FF_LDS_DEV_API = 'ff_lds_dev_api';
  static POS_MODE = 'pos_mode';
  static DFX_POS = 'dfx_pos';
  static DFX_SWAP = 'dfx_swap';

  static keys2migrate = [AppStorage.HANDOFF_STORAGE_KEY, AppStorage.DO_NOT_TRACK, AppStorage.ADVANCED_MODE_ENABLED];

  constructor() {
    /** {Array.<AbstractWallet>} */
    this.wallets = [];
    this.tx_metadata = {};
    this.cachedPassword = false;
  }

  async migrateKeys() {
    if (!(typeof navigator !== 'undefined' && navigator.product === 'ReactNative')) return;
    for (const key of this.constructor.keys2migrate) {
      try {
        const value = await RNSecureKeyStore.get(key);
        if (value) {
          await AsyncStorage.setItem(key, value);
          await RNSecureKeyStore.remove(key);
        }
      } catch (_) {}
    }
  }

  /**
   * Wrapper for storage call. Secure store works only in RN environment. AsyncStorage is
   * used for cli/tests
   *
   * @param key
   * @param value
   * @returns {Promise<any>|Promise<any> | Promise<void> | * | Promise | void}
   */
  setItem = (key, value) => {
    if (typeof navigator !== 'undefined' && navigator.product === 'ReactNative') {
      return RNSecureKeyStore.set(key, value, { accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    } else {
      return AsyncStorage.setItem(key, value);
    }
  };

  /**
   * Wrapper for storage call. Secure store works only in RN environment. AsyncStorage is
   * used for cli/tests
   *
   * @param key
   * @returns {Promise<any>|*}
   */
  getItem = key => {
    if (typeof navigator !== 'undefined' && navigator.product === 'ReactNative') {
      return RNSecureKeyStore.get(key);
    } else {
      return AsyncStorage.getItem(key);
    }
  };

  /**
   * @throws Error
   * @param key {string}
   * @returns {Promise<*>|null}
   */
  getItemWithFallbackToRealm = async key => {
    let value;
    try {
      return await this.getItem(key);
    } catch (error) {
      console.warn('error reading', key, error.message);
      console.warn('fallback to realm');
      const realmKeyValue = await this.openRealmKeyValue();
      const obj = realmKeyValue.objectForPrimaryKey('KeyValue', key); // search for a realm object with a primary key
      value = obj?.value;
      realmKeyValue.close();
      if (value) {
        console.warn('successfully recovered', value.length, 'bytes from realm for key', key);
        return value;
      }
      return null;
    }
  };

  storageIsEncrypted = async () => {
    let data;
    try {
      data = await this.getItemWithFallbackToRealm(AppStorage.FLAG_ENCRYPTED);
    } catch (error) {
      console.warn('error reading `' + AppStorage.FLAG_ENCRYPTED + '` key:', error.message);
      return false;
    }

    return !!data;
  };

  isPasswordInUse = async password => {
    try {
      let data = await this.getItem('data');
      data = this.decryptData(data, password);
      return !!data;
    } catch (_e) {
      return false;
    }
  };

  /**
   * Iterates through all values of `data` trying to
   * decrypt each one, and returns first one successfully decrypted
   *
   * @param data {string} Serialized array
   * @param password
   * @returns {boolean|string} Either STRING of storage data (which is stringified JSON) or FALSE, which means failure
   */
  decryptData(data, password) {
    data = JSON.parse(data);
    let decrypted;
    let num = 0;
    for (const value of data) {
      decrypted = encryption.decrypt(value, password);

      if (decrypted) {
        usedBucketNum = num;
        return decrypted;
      }
      num++;
    }

    return false;
  }

  decryptStorage = async password => {
    if (password === this.cachedPassword) {
      this.cachedPassword = undefined;
      await this.saveToDisk();
      this.wallets = [];
      this.tx_metadata = [];
      return this.loadFromDisk();
    } else {
      throw new Error('Incorrect password. Please, try again.');
    }
  };

  encryptStorage = async password => {
    // assuming the storage is not yet encrypted
    await this.saveToDisk();
    let data = await this.getItem('data');
    // TODO: refactor ^^^ (should not save & load to fetch data)

    const encrypted = encryption.encrypt(data, password);
    data = [];
    data.push(encrypted); // putting in array as we might have many buckets with storages
    data = JSON.stringify(data);
    this.cachedPassword = password;
    await this.setItem('data', data);
    await this.setItem(AppStorage.FLAG_ENCRYPTED, '1');
  };

  /**
   * Cleans up all current application data (wallets, tx metadata etc)
   * Encrypts the bucket and saves it storage
   *
   * @returns {Promise.<boolean>} Success or failure
   */
  createFakeStorage = async fakePassword => {
    usedBucketNum = false; // resetting currently used bucket so we wont overwrite it
    this.wallets = [];
    this.tx_metadata = {};

    const data = {
      wallets: [],
      tx_metadata: {},
    };

    let buckets = await this.getItem('data');
    buckets = JSON.parse(buckets);
    buckets.push(encryption.encrypt(JSON.stringify(data), fakePassword));
    this.cachedPassword = fakePassword;
    const bucketsString = JSON.stringify(buckets);
    await this.setItem('data', bucketsString);
    return (await this.getItem('data')) === bucketsString;
  };

  hashIt = s => {
    return createHash('sha256').update(s).digest().toString('hex');
  };

  /**
   * Returns instace of the Realm database, which is encrypted either by cached user's password OR default password.
   * Database file is deterministically derived from encryption key.
   *
   * @returns {Promise<Realm>}
   */
  async getRealm() {
    const password = this.hashIt(this.cachedPassword || 'fyegjitkyf[eqjnc.lf');
    const buf = Buffer.from(this.hashIt(password) + this.hashIt(password), 'hex');
    const encryptionKey = Int8Array.from(buf);
    const path = this.hashIt(this.hashIt(password)) + '-wallettransactions.realm';

    const schema = [
      {
        name: 'WalletTransactions',
        properties: {
          walletid: { type: 'string', indexed: true },
          internal: 'bool?', // true - internal, false - external
          index: 'int?',
          tx: 'string', // stringified json
        },
      },
    ];
    return Realm.open({
      schema,
      path,
      encryptionKey,
    });
  }

  /**
   * Returns instace of the Realm database, which is encrypted by device unique id
   * Database file is static.
   *
   * @returns {Promise<Realm>}
   */
  async openRealmKeyValue() {
    const service = 'realm_encryption_key';
    let password;
    const credentials = await Keychain.getGenericPassword({ service });
    if (credentials) {
      password = credentials.password;
    } else {
      const buf = await randomBytes(64);
      password = buf.toString('hex');
      await Keychain.setGenericPassword(service, password, { service });
    }

    const buf = Buffer.from(password, 'hex');
    const encryptionKey = Int8Array.from(buf);
    const path = 'keyvalue.realm';

    const schema = [
      {
        name: 'KeyValue',
        primaryKey: 'key',
        properties: {
          key: { type: 'string', indexed: true },
          value: 'string', // stringified json, or whatever
        },
      },
    ];
    return Realm.open({
      schema,
      path,
      encryptionKey,
    });
  }

  saveToRealmKeyValue(realmkeyValue, key, value) {
    realmkeyValue.write(() => {
      realmkeyValue.create(
        'KeyValue',
        {
          key,
          value,
        },
        Realm.UpdateMode.Modified,
      );
    });
  }

  /**
   * Loads from storage all wallets and
   * maps them to `this.wallets`
   *
   * @param password If present means storage must be decrypted before usage
   * @returns {Promise.<boolean>}
   */
  async loadFromDisk(password) {
    let data = await this.getItemWithFallbackToRealm('data');
    if (password) {
      data = this.decryptData(data, password);
      if (data) {
        // password is good, cache it
        this.cachedPassword = password;
      }
    }
    if (data !== null) {
      let realm;
      try {
        realm = await this.getRealm();
      } catch (error) {
        console.log("ERROR: ", error.message);
      }
      data = JSON.parse(data);
      if (!data.wallets) return false;
      const wallets = data.wallets;
      for (const key of wallets) {
        // deciding which type is wallet and instatiating correct object
        const tempObj = JSON.parse(key);
        let unserializedWallet;
        switch (tempObj.type) {
          case SegwitBech32Wallet.type:
            unserializedWallet = SegwitBech32Wallet.fromJson(key);
            break;
          case SegwitP2SHWallet.type:
            unserializedWallet = SegwitP2SHWallet.fromJson(key);
            break;
          case WatchOnlyWallet.type:
            unserializedWallet = WatchOnlyWallet.fromJson(key);
            unserializedWallet.init();
            if (unserializedWallet.isHd() && !unserializedWallet.isXpubValid()) {
              continue;
            }
            break;
          case HDLegacyP2PKHWallet.type:
            unserializedWallet = HDLegacyP2PKHWallet.fromJson(key);
            break;
          case HDSegwitP2SHWallet.type:
            unserializedWallet = HDSegwitP2SHWallet.fromJson(key);
            break;
          case HDSegwitBech32Wallet.type:
            unserializedWallet = HDSegwitBech32Wallet.fromJson(key);
            break;
          case HDLegacyBreadwalletWallet.type:
            unserializedWallet = HDLegacyBreadwalletWallet.fromJson(key);
            break;
          case HDLegacyElectrumSeedP2PKHWallet.type:
            unserializedWallet = HDLegacyElectrumSeedP2PKHWallet.fromJson(key);
            break;
          case HDSegwitElectrumSeedP2WPKHWallet.type:
            unserializedWallet = HDSegwitElectrumSeedP2WPKHWallet.fromJson(key);
            break;
          case MultisigHDWallet.type:
            unserializedWallet = MultisigHDWallet.fromJson(key);
            break;
          case HDAezeedWallet.type:
            unserializedWallet = HDAezeedWallet.fromJson(key);
            // migrate password to this.passphrase field
            // remove this code somewhere in year 2022
            if (unserializedWallet.secret.includes(':')) {
              const [mnemonic, passphrase] = unserializedWallet.secret.split(':');
              unserializedWallet.secret = mnemonic;
              unserializedWallet.passphrase = passphrase;
            }

            break;
          case SLIP39SegwitP2SHWallet.type:
            unserializedWallet = SLIP39SegwitP2SHWallet.fromJson(key);
            break;
          case SLIP39LegacyP2PKHWallet.type:
            unserializedWallet = SLIP39LegacyP2PKHWallet.fromJson(key);
            break;
          case SLIP39SegwitBech32Wallet.type:
            unserializedWallet = SLIP39SegwitBech32Wallet.fromJson(key);
            break;
          case TaprootLdsWallet.type:
          case LightningCustodianWallet.type:
          case LightningLdsWallet.type: {
            unserializedWallet =
              tempObj.type === LightningCustodianWallet.type
                ? LightningCustodianWallet.fromJson(key)
                : tempObj.type === LightningLdsWallet.type
                ? LightningLdsWallet.fromJson(key)
                : TaprootLdsWallet.fromJson(key);
                
            let lndhub = false;
            try {
              lndhub = await AsyncStorage.getItem(AppStorage.LNDHUB);
            } catch (error) {
              console.warn(error);
            }

            if (unserializedWallet.baseURI) {
              unserializedWallet.setBaseURI(unserializedWallet.baseURI); // not really necessary, just for the sake of readability
              console.log('using saved uri for for ln wallet:', unserializedWallet.baseURI);
            } else if (lndhub) {
              console.log('using wallet-wide settings ', lndhub, 'for ln wallet');
              unserializedWallet.setBaseURI(lndhub);
            } else {
              console.log('wallet does not have a baseURI. Continuing init...');
            }
            unserializedWallet.init();
            break;
          }
          case LegacyWallet.type:
          default:
            unserializedWallet = LegacyWallet.fromJson(key);
            break;
        }

        try {
          if (realm) this.inflateWalletFromRealm(realm, unserializedWallet);
        } catch (error) {
          console.log("ERROR: ", error.message);
        }

        // done
        const ID = unserializedWallet.getID();
        if (!this.wallets.some(wallet => wallet.getID() === ID)) {
          this.wallets.push(unserializedWallet);
          this.tx_metadata = data.tx_metadata;
        }
      }
      if (realm) realm.close();
      return true;
    } else {
      return false; // failed loading data or loading/decryptin data
    }
  }

  /**
   * Lookup wallet in list by it's secret and
   * remove it from `this.wallets`
   *
   * @param wallet {AbstractWallet}
   */
  deleteWallet = wallet => {
    const ID = wallet.getID();
    const tempWallets = [];

    for (const value of this.wallets) {
      if (value.getID() === ID) {
        // the one we should delete
        // nop
      } else {
        // the one we must keep
        tempWallets.push(value);
      }
    }
    this.wallets = tempWallets;
  };

  inflateWalletFromRealm(realm, walletToInflate) {
    const transactions = realm.objects('WalletTransactions');
    const transactionsForWallet = transactions.filtered(`walletid = "${walletToInflate.getID()}"`);
    for (const tx of transactionsForWallet) {
      if (tx.internal === false) {
        if (walletToInflate._hdWalletInstance) {
          walletToInflate._hdWalletInstance._txs_by_external_index[tx.index] =
            walletToInflate._hdWalletInstance._txs_by_external_index[tx.index] || [];
          walletToInflate._hdWalletInstance._txs_by_external_index[tx.index].push(JSON.parse(tx.tx));
        } else {
          walletToInflate._txs_by_external_index[tx.index] = walletToInflate._txs_by_external_index[tx.index] || [];
          walletToInflate._txs_by_external_index[tx.index].push(JSON.parse(tx.tx));
        }
      } else if (tx.internal === true) {
        if (walletToInflate._hdWalletInstance) {
          walletToInflate._hdWalletInstance._txs_by_internal_index[tx.index] =
            walletToInflate._hdWalletInstance._txs_by_internal_index[tx.index] || [];
          walletToInflate._hdWalletInstance._txs_by_internal_index[tx.index].push(JSON.parse(tx.tx));
        } else {
          walletToInflate._txs_by_internal_index[tx.index] = walletToInflate._txs_by_internal_index[tx.index] || [];
          walletToInflate._txs_by_internal_index[tx.index].push(JSON.parse(tx.tx));
        }
      } else {
        if (!Array.isArray(walletToInflate._txs_by_external_index)) walletToInflate._txs_by_external_index = [];
        walletToInflate._txs_by_external_index = walletToInflate._txs_by_external_index || [];
        walletToInflate._txs_by_external_index.push(JSON.parse(tx.tx));
      }
    }
  }

  offloadWalletToRealm(realm, wallet) {
    const id = wallet.getID();
    const walletToSave = wallet._hdWalletInstance ?? wallet;

    if (Array.isArray(walletToSave._txs_by_external_index)) {
      // if this var is an array that means its a single-address wallet class, and this var is a flat array
      // with transactions
      realm.write(() => {
        // cleanup all existing transactions for the wallet first
        const walletTransactionsToDelete = realm.objects('WalletTransactions').filtered(`walletid = '${id}'`);
        realm.delete(walletTransactionsToDelete);

        for (const tx of walletToSave._txs_by_external_index) {
          realm.create(
            'WalletTransactions',
            {
              walletid: id,
              tx: JSON.stringify(tx),
            },
            Realm.UpdateMode.Modified,
          );
        }
      });

      return;
    }

    /// ########################################################################################################

    if (walletToSave._txs_by_external_index) {
      realm.write(() => {
        // cleanup all existing transactions for the wallet first
        const walletTransactionsToDelete = realm.objects('WalletTransactions').filtered(`walletid = '${id}'`);
        realm.delete(walletTransactionsToDelete);

        // insert new ones:
        for (const index of Object.keys(walletToSave._txs_by_external_index)) {
          const txs = walletToSave._txs_by_external_index[index];
          for (const tx of txs) {
            realm.create(
              'WalletTransactions',
              {
                walletid: id,
                internal: false,
                index: parseInt(index, 10),
                tx: JSON.stringify(tx),
              },
              Realm.UpdateMode.Modified,
            );
          }
        }

        for (const index of Object.keys(walletToSave._txs_by_internal_index)) {
          const txs = walletToSave._txs_by_internal_index[index];
          for (const tx of txs) {
            realm.create(
              'WalletTransactions',
              {
                walletid: id,
                internal: true,
                index: parseInt(index, 10),
                tx: JSON.stringify(tx),
              },
              Realm.UpdateMode.Modified,
            );
          }
        }
      });
    }
  }

  /**
   * Serializes and saves to storage object data.
   * If cached password is saved - finds the correct bucket
   * to save to, encrypts and then saves.
   *
   * @returns {Promise} Result of storage save
   */
  async saveToDisk() {
    if (savingInProgress) {
      if (++savingInProgress > 10) console.warn('ERROR: Critical error. Last actions were not saved'); // should never happen
      await new Promise(resolve => setTimeout(resolve, 1000 * savingInProgress)); // sleep
      return this.saveToDisk();
    }
    savingInProgress = 1;

    try {
      const walletsToSave = [];
      let realm;
      try {
        realm = await this.getRealm();
      } catch (error) {
        console.error(`saveToDisk: getRealm: ${error.message}`);
      }
      for (const key of this.wallets) {
        if (typeof key === 'boolean') continue;
        key.prepareForSerialization();
        delete key.current;
        const keyCloned = Object.assign({}, key); // stripped-down version of a wallet to save to secure keystore
        if (key._hdWalletInstance) keyCloned._hdWalletInstance = Object.assign({}, key._hdWalletInstance);
        if (realm) this.offloadWalletToRealm(realm, key);
        // stripping down:
        if (key._txs_by_external_index) {
          keyCloned._txs_by_external_index = {};
          keyCloned._txs_by_internal_index = {};
        }
        if (key._hdWalletInstance) {
          keyCloned._hdWalletInstance._txs_by_external_index = {};
          keyCloned._hdWalletInstance._txs_by_internal_index = {};
        }

        if (keyCloned._bip47_instance) {
          delete keyCloned._bip47_instance; // since it wont be restored into a proper class instance
        }

        walletsToSave.push(JSON.stringify({ ...keyCloned, type: keyCloned.type }));
      }
      if (realm) realm.close();
      let data = {
        wallets: walletsToSave,
        tx_metadata: this.tx_metadata,
      };

      if (this.cachedPassword) {
        // should find the correct bucket, encrypt and then save
        let buckets = await this.getItemWithFallbackToRealm('data');
        buckets = JSON.parse(buckets);
        const newData = [];
        let num = 0;
        for (const bucket of buckets) {
          let decrypted;
          // if we had `usedBucketNum` during loadFromDisk(), no point to try to decode each bucket to find the one we
          // need, we just to find bucket with the same index
          if (usedBucketNum !== false) {
            if (num === usedBucketNum) {
              decrypted = true;
            }
            num++;
          } else {
            // we dont have `usedBucketNum` for whatever reason, so lets try to decrypt each bucket after bucket
            // till we find the right one
            decrypted = encryption.decrypt(bucket, this.cachedPassword);
          }

          if (!decrypted) {
            // no luck decrypting, its not our bucket
            newData.push(bucket);
          } else {
            // decrypted ok, this is our bucket
            // we serialize our object's data, encrypt it, and add it to buckets
            newData.push(encryption.encrypt(JSON.stringify(data), this.cachedPassword));
          }
        }
        data = newData;
      }

      await this.setItem('data', JSON.stringify(data));
      await this.setItem(AppStorage.FLAG_ENCRYPTED, this.cachedPassword ? '1' : '');

      // now, backing up same data in realm:
      const realmkeyValue = await this.openRealmKeyValue();
      this.saveToRealmKeyValue(realmkeyValue, 'data', JSON.stringify(data));
      this.saveToRealmKeyValue(realmkeyValue, AppStorage.FLAG_ENCRYPTED, this.cachedPassword ? '1' : '');
      realmkeyValue.close();
    } catch (error) {
      console.error('save to disk exception:', error.message);
      if (error.message.includes('Realm file decryption failed')) {
        console.warn('purging realm key-value database file');
        this.purgeRealmKeyValueFile();
      }
    } finally {
      savingInProgress = 0;
    }
  }

  /**
   * For each wallet, fetches balance from remote endpoint.
   * Use getter for a specific wallet to get actual balance.
   * Returns void.
   * If index is present then fetch only from this specific wallet
   *
   * @return {Promise.<void>}
   */
  fetchWalletBalances = async index => {
    if (index || index === 0) {
      if (this.wallets[index]) {
        await this.wallets[index].fetchBalance();
      }
    } else {
      await Promise.all(
        this.wallets.map(wallet => {
          return wallet.fetchBalance();
        })
      );
    }
  };

  /**
   * Fetches from remote endpoint all transactions for each wallet.
   * Returns void.
   * To access transactions - get them from each respective wallet.
   * If index is present then fetch only from this specific wallet.
   *
   * @param index {Integer} Index of the wallet in this.wallets array,
   *                        blank to fetch from all wallets
   * @return {Promise.<void>}
   */
  fetchWalletTransactions = async index => {
    if (index || index === 0) {
      let c = 0;
      for (const wallet of this.wallets) {
        if (c++ === index) {
          await wallet.fetchTransactions();
          if (wallet.fetchPendingTransactions) {
            await wallet.fetchPendingTransactions();
          }
          if (wallet.fetchUserInvoices) {
            await wallet.fetchUserInvoices();
          }
        }
      }
    } else {
      for (const wallet of this.wallets) {
        await wallet.fetchTransactions();
        if (wallet.fetchPendingTransactions) {
          await wallet.fetchPendingTransactions();
        }
        if (wallet.fetchUserInvoices) {
          await wallet.fetchUserInvoices();
        }
      }
    }
  };

  fetchSenderPaymentCodes = async index => {
    if (index || index === 0) {
      try {
        if (!(this.wallets[index].allowBIP47() && this.wallets[index].isBIP47Enabled())) return;
        await this.wallets[index].fetchBIP47SenderPaymentCodes();
      } catch (error) {
        console.error('Failed to fetch sender payment codes for wallet', index, error);
      }
    } else {
      for (const wallet of this.wallets) {
        try {
          if (!(wallet.allowBIP47() && wallet.isBIP47Enabled())) continue;
          await wallet.fetchBIP47SenderPaymentCodes();
        } catch (error) {
          console.error('Failed to fetch sender payment codes for wallet', wallet.label, error);
        }
      }
    }
  };

  /**
   *
   * @returns {Array.<AbstractWallet>}
   */
  getWallets = () => {
    return this.wallets;
  };

  /**
   * Getter for all transactions in all wallets.
   * But if index is provided - only for wallet with corresponding index
   *
   * @param index {Integer|null} Wallet index in this.wallets. Empty (or null) for all wallets.
   * @param limit {Integer} How many txs return, starting from the earliest. Default: all of them.
   * @param includeWalletsWithHideTransactionsEnabled {Boolean} Wallets' _hideTransactionsInWalletsList property determines wether the user wants this wallet's txs hidden from the main list view.
   * @return {Array}
   */
  getTransactions = (index, limit = Infinity, includeWalletsWithHideTransactionsEnabled = false) => {
    if (index || index === 0) {
      let txs = [];
      let c = 0;
      for (const wallet of this.wallets) {
        if (c++ === index) {
          txs = txs.concat(wallet.getTransactions());
        }
      }
      return txs;
    }

    let txs = [];
    for (const wallet of this.wallets.filter(w => includeWalletsWithHideTransactionsEnabled || !w.getHideTransactionsInWalletsList())) {
      const walletTransactions = wallet.getTransactions();
      const walletID = wallet.getID();
      for (const t of walletTransactions) {
        t.walletPreferredBalanceUnit = wallet.getPreferredBalanceUnit();
        t.walletID = walletID;
      }
      txs = txs.concat(walletTransactions);
    }

    for (const t of txs) {
      t.sort_ts = +new Date(t.received);
    }

    return txs
      .sort(function (a, b) {
        return b.sort_ts - a.sort_ts;
      })
      .slice(0, limit);
  };

  /**
   * Getter for a sum of all balances of all wallets
   *
   * @return {number}
   */
  getBalance = () => {
    let finalBalance = 0;
    for (const wal of this.wallets) {
      finalBalance += wal.getBalance();
    }
    return finalBalance;
  };

  isAdvancedModeEnabled = async () => {
    try {
      return !!(await AsyncStorage.getItem(AppStorage.ADVANCED_MODE_ENABLED));
    } catch (_) {}
    return false;
  };

  setIsAdvancedModeEnabled = async value => {
    await AsyncStorage.setItem(AppStorage.ADVANCED_MODE_ENABLED, value ? '1' : '');
  };


  isLdsDevEnabled = async () => {
    try {
      return !!(await AsyncStorage.getItem(AppStorage.FF_LDS_DEV_API));
    } catch (_) {}
    return false;
  };

  setIsLdsDevEnabled = async value => {
    await AsyncStorage.setItem(AppStorage.FF_LDS_DEV_API, value ? '1' : '');
  };

  isPOSmodeEnabled = async () => {
    try {
      return !!(await AsyncStorage.getItem(AppStorage.POS_MODE));
    } catch (_) {}
    return false;
  };

  setIsPOSmodeEnabled = async value => {
    await AsyncStorage.setItem(AppStorage.POS_MODE, value ? '1' : '');
  };

  isDfxPOSEnabled = async () => {
    try {
      return !!(await AsyncStorage.getItem(AppStorage.DFX_POS));
    } catch (_) {}
    return false;
  };

  setIsDfxPOSEnabled = async value => {
    await AsyncStorage.setItem(AppStorage.DFX_POS, value ? '1' : '');
  };

  isDfxSwapEnabled = async () => {
    try {
      return !!(await AsyncStorage.getItem(AppStorage.DFX_SWAP));
    } catch (_) {}
    return false;
  };

  setIsDfxSwapEnabled = async value => {
    await AsyncStorage.setItem(AppStorage.DFX_SWAP, value ? '1' : '');
  };

  isHandoffEnabled = async () => {
    try {
      return !!(await AsyncStorage.getItem(AppStorage.HANDOFF_STORAGE_KEY));
    } catch (_) {}
    return false;
  };

  setIsHandoffEnabled = async value => {
    await AsyncStorage.setItem(AppStorage.HANDOFF_STORAGE_KEY, value ? '1' : '');
  };

  isDoNotTrackEnabled = async () => {
    try {
      return !!(await AsyncStorage.getItem(AppStorage.DO_NOT_TRACK));
    } catch (_) {}
    return false;
  };

  setDoNotTrack = async value => {
    await AsyncStorage.setItem(AppStorage.DO_NOT_TRACK, value ? '1' : '');
  };

  /**
   * Simple async sleeper function
   *
   * @param ms {number} Milliseconds to sleep
   * @returns {Promise<Promise<*> | Promise<*>>}
   */
  sleep = ms => {
    return new Promise(resolve => setTimeout(resolve, ms));
  };

  purgeRealmKeyValueFile() {
    const path = 'keyvalue.realm';
    return Realm.deleteFile({
      path,
    });
  }
}

const BlueApp = new AppStorage();
// If attempt reaches 10, a wipe keychain option will be provided to the user.
let unlockAttempt = 0;

const startAndDecrypt = async retry => {
  console.log('startAndDecrypt');
  if (BlueApp.getWallets().length > 0) {
    console.log('App already has some wallets, so we are in already started state, exiting startAndDecrypt');
    return true;
  }
  await BlueApp.migrateKeys();
  let password = false;
  if (await BlueApp.storageIsEncrypted()) {
    do {
      password = await prompt((retry && loc._.bad_password) || loc._.enter_password, loc._.storage_is_encrypted, false);
    } while (!password);
  }
  let success = false;
  let wasException = false;
  try {
    success = await BlueApp.loadFromDisk(password);
  } catch (error) {
    // in case of exception reading from keystore, lets retry instead of assuming there is no storage and
    // proceeding with no wallets
    console.warn('exception loading from disk:', error);
    wasException = true;
  }

  if (wasException) {
    // retrying, but only once
    try {
      await new Promise(resolve => setTimeout(resolve, 3000)); // sleep
      success = await BlueApp.loadFromDisk(password);
    } catch (error) {
      console.warn('second exception loading from disk:', error);
    }
  }

  if (success) {
    console.log('loaded from disk');
    // We want to return true to let the UnlockWith screen that its ok to proceed.
    return true;
  }

  if (password) {
    // we had password and yet could not load/decrypt
    unlockAttempt++;
    if (unlockAttempt < 10 || Platform.OS !== 'ios') {
      return startAndDecrypt(true);
    } else {
      unlockAttempt = 0;
      Biometric.showKeychainWipeAlert();
      // We want to return false to let the UnlockWith screen that it is NOT ok to proceed.
      return false;
    }
  } else {
    unlockAttempt = 0;
    // Return true because there was no wallet data in keychain. Proceed.
    return true;
  }
};

BlueApp.startAndDecrypt = startAndDecrypt;
BlueApp.AppStorage = AppStorage;
currency.init();

module.exports = BlueApp;
