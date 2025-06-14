import AsyncStorage from '@react-native-async-storage/async-storage';
import { LegacyWallet, SegwitBech32Wallet, SegwitP2SHWallet, TaprootWallet } from '../class';
import DefaultPreference from 'react-native-default-preference';
import WidgetCommunication from './WidgetCommunication';
import { isTorDaemonDisabled } from './environment';
const bitcoin = require('bitcoinjs-lib');
const ElectrumClient = require('electrum-client');
const reverse = require('buffer-reverse');
const BigNumber = require('bignumber.js');
const torrific = require('./torrific');
const Realm = require('realm');

const ELECTRUM_HOST = 'electrum_host';
const ELECTRUM_TCP_PORT = 'electrum_tcp_port';
const ELECTRUM_SSL_PORT = 'electrum_ssl_port';
const ELECTRUM_SERVER_HISTORY = 'electrum_server_history';
const ELECTRUM_CONNECTION_DISABLED = 'electrum_disabled';

let _realm;
async function _getRealm() {
  if (_realm) return _realm;

  const password = bitcoin.crypto.sha256(Buffer.from('fyegjitkyf[eqjnc.lf')).toString('hex');
  const buf = Buffer.from(password + password, 'hex');
  const encryptionKey = Int8Array.from(buf);
  const path = 'electrumcache.realm';

  const schema = [
    {
      name: 'Cache',
      primaryKey: 'cache_key',
      properties: {
        cache_key: { type: 'string', indexed: true },
        cache_value: 'string', // stringified json
      },
    },
  ];
  _realm = await Realm.open({
    schema,
    path,
    encryptionKey,
  });
  return _realm;
}

const storageKey = 'ELECTRUM_PEERS';
const defaultPeer = { host: 'electrum1.bluewallet.io', ssl: '443' };
const hardcodedPeers = [
  { host: 'mainnet.foundationdevices.com', ssl: '50002' },
  { host: 'electrum.jochen-hoenicke.de', ssl: '50006' },
  { host: 'electrum1.bluewallet.io', ssl: '443' },
  { host: 'electrum.acinq.co', ssl: '50002' },
  { host: 'electrum.bitaroo.net', ssl: '50002' },
  { host: 'VPS.hsmiths.com', tcp: '50001', ssl: '50002' },
  { host: 'helicarrier.bauerj.eu', tcp: '50001', ssl: '50002' },
  { host: 'kirsche.emzy.de', tcp: '50001', ssl: '50002' },
];

/** @type {ElectrumClient} */
let mainClient;
let serverName = false;
let disableBatching = false;
let connectionAttempt = 0;
let currentPeerIndex = Math.floor(Math.random() * hardcodedPeers.length);
let isDisabledCache = undefined;

let latestBlockheight = false;
let latestBlockheightTimestamp = false;

const txhashHeightCache = {};

let connectionPromise = null;
let waitTillConnectedPromise = null;
let flushTillConnectedPromise = null;
let rotatePeerTimeout = null;

let networkConnected = true;

async function isDisabled() {
  if (isDisabledCache !== undefined) return isDisabledCache;

  let result;
  try {
    const savedValue = await AsyncStorage.getItem(ELECTRUM_CONNECTION_DISABLED);
    if (savedValue === null) {
      result = false;
    } else {
      result = savedValue;
    }
  } catch {
    result = false;
  }

  isDisabledCache = !!result;
  return isDisabledCache;
}

async function setDisabled(disabled = true) {
  isDisabledCache = disabled;
  return AsyncStorage.setItem(ELECTRUM_CONNECTION_DISABLED, disabled ? '1' : '');
}

async function connectMain() {
  if (await isDisabled()) {
    console.log('Electrum connection disabled by user. Skipping connectMain call');
    return;
  }

  if (!networkConnected) {
    console.warn('Network is not connected, skipping Electrum connection');
    return;
  }

  if (connectionPromise) return connectionPromise;

  connectionPromise = _initConnection().finally(() => {
    if (isMainClientConnected()) {
      console.log('Electrum connection established, rotating peer in 30 minutes');
      connectionAttempt = 0;
      clearTimeout(rotatePeerTimeout);
      rotatePeerTimeout = setTimeout(
        () => {
          mainClient?.close?.();
          connectMain();
        },
        30 * 60 * 1000,
      );
    } else if (connectionAttempt++ > hardcodedPeers.length * 2) {
      mainClient?.close?.();
    } else {
      console.log('Electrum connection not established, trying again');
      connectMain();
    }

    // Ready for receiving next connection attempt
    connectionPromise = null;
  });
}

