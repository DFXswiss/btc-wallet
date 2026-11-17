import assert from 'assert';
import BIP32Factory from 'bip32';
import * as bip39 from 'bip39';
import ecc from '../../blue_modules/noble_ecc';
import {
  deriveSparkMnemonic,
  sparkIdentityKey,
  sparkMnemonicFromRoot,
  SPARK_BIP85_PATH,
  SPARK_IDENTITY_PATH,
} from '../../api/spark/spark-seed';

const bip32 = BIP32Factory(ecc);

describe('spark-seed', () => {
  it('matches the official BIP-85 vector via sparkMnemonicFromRoot', () => {
    const root = bip32.fromBase58(
      'xprv9s21ZrQH143K2LBWUUQRFXhucrQqBpKdRRxNVq2zBqsx8HVqFk2uYo8kmbaLLHRdqtQpUm98uKfu3vca1LqdGhUtyoFnCNkfmXRyPXLjbKb',
    );
    assert.strictEqual(sparkMnemonicFromRoot(root), 'girl mad pet galaxy egg matter matrix prison refuse sense ordinary nose');
  });

  it('derives pinned Spark child mnemonics from known on-chain phrases', () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    assert.strictEqual(deriveSparkMnemonic(mnemonic), 'prosper short ramp prepare exchange stove life snack client enough purpose fold');
    assert.strictEqual(
      deriveSparkMnemonic(mnemonic, 'super secret passphrase'),
      'car over raven tomato east trust board lend wave horn behind trip',
    );
    assert.strictEqual(deriveSparkMnemonic(mnemonic, ''), deriveSparkMnemonic(mnemonic));
    assert.strictEqual(
      deriveSparkMnemonic('legal winner thank year wave sausage worth useful legal winner thank yellow'),
      'weird hair hip place rail airport twin immense stomach later push carpet',
    );
  });

  it('returns a valid 12-word BIP39 mnemonic that differs from the input', () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const child = deriveSparkMnemonic(mnemonic);
    assert.ok(bip39.validateMnemonic(child));
    assert.strictEqual(child.split(' ').length, 12);
    assert.notStrictEqual(child, mnemonic);
  });

  it('throws a fixed error for invalid input without echoing the input', () => {
    const badChecksum = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon';
    for (const input of ['not a mnemonic', badChecksum, '']) {
      assert.throws(
        () => deriveSparkMnemonic(input),
        err => {
          assert.ok(err instanceof Error);
          expect(err.message).toMatch(/On-chain recovery phrase is not available/);
          if (input) {
            assert.ok(!err.message.includes(input));
          }
          return true;
        },
      );
    }
  });

  it('pins the BIP-85 recovery path', () => {
    assert.strictEqual(SPARK_BIP85_PATH, "m/83696968'/39'/0'/12'/0'");
  });

  it('accepts a non-English on-chain phrase and still derives an English child', () => {
    const input = 'abaisser abaisser abaisser abaisser abaisser abaisser abaisser abaisser abaisser abaisser abaisser abeille';
    const child = deriveSparkMnemonic(input);
    assert.strictEqual(child, 'panda lesson setup coffee uncle beyond night burger hello artist sick hawk');
    assert.ok(bip39.validateMnemonic(child));
  });
});

describe('sparkIdentityKey', () => {
  const phrase = 'prosper short ramp prepare exchange stove life snack client enough purpose fold';

  it('derives the key at the Spark identity path of the Spark phrase', () => {
    const node = BIP32Factory(ecc).fromSeed(bip39.mnemonicToSeedSync(phrase)).derivePath(SPARK_IDENTITY_PATH);
    const key = sparkIdentityKey(phrase);
    assert.strictEqual(SPARK_IDENTITY_PATH, "m/8797555'/1'/0'");
    assert.strictEqual(key.publicKey, Buffer.from(node.publicKey).toString('hex'));
    assert.ok(key.privateKey.equals(Buffer.from(node.privateKey)));
    assert.match(key.publicKey, /^0[23][0-9a-f]{64}$/);
  });
});
