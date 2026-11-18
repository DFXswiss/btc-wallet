/**
 * The RBF/CPFP helpers fetch the original transaction and the transactions it spends by
 * txid. A raw hex is only used when it hashes to the txid it was requested by, and the
 * outputs of the replacement and the input amounts are taken from those verified hexes
 * rather than from the decoded JSON the server sends along.
 */
import assert from 'assert';
import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import ecc from '../../blue_modules/noble_ecc';

jest.mock('../../blue_modules/BlueElectrum', () => ({
  multiGetTransactionByTxid: jest.fn(),
}));

const BlueElectrum = require('../../blue_modules/BlueElectrum');
const { HDSegwitBech32Wallet, HDSegwitBech32Transaction } = require('../../class');

const RECIPIENT = bitcoin.address.fromOutputScript(Buffer.from('a914e286d58e53f9247a4710e51232cce0686f16873c87', 'hex'));
const OTHER_ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
// the key that owns the spent outputs and signs the inputs
const KEY = ECPairFactory(ecc).fromPrivateKey(Buffer.alloc(32, 7));
const CHANGE = bitcoin.payments.p2wpkh({ pubkey: KEY.publicKey }).address;

const PREV_VALUE = 200000;
const RECIPIENT_VALUE = 200000;
const CHANGE_VALUE = 103686;

function makeParent(seed) {
  const parent = new bitcoin.Transaction();
  parent.version = 2;
  parent.addInput(Buffer.alloc(32, seed), 0);
  parent.addOutput(bitcoin.address.toOutputScript(OTHER_ADDRESS), 12345);
  parent.addOutput(bitcoin.address.toOutputScript(CHANGE), PREV_VALUE);
  return parent;
}

function signP2wpkhInputs(tx, values) {
  const scriptCode = bitcoin.payments.p2pkh({ pubkey: KEY.publicKey }).output;
  tx.ins.forEach((inp, i) => {
    if (values[i] === undefined) return;
    const hash = tx.hashForWitnessV0(i, scriptCode, values[i], bitcoin.Transaction.SIGHASH_ALL);
    inp.witness = [bitcoin.script.signature.encode(KEY.sign(hash), bitcoin.Transaction.SIGHASH_ALL), KEY.publicKey];
  });
}

// spends output 1 of two parents and pays the recipient plus change; extraOuts are appended
function makeChild(parents, extraOuts = []) {
  const child = new bitcoin.Transaction();
  child.version = 2;
  for (const parent of parents) child.addInput(parent.getHash(), 1, 0);
  child.addOutput(bitcoin.address.toOutputScript(RECIPIENT), RECIPIENT_VALUE);
  child.addOutput(bitcoin.address.toOutputScript(CHANGE), CHANGE_VALUE);
  for (const { script, value } of extraOuts) child.addOutput(script, value);
  signP2wpkhInputs(
    child,
    parents.map(() => PREV_VALUE),
  );
  return child;
}

const parents = [makeParent(1), makeParent(2)];
const child = makeChild(parents);
const TXID = child.getId();
const TXHEX = child.toHex();

// same inputs, first output redirected: a different transaction with a different txid
const tampered = makeChild(parents);
tampered.outs[0].script = bitcoin.address.toOutputScript(OTHER_ADDRESS);
const TAMPERED_HEX = tampered.toHex();

const OP_RETURN = bitcoin.payments.embed({ data: [Buffer.from('memo')] }).output;

/**
 * rawHexes: txid -> raw hex returned for verbose = false
 * verboseTxs: txid -> decoded JSON returned for verbose = true (never trusted for amounts or outputs)
 */
function mockServer(rawHexes, verboseTxs = {}) {
  BlueElectrum.multiGetTransactionByTxid.mockImplementation(async (txids, batchsize, verbose = true) => {
    const ret = {};
    for (const txid of txids) {
      const source = verbose === false ? rawHexes : verboseTxs;
      if (source[txid]) ret[txid] = source[txid];
    }
    return ret;
  });
}

