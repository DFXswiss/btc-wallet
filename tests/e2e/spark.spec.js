/* global device, element, by, expect, waitFor */
import assert from 'assert';
import * as bip39 from 'bip39';
import bolt11 from 'bolt11';

import { extractTextFromElementById, launchFresh, requireEnv, scanText, speedImport, unpayableInvoice, waitForId } from './helperz';
import { bip85Mnemonic12 } from './bip85';

// Needs a build with BREEZ_API_KEY; the wallet is new and unfunded on every run.

async function waitForInvoice(accept = () => true) {
  for (let i = 0; i < 60; i++) {
    const value = await extractTextFromElementById('AddressValue').catch(() => '');
    if (/^lnbc/i.test(value) && accept(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('receive screen never showed a BOLT11 invoice');
}

describe('Spark Lightning wallet', () => {
  const onChainMnemonic = bip39.generateMnemonic(128);
  let invoice;

  beforeAll(async () => {
    requireEnv('BREEZ_API_KEY');
    await launchFresh();
    await speedImport(onChainMnemonic);
    await waitForId('LightningWalletRowAdd');
    await element(by.id('LightningWalletRowAdd')).tap();
    await waitForId('LightningWalletRow', 180_000);
  });

  it('creates an invoice for the typed sats amount and description, and a new one when the amount changes', async () => {
    await element(by.id('LightningWalletRow')).tap();
    await waitForId('ReceiveButton');
    await element(by.id('ReceiveButton')).tap();
    await waitForId('ReceiveAmountInput', 120_000);

    await element(by.id('ReceiveAmountInput')).replaceText('1234');
    await element(by.id('ReceiveDescriptionInput')).replaceText('e2e invoice');
    await element(by.id('ReceiveDescriptionInput')).tapReturnKey();

    invoice = await waitForInvoice();
    const decoded = bolt11.decode(invoice);
    assert.strictEqual(decoded.network.bech32, 'bc');
    assert.strictEqual(decoded.millisatoshis, '1234000');
    const description = decoded.tags.find(tag => tag.tagName === 'description');
    assert.strictEqual(description?.data, 'e2e invoice');
    const expiry = decoded.timeExpireDate * 1000;
    assert.ok(expiry > Date.now() + 5 * 60_000, 'invoice must stay payable for more than five minutes');

    await element(by.id('ReceiveAmountInput')).replaceText('2345');
    await element(by.id('ReceiveDescriptionInput')).tap();
    await element(by.id('ReceiveDescriptionInput')).tapReturnKey();
    const replaced = await waitForInvoice(value => value !== invoice);
    assert.strictEqual(bolt11.decode(replaced).millisatoshis, '2345000');
    invoice = replaced;
  });

  it('lists the open invoice in the history and shows it with amount, description and the same request', async () => {
    assert.ok(invoice, 'needs the invoice from the previous test');
    await device.launchApp({ newInstance: true });
    await waitForId('LightningWalletRow');
    await element(by.id('LightningWalletRow')).tap();
    await waitFor(element(by.id('TransactionRow0')))
      .toExist()
      .withTimeout(120_000);
    await element(by.id('TransactionRow0')).tap();
    await waitForId('InvoicePleasePay');
    assert.strictEqual((await extractTextFromElementById('InvoicePleasePay')).trim(), 'Please pay 2345 sats.');
    assert.strictEqual((await extractTextFromElementById('InvoiceFor')).trim(), 'For: e2e invoice');
    assert.strictEqual((await extractTextFromElementById('AddressValue')).trim(), invoice);
  });

  it('a lightning: link opens the payment screen with the invoice amount and description, and an empty wallet cannot pay', async () => {
    await device.launchApp({ newInstance: true });
    await waitForId('LightningWalletRow');
    await device.openURL({ url: `lightning:${unpayableInvoice(4321, 'dfx e2e deep link')}` });
    await waitForId('ScanLndInvoiceNext', 60_000);
    assert.strictEqual((await extractTextFromElementById('BitcoinAmountInput')).trim(), '4321');
    assert.strictEqual((await extractTextFromElementById('ScanLndInvoiceNote')).trim(), 'dfx e2e deep link');

    await element(by.id('ScanLndInvoiceNext')).tap();
    await waitForId('LnurlPayInsufficientFunds', 60_000);
    await expect(element(by.id('LnurlPayButton'))).not.toExist();
  });

  it('a Lightning invoice scanned on home opens the Lightning payment screen', async () => {
    await device.launchApp({ newInstance: true });
    await waitForId('HomeScanButton');
    await element(by.id('HomeScanButton')).tap();
    await scanText(unpayableInvoice(555, 'dfx e2e scan'));
    await waitForId('ScanLndInvoiceNext', 60_000);
    assert.strictEqual((await extractTextFromElementById('BitcoinAmountInput')).trim(), '555');
    assert.strictEqual((await extractTextFromElementById('ScanLndInvoiceNote')).trim(), 'dfx e2e scan');
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
