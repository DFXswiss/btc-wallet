import assert from 'assert';
import { MultisigHDWallet } from '../../class/';

// Guard added in PR #200: _getXpubFromCosigner now throws a clear error for an
// undefined / unregistered cosigner instead of letting isXprvString(undefined)
// blow up with a cryptic TypeError deep inside address derivation.
const XPUB1 = 'xpub69SfFhG5eA9cqxHKM6b1HhXMpDzipUPDBNMBrjNgWWbbzKqnqwx2mvMyB5bRgmLAi7cBgr8euuz4Lvz3maWxpfUmdM71dyQuvq68mTAG4Cp';
const XPUB2 = 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj';
const FP1 = 'D37EAD88';

describe('MultisigHDWallet._getXpubFromCosigner guard', () => {
  it('throws a clear error for an undefined cosigner instead of a cryptic TypeError', () => {
    const w = new MultisigHDWallet();
    w.addCosigner(XPUB1, FP1);
    assert.throws(() => w._getXpubFromCosigner(undefined), /Invalid cosigner or cosigners not initialized/);
  });

  it('throws for a cosigner that is not registered on the wallet', () => {
    const w = new MultisigHDWallet();
    w.addCosigner(XPUB1, FP1);
    assert.throws(() => w._getXpubFromCosigner(XPUB2), /Invalid cosigner or cosigners not initialized/);
  });

  it('still returns the xpub for a registered cosigner (happy path preserved)', () => {
    const w = new MultisigHDWallet();
    w.addCosigner(XPUB1, FP1);
    const xpub = w._getXpubFromCosigner(XPUB1);
    assert.strictEqual(typeof xpub, 'string');
    assert.ok(xpub.startsWith('xpub'));
  });
});