async function _initConnection() {
  if (await isDisabled()) {
    console.log('Electrum connection disabled by user. Skipping _initConnection call');
    return;
  }

  if (isMainClientConnected()) return;

  let usingPeer = await getNextPeer();
  const savedPeer = await getSavedPeer();
  if (savedPeer && savedPeer.host && (savedPeer.tcp || savedPeer.ssl)) {
    usingPeer = savedPeer;
  }

  await DefaultPreference.setName('group.swiss.dfx.bitcoin');
  try {
    if (usingPeer.host.endsWith('onion')) {
      const randomPeer = await getCurrentPeer();
      await DefaultPreference.set(ELECTRUM_HOST, randomPeer.host);
      await DefaultPreference.set(ELECTRUM_TCP_PORT, randomPeer.tcp);
      await DefaultPreference.set(ELECTRUM_SSL_PORT, randomPeer.ssl);
    } else {
      await DefaultPreference.set(ELECTRUM_HOST, usingPeer.host);
      await DefaultPreference.set(ELECTRUM_TCP_PORT, usingPeer.tcp);
      await DefaultPreference.set(ELECTRUM_SSL_PORT, usingPeer.ssl);
    }

    WidgetCommunication.reloadAllTimelines();
  } catch (e) {
    // Must be running on Android
    console.log(e);
  }

  try {
    console.log('begin connection:', JSON.stringify(usingPeer));
    mainClient = new ElectrumClient(
      usingPeer.host.endsWith('.onion') && !(await isTorDaemonDisabled()) ? torrific : global.net,
      global.tls,
      usingPeer.ssl || usingPeer.tcp,
      usingPeer.host,
      usingPeer.ssl ? 'tls' : 'tcp',
    );

    mainClient.onError = function (e) {
      console.log('electrum mainClient.onError():', e.message);
      mainClient.close();
      connectMain();
    };

    mainClient.onConnect = function () {
      if (flushTillConnectedPromise) {
        flushTillConnectedPromise();
      }
    };

    const electrumConfig = { client: 'bluewallet', version: '1.4' };
    const persistentConfig = { maxRetry: -1, callBack: () => {} }; // this is a hack for preventing the base library from retrying, we will handle the retry logic on our side

    const ver = await Promise.race([
      mainClient.initElectrum(electrumConfig, persistentConfig),
      new Promise(resolve => setTimeout(resolve, 10 * 1000)), // don't wait for slow servers
    ]);

    if (!ver || !ver[0]) {
      throw new Error('Electrum connection timed out');
    }

    console.log('connected to ', ver);
    serverName = ver[0];

    if (ver[0].startsWith('ElectrumPersonalServer') || ver[0].startsWith('electrs') || ver[0].startsWith('Fulcrum')) {
      disableBatching = true;

      // exeptions for versions:
      const [electrumImplementation, electrumVersion] = ver[0].split(' ');
      switch (electrumImplementation) {
        case 'electrs':
          if (semVerToInt(electrumVersion) >= semVerToInt('0.9.0')) {
            disableBatching = false;
          }
          break;
        case 'electrs-esplora':
          // its a different one, and it does NOT support batching
          // nop
          break;
        case 'Fulcrum':
          if (semVerToInt(electrumVersion) >= semVerToInt('1.9.0')) {
            disableBatching = false;
          }
          break;
      }
    }
    const header = await mainClient.blockchainHeaders_subscribe();
    if (header && header.height) {
      latestBlockheight = header.height;
      latestBlockheightTimestamp = Math.floor(+new Date() / 1000);
    }
    // AsyncStorage.setItem(storageKey, JSON.stringify(peers));  TODO: refactor
  } catch (e) {
    console.log('bad connection:', JSON.stringify(usingPeer), e);
  }
}

async function getCurrentPeer() {
  return hardcodedPeers[currentPeerIndex];
}

function isMainClientConnected() {
  return mainClient && mainClient.timeLastCall !== 0 && mainClient.status;
}

/**
 * Returns NEXT hardcoded electrum server (increments index after use)
 *
 * @returns {Promise<{tcp, host, ssl?}|*>}
 */
async function getNextPeer() {
  currentPeerIndex++;
  if (currentPeerIndex >= hardcodedPeers.length) currentPeerIndex = 0;
  return getCurrentPeer();
}

async function getSavedPeer() {
  const host = await AsyncStorage.getItem(ELECTRUM_HOST);
  const port = await AsyncStorage.getItem(ELECTRUM_TCP_PORT);
  const sslPort = await AsyncStorage.getItem(ELECTRUM_SSL_PORT);
  return { host, tcp: port, ssl: sslPort };
}

