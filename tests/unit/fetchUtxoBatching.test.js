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

// Gives the wallet a transaction history that independently proves it still holds spendable
// funds, so getDerivedUtxoFromOurTransaction() - the same fallback getUtxo() already trusts -
// disagrees with a structural "empty" result from a non-batching server.
function creditTransactionHistory(w, address) {
  w._txs_by_external_index[0] = [
    {
      txid: 'b'.repeat(64),
      confirmations: 6,
      inputs: [],
      outputs: [{ n: 0, value: 0.001, scriptPubKey: { addresses: [address] } }],
    },
  ];
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

  it('refuses to discard a known UTXO set when the server does not support batching and history still shows funds', async () => {
    const w = makeWalletWithKnownBalance();
    const address = w._getExternalAddressByIndex(0);
    w._utxo = [{ value: 100000, address, txId: 'a'.repeat(64), vout: 0 }];
    creditTransactionHistory(w, address);
    BlueElectrum.isBatchingDisabled.mockReturnValue(true);
    // multiGetUtxoByAddress() itself resolves with {} unconditionally in this mode - see BlueElectrum.js.
    BlueElectrum.multiGetUtxoByAddress.mockResolvedValue({});

    await assert.rejects(w.fetchUtxo(), /does not support batched UTXO lookups/);
    assert.strictEqual(w._utxo.length, 1, 'the previously known UTXO set must survive the failed refresh');
  });

  // Without this, once a non-batching connection's structural "empty" result collided with a
  // known-good UTXO set once, it would throw on every future call forever - multiGetUtxoByAddress()
  // never resolves non-empty on such a server, so nothing could naturally clear the condition even
  // after the wallet is genuinely spent to zero.
  it('accepts a genuinely empty result on a non-batching server once transaction history agrees the wallet is empty', async () => {
    const w = makeWalletWithKnownBalance();
    w._utxo = [{ value: 100000, address: w._getExternalAddressByIndex(0), txId: 'a'.repeat(64), vout: 0 }];
    // No transaction history credited: getDerivedUtxoFromOurTransaction() also finds nothing.
    BlueElectrum.isBatchingDisabled.mockReturnValue(true);
    BlueElectrum.multiGetUtxoByAddress.mockResolvedValue({});

    await w.fetchUtxo();

    assert.strictEqual(w._utxo.length, 0, 'transaction history agreeing the wallet is empty must not be treated as a lockout');
  });

  it('does not throw for a wallet with no prior UTXO data, even when batching is disabled', async () => {
    const w = makeWalletWithKnownBalance();
    BlueElectrum.isBatchingDisabled.mockReturnValue(true);
    BlueElectrum.multiGetUtxoByAddress.mockResolvedValue({});

    await w.fetchUtxo();

    assert.strictEqual(w._utxo.length, 0, 'nothing to protect on a first-ever empty fetch, so it must resolve normally');
  });
});
