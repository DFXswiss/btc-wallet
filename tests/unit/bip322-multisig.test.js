import assert from 'assert';
import { MultisigHDWallet } from '../../class/';
const bitcoin = require('bitcoinjs-lib');
const { bech32 } = require('bech32');
const {
  BIP322_INCOMPLETE_PSBT,
  extractSimpleSignatureFromPsbt,
  isP2wshAddress,
  verifyBip322Signature,
  newBip322SessionId,
  registerBip322PendingSession,
  consumeBip322PendingSession,
  hasBip322PendingSession,
} = require('../../class/bip322');

const MNEMONIC_A = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const MNEMONIC_B = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const MNEMONIC_C = 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above';

function buildLocalMultisig({ m, mnemonics }) {
  const w = new MultisigHDWallet();
  w.setNativeSegwit();
  w.setDerivationPath(MultisigHDWallet.PATH_NATIVE_SEGWIT);
  w.setM(m);
  for (const mnemonic of mnemonics) w.addCosigner(mnemonic);
  return w;
}

function decodeWitnessStack(buf) {
  let offset = 0;
  const count = readVarInt(buf, offset);
  offset = count.next;
  const items = [];
  for (let i = 0; i < count.value; i++) {
    const len = readVarInt(buf, offset);
    offset = len.next;
    items.push(buf.subarray(offset, offset + len.value));
    offset += len.value;
  }
  assert.strictEqual(offset, buf.length, 'witness stack must consume the full buffer');
  return items;
}

function readVarInt(buf, offset) {
  const first = buf[offset];
  if (first < 0xfd) return { value: first, next: offset + 1 };
  if (first === 0xfd) return { value: buf.readUInt16LE(offset + 1), next: offset + 3 };
  if (first === 0xfe) return { value: buf.readUInt32LE(offset + 1), next: offset + 5 };
  return { value: Number(buf.readBigUInt64LE(offset + 1)), next: offset + 9 };
}

function bech32ProgramOf(address) {
  const decoded = bech32.decode(address);
  return Buffer.from(bech32.fromWords(decoded.words.slice(1)));
}

