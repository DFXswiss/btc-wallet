import assert from 'assert';
import '../../class';
import { LightningLdsWallet } from '../../class/wallets/lightning-lds-wallet';
import { openLightningLdsWallet } from '../../api/lds/lightning-lds-wallet-factory';
import { Chain, WalletLabel } from '../../models/bitcoinUnits';

describe('openLightningLdsWallet', () => {
  afterEach(() => jest.restoreAllMocks());

  it('splits the LNDHub admin URL into secret and base URI and loads the wallet before returning it', async () => {
    const calls = [];
    for (const method of ['init', 'authorize', 'fetchTransactions', 'fetchUserInvoices', 'fetchPendingTransactions', 'fetchBalance']) {
      jest.spyOn(LightningLdsWallet.prototype, method).mockImplementation(async () => {
        calls.push(method);
      });
    }

    const wallet = await openLightningLdsWallet('lndhub://login:password@https://lds.example/lndhub', 'user@lds.example', 'proof');

    assert.strictEqual(wallet.type, LightningLdsWallet.type);
    assert.strictEqual(wallet.secret, 'lndhub://login:password');
    assert.strictEqual(wallet.getSecret(), 'lndhub://login:password@https://lds.example/lndhub');
    assert.strictEqual(wallet.getBaseURI(), 'https://lds.example/lndhub');
    assert.strictEqual(wallet.lnAddress, 'user@lds.example');
    assert.strictEqual(wallet.addressOwnershipProof, 'proof');
    assert.strictEqual(wallet.getLabel(), WalletLabel[Chain.OFFCHAIN]);
    // The wallet constructor runs init once itself; the factory then loads the wallet in this order.
    assert.deepStrictEqual(calls.slice(-6), [
      'init',
      'authorize',
      'fetchTransactions',
      'fetchUserInvoices',
      'fetchPendingTransactions',
      'fetchBalance',
    ]);
  });
});
