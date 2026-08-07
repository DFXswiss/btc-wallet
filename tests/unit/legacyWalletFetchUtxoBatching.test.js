import { LegacyWallet } from '../../class';

const assert = require('assert');

jest.mock('../../blue_modules/BlueElectrum', () => ({
  multiGetUtxoByAddress: jest.fn(),
  multiGetTransactionByTxid: jest.fn().mockResolvedValue({}),
  isBatchingDisabled: jest.fn(),
  estimateCurrentBlockheight: jest.fn(() => 0),
}));

const BlueElectrum = require('../../blue_modules/BlueElectrum');

const WIF = 'L4ccWrPMmFDZw4kzAKFqJNxgHANjdy6b7YKNXMwB4xac4FLF3Tov';

function makeWallet() {
  const w = new LegacyWallet();
  w.setSecret(WIF);
  return w;
}

// Same fallback getUtxo() already trusts, mirroring the AbstractHDElectrumWallet coverage.
// getTransactions() reuses HDSegwitBech32Wallet's implementation against this field (see
// LegacyWallet.getTransactions()), which reads it as a flat array of transactions.
function creditTransactionHistory(w, address) {
  w._txs_by_external_index = [
    {
      txid: 'b'.repeat(64),
      confirmations: 6,
      inputs: [],
      outputs: [{ n: 0, value: 0.001, scriptPubKey: { addresses: [address] } }],
    },
  ];
}

describe('LegacyWallet.fetchUtxo() on servers that do not support batching', () => {
  afterEach(() => {
    jest.clearAllMocks();
    BlueElectrum.multiGetTransactionByTxid.mockResolvedValue({});
  });

  it('trusts a genuinely empty result when the server supports batching (real spend)', async () => {
    const w = makeWallet();
    w.utxo = [{ value: 100000, address: w.getAddress(), txId: 'a'.repeat(64), vout: 0 }];
    BlueElectrum.isBatchingDisabled.mockReturnValue(false);
    BlueElectrum.multiGetUtxoByAddress.mockResolvedValue({});

    await w.fetchUtxo();

    assert.strictEqual(w.utxo.length, 0, 'a real, batching-capable empty result must be trusted');
  });

  it('refuses to discard a known UTXO set when the server does not support batching and history still shows funds', async () => {
    const w = makeWallet();
    const address = w.getAddress();
    w.utxo = [{ value: 100000, address, txId: 'a'.repeat(64), vout: 0 }];
    creditTransactionHistory(w, address);
    BlueElectrum.isBatchingDisabled.mockReturnValue(true);
    BlueElectrum.multiGetUtxoByAddress.mockResolvedValue({});

    await assert.rejects(w.fetchUtxo(), /does not support batched UTXO lookups/);
    assert.strictEqual(w.utxo.length, 1, 'the previously known UTXO set must survive the failed refresh');
  });

  it('accepts a genuinely empty result on a non-batching server once transaction history agrees the wallet is empty', async () => {
    const w = makeWallet();
    w.utxo = [{ value: 100000, address: w.getAddress(), txId: 'a'.repeat(64), vout: 0 }];
    BlueElectrum.isBatchingDisabled.mockReturnValue(true);
    BlueElectrum.multiGetUtxoByAddress.mockResolvedValue({});

    await w.fetchUtxo();

    assert.strictEqual(w.utxo.length, 0, 'transaction history agreeing the wallet is empty must not be treated as a lockout');
  });

  it('does not throw for a wallet with no prior UTXO data, even when batching is disabled', async () => {
    const w = makeWallet();
    BlueElectrum.isBatchingDisabled.mockReturnValue(true);
    BlueElectrum.multiGetUtxoByAddress.mockResolvedValue({});

    await w.fetchUtxo();

    assert.strictEqual(w.utxo.length, 0, 'nothing to protect on a first-ever empty fetch, so it must resolve normally');
  });
});
