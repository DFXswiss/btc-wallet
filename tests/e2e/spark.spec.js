/* global device, element, by, expect */
import assert from 'assert';
import BIP32Factory from 'bip32';
import * as bip39 from 'bip39';
import bolt11 from 'bolt11';
import { createHmac } from 'crypto';

import ecc from '../../blue_modules/noble_ecc';
import { extractTextFromElementById, launchFresh, requireEnv, speedImport, waitForId } from './helperz';

// Needs a build with BREEZ_API_KEY; the wallet is new and unfunded on every run.
const bip32 = BIP32Factory(ecc);

/** BIP-85 BIP39 application, English, 12 words, index 0 — written from the spec, independent of the app code. */
function bip85Mnemonic12(mnemonic) {
  const node = bip32.fromSeed(bip39.mnemonicToSeedSync(mnemonic)).derivePath("m/83696968'/39'/0'/12'/0'");
  const entropy = createHmac('sha512', 'bip-entropy-from-k').update(node.privateKey).digest().subarray(0, 16);
  return bip39.entropyToMnemonic(Buffer.from(entropy).toString('hex'));
}

async function waitForInvoice() {
  for (let i = 0; i < 60; i++) {
    const value = await extractTextFromElementById('AddressValue').catch(() => '');
    if (/^lnbc/i.test(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('receive screen never showed a BOLT11 invoice');
}

describe('Spark Lightning wallet', () => {
  const onChainMnemonic = bip39.generateMnemonic(128);

  beforeAll(async () => {
    requireEnv('BREEZ_API_KEY');
    await launchFresh();
    await speedImport(onChainMnemonic);
    await waitForId('LightningWalletRowAdd');
    await element(by.id('LightningWalletRowAdd')).tap();
    await waitForId('LightningWalletRow', 180_000);
  });

  it('creates an invoice for the typed sats amount and description', async () => {
    await element(by.id('LightningWalletRow')).tap();
    await waitForId('ReceiveButton');
    await element(by.id('ReceiveButton')).tap();
    await waitForId('ReceiveAmountInput', 120_000);

    await element(by.id('ReceiveAmountInput')).replaceText('1234');
    await element(by.id('ReceiveDescriptionInput')).replaceText('e2e invoice');
    await element(by.id('ReceiveDescriptionInput')).tapReturnKey();

    const invoice = await waitForInvoice();
    const decoded = bolt11.decode(invoice);
    assert.strictEqual(decoded.network.bech32, 'bc');
    assert.strictEqual(decoded.millisatoshis, '1234000');
    const description = decoded.tags.find(tag => tag.tagName === 'description');
    assert.strictEqual(description?.data, 'e2e invoice');
    const expiry = decoded.timeExpireDate * 1000;
    assert.ok(expiry > Date.now() + 5 * 60_000, 'invoice must stay payable for more than five minutes');
  });

  it('exports the BIP-85 child phrase of the on-chain phrase, only after the notice is accepted', async () => {
    await device.launchApp({ newInstance: true });
    await waitForId('Settings');
    await element(by.id('Settings')).tap();
    await waitForId('WalletDetailsLnd');
    await element(by.id('WalletDetailsLnd')).tap();
    await waitForId('WalletDetailsScroll');
    await element(by.id('WalletExport')).tap();

    await waitForId('SparkBackupNoticeContinue');
    await element(by.id('SparkBackupNoticeContinue')).tap();
    await expect(element(by.id('WalletExportScroll'))).not.toExist();

    await element(by.text('I understand')).tap();
    await element(by.id('SparkBackupNoticeContinue')).tap();
    await waitForId('WalletExportScroll');

    const expected = bip85Mnemonic12(onChainMnemonic).split(' ');
    for (const [index, word] of expected.entries()) {
      await expect(element(by.text(`${index + 1}. ${word}  `))).toExist();
    }
  });
});