function honestServer(tx = child) {
  mockServer({
    [tx.getId()]: tx.toHex(),
    [parents[0].getId()]: parents[0].toHex(),
    [parents[1].getId()]: parents[1].toHex(),
  });
}

function makeWallet() {
  const wallet = new HDSegwitBech32Wallet();
  jest.spyOn(wallet, 'weOwnAddress').mockImplementation(address => address === CHANGE);
  jest.spyOn(wallet, 'getChangeAddressAsync').mockResolvedValue(CHANGE);
  jest.spyOn(wallet, 'createTransaction').mockImplementation(() => ({ tx: child, inputs: [], outputs: [], fee: 1000 }));
  return wallet;
}

afterEach(() => {
  BlueElectrum.multiGetTransactionByTxid.mockReset();
});

describe('HDSegwitBech32Transaction txid binding', () => {
  it('sanity: the tampered hex really is a different transaction', () => {
    assert.notStrictEqual(tampered.getId(), TXID);
    assert.strictEqual(bitcoin.Transaction.fromHex(TXHEX).getId(), TXID);
  });

  it('rejects a fetched hex that does not hash to the requested txid', async () => {
    mockServer({ [TXID]: TAMPERED_HEX, [parents[0].getId()]: parents[0].toHex(), [parents[1].getId()]: parents[1].toHex() });
    const tx = new HDSegwitBech32Transaction(null, TXID, makeWallet());

    await assert.rejects(() => tx.getInfo(), /does not match the requested txid/);
    await assert.rejects(() => tx.getMaxUsedSequence(), /does not match the requested txid/);
  });

  it('refuses to build a fee bump from a mismatching hex', async () => {
    mockServer({ [TXID]: TAMPERED_HEX, [parents[0].getId()]: parents[0].toHex(), [parents[1].getId()]: parents[1].toHex() });
    const wallet = makeWallet();
    const tx = new HDSegwitBech32Transaction(null, TXID, wallet);

    await assert.rejects(() => tx.createRBFbumpFee(100), /does not match the requested txid/);
    expect(wallet.createTransaction).not.toHaveBeenCalled();
  });

  it('takes targets, change and input amounts from the verified hexes, not from the decoded JSON', async () => {
    mockServer(
      { [TXID]: TXHEX, [parents[0].getId()]: parents[0].toHex(), [parents[1].getId()]: parents[1].toHex() },
      {
        [TXID]: {
          txid: TXID,
          vout: [
            { n: 0, value: RECIPIENT_VALUE / 1e8, scriptPubKey: { addresses: [OTHER_ADDRESS] } },
            { n: 1, value: CHANGE_VALUE / 1e8, scriptPubKey: { addresses: [CHANGE] } },
          ],
        },
        [parents[0].getId()]: { vout: [{ value: 0 }, { value: 1 }] },
        [parents[1].getId()]: { vout: [{ value: 0 }, { value: 1 }] },
      },
    );
    const tx = new HDSegwitBech32Transaction(null, TXID, makeWallet());

    const info = await tx.getInfo();
    assert.deepStrictEqual(info.targets, [{ value: RECIPIENT_VALUE, address: RECIPIENT }]);
    assert.strictEqual(info.changeAmount, CHANGE_VALUE);
    assert.deepStrictEqual(info.unconfirmedUtxos, [{ vout: 1, value: CHANGE_VALUE, txId: TXID, address: CHANGE }]);
    assert.deepStrictEqual(
      info.utxos.map(u => [u.txId, u.vout, u.value]),
      parents.map(p => [p.getId(), 1, PREV_VALUE]),
    );
    assert.strictEqual(info.fee, 2 * PREV_VALUE - RECIPIENT_VALUE - CHANGE_VALUE);
  });

  it('rejects a previous transaction hex that does not hash to its txid', async () => {
    const fakeParent = makeParent(1);
    fakeParent.outs[1].value = 5 * PREV_VALUE;
    mockServer({ [TXID]: TXHEX, [parents[0].getId()]: fakeParent.toHex(), [parents[1].getId()]: parents[1].toHex() });
    const tx = new HDSegwitBech32Transaction(null, TXID, makeWallet());

    await assert.rejects(() => tx.getInfo(), /does not match the requested txid/);
  });

  it('refuses to compute the fee when a spent transaction is missing', async () => {
    // what multiGetTransactionByTxid returns after it dropped a mismatching or absent hex
    mockServer({ [TXID]: TXHEX, [parents[1].getId()]: parents[1].toHex() });
    const wallet = makeWallet();

    await assert.rejects(() => new HDSegwitBech32Transaction(null, TXID, wallet).getInfo(), /can't be fetched/);
    await assert.rejects(() => new HDSegwitBech32Transaction(null, TXID, wallet).createCPFPbumpFee(100), /can't be fetched/);
    await assert.rejects(() => new HDSegwitBech32Transaction(null, TXID, wallet).createRBFbumpFee(100), /can't be fetched/);
    await assert.rejects(() => new HDSegwitBech32Transaction(null, TXID, wallet).createRBFcancelTx(100), /can't be fetched/);
    expect(wallet.createTransaction).not.toHaveBeenCalled();
  });

  it('refuses to compute the fee when a spent output does not exist', async () => {
    const shortParent = makeParent(1);
    shortParent.outs.pop();
    const spendsMissingOutput = makeChild([shortParent, parents[1]]);
    mockServer({
      [spendsMissingOutput.getId()]: spendsMissingOutput.toHex(),
      [shortParent.getId()]: shortParent.toHex(),
      [parents[1].getId()]: parents[1].toHex(),
    });

    await assert.rejects(() => new HDSegwitBech32Transaction(null, spendsMissingOutput.getId(), makeWallet()).getInfo(), /has no output 1/);
  });

  it('passes the verified recipients to createTransaction for the bump', async () => {
    honestServer();
    const wallet = makeWallet();
    const tx = new HDSegwitBech32Transaction(null, TXID, wallet);

    await tx.createRBFbumpFee(1000);
    expect(wallet.createTransaction).toHaveBeenCalledTimes(1);
    assert.deepStrictEqual(wallet.createTransaction.mock.calls[0][1], [{ value: RECIPIENT_VALUE, address: RECIPIENT }]);
  });

  describe('witness data, which the txid does not cover', () => {
    it('takes input addresses from the spent outputs and counts verified witnesses in the size', async () => {
      honestServer();
      const info = await new HDSegwitBech32Transaction(null, TXID, makeWallet()).getInfo();

      assert.deepStrictEqual(
        info.utxos.map(u => u.address),
        [CHANGE, CHANGE],
      );
      assert.strictEqual(info.vsize, child.virtualSize());
      assert.strictEqual(info.feeRate, Math.floor(info.fee / child.virtualSize()));
    });

    it('rejects a witness that was changed without changing the txid', async () => {
      const padded = bitcoin.Transaction.fromHex(TXHEX);
      padded.ins[0].witness = [...padded.ins[0].witness, Buffer.alloc(4000, 1)];
      const otherKey = ECPairFactory(ecc).fromPrivateKey(Buffer.alloc(32, 9));
      const resigned = bitcoin.Transaction.fromHex(TXHEX);
      const hash = resigned.hashForWitnessV0(
        0,
        bitcoin.payments.p2pkh({ pubkey: KEY.publicKey }).output,
        PREV_VALUE,
        bitcoin.Transaction.SIGHASH_ALL,
      );
      resigned.ins[0].witness[0] = bitcoin.script.signature.encode(otherKey.sign(hash), bitcoin.Transaction.SIGHASH_ALL);

      for (const mutated of [padded, resigned]) {
        assert.strictEqual(mutated.getId(), TXID);
        mockServer({ [TXID]: mutated.toHex(), [parents[0].getId()]: parents[0].toHex(), [parents[1].getId()]: parents[1].toHex() });
        const wallet = makeWallet();

        await assert.rejects(() => new HDSegwitBech32Transaction(null, TXID, wallet).getInfo(), /witness does not match/);
        await assert.rejects(() => new HDSegwitBech32Transaction(null, TXID, wallet).createCPFPbumpFee(100), /witness does not match/);
        expect(wallet.createTransaction).not.toHaveBeenCalled();
      }
    });

    it('leaves a witness it cannot verify out of the size, so it cannot lower the fee rate', async () => {
      const opTrue = bitcoin.script.compile([bitcoin.opcodes.OP_TRUE]);
      const wshParent = makeParent(3);
      wshParent.outs[1].script = bitcoin.payments.p2wsh({ redeem: { output: opTrue } }).output;
      const mixed = new bitcoin.Transaction();
      mixed.version = 2;
      mixed.addInput(parents[0].getHash(), 1, 0);
      mixed.addInput(wshParent.getHash(), 1, 0);
      mixed.addOutput(bitcoin.address.toOutputScript(RECIPIENT), RECIPIENT_VALUE);
      mixed.addOutput(bitcoin.address.toOutputScript(CHANGE), CHANGE_VALUE);
      signP2wpkhInputs(mixed, [PREV_VALUE]);
      mixed.ins[1].witness = [Buffer.alloc(4000, 1), opTrue];
      mockServer({ [mixed.getId()]: mixed.toHex(), [parents[0].getId()]: parents[0].toHex(), [wshParent.getId()]: wshParent.toHex() });

      const info = await new HDSegwitBech32Transaction(null, mixed.getId(), makeWallet()).getInfo();
      const withoutUnverified = mixed.clone();
      withoutUnverified.ins[1].witness = [];
      assert.strictEqual(info.vsize, withoutUnverified.virtualSize());
      assert.ok(info.vsize < mixed.virtualSize() - 900);
      assert.strictEqual(info.feeRate, Math.floor(info.fee / withoutUnverified.virtualSize()));
    });
  });

  describe('with an output that has no address (OP_RETURN)', () => {
    const withOpReturn = makeChild(parents, [{ script: OP_RETURN, value: 0 }]);

    it('getInfo leaves it out of targets, change and unconfirmed utxos', async () => {
      honestServer(withOpReturn);
      const tx = new HDSegwitBech32Transaction(null, withOpReturn.getId(), makeWallet());

      const info = await tx.getInfo();
      assert.deepStrictEqual(info.targets, [{ value: RECIPIENT_VALUE, address: RECIPIENT }]);
      assert.strictEqual(info.changeAmount, CHANGE_VALUE);
      assert.deepStrictEqual(info.unconfirmedUtxos, [{ vout: 1, value: CHANGE_VALUE, txId: withOpReturn.getId(), address: CHANGE }]);
    });

    it('can still be cancelled and CPFP-bumped', async () => {
      honestServer(withOpReturn);
      const wallet = makeWallet();

      await new HDSegwitBech32Transaction(null, withOpReturn.getId(), wallet).createRBFcancelTx(1000);
      await new HDSegwitBech32Transaction(null, withOpReturn.getId(), wallet).createCPFPbumpFee(1000);
      expect(wallet.createTransaction).toHaveBeenCalled();
    });

    it('is not RBF-bumped, because the replacement could not reproduce that output', async () => {
      honestServer(withOpReturn);
      const wallet = makeWallet();
      const tx = new HDSegwitBech32Transaction(null, withOpReturn.getId(), wallet);

      await assert.rejects(() => tx.createRBFbumpFee(1000), /without an address/);
      expect(wallet.createTransaction).not.toHaveBeenCalled();
    });
  });
});
