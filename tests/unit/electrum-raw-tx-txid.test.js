/**
 * multiGetTransactionByTxid(..., verbose = false) returns raw transaction hexes keyed by
 * txid. A hex is only returned (and cached) when it hashes to the txid it is keyed by;
 * a cached hex that does not is ignored and fetched again.
 *
 * Only the network client and the cache store are mocked.
 */
import assert from 'assert';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as bitcoin from 'bitcoinjs-lib';

const mockServerTxs = {};
const mockCache = {};

jest.mock('realm', () => {
  const realm = {
    close() {},
    objectForPrimaryKey(_schema, key) {
      return key in mockCache ? { cache_key: key, cache_value: mockCache[key] } : null;
    },
    write(fn) {
      fn();
    },
    create(_schema, obj) {
      mockCache[obj.cache_key] = obj.cache_value;
    },
  };
  const Realm = { open: jest.fn(() => realm), UpdateMode: { Modified: 'modified' } };
  return Realm;
});

jest.mock('electrum-client', () =>
  jest.fn().mockImplementation(function () {
    this.status = 1;
    this.timeLastCall = 1;
    this.initElectrum = async () => ['Fulcrum 1.10.0', '1.4'];
    this.blockchainHeaders_subscribe = async () => ({ height: 1, hex: '00' });
    this.blockchainTransaction_getBatch = async txids => txids.map(txid => ({ param: txid, result: mockServerTxs[txid] }));
    this.close = () => {
      this.status = 0;
    };
  }),
);

const BlueElectrum = require('../../blue_modules/BlueElectrum');

const TXHEX =
  '02000000000102f1155666b534f7cb476a0523a45dc8731d38d56b5b08e877c968812423fbd7f3010000000000000000d8a2882a692ee759b43e6af48ac152dd3410cc4b7d25031e83b3396c16ffbc8900000000000000000002400d03000000000017a914e286d58e53f9247a4710e51232cce0686f16873c870695010000000000160014d3e2ecbf4d91321794e0297e0284c47527cf878b02483045022100d18dc865fb4d087004d021d480b983b8afb177a1934ce4cd11cf97b03e17944f02206d7310687a84aab5d4696d535bca69c2db4449b48feb55fff028aa004f2d1744012103af4b208608c75f38e78f6e5abfbcad9c360fb60d3e035193b2cd0cdc8fc0155c0247304402207556e859845df41d897fe442f59b6106c8fa39c74ba5b7b8e3268ab0aebf186f0220048a9f3742339c44a1e5c78b491822b96070bcfda3f64db9dc6434f8e8068475012102456e5223ed3884dc6b0e152067fd836e3eb1485422eda45558bf83f59c6ad09f00000000';
const TXID = '881c54edd95cbdd1583d6b9148eb35128a47b64a2e67a5368a649d6be960f08e';
const tampered = bitcoin.Transaction.fromHex(TXHEX);
tampered.outs[0].script = bitcoin.address.toOutputScript('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
const TAMPERED_HEX = tampered.toHex();
const CACHE_KEY = TXID + '_non_verbose';

beforeAll(async () => {
  await AsyncStorage.setItem(BlueElectrum.ELECTRUM_HOST, 'server.local');
  await AsyncStorage.setItem(BlueElectrum.ELECTRUM_TCP_PORT, '50001');
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
  await BlueElectrum.connectMain();
  await BlueElectrum.connectMain();
  for (let i = 0; i < 50; i++) await Promise.resolve();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterAll(() => {
  BlueElectrum.forceDisconnect();
  jest.useRealTimers();
});

beforeEach(() => {
  for (const key of Object.keys(mockServerTxs)) delete mockServerTxs[key];
  for (const key of Object.keys(mockCache)) delete mockCache[key];
});

describe('multiGetTransactionByTxid raw hex txid binding', () => {
  it('returns and caches a hex that matches its txid', async () => {
    mockServerTxs[TXID] = TXHEX;
    const ret = await BlueElectrum.multiGetTransactionByTxid([TXID], 10, false);
    assert.strictEqual(ret[TXID], TXHEX);
    assert.strictEqual(JSON.parse(mockCache[CACHE_KEY]), TXHEX);
  });

  it('drops a server hex that does not match the requested txid and does not cache it', async () => {
    mockServerTxs[TXID] = TAMPERED_HEX;
    const ret = await BlueElectrum.multiGetTransactionByTxid([TXID], 10, false);
    assert.strictEqual(ret[TXID], undefined);
    assert.strictEqual(mockCache[CACHE_KEY], undefined);
  });

  it('ignores a cached hex that does not match its txid and fetches it again', async () => {
    mockCache[CACHE_KEY] = JSON.stringify(TAMPERED_HEX);
    mockServerTxs[TXID] = TXHEX;
    const ret = await BlueElectrum.multiGetTransactionByTxid([TXID], 10, false);
    assert.strictEqual(ret[TXID], TXHEX);
    assert.strictEqual(JSON.parse(mockCache[CACHE_KEY]), TXHEX);
  });

  it('txhexMatchesTxid', () => {
    assert.strictEqual(BlueElectrum.txhexMatchesTxid(TXHEX, TXID), true);
    assert.strictEqual(BlueElectrum.txhexMatchesTxid(TAMPERED_HEX, TXID), false);
    assert.strictEqual(BlueElectrum.txhexMatchesTxid('zz', TXID), false);
    assert.strictEqual(BlueElectrum.txhexMatchesTxid({ hex: TXHEX }, TXID), false);
  });
});