/**
 * Returns random electrum server out of list of servers
 * previous electrum server told us. Nearly half of them is
 * usually offline.
 * Not used for now.
 *
 * @returns {Promise<{tcp: number, host: string}>}
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function getRandomDynamicPeer() {
  try {
    let peers = JSON.parse(await AsyncStorage.getItem(storageKey));
    peers = peers.sort(() => Math.random() - 0.5); // shuffle
    for (const peer of peers) {
      const ret = {};
      ret.host = peer[1];
      for (const item of peer[2]) {
        if (item.startsWith('t')) {
          ret.tcp = item.replace('t', '');
        }
      }
      if (ret.host && ret.tcp) return ret;
    }

    return defaultPeer; // failed to find random client, using default
  } catch (_) {
    return defaultPeer; // smth went wrong, using default
  }
}

/**
 *
 * @param address {String}
 * @returns {Promise<Object>}
 */
module.exports.getBalanceByAddress = async function (address) {
  if (!mainClient) throw new Error('getBalanceByAddress: Electrum client is not connected');
  const script = bitcoin.address.toOutputScript(address);
  const hash = bitcoin.crypto.sha256(script);
  const reversedHash = Buffer.from(reverse(hash));
  const balance = await mainClient.blockchainScripthash_getBalance(reversedHash.toString('hex'));
  balance.addr = address;
  return balance;
};

module.exports.getConfig = async function () {
  if (!mainClient) throw new Error('getConfig: Electrum client is not connected');
  return {
    host: mainClient.host,
    port: mainClient.port,
    serverName,
    connected: mainClient.timeLastCall !== 0 && mainClient.status,
  };
};

module.exports.getSecondsSinceLastRequest = function () {
  return mainClient && mainClient.timeLastCall ? (+new Date() - mainClient.timeLastCall) / 1000 : -1;
};

/**
 *
 * @param address {String}
 * @returns {Promise<Array>}
 */
module.exports.getTransactionsByAddress = async function (address) {
  if (!mainClient) throw new Error('getTransactionsByAddress: Electrum client is not connected');
  const script = bitcoin.address.toOutputScript(address);
  const hash = bitcoin.crypto.sha256(script);
  const reversedHash = Buffer.from(reverse(hash));
  const history = await mainClient.blockchainScripthash_getHistory(reversedHash.toString('hex'));
  for (const h of history || []) {
    if (h.tx_hash) txhashHeightCache[h.tx_hash] = h.height; // cache tx height
  }

  return history;
};

/**
 *
 * @param address {String}
 * @returns {Promise<Array>}
 */
module.exports.getMempoolTransactionsByAddress = async function (address) {
  if (!mainClient) throw new Error('getMempoolTransactionsByAddress: Electrum client is not connected');
  const script = bitcoin.address.toOutputScript(address);
  const hash = bitcoin.crypto.sha256(script);
  const reversedHash = Buffer.from(reverse(hash));
  return mainClient.blockchainScripthash_getMempool(reversedHash.toString('hex'));
};

module.exports.ping = async function () {
  try {
    await mainClient.server_ping();
  } catch (_) {
    return false;
  }
  return true;
};

module.exports.getTransactionsFullByAddress = async function (address) {
  const txs = await this.getTransactionsByAddress(address);
  const ret = [];
  for (const tx of txs) {
    let full;
    try {
      full = await mainClient.blockchainTransaction_get(tx.tx_hash, true);
    } catch (error) {
      if (String(error?.message ?? error).startsWith('verbose transactions are currently unsupported')) {
        // apparently, stupid esplora instead of returning txhex when it cant return verbose tx started
        // throwing a proper exception. lets fetch txhex manually and decode on our end
        const txhex = await mainClient.blockchainTransaction_get(tx.tx_hash, false);
        full = txhexToElectrumTransaction(txhex);
      } else {
        // nope, its something else
        throw new Error(String(error?.message ?? error));
      }
    }
    full.address = address;
    for (const input of full.vin) {
      // now we need to fetch previous TX where this VIN became an output, so we can see its amount
      let prevTxForVin;
      try {
        prevTxForVin = await mainClient.blockchainTransaction_get(input.txid, true);
      } catch (error) {
        if (String(error?.message ?? error).startsWith('verbose transactions are currently unsupported')) {
          // apparently, stupid esplora instead of returning txhex when it cant return verbose tx started
          // throwing a proper exception. lets fetch txhex manually and decode on our end
          const txhex = await mainClient.blockchainTransaction_get(input.txid, false);
          prevTxForVin = txhexToElectrumTransaction(txhex);
        } else {
          // nope, its something else
          throw new Error(String(error?.message ?? error));
        }
      }
      if (prevTxForVin && prevTxForVin.vout && prevTxForVin.vout[input.vout]) {
        input.value = prevTxForVin.vout[input.vout].value;
        // also, we extract destination address from prev output:
        if (prevTxForVin.vout[input.vout].scriptPubKey && prevTxForVin.vout[input.vout].scriptPubKey.addresses) {
          input.addresses = prevTxForVin.vout[input.vout].scriptPubKey.addresses;
        }
        // in bitcoin core 22.0.0+ they removed `.addresses` and replaced it with plain `.address`:
        if (prevTxForVin.vout[input.vout]?.scriptPubKey?.address) {
          input.addresses = [prevTxForVin.vout[input.vout].scriptPubKey.address];
        }
      }
    }

    for (const output of full.vout) {
      if (output.scriptPubKey && output.scriptPubKey.addresses) output.addresses = output.scriptPubKey.addresses;
      // in bitcoin core 22.0.0+ they removed `.addresses` and replaced it with plain `.address`:
      if (output?.scriptPubKey?.address) output.addresses = [output.scriptPubKey.address];
    }
    full.inputs = full.vin;
    full.outputs = full.vout;
    delete full.vin;
    delete full.vout;
    delete full.hex; // compact
    delete full.hash; // compact
    ret.push(full);
  }

  return ret;
};

