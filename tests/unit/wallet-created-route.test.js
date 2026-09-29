import assert from 'assert';
import { walletCreatedRoute } from '../../helpers/wallet-created-route';

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