describe('BIP-322 simple signature for native P2WSH multisig', () => {
  it('produces a structurally valid signature when all M cosigners are local (2-of-2)', () => {
    const w = buildLocalMultisig({ m: 2, mnemonics: [MNEMONIC_A, MNEMONIC_B] });
    const address = w._getExternalAddressByIndex(0);
    assert.ok(address.startsWith('bc1q'), 'expected native P2WSH address');
    assert.strictEqual(address.length, 62);

    const sig = w.signMessage('DFX login challenge', address);
    assert.ok(sig.length > 0, 'signature must be non-empty');

    const witness = decodeWitnessStack(Buffer.from(sig, 'base64'));
    assert.strictEqual(witness.length, 2 + 2, 'expected dummy + 2 sigs + witnessScript');
    assert.strictEqual(witness[0].length, 0, 'first witness item is the OP_CHECKMULTISIG dummy');

    const witnessScript = witness[witness.length - 1];
    const programFromScript = bitcoin.crypto.sha256(witnessScript);
    assert.deepStrictEqual(programFromScript, bech32ProgramOf(address));

    for (let i = 1; i < witness.length - 1; i++) {
      const sigBytes = witness[i];
      assert.ok(sigBytes.length >= 9, 'sig must contain DER bytes + sighash flag');
      assert.strictEqual(sigBytes[sigBytes.length - 1], 0x01, 'sighash flag must be SIGHASH_ALL');
    }
  });

  it('is deterministic: signing the same message twice yields the same signature', () => {
    const w = buildLocalMultisig({ m: 2, mnemonics: [MNEMONIC_A, MNEMONIC_B] });
    const address = w._getExternalAddressByIndex(0);
    const sig1 = w.signMessage('stable challenge', address);
    const sig2 = w.signMessage('stable challenge', address);
    assert.strictEqual(sig1, sig2, 'BIP-322 sign must be deterministic (RFC 6979 ECDSA)');
  });

  it('produces signatures bound to the message (different message → different sig)', () => {
    const w = buildLocalMultisig({ m: 2, mnemonics: [MNEMONIC_A, MNEMONIC_B] });
    const address = w._getExternalAddressByIndex(0);
    const sig1 = w.signMessage('msg-a', address);
    const sig2 = w.signMessage('msg-b', address);
    assert.notStrictEqual(sig1, sig2);
  });

  it('signs an internal (change) address belonging to the wallet', () => {
    const w = buildLocalMultisig({ m: 2, mnemonics: [MNEMONIC_A, MNEMONIC_B] });
    const internal = w._getInternalAddressByIndex(0);
    const sig = w.signMessage('change addr challenge', internal);
    const witness = decodeWitnessStack(Buffer.from(sig, 'base64'));
    const programFromScript = bitcoin.crypto.sha256(witness[witness.length - 1]);
    assert.deepStrictEqual(programFromScript, bech32ProgramOf(internal));
  });

  it('throws when the address does not belong to the wallet', () => {
    const w = buildLocalMultisig({ m: 2, mnemonics: [MNEMONIC_A, MNEMONIC_B] });
    const foreignAddress = 'bc1qsy93ywfzzp4e8aczvzn4452jmlwvyp2fklnm2qevnyzlmyd672pqrl3cep';
    assert.throws(() => w.signMessage('m', foreignAddress), /does not belong/);
  });

  it('throws BIP322_INCOMPLETE_PSBT when fewer than M cosigners are local (2-of-3, only 1 mnemonic)', () => {
    const fullWallet = buildLocalMultisig({ m: 2, mnemonics: [MNEMONIC_A, MNEMONIC_B, MNEMONIC_C] });
    const address = fullWallet._getExternalAddressByIndex(0);

    const partial = new MultisigHDWallet();
    partial.setNativeSegwit();
    partial.setDerivationPath(MultisigHDWallet.PATH_NATIVE_SEGWIT);
    partial.setM(2);
    partial.addCosigner(MNEMONIC_A);
    partial.addCosigner(fullWallet._getXpubFromCosigner(fullWallet.getCosigner(2)), MultisigHDWallet.mnemonicToFingerprint(MNEMONIC_B));
    partial.addCosigner(fullWallet._getXpubFromCosigner(fullWallet.getCosigner(3)), MultisigHDWallet.mnemonicToFingerprint(MNEMONIC_C));

    assert.strictEqual(partial._getExternalAddressByIndex(0), address);
    assert.strictEqual(partial.howManySignaturesCanWeMake(), 1);

    let caught;
    try {
      partial.signMessage('challenge', address);
    } catch (e) {
      caught = e;
    }
    assert.ok(caught, 'expected throw');
    assert.strictEqual(caught.code, BIP322_INCOMPLETE_PSBT);
    assert.ok(caught.psbtBase64 && caught.psbtBase64.length > 0, 'must expose partial PSBT');
    const psbt = bitcoin.Psbt.fromBase64(caught.psbtBase64);
    assert.strictEqual(psbt.inputCount, 1);
  });

  it('extracts the simple signature from a fully co-signed PSBT (matches direct signMessage output)', () => {
    const fullWallet = buildLocalMultisig({ m: 2, mnemonics: [MNEMONIC_A, MNEMONIC_B] });
    const address = fullWallet._getExternalAddressByIndex(0);

    const initiator = new MultisigHDWallet();
    initiator.setNativeSegwit();
    initiator.setDerivationPath(MultisigHDWallet.PATH_NATIVE_SEGWIT);
    initiator.setM(2);
    initiator.addCosigner(MNEMONIC_A);
    initiator.addCosigner(fullWallet._getXpubFromCosigner(fullWallet.getCosigner(2)), MultisigHDWallet.mnemonicToFingerprint(MNEMONIC_B));

    let caught;
    try {
      initiator.signMessage('m', address);
    } catch (e) {
      caught = e;
    }
    assert.strictEqual(caught.code, BIP322_INCOMPLETE_PSBT);

    const cosigner = new MultisigHDWallet();
    cosigner.setNativeSegwit();
    cosigner.setDerivationPath(MultisigHDWallet.PATH_NATIVE_SEGWIT);
    cosigner.setM(2);
    cosigner.addCosigner(fullWallet._getXpubFromCosigner(fullWallet.getCosigner(1)), MultisigHDWallet.mnemonicToFingerprint(MNEMONIC_A));
    cosigner.addCosigner(MNEMONIC_B);

    const psbt = bitcoin.Psbt.fromBase64(caught.psbtBase64);
    cosigner.cosignPsbt(psbt);

    const sigFromPsbt = extractSimpleSignatureFromPsbt(psbt);
    const sigFromDirect = fullWallet.signMessage('m', address);

    const witnessFromPsbt = decodeWitnessStack(Buffer.from(sigFromPsbt, 'base64'));
    const witnessFromDirect = decodeWitnessStack(Buffer.from(sigFromDirect, 'base64'));

    assert.strictEqual(witnessFromPsbt.length, witnessFromDirect.length);
    assert.deepStrictEqual(witnessFromPsbt[0], witnessFromDirect[0]);
    assert.deepStrictEqual(witnessFromPsbt[witnessFromPsbt.length - 1], witnessFromDirect[witnessFromDirect.length - 1]);
  });

  describe('verifyBip322Signature / wallet.verifyMessage', () => {
    it('verifies a signature produced by signMessage (round-trip)', () => {
      const w = buildLocalMultisig({ m: 2, mnemonics: [MNEMONIC_A, MNEMONIC_B] });
      const address = w._getExternalAddressByIndex(0);
      const message = 'DFX login challenge';
      const signature = w.signMessage(message, address);
      assert.strictEqual(verifyBip322Signature(message, address, signature), true);
      assert.strictEqual(w.verifyMessage(message, address, signature), true);
    });

    it('verifies signatures across multiple message lengths', () => {
      const w = buildLocalMultisig({ m: 2, mnemonics: [MNEMONIC_A, MNEMONIC_B] });
      const address = w._getExternalAddressByIndex(0);
      for (const message of ['', 'short', 'm'.repeat(200), 'unicode 漢字 ✓']) {
        const sig = w.signMessage(message, address);
        assert.strictEqual(verifyBip322Signature(message, address, sig), true, `failed for: ${message.slice(0, 20)}`);
      }
    });

    it('rejects signature for a different message', () => {
      const w = buildLocalMultisig({ m: 2, mnemonics: [MNEMONIC_A, MNEMONIC_B] });
      const address = w._getExternalAddressByIndex(0);
      const sig = w.signMessage('original', address);
      assert.strictEqual(verifyBip322Signature('tampered', address, sig), false);
    });

    it('rejects signature for a different address', () => {
      const w1 = buildLocalMultisig({ m: 2, mnemonics: [MNEMONIC_A, MNEMONIC_B] });
      const w2 = buildLocalMultisig({ m: 2, mnemonics: [MNEMONIC_A, MNEMONIC_C] });
      const address1 = w1._getExternalAddressByIndex(0);
      const address2 = w2._getExternalAddressByIndex(0);
      const sig = w1.signMessage('m', address1);
      assert.strictEqual(verifyBip322Signature('m', address2, sig), false);
    });

    it('verifies a signature produced via PSBT cross-device round-trip', () => {
      const fullWallet = buildLocalMultisig({ m: 2, mnemonics: [MNEMONIC_A, MNEMONIC_B] });
      const address = fullWallet._getExternalAddressByIndex(0);

      const initiator = new MultisigHDWallet();
      initiator.setNativeSegwit();
      initiator.setDerivationPath(MultisigHDWallet.PATH_NATIVE_SEGWIT);
      initiator.setM(2);
      initiator.addCosigner(MNEMONIC_A);
      initiator.addCosigner(fullWallet._getXpubFromCosigner(fullWallet.getCosigner(2)), MultisigHDWallet.mnemonicToFingerprint(MNEMONIC_B));

      let caught;
      try {
        initiator.signMessage('cross-device', address);
      } catch (e) {
        caught = e;
      }
      const cosigner = new MultisigHDWallet();
      cosigner.setNativeSegwit();
      cosigner.setDerivationPath(MultisigHDWallet.PATH_NATIVE_SEGWIT);
      cosigner.setM(2);
      cosigner.addCosigner(fullWallet._getXpubFromCosigner(fullWallet.getCosigner(1)), MultisigHDWallet.mnemonicToFingerprint(MNEMONIC_A));
      cosigner.addCosigner(MNEMONIC_B);

      const psbt = bitcoin.Psbt.fromBase64(caught.psbtBase64);
      cosigner.cosignPsbt(psbt);
      const sigFromPsbt = extractSimpleSignatureFromPsbt(psbt);
      assert.strictEqual(verifyBip322Signature('cross-device', address, sigFromPsbt), true);
    });

    it('rejects malformed input gracefully', () => {
      const w = buildLocalMultisig({ m: 2, mnemonics: [MNEMONIC_A, MNEMONIC_B] });
      const address = w._getExternalAddressByIndex(0);
      assert.strictEqual(verifyBip322Signature('m', address, ''), false);
      assert.strictEqual(verifyBip322Signature('m', address, 'AAAAAAAAAA'), false);
      assert.strictEqual(verifyBip322Signature('m', 'bc1q', 'AAAA'), false);
      assert.strictEqual(verifyBip322Signature('m', '1AcGhh1oYJTqaPgmWThc7EvKBRjRLe3Go9', 'AAAA'), false);
    });

    it('isP2wshAddress detects native P2WSH only', () => {
      assert.strictEqual(isP2wshAddress('bc1qsy93ywfzzp4e8aczvzn4452jmlwvyp2fklnm2qevnyzlmyd672pqrl3cep'), true);
      assert.strictEqual(isP2wshAddress('bc1qd9jvcd4l64q09kkj2q0qpf58umrryknyqmdp47'), false); // P2WPKH
      assert.strictEqual(isP2wshAddress('1AcGhh1oYJTqaPgmWThc7EvKBRjRLe3Go9'), false); // legacy
      assert.strictEqual(isP2wshAddress('tb1qsy93ywfzzp4e8aczvzn4452jmlwvyp2fklnm2qevnyzlmyd672pqrl3cep'), false); // testnet
      assert.strictEqual(isP2wshAddress(''), false);
    });
  });

  describe('Pending session registry', () => {
    it('registers, consumes and removes sessions', () => {
      const id = newBip322SessionId();
      assert.ok(id.startsWith('bip322-'));
      const resolve = () => {};
      const reject = () => {};
      registerBip322PendingSession(id, resolve, reject);
      assert.ok(hasBip322PendingSession(id));
      const entry = consumeBip322PendingSession(id);
      assert.strictEqual(entry.resolve, resolve);
      assert.strictEqual(entry.reject, reject);
      assert.ok(!hasBip322PendingSession(id));
      assert.strictEqual(consumeBip322PendingSession(id), undefined);
    });

    it('produces unique session ids', () => {
      const ids = new Set();
      for (let i = 0; i < 100; i++) ids.add(newBip322SessionId());
      assert.strictEqual(ids.size, 100);
    });
  });

  it('completes signing across two wallets via cosignPsbt (round-trip)', () => {
    const fullWallet = buildLocalMultisig({ m: 2, mnemonics: [MNEMONIC_A, MNEMONIC_B] });
    const address = fullWallet._getExternalAddressByIndex(0);

    const initiator = new MultisigHDWallet();
    initiator.setNativeSegwit();
    initiator.setDerivationPath(MultisigHDWallet.PATH_NATIVE_SEGWIT);
    initiator.setM(2);
    initiator.addCosigner(MNEMONIC_A);
    initiator.addCosigner(fullWallet._getXpubFromCosigner(fullWallet.getCosigner(2)), MultisigHDWallet.mnemonicToFingerprint(MNEMONIC_B));

    let caught;
    try {
      initiator.signMessage('cross-device login', address);
    } catch (e) {
      caught = e;
    }
    assert.strictEqual(caught.code, BIP322_INCOMPLETE_PSBT);

    const cosigner = new MultisigHDWallet();
    cosigner.setNativeSegwit();
    cosigner.setDerivationPath(MultisigHDWallet.PATH_NATIVE_SEGWIT);
    cosigner.setM(2);
    cosigner.addCosigner(fullWallet._getXpubFromCosigner(fullWallet.getCosigner(1)), MultisigHDWallet.mnemonicToFingerprint(MNEMONIC_A));
    cosigner.addCosigner(MNEMONIC_B);

    const psbt = bitcoin.Psbt.fromBase64(caught.psbtBase64);
    const { tx } = cosigner.cosignPsbt(psbt);
    assert.ok(tx, 'second cosigner must complete the PSBT');

    const fullSig = fullWallet.signMessage('cross-device login', address);
    const witnessFull = decodeWitnessStack(Buffer.from(fullSig, 'base64'));
    assert.strictEqual(witnessFull.length, 4);
  });
});