/**
 *
 * @param addresses {Array}
 * @param batchsize {Number}
 * @returns {Promise<{balance: number, unconfirmed_balance: number, addresses: object}>}
 */
module.exports.multiGetBalanceByAddress = async function (addresses, batchsize) {
  batchsize = batchsize || 200;
  if (!mainClient) throw new Error('multiGetBalanceByAddress: Electrum client is not connected');
  const ret = { balance: 0, unconfirmed_balance: 0, addresses: {} };

  const chunks = splitIntoChunks(addresses, batchsize);
  for (const chunk of chunks) {
    const scripthashes = [];
    const scripthash2addr = {};
    for (const addr of chunk) {
      const script = bitcoin.address.toOutputScript(addr);
      const hash = bitcoin.crypto.sha256(script);
      let reversedHash = Buffer.from(reverse(hash));
      reversedHash = reversedHash.toString('hex');
      scripthashes.push(reversedHash);
      scripthash2addr[reversedHash] = addr;
    }

    let balances = [];

    if (disableBatching) {
      const promises = [];
      const index2scripthash = {};
      for (let promiseIndex = 0; promiseIndex < scripthashes.length; promiseIndex++) {
        promises.push(mainClient.blockchainScripthash_getBalance(scripthashes[promiseIndex]));
        index2scripthash[promiseIndex] = scripthashes[promiseIndex];
      }
      const promiseResults = await Promise.all(promises);
      for (let resultIndex = 0; resultIndex < promiseResults.length; resultIndex++) {
        balances.push({ result: promiseResults[resultIndex], param: index2scripthash[resultIndex] });
      }
    } else {
      balances = await mainClient.blockchainScripthash_getBalanceBatch(scripthashes);
    }

    for (const bal of balances) {
      if (bal.error) console.warn('multiGetBalanceByAddress():', bal.error);
      ret.balance += +bal.result.confirmed;
      ret.unconfirmed_balance += +bal.result.unconfirmed;
      ret.addresses[scripthash2addr[bal.param]] = bal.result;
    }
  }

  return ret;
};

module.exports.multiGetUtxoByAddress = async function (addresses, batchsize) {
  batchsize = batchsize || 100;
  if (!mainClient) throw new Error('multiGetUtxoByAddress: Electrum client is not connected');
  const ret = {};

  const chunks = splitIntoChunks(addresses, batchsize);
  for (const chunk of chunks) {
    const scripthashes = [];
    const scripthash2addr = {};
    for (const addr of chunk) {
      const script = bitcoin.address.toOutputScript(addr);
      const hash = bitcoin.crypto.sha256(script);
      let reversedHash = Buffer.from(reverse(hash));
      reversedHash = reversedHash.toString('hex');
      scripthashes.push(reversedHash);
      scripthash2addr[reversedHash] = addr;
    }

    let results = [];

    if (disableBatching) {
      // ElectrumPersonalServer doesnt support `blockchain.scripthash.listunspent`
      // electrs OTOH supports it, but we dont know it we are currently connected to it or to EPS
      // so it is pretty safe to do nothing, as caller can derive UTXO from stored transactions
    } else {
      results = await mainClient.blockchainScripthash_listunspentBatch(scripthashes);
    }

    for (const utxos of results) {
      ret[scripthash2addr[utxos.param]] = utxos.result;
      for (const utxo of ret[scripthash2addr[utxos.param]]) {
        utxo.address = scripthash2addr[utxos.param];
        utxo.txId = utxo.tx_hash;
        utxo.vout = utxo.tx_pos;
        delete utxo.tx_pos;
        delete utxo.tx_hash;
      }
    }
  }

  return ret;
};

