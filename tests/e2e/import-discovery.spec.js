/* global device, element, by, waitFor */
import assert from 'assert';
import BIP32Factory from 'bip32';
import * as bip39 from 'bip39';

import ecc from '../../blue_modules/noble_ecc';
import { extractTextFromElementById, openAddWalletWithAdvancedMode, waitForId, waitForText } from './helperz';

// Public BIP39 test phrase; it has on-chain history on the standard BIP44, BIP49 and BIP84 accounts.
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const bip32 = BIP32Factory(ecc);

function accountXpub(path) {
  return bip32.fromSeed(bip39.mnemonicToSeedSync(MNEMONIC)).derivePath(path).neutered().toBase58();
}

async function startImport() {
  await element(by.id('ImportWallet')).tap();
  await waitForId('ImportFromTextButton');
  await element(by.id('ImportFromTextButton')).tap();
  await waitForId('MnemonicInput');
  await element(by.id('MnemonicInput')).replaceText(MNEMONIC);
  await element(by.id('DoImport')).tap();
}

describe('Import with account discovery', () => {
  beforeAll(async () => {
    await openAddWalletWithAdvancedMode();
    await startImport();
  });

  it('lists the used accounts and a custom path reports whether it was used', async () => {
    await waitForText("m/84'/0'/0'", 180_000);
    await waitForText("m/44'/0'/0'", 180_000);

    await element(by.id('CustomDerivationPathButton')).tap();
    await waitForId('DerivationPathInput');
    await element(by.id('DerivationPathInput')).replaceText("m/84'/0'/0'");
    await waitFor(element(by.text('found')).atIndex(0))
      .toExist()
      .withTimeout(120_000);
    await element(by.id('DerivationPathInput')).replaceText("m/84'/0'/77'");
    await waitFor(element(by.text('not found')).atIndex(0))
      .toExist()
      .withTimeout(120_000);
  });

  it('imports the chosen BIP44 account with its own derivation path and xpub', async () => {
    await device.pressBack();
    await waitForText("m/44'/0'/0'", 180_000);
    await element(by.text("m/44'/0'/0'")).tap();
    await element(by.id('DiscoveryImportButton')).tap();
    await waitForId('OnChainWalletRow', 120_000);

    await element(by.id('Settings')).tap();
    await waitForId('WalletDetails');
    await element(by.id('WalletDetails')).tap();
    await waitForId('WalletDetailsScroll');
    await waitFor(element(by.id('DerivationPath')))
      .toExist()
      .withTimeout(30_000);
    assert.strictEqual((await extractTextFromElementById('DerivationPath')).trim(), "m/44'/0'/0'");

    await waitFor(element(by.id('XPub')))
      .toBeVisible()
      .whileElement(by.id('WalletDetailsScroll'))
      .scroll(200, 'down');
    await element(by.id('XPub')).tap();
    await waitForId('AddressValue');
    assert.strictEqual(await extractTextFromElementById('AddressValue'), accountXpub("m/44'/0'/0'"));
  });
});
