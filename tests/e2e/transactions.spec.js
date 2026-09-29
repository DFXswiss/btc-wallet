import assert from 'assert';

import {
  bip84Addresses,
  expectTransactionMatchesExplorer,
  launchFresh,
  openWalletWithHistory,
  readTransactionRow,
  speedImport,
} from './helperz';

// The BIP39 test vector phrase: a public mainnet wallet with a long confirmed history and no funds to lose.
const PUBLIC_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('On-chain transaction history', () => {
  const addresses = bip84Addresses(PUBLIC_MNEMONIC, 500);

  beforeAll(async () => {
    await launchFresh();
    await speedImport(PUBLIC_MNEMONIC);
  });

  it('lists the newest transactions first and each one shows the value, fee and confirmations the chain has', async () => {
    await openWalletWithHistory('OnChainWalletRow');

    const newest = await readTransactionRow(0);
    const newestTx = await expectTransactionMatchesExplorer(newest, addresses);
    const older = await readTransactionRow(1);
    const olderTx = await expectTransactionMatchesExplorer(older, addresses);

    assert.notStrictEqual(newest.txid, older.txid);
    const height = tx => (tx.status.confirmed ? tx.status.block_height : Infinity);
    assert.ok(height(newestTx) >= height(olderTx), `row 0 (${newest.txid}) is older than row 1 (${older.txid})`);
  });
});
