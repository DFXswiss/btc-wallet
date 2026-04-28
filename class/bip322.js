const bitcoin = require('bitcoinjs-lib');
const { bech32 } = require('bech32');
const { ECPairFactory } = require('ecpair');
const eccLib = require('../blue_modules/noble_ecc');
const ECPair = ECPairFactory(eccLib.default || eccLib);

const TAG = Buffer.from('BIP0322-signed-message', 'utf8');
const OP_RETURN = 0x6a;
const OP_0 = 0x00;
const OP_1 = 0x51;
const OP_16 = 0x60;
const OP_CHECKMULTISIG = 0xae;
const OP_PUSH_33 = 0x21;
const SIGHASH_ALL = 0x01;

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

function isP2wshAddress(address) {
  if (typeof address !== 'string') return false;
  if (!address.startsWith('bc1q') || address.length !== 62) return false;
  try {
    const decoded = bech32.decode(address);
    if (decoded.prefix !== 'bc' || decoded.words[0] !== 0) return false;
    const program = bech32.fromWords(decoded.words.slice(1));
    return program.length === 32;
  } catch (_) {
    return false;
  }
}

function decodeP2wshAddress(address) {
  const decoded = bech32.decode(address);
  return Buffer.from(bech32.fromWords(decoded.words.slice(1)));
}

function decodeWitnessStack(buf) {
  const items = [];
  let offset = 0;
  const count = readVarInt(buf, offset);
  if (!count) return null;
  offset = count.next;
  for (let i = 0; i < count.value; i++) {
    const len = readVarInt(buf, offset);
    if (!len) return null;
    offset = len.next;
    if (offset + len.value > buf.length) return null;
    items.push(buf.subarray(offset, offset + len.value));
    offset += len.value;
  }
  if (offset !== buf.length) return null;
  return items;
}

function readVarInt(buf, offset) {
  if (offset >= buf.length) return null;
  const first = buf[offset];
  if (first < 0xfd) return { value: first, next: offset + 1 };
  if (first === 0xfd) {
    if (offset + 3 > buf.length) return null;
    return { value: buf.readUInt16LE(offset + 1), next: offset + 3 };
  }
  if (first === 0xfe) {
    if (offset + 5 > buf.length) return null;
    return { value: buf.readUInt32LE(offset + 1), next: offset + 5 };
  }
  if (offset + 9 > buf.length) return null;
  const big = buf.readBigUInt64LE(offset + 1);
  if (big > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return { value: Number(big), next: offset + 9 };
}

function parseStandardMultisigScript(script) {
  if (script.length < 3) return null;

  const mOp = script[0];
  if (mOp < OP_1 || mOp > OP_16) return null;
  const m = mOp - OP_1 + 1;

  if (script[script.length - 1] !== OP_CHECKMULTISIG) return null;
  const nOp = script[script.length - 2];
  if (nOp < OP_1 || nOp > OP_16) return null;
  const n = nOp - OP_1 + 1;
  if (m > n) return null;

  const pubkeys = [];
  let offset = 1;
  const end = script.length - 2;
  while (offset < end) {
    if (script[offset] !== OP_PUSH_33) return null;
    offset += 1;
    if (offset + 33 > end) return null;
    const pk = script.subarray(offset, offset + 33);
    if (pk[0] !== 0x02 && pk[0] !== 0x03) return null;
    pubkeys.push(pk);
    offset += 33;
  }
  if (offset !== end) return null;
  if (pubkeys.length !== n) return null;

  return { m, pubkeys };
}

function computeBip143Sighash(message, addressScriptPubKey, witnessScript) {
  const messageHash = bip322MessageHash(message);
  const scriptSig = Buffer.concat([Buffer.from([OP_0, 0x20]), messageHash]);
  const toSpendTx = new bitcoin.Transaction();
  toSpendTx.version = 0;
  toSpendTx.locktime = 0;
  toSpendTx.addInput(Buffer.alloc(32), 0xffffffff, 0, scriptSig);
  toSpendTx.addOutput(addressScriptPubKey, 0);
  const toSpendTxid = toSpendTx.getHash();

  const toSignTx = new bitcoin.Transaction();
  toSignTx.version = 0;
  toSignTx.locktime = 0;
  toSignTx.addInput(toSpendTxid, 0, 0);
  toSignTx.addOutput(Buffer.from([OP_RETURN]), 0);

  return toSignTx.hashForWitnessV0(0, witnessScript, 0, SIGHASH_ALL);
}

function verifyBip322Signature(message, address, signatureBase64) {
  if (!isP2wshAddress(address)) return false;
  if (typeof signatureBase64 !== 'string' || signatureBase64.length === 0) return false;

  let buf;
  try {
    buf = Buffer.from(signatureBase64, 'base64');
  } catch (_) {
    return false;
  }
  if (buf.length === 0) return false;

  const witness = decodeWitnessStack(buf);
  if (!witness || witness.length < 3) return false;

  const witnessScript = witness[witness.length - 1];
  const program = decodeP2wshAddress(address);
  if (!Buffer.from(bitcoin.crypto.sha256(witnessScript)).equals(program)) return false;

  const parsed = parseStandardMultisigScript(witnessScript);
  if (!parsed) return false;

  if (witness[0].length !== 0) return false;
  const sigs = witness.slice(1, witness.length - 1);
  if (sigs.length !== parsed.m) return false;

  const sighash = computeBip143Sighash(message, Buffer.concat([Buffer.from([OP_0, 0x20]), program]), witnessScript);

  let pkIdx = 0;
  for (const sig of sigs) {
    if (sig.length === 0) return false;
    let decoded;
    try {
      decoded = bitcoin.script.signature.decode(sig);
    } catch (_) {
      return false;
    }
    if (decoded.hashType !== SIGHASH_ALL) return false;

    let matched = false;
    while (pkIdx < parsed.pubkeys.length) {
      const pk = parsed.pubkeys[pkIdx];
      pkIdx += 1;
      try {
        if (ECPair.fromPublicKey(pk).verify(sighash, decoded.signature)) {
          matched = true;
          break;
        }
      } catch (_) {}
    }
    if (!matched) return false;
  }
  return true;
}

function extractSimpleSignatureFromPsbt(psbt) {
  let tx;
  try {
    tx = psbt.finalizeAllInputs().extractTransaction();
  } catch (e) {
    tx = psbt.extractTransaction();
  }
  return extractSimpleSignature(tx);
}

const pendingBip322Sessions = new Map();

function newBip322SessionId() {
  return `bip322-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function registerBip322PendingSession(id, resolve, reject) {
  pendingBip322Sessions.set(id, { resolve, reject });
}

function consumeBip322PendingSession(id) {
  const entry = pendingBip322Sessions.get(id);
  if (entry) pendingBip322Sessions.delete(id);
  return entry;
}

function hasBip322PendingSession(id) {
  return pendingBip322Sessions.has(id);
}

module.exports = {
  bip322MessageHash,
  buildToSpendTx,
  buildToSignPsbt,
  extractSimpleSignature,
  extractSimpleSignatureFromPsbt,
  isP2wshAddress,
  verifyBip322Signature,
  BIP322_INCOMPLETE_PSBT,
  newBip322SessionId,
  registerBip322PendingSession,
  consumeBip322PendingSession,
  hasBip322PendingSession,
};
