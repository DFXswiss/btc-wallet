/* global element, by */
import assert from 'assert';
import * as bip39 from 'bip39';

import { expectMainWalletPhrase, extractTextFromElementById, openAddWalletWithAdvancedMode, waitForId, waitForText } from './helperz';

async function openEntropyScreen() {
  await waitForId('ProvideEntropyLink');
  await element(by.id('ProvideEntropyLink')).tap();
  await waitForId('EntropyCounter');
  await element(by.id('Tab0')).tap(); // coin: one bit per flip
  await waitForId('CoinFlip1');
}

describe('Wallet from provided entropy', () => {
  beforeAll(async () => {
    await openAddWalletWithAdvancedMode();
  });

  it('counts flips, undoes the last one and reports the bytes still taken from the system generator', async () => {
    await openEntropyScreen();
    for (let flip = 0; flip < 9; flip++) await element(by.id('CoinFlip0')).tap();
    assert.strictEqual((await extractTextFromElementById('EntropyCounter')).trim(), '9 of 256 bits');
    await element(by.id('UndoEntropy')).tap();
    assert.strictEqual((await extractTextFromElementById('EntropyCounter')).trim(), '8 of 256 bits');
    await element(by.id('SaveEntropy')).tap();
    await waitForText('1 bytes of generated entropy. Remaining 31 bytes will be obtained from the System random number generator.');
  });

  it('with the full 256 bits the recovery phrase is exactly the one those bits encode', async () => {
    await openEntropyScreen();
    for (let flip = 0; flip < 256; flip++) await element(by.id('CoinFlip1')).tap();
    assert.strictEqual((await extractTextFromElementById('EntropyCounter')).trim(), '256 of 256 bits');
    await element(by.id('SaveEntropy')).tap();
    await waitForText('32 bytes of generated entropy');
    await element(by.id('Create')).tap();
    await waitForId('OnChainWalletRow');

    await expectMainWalletPhrase(bip39.entropyToMnemonic('ff'.repeat(32)).split(' '));
  });
});
