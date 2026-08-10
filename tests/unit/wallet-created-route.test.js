import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { walletCreatedRoute } from '../../helpers/wallet-created-route';

const repoRoot = path.join(__dirname, '..', '..');
const readSource = relativePath => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

// Creating or importing the first wallet used to replace the stack with the LNDHub
// screen, so every fresh setup ended on the Lightning provider selection. The
// Lightning wallet is opt-in now — the only way in is the "add" button on the
// home screen.
describe('walletCreatedRoute', () => {
  it('replaces the stack with the wallet home screen', () => {
    assert.deepStrictEqual(walletCreatedRoute(), ['WalletsRoot', { screen: 'WalletTransactions' }]);
  });

  it('carries no params beyond the target screen', () => {
    const [, params] = walletCreatedRoute();
    assert.deepStrictEqual(Object.keys(params), ['screen']);
  });

  it('hands out a fresh params object per call, so a screen cannot mutate the next navigation', () => {
    const [, first] = walletCreatedRoute();
    first.screen = 'AddLightning';
    const [, second] = walletCreatedRoute();
    assert.strictEqual(second.screen, 'WalletTransactions');
  });
});

describe('onboarding does not open the LNDHub screen', () => {
  it('the LNDHub screen has no onboarding variant left', () => {
    const source = readSource('screen/wallets/dfx/add-lightning.tsx');
    assert.ok(!source.includes('isOnboarding'), 'expected no onboarding flag');
    assert.ok(!source.includes('loc._.skip'), 'expected the "skip for now" button to be gone');
    assert.ok(source.includes('loc._.cancel'), 'expected the cancel button to remain');
  });

  it('the home screen still reaches it through the Lightning "add" button', () => {
    const source = readSource('screen/wallets/home.js');

    // Exactly one match required — unanchored includes() would also match a
    // comment or a second navigation site and hide a regression either way.
    const addLightningNav = source.match(/screen:\s*'AddLightning'/g);
    if (!addLightningNav || addLightningNav.length === 0) {
      throw new Error("home.js: screen: 'AddLightning' not found (need exactly 1)");
    }
    if (addLightningNav.length !== 1) {
      throw new Error(`home.js: screen: 'AddLightning' matches ${addLightningNav.length} times (need exactly 1)`);
    }

    const lightningRow = source.match(/onDummyPress:\s*navigateToAddLightning/g);
    if (!lightningRow || lightningRow.length === 0) {
      throw new Error('home.js: onDummyPress: navigateToAddLightning not found (need exactly 1)');
    }
    if (lightningRow.length !== 1) {
      throw new Error(`home.js: onDummyPress: navigateToAddLightning matches ${lightningRow.length} times (need exactly 1)`);
    }
  });
});
