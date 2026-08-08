import { HDSegwitBech32Wallet } from '../../class';

const assert = require('assert');

jest.mock('../../blue_modules/BlueElectrum', () => ({
  multiGetUtxoByAddress: jest.fn(),
  isBatchingDisabled: jest.fn(),
  estimateCurrentBlockheight: jest.fn(() => 0),
}));

const BlueElectrum = require('../../blue_modules/BlueElectrum');

const SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function makeWalletWithKnownBalance() {
  const w = new HDSegwitBech32Wallet();
  w.setSecret(SEED);
  w._balances_by_external_index[0] = { c: 100000, u: 0 };
  return w;
}

describe('AbstractHDElectrumWallet.fetchUtxo() on servers that do not support batching', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('trusts a genuinely empty result when the server supports batching (real spend)', async () => {
    const w = makeWalletWithKnownBalance();
    w._utxo = [{ value: 100000, address: w._getExternalAddressByIndex(0), txId: 'a'.repeat(64), vout: 0 }];
    BlueElectrum.isBatchingDisabled.mockReturnValue(false);
    BlueElectrum.multiGetUtxoByAddress.mockResolvedValue({});

    await w.fetchUtxo();

    assert.strictEqual(w._utxo.length, 0, 'a real, batching-capable empty result must be trusted');
  });

  it('refuses to discard a known UTXO set when the server does not support batching', async () => {
    const w = makeWalletWithKnownBalance();
    w._utxo = [{ value: 100000, address: w._getExternalAddressByIndex(0), txId: 'a'.repeat(64), vout: 0 }];
    BlueElectrum.isBatchingDisabled.mockReturnValue(true);
    // multiGetUtxoByAddress() itself resolves with {} unconditionally in this mode - see BlueElectrum.js.
    BlueElectrum.multiGetUtxoByAddress.mockResolvedValue({});

    await assert.rejects(w.fetchUtxo(), /does not support batched UTXO lookups/);
    assert.strictEqual(w._utxo.length, 1, 'the previously known UTXO set must survive the failed refresh');
  });

  // The guard triggers off _utxo, which saveToDisk() serializes and fromJson() restores - so an
  // app restart alone does NOT clear the condition while the same non-batching server stays
  // pinned. Recovery requires connecting to a batching-capable server (or a genuinely fresh
  // wallet with no prior UTXO data).
  it('still refuses after a saveToDisk()/fromJson() round-trip - an app restart does not clear the lockout', async () => {
    const w = makeWalletWithKnownBalance();
    w._utxo = [{ value: 100000, address: w._getExternalAddressByIndex(0), txId: 'a'.repeat(64), vout: 0 }];

    // exactly what BlueApp.saveToDisk() persists for this wallet class
    w.prepareForSerialization();
    const keyCloned = Object.assign({}, w);
    keyCloned._txs_by_external_index = {};
    keyCloned._txs_by_internal_index = {};
    const restored = HDSegwitBech32Wallet.fromJson(JSON.stringify({ ...keyCloned, type: keyCloned.type }));

    assert.strictEqual(restored._utxo.length, 1, '_utxo is part of what gets persisted and restored on boot');

    BlueElectrum.isBatchingDisabled.mockReturnValue(true);
    BlueElectrum.multiGetUtxoByAddress.mockResolvedValue({});
    await assert.rejects(restored.fetchUtxo(), /does not support batched UTXO lookups/);
    assert.strictEqual(restored._utxo.length, 1, 'the restored UTXO set survives, but the refresh keeps failing');
  });

  it('does not throw for a wallet with no prior UTXO data, even when batching is disabled', async () => {
    const w = makeWalletWithKnownBalance();
    BlueElectrum.isBatchingDisabled.mockReturnValue(true);
    BlueElectrum.multiGetUtxoByAddress.mockResolvedValue({});

    await w.fetchUtxo();

    assert.strictEqual(w._utxo.length, 0, 'nothing to protect on a first-ever empty fetch, so it must resolve normally');
  });
});
