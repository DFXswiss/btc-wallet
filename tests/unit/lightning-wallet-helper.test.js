import assert from 'assert';
import { getLightningWallet, LIGHTNING_WALLET_TYPES } from '../../helpers/lightning-wallet';
import { LightningCustodianWallet } from '../../class';
import { LightningLdsWallet } from '../../class/wallets/lightning-lds-wallet';
import { SparkWallet } from '../../class/wallets/spark-wallet';

const wallet = (type, id = type) => ({ type, chain: type === 'HDsegwitBech32' ? 'ONCHAIN' : 'OFFCHAIN', id });

describe('getLightningWallet', () => {
  it('names the wallet classes by their exact types, LNDHub first', () => {
    assert.deepStrictEqual(LIGHTNING_WALLET_TYPES, [LightningLdsWallet.type, LightningCustodianWallet.type, SparkWallet.type]);
  });

  it('returns the lightning.space, custom LNDHub or Spark wallet', () => {
    for (const type of ['lightningLdsWallet', 'lightningCustodianWallet', 'sparkWallet']) {
      assert.strictEqual(getLightningWallet([wallet('HDsegwitBech32'), wallet(type)]).type, type);
    }
  });

  it('never returns a Taproot asset wallet, although it is off-chain too', () => {
    assert.strictEqual(getLightningWallet([wallet('HDsegwitBech32'), wallet('taprootLdsWallet')]), undefined);
    assert.strictEqual(getLightningWallet([wallet('taprootLdsWallet'), wallet('sparkWallet')]).type, 'sparkWallet');
  });

  it('prefers the LNDHub wallet should both kinds exist', () => {
    assert.strictEqual(getLightningWallet([wallet('sparkWallet'), wallet('lightningLdsWallet')]).type, 'lightningLdsWallet');
  });

  it('returns undefined without a Lightning wallet', () => {
    assert.strictEqual(getLightningWallet([wallet('HDsegwitBech32')]), undefined);
    assert.strictEqual(getLightningWallet([]), undefined);
  });
});
