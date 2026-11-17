/**
 * The RBF/CPFP helpers fetch the original transaction by txid. The raw hex is only
 * used when it hashes to that txid, and the outputs of the replacement are taken
 * from that verified hex rather than from the decoded JSON the server sends along.
 */
import assert from 'assert';
import * as bitcoin from 'bitcoinjs-lib';

jest.mock('../../blue_modules/BlueElectrum', () => ({
  multiGetTransactionByTxid: jest.fn(),
}));

const BlueElectrum = require('../../blue_modules/BlueElectrum');
const { HDSegwitBech32Wallet, HDSegwitBech32Transaction } = require('../../class');

// 881c54edd95cbdd1583d6b9148eb35128a47b64a2e67a5368a649d6be960f08e: two inputs, one P2SH output, one P2WPKH output
const TXHEX =
  '02000000000102f1155666b534f7cb476a0523a45dc8731d38d56b5b08e877c968812423fbd7f3010000000000000000d8a2882a692ee759b43e6af48ac152dd3410cc4b7d25031e83b3396c16ffbc8900000000000000000002400d03000000000017a914e286d58e53f9247a4710e51232cce0686f16873c870695010000000000160014d3e2ecbf4d91321794e0297e0284c47527cf878b02483045022100d18dc865fb4d087004d021d480b983b8afb177a1934ce4cd11cf97b03e17944f02206d7310687a84aab5d4696d535bca69c2db4449b48feb55fff028aa004f2d1744012103af4b208608c75f38e78f6e5abfbcad9c360fb60d3e035193b2cd0cdc8fc0155c0247304402207556e859845df41d897fe442f59b6106c8fa39c74ba5b7b8e3268ab0aebf186f0220048a9f3742339c44a1e5c78b491822b96070bcfda3f64db9dc6434f8e8068475012102456e5223ed3884dc6b0e152067fd836e3eb1485422eda45558bf83f59c6ad09f00000000';
const TXID = '881c54edd95cbdd1583d6b9148eb35128a47b64a2e67a5368a649d6be960f08e';
const OTHER_ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

const decoded = bitcoin.Transaction.fromHex(TXHEX);
const RECIPIENT = bitcoin.address.fromOutputScript(decoded.outs[0].script);
const CHANGE = bitcoin.address.fromOutputScript(decoded.outs[1].script);

// same inputs, first output redirected: a different transaction with a different txid
const tampered = bitcoin.Transaction.fromHex(TXHEX);
tampered.outs[0].script = bitcoin.address.toOutputScript(OTHER_ADDRESS);
const TAMPERED_HEX = tampered.toHex();

const prevTxids = decoded.ins.map(inp => Buffer.from(inp.hash).reverse().toString('hex'));

function mockServer({ rawHex, remoteVout }) {
  BlueElectrum.multiGetTransactionByTxid.mockImplementation(async (txids, batchsize, verbose = true) => {
    const ret = {};
    for (const txid of txids) {
      if (txid === TXID) {
        if (verbose === false) {
          if (rawHex) ret[txid] = rawHex;
        } else {
          ret[txid] = { txid, confirmations: 0, vout: remoteVout };
        }
      } else if (prevTxids.includes(txid)) {
        ret[txid] = { txid, confirmations: 10, vout: [{ value: 0.002 }, { value: 0.002 }] };
      }
    }
    return ret;
  });
}

function makeWallet() {
  const wallet = new HDSegwitBech32Wallet();
  jest.spyOn(wallet, 'weOwnAddress').mockImplementation(address => address === CHANGE);
  return wallet;
}

const honestVout = [
  { n: 0, value: decoded.outs[0].value / 1e8, scriptPubKey: { addresses: [RECIPIENT] } },
  { n: 1, value: decoded.outs[1].value / 1e8, scriptPubKey: { addresses: [CHANGE] } },
];

afterEach(() => {
  BlueElectrum.multiGetTransactionByTxid.mockReset();
});

describe('HDSegwitBech32Transaction txid binding', () => {
  it('sanity: the tampered hex really is a different transaction', () => {
    assert.strictEqual(decoded.getId(), TXID);
    assert.notStrictEqual(tampered.getId(), TXID);
  });

  it('rejects a fetched hex that does not hash to the requested txid', async () => {
    mockServer({ rawHex: TAMPERED_HEX, remoteVout: honestVout });
    const tx = new HDSegwitBech32Transaction(null, TXID, makeWallet());

    await assert.rejects(() => tx.getInfo(), /does not match the requested txid/);
    await assert.rejects(() => tx.getMaxUsedSequence(), /does not match the requested txid/);
  });

  it('refuses to build a fee bump from a mismatching hex', async () => {
    mockServer({ rawHex: TAMPERED_HEX, remoteVout: honestVout });
    const wallet = makeWallet();
    const createTransaction = jest.spyOn(wallet, 'createTransaction').mockImplementation(() => ({}));
    const tx = new HDSegwitBech32Transaction(null, TXID, wallet);

    await assert.rejects(() => tx.createRBFbumpFee(100), /does not match the requested txid/);
    expect(createTransaction).not.toHaveBeenCalled();
  });

  it('accepts the matching hex and takes the bump targets from it', async () => {
    // the decoded JSON names a different recipient; the verified hex is authoritative
    mockServer({
      rawHex: TXHEX,
      remoteVout: [
        { n: 0, value: decoded.outs[0].value / 1e8, scriptPubKey: { addresses: [OTHER_ADDRESS] } },
        { n: 1, value: decoded.outs[1].value / 1e8, scriptPubKey: { addresses: [CHANGE] } },
      ],
    });
    const tx = new HDSegwitBech32Transaction(null, TXID, makeWallet());

    const info = await tx.getInfo();
    assert.deepStrictEqual(info.targets, [{ value: decoded.outs[0].value, address: RECIPIENT }]);
    assert.strictEqual(info.changeAmount, decoded.outs[1].value);
    assert.deepStrictEqual(info.unconfirmedUtxos, [{ vout: 1, value: decoded.outs[1].value, txId: TXID, address: CHANGE }]);
    assert.strictEqual(info.fee, 400000 - decoded.outs[0].value - decoded.outs[1].value);
  });

  it('passes the verified recipients to createTransaction for the bump', async () => {
    mockServer({ rawHex: TXHEX, remoteVout: honestVout });
    const wallet = makeWallet();
    jest.spyOn(wallet, 'getChangeAddressAsync').mockResolvedValue(CHANGE);
    const createTransaction = jest.spyOn(wallet, 'createTransaction').mockImplementation(() => ({}));
    const tx = new HDSegwitBech32Transaction(null, TXID, wallet);

    await tx.createRBFbumpFee(1000);
    expect(createTransaction).toHaveBeenCalledTimes(1);
    assert.deepStrictEqual(createTransaction.mock.calls[0][1], [{ value: decoded.outs[0].value, address: RECIPIENT }]);
  });
});