module.exports.multiGetHistoryByAddress = async function (addresses, batchsize) {
  batchsize = batchsize || 100;
  if (!mainClient) throw new Error('multiGetHistoryByAddress: Electrum client is not connected');
  const ret = {};

  const chunks = splitIntoChunks(addresses, batchsize);
  for (const chunk of chunks) {
    const scripthashes = [];
    const scripthash2addr = {};
    for (const addr of chunk) {
      const script = bitcoin.address.toOutputScript(addr);
      const hash = bitcoin.crypto.sha256(script);
      let reversedHash = Buffer.from(reverse(hash));
      reversedHash = reversedHash.toString('hex');
      scripthashes.push(reversedHash);
      scripthash2addr[reversedHash] = addr;
    }

    let results = [];

    if (disableBatching) {
      const promises = [];
      const index2scripthash = {};
      for (let promiseIndex = 0; promiseIndex < scripthashes.length; promiseIndex++) {
        index2scripthash[promiseIndex] = scripthashes[promiseIndex];
        promises.push(mainClient.blockchainScripthash_getHistory(scripthashes[promiseIndex]));
      }
      const histories = await Promise.all(promises);
      for (let historyIndex = 0; historyIndex < histories.length; historyIndex++) {
        results.push({ result: histories[historyIndex], param: index2scripthash[historyIndex] });
      }
    } else {
      results = await mainClient.blockchainScripthash_getHistoryBatch(scripthashes);
    }

    for (const history of results) {
      if (history.error) console.warn('multiGetHistoryByAddress():', history.error);
      ret[scripthash2addr[history.param]] = history.result || [];
      for (const result of history.result || []) {
        if (result.tx_hash) txhashHeightCache[result.tx_hash] = result.height; // cache tx height
      }

      for (const hist of ret[scripthash2addr[history.param]]) {
        hist.address = scripthash2addr[history.param];
      }
    }
  }

  return ret;
};

module.exports.multiGetTransactionByTxid = async function (txids, batchsize, verbose = true) {
  batchsize = batchsize || 45;
  // this value is fine-tuned so althrough wallets in test suite will occasionally
  // throw 'response too large (over 1,000,000 bytes', test suite will pass
  if (!mainClient) throw new Error('multiGetTransactionByTxid: Electrum client is not connected');
  const ret = {};
  txids = [...new Set(txids)]; // deduplicate just for any case

  // lets try cache first:
  const realm = await _getRealm();
  const cacheKeySuffix = verbose ? '_verbose' : '_non_verbose';
  const keysCacheMiss = [];
  for (const txid of txids) {
    const jsonString = realm.objectForPrimaryKey('Cache', txid + cacheKeySuffix); // search for a realm object with a primary key
    if (jsonString && jsonString.cache_value) {
      try {
        ret[txid] = JSON.parse(jsonString.cache_value);
      } catch (error) {
        console.log(error, 'cache failed to parse', jsonString.cache_value);
      }
    }

    if (!ret[txid]) keysCacheMiss.push(txid);
  }

  if (keysCacheMiss.length === 0) {
    return ret;
  }

  txids = keysCacheMiss;
  // end cache

  const chunks = splitIntoChunks(txids, batchsize);
  for (const chunk of chunks) {
    let results = [];

    if (disableBatching) {
      try {
        // in case of ElectrumPersonalServer it might not track some transactions (like source transactions for our transactions)
        // so we wrap it in try-catch. note, when `Promise.all` fails we will get _zero_ results, but we have a fallback for that
        const promises = [];
        const index2txid = {};
        for (let promiseIndex = 0; promiseIndex < chunk.length; promiseIndex++) {
          const txid = chunk[promiseIndex];
          index2txid[promiseIndex] = txid;
          promises.push(mainClient.blockchainTransaction_get(txid, verbose));
        }

        const transactionResults = await Promise.all(promises);
        for (let resultIndex = 0; resultIndex < transactionResults.length; resultIndex++) {
          let tx = transactionResults[resultIndex];
          if (typeof tx === 'string' && verbose) {
            // apparently electrum server (EPS?) didnt recognize VERBOSE parameter, and  sent us plain txhex instead of decoded tx.
            // lets decode it manually on our end then:
            tx = txhexToElectrumTransaction(tx);
          }
          const txid = index2txid[resultIndex];
          results.push({ result: tx, param: txid });
        }
      } catch (_) {
        if (String(_?.message ?? _).startsWith('verbose transactions are currently unsupported')) {
          // electrs-esplora. cant use verbose, so fetching txs one by one and decoding locally
          for (const txid of chunk) {
            try {
              let tx = await mainClient.blockchainTransaction_get(txid, false);
              tx = txhexToElectrumTransaction(tx);
              results.push({ result: tx, param: txid });
            } catch (error) {
              console.log(error);
            }
          }
        } else {
          // fallback. pretty sure we are connected to EPS.  we try getting transactions one-by-one. this way we wont
          // fail and only non-tracked by EPS transactions will be omitted
          for (const txid of chunk) {
            try {
              let tx = await mainClient.blockchainTransaction_get(txid, verbose);
              if (typeof tx === 'string' && verbose) {
                // apparently electrum server (EPS?) didnt recognize VERBOSE parameter, and  sent us plain txhex instead of decoded tx.
                // lets decode it manually on our end then:
                tx = txhexToElectrumTransaction(tx);
              }
              results.push({ result: tx, param: txid });
            } catch (error) {
              console.log(error);
            }
          }
        }
      }
    } else {
      results = await mainClient.blockchainTransaction_getBatch(chunk, verbose);
    }

    for (const txdata of results) {
      if (txdata.error && txdata.error.code === -32600) {
        // response too large
        // lets do single call, that should go through okay:
        txdata.result = await mainClient.blockchainTransaction_get(txdata.param, false);
        // since we used VERBOSE=false, server sent us plain txhex which we must decode on our end:
        txdata.result = txhexToElectrumTransaction(txdata.result);
      }
      ret[txdata.param] = txdata.result;
      if (ret[txdata.param]) delete ret[txdata.param].hex; // compact
    }
  }

  // in bitcoin core 22.0.0+ they removed `.addresses` and replaced it with plain `.address`:
  for (const txid of Object.keys(ret) ?? []) {
    for (const vout of ret[txid]?.vout ?? []) {
      if (vout?.scriptPubKey?.address) vout.scriptPubKey.addresses = [vout.scriptPubKey.address];
    }
  }

  // saving cache:
  realm.write(() => {
    for (const txid of Object.keys(ret)) {
      if (verbose && (!ret[txid].confirmations || ret[txid].confirmations < 7)) continue;
      // dont cache immature txs, but only for 'verbose', since its fully decoded tx jsons. non-verbose are just plain
      // strings txhex
      realm.create(
        'Cache',
        {
          cache_key: txid + cacheKeySuffix,
          cache_value: JSON.stringify(ret[txid]),
        },
        Realm.UpdateMode.Modified,
      );
    }
  });

  return ret;
};

