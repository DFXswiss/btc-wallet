const bitcoin = require('bitcoinjs-lib');

const TAG = Buffer.from('BIP0322-signed-message', 'utf8');
const OP_RETURN = 0x6a;

function bip322MessageHash(message) {
  const sha256 = bitcoin.crypto.sha256;
  const tagHash = sha256(TAG);
  return sha256(Buffer.concat([tagHash, tagHash, Buffer.from(message, 'utf8')]));
}

function buildToSpendTx(messageHash, addressScriptPubKey) {
  const tx = new bitcoin.Transaction();
  tx.version = 0;
  tx.locktime = 0;
  const scriptSig = Buffer.concat([Buffer.from([0x00, 0x20]), messageHash]);
  tx.addInput(Buffer.alloc(32), 0xffffffff, 0, scriptSig);
  tx.addOutput(addressScriptPubKey, 0);
  return tx;
}

function buildToSignPsbt({ message, addressScriptPubKey, witnessScript, bip32Derivation }) {
  const messageHash = bip322MessageHash(message);
  const toSpend = buildToSpendTx(messageHash, addressScriptPubKey);
  const toSpendTxid = toSpend.getId();

  const psbt = new bitcoin.Psbt();
  psbt.setVersion(0);
  psbt.setLocktime(0);
  psbt.addInput({
    hash: toSpendTxid,
    index: 0,
    sequence: 0,
    witnessUtxo: { script: addressScriptPubKey, value: 0 },
    witnessScript,
    bip32Derivation,
  });
  psbt.addOutput({ script: Buffer.from([OP_RETURN]), value: 0 });
  return psbt;
}

function extractSimpleSignature(tx) {
  if (tx.ins.length !== 1) throw new Error('BIP-322 to_sign must have exactly 1 input');
  return encodeWitnessStack(tx.ins[0].witness).toString('base64');
}

function encodeWitnessStack(items) {
  const parts = [encodeVarInt(items.length)];
  for (const item of items) {
    parts.push(encodeVarInt(item.length));
    parts.push(item);
  }
  return Buffer.concat(parts);
}

function encodeVarInt(n) {
  if (n < 0xfd) return Buffer.from([n]);
  if (n <= 0xffff) {
    const b = Buffer.alloc(3);
    b[0] = 0xfd;
    b.writeUInt16LE(n, 1);
    return b;
  }
  if (n <= 0xffffffff) {
    const b = Buffer.alloc(5);
    b[0] = 0xfe;
    b.writeUInt32LE(n, 1);
    return b;
  }
  const b = Buffer.alloc(9);
  b[0] = 0xff;
  b.writeBigUInt64LE(BigInt(n), 1);
  return b;
}

const BIP322_INCOMPLETE_PSBT = 'BIP322_INCOMPLETE_PSBT';

module.exports = {
  bip322MessageHash,
  buildToSpendTx,
  buildToSignPsbt,
  extractSimpleSignature,
  BIP322_INCOMPLETE_PSBT,
};
