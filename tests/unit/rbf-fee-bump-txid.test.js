/**
 * The RBF/CPFP helpers fetch the original transaction and the transactions it spends by
 * txid. A raw hex is only used when it hashes to the txid it was requested by, and the
 * outputs of the replacement and the input amounts are taken from those verified hexes
 * rather than from the decoded JSON the server sends along.
 */
import assert from 'assert';
import * as bitcoin from 'bitcoinjs-lib';

jest.mock('../../blue_modules/BlueElectrum', () => ({
  multiGetTransactionByTxid: jest.fn(),
}));

const BlueElectrum = require('../../blue_modules/BlueElectrum');
const { HDSegwitBech32Wallet, HDSegwitBech32Transaction } = require('../../class');

const RECIPIENT = bitcoin.address.fromOutputScript(Buffer.from('a914e286d58e53f9247a4710e51232cce0686f16873c87', 'hex'));
const CHANGE = bitcoin.address.fromOutputScript(Buffer.from('0014d3e2ecbf4d91321794e0297e0284c47527cf878b', 'hex'));
const OTHER_ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
// a compressed public key, used as the last witness item of each input
const PUBKEY = Buffer.from('03af4b208608c75f38e78f6e5abfbcad9c360fb60d3e035193b2cd0cdc8fc0155c', 'hex');

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

// spends output 1 of two parents and pays the recipient plus change; extraOuts are appended
function makeChild(parents, extraOuts = []) {
  const child = new bitcoin.Transaction();
  child.version = 2;
  for (const parent of parents) {
    child.addInput(parent.getHash(), 1, 0);
    child.ins[child.ins.length - 1].witness = [Buffer.alloc(71, 1), PUBKEY];
  }
  child.addOutput(bitcoin.address.toOutputScript(RECIPIENT), RECIPIENT_VALUE);
  child.addOutput(bitcoin.address.toOutputScript(CHANGE), CHANGE_VALUE);
  for (const { script, value } of extraOuts) child.addOutput(script, value);
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