/**
 * Wait until main client is connected or timeout
 * register a flush function to be called when connected
 *
 * @returns {Promise<Promise<*> | Promise<*>>}
 */
module.exports.waitTillConnected = async function () {
  if (await isDisabled()) {
    console.warn('Electrum connections disabled by user. waitTillConnected skipping...');
    return;
  }

  if (isMainClientConnected()) {
    return true;
  }

  if (waitTillConnectedPromise) return waitTillConnectedPromise; // Singleton promise

  waitTillConnectedPromise = new Promise((resolve, reject) => {
    const timeoutReject = setTimeout(() => {
      waitTillConnectedPromise = null;
      flushTillConnectedPromise = null;
      connectMain();
      reject(new Error('Electrum connection timed out'));
    }, 5 * 1000);

    flushTillConnectedPromise = function () {
      waitTillConnectedPromise = null;
      flushTillConnectedPromise = null;
      clearTimeout(timeoutReject);
      resolve(true);
    };
  });

  return waitTillConnectedPromise;
};

// Returns the value at a given percentile in a sorted numeric array.
// "Linear interpolation between closest ranks" method
function percentile(arr, p) {
  if (arr.length === 0) return 0;
  if (typeof p !== 'number') throw new TypeError('p must be a number');
  if (p <= 0) return arr[0];
  if (p >= 1) return arr[arr.length - 1];

  const index = (arr.length - 1) * p;
  const lower = Math.floor(index);
  const upper = lower + 1;
  const weight = index % 1;

  if (upper >= arr.length) return arr[lower];
  return arr[lower] * (1 - weight) + arr[upper] * weight;
}

/**
 * The histogram is an array of [fee, vsize] pairs, where vsizen is the cumulative virtual size of mempool transactions
 * with a fee rate in the interval [feen-1, feen], and feen-1 > feen.
 *
 * @param numberOfBlocks {Number}
 * @param feeHistorgram {Array}
 * @returns {number}
 */
module.exports.calcEstimateFeeFromFeeHistorgam = function (numberOfBlocks, feeHistorgram) {
  // first, transforming histogram:
  let totalVsize = 0;
  const histogramToUse = [];
  for (const h of feeHistorgram) {
    let [fee, vsize] = h;
    let timeToStop = false;

    if (totalVsize + vsize >= 1000000 * numberOfBlocks) {
      vsize = 1000000 * numberOfBlocks - totalVsize; // only the difference between current summarized sige to tip of the block
      timeToStop = true;
    }

    histogramToUse.push({ fee, vsize });
    totalVsize += vsize;
    if (timeToStop) break;
  }

  // now we have histogram of precisely size for numberOfBlocks.
  // lets spread it into flat array so its easier to calculate percentile:
  let histogramFlat = [];
  for (const hh of histogramToUse) {
    histogramFlat = histogramFlat.concat(Array(Math.round(hh.vsize / 25000)).fill(hh.fee));
    // division is needed so resulting flat array is not too huge
  }

  histogramFlat = histogramFlat.sort(function (a, b) {
    return a - b;
  });

  return Math.round(percentile(histogramFlat, 0.5) || 1);
};

module.exports.estimateFees = async function () {
  let histogram;
  let timeoutId;
  try {
    histogram = await Promise.race([
      mainClient.mempool_getFeeHistogram(),
      new Promise(resolve => (timeoutId = setTimeout(resolve, 15000))),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!histogram) throw new Error('timeout while getting mempool_getFeeHistogram');

  // fetching what electrum (which uses bitcoin core) thinks about fees:
  const _fast = await module.exports.estimateFee(1);
  const _medium = await module.exports.estimateFee(18);
  const _slow = await module.exports.estimateFee(144);

  // calculating fast fees from mempool:
  const fast = Math.max(2, module.exports.calcEstimateFeeFromFeeHistorgam(1, histogram));
  // recalculating medium and slow fees using bitcoincore estimations only like relative weights:
  // (minimum 1 sat, just for any case)
  const medium = Math.max(1, Math.round((fast * _medium) / _fast));
  const slow = Math.max(1, Math.round((fast * _slow) / _fast));
  return { fast, medium, slow };
};

/**
 * Returns the estimated transaction fee to be confirmed within a certain number of blocks
 *
 * @param numberOfBlocks {number} The number of blocks to target for confirmation
 * @returns {Promise<number>} Satoshis per byte
 */
module.exports.estimateFee = async function (numberOfBlocks) {
  if (!mainClient) throw new Error('estimateFee: Electrum client is not connected');
  numberOfBlocks = numberOfBlocks || 1;
  const coinUnitsPerKilobyte = await mainClient.blockchainEstimatefee(numberOfBlocks);
  if (coinUnitsPerKilobyte === -1) return 1;
  return Math.round(new BigNumber(coinUnitsPerKilobyte).dividedBy(1024).multipliedBy(100000000).toNumber());
};

module.exports.serverFeatures = async function () {
  if (!mainClient) throw new Error('serverFeatures: Electrum client is not connected');
  return mainClient.server_features();
};

module.exports.broadcast = async function (hex) {
  if (!mainClient) throw new Error('broadcast: Electrum client is not connected');
  try {
    const broadcast = await mainClient.blockchainTransaction_broadcast(hex);
    return broadcast;
  } catch (error) {
    return error;
  }
};

module.exports.broadcastV2 = async function (hex) {
  if (!mainClient) throw new Error('broadcastV2: Electrum client is not connected');
  return mainClient.blockchainTransaction_broadcast(hex);
};

module.exports.estimateCurrentBlockheight = function () {
  if (latestBlockheight) {
    const timeDiff = Math.floor(+new Date() / 1000) - latestBlockheightTimestamp;
    const extraBlocks = Math.floor(timeDiff / (9.93 * 60));
    return latestBlockheight + extraBlocks;
  }

  const baseTs = 1587570465609; // uS
  const baseHeight = 627179;
  return Math.floor(baseHeight + (+new Date() - baseTs) / 1000 / 60 / 9.93);
};

/**
 *
 * @param height
 * @returns {number} Timestamp in seconds
 */
module.exports.calculateBlockTime = function (height) {
  if (latestBlockheight) {
    return Math.floor(latestBlockheightTimestamp + (height - latestBlockheight) * 9.93 * 60);
  }

  const baseTs = 1585837504; // sec
  const baseHeight = 624083;
  return Math.floor(baseTs + (height - baseHeight) * 9.93 * 60);
};

/**
 *
 * @param host
 * @param tcpPort
 * @param sslPort
 * @returns {Promise<boolean>} Whether provided host:port is a valid electrum server
 */
module.exports.testConnection = async function (host, tcpPort, sslPort) {
  const isTorDisabled = await isTorDaemonDisabled();
  const client = new ElectrumClient(
    host.endsWith('.onion') && !isTorDisabled ? torrific : global.net,
    global.tls,
    sslPort || tcpPort,
    host,
    sslPort ? 'tls' : 'tcp',
  );

  client.onError = () => {}; // mute
  let timeoutId = false;
  try {
    const rez = await Promise.race([
      new Promise(resolve => {
        timeoutId = setTimeout(() => resolve('timeout'), host.endsWith('.onion') && !isTorDisabled ? 21000 : 5000);
      }),
      client.connect(),
    ]);
    if (rez === 'timeout') return false;

    await client.server_version('2.7.11', '1.4');
    await client.server_ping();
    return true;
  } catch (_) {
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    client.close();
  }

  return false;
};

module.exports.forceDisconnect = () => {
  mainClient.close();
};

module.exports.setBatchingDisabled = () => {
  disableBatching = true;
};

module.exports.setBatchingEnabled = () => {
  disableBatching = false;
};
module.exports.connectMain = connectMain;
module.exports.isDisabled = isDisabled;
module.exports.setDisabled = setDisabled;
module.exports.hardcodedPeers = hardcodedPeers;
module.exports.ELECTRUM_HOST = ELECTRUM_HOST;
module.exports.ELECTRUM_TCP_PORT = ELECTRUM_TCP_PORT;
module.exports.ELECTRUM_SSL_PORT = ELECTRUM_SSL_PORT;
module.exports.ELECTRUM_SERVER_HISTORY = ELECTRUM_SERVER_HISTORY;

const splitIntoChunks = function (arr, chunkSize) {
  const groups = [];
  let i;
  for (i = 0; i < arr.length; i += chunkSize) {
    groups.push(arr.slice(i, i + chunkSize));
  }
  return groups;
};

const semVerToInt = function (semver) {
  if (!semver) return 0;
  if (semver.split('.').length !== 3) return 0;

  const ret = semver.split('.')[0] * 1000000 + semver.split('.')[1] * 1000 + semver.split('.')[2] * 1;

  if (isNaN(ret)) return 0;

  return ret;
};

function txhexToElectrumTransaction(txhex) {
  const tx = bitcoin.Transaction.fromHex(txhex);

  const ret = {
    txid: tx.getId(),
    hash: tx.getId(),
    version: tx.version,
    size: Math.ceil(txhex.length / 2),
    vsize: tx.virtualSize(),
    weight: tx.weight(),
    locktime: tx.locktime,
    vin: [],
    vout: [],
    hex: txhex,
    blockhash: '',
    confirmations: 0,
    time: 0,
    blocktime: 0,
  };

  if (txhashHeightCache[ret.txid]) {
    // got blockheight where this tx was confirmed
    ret.confirmations = module.exports.estimateCurrentBlockheight() - txhashHeightCache[ret.txid];
    if (ret.confirmations < 0) {
      // ugly fix for when estimator lags behind
      ret.confirmations = 1;
    }
    ret.time = module.exports.calculateBlockTime(txhashHeightCache[ret.txid]);
    ret.blocktime = module.exports.calculateBlockTime(txhashHeightCache[ret.txid]);
  }

  for (const inn of tx.ins) {
    const txinwitness = [];
    if (inn.witness[0]) txinwitness.push(inn.witness[0].toString('hex'));
    if (inn.witness[1]) txinwitness.push(inn.witness[1].toString('hex'));

    ret.vin.push({
      txid: reverse(inn.hash).toString('hex'),
      vout: inn.index,
      scriptSig: { hex: inn.script.toString('hex'), asm: '' },
      txinwitness,
      sequence: inn.sequence,
    });
  }

  let n = 0;
  for (const out of tx.outs) {
    const value = new BigNumber(out.value).dividedBy(100000000).toNumber();
    let address = false;
    let type = false;

    if (SegwitBech32Wallet.scriptPubKeyToAddress(out.script.toString('hex'))) {
      address = SegwitBech32Wallet.scriptPubKeyToAddress(out.script.toString('hex'));
      type = 'witness_v0_keyhash';
    } else if (SegwitP2SHWallet.scriptPubKeyToAddress(out.script.toString('hex'))) {
      address = SegwitP2SHWallet.scriptPubKeyToAddress(out.script.toString('hex'));
      type = '???'; // TODO
    } else if (LegacyWallet.scriptPubKeyToAddress(out.script.toString('hex'))) {
      address = LegacyWallet.scriptPubKeyToAddress(out.script.toString('hex'));
      type = '???'; // TODO
    } else {
      address = TaprootWallet.scriptPubKeyToAddress(out.script.toString('hex'));
      type = 'witness_v1_taproot';
    }

    ret.vout.push({
      value,
      n,
      scriptPubKey: {
        asm: '',
        hex: out.script.toString('hex'),
        reqSigs: 1, // todo
        type,
        addresses: [address],
      },
    });
    n++;
  }
  return ret;
}

// exported only to be used in unit tests
module.exports.txhexToElectrumTransaction = txhexToElectrumTransaction;

module.exports.setNetworkConnected = function (isConnected) {
  networkConnected = !!isConnected;
};
