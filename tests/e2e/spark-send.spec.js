/* global element, by, expect */
import assert from 'assert';
import bolt11 from 'bolt11';

import { enterSendDestination, extractTextFromElementById, launchFresh, parseSats, regularImport, requireEnv, waitForId } from './helperz';

// Needs a build with BREEZ_API_KEY, an on-chain phrase whose Spark wallet holds a few hundred sats,
// and a Lightning address to request invoices from. Payments are quoted but never sent.
const AMOUNT_SATS = 100;

async function invoiceFromLightningAddress(lightningAddress, sats) {
  const [user, domain] = lightningAddress.split('@');
  const meta = await (await fetch(`https://${domain}/.well-known/lnurlp/${user}`)).json();
  if (meta.status === 'ERROR') throw new Error(`LNURL-pay metadata: ${meta.reason}`);
  const separator = meta.callback.includes('?') ? '&' : '?';
  const response = await (await fetch(`${meta.callback}${separator}amount=${sats * 1000}`)).json();
  if (!response.pr) throw new Error(`LNURL-pay callback returned no invoice: ${JSON.stringify(response)}`);
  return response.pr;
}

async function readQuotedFee() {
  for (let i = 0; i < 60; i++) {
    const text = await extractTextFromElementById('LnurlPayFee');
    if (/\d+\s*sats/.test(text)) return parseSats(text);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('no Spark fee quote arrived');
}

describe('Spark Lightning send (quote only)', () => {
  let lightningAddress;

  beforeAll(async () => {
    const mnemonic = requireEnv('SPARK_E2E_MNEMONIC');
    lightningAddress = requireEnv('E2E_LIGHTNING_ADDRESS');
    await launchFresh();
    await regularImport(mnemonic);
    await waitForId('LightningWalletRow', 300_000);
  });

  it('a BOLT11 invoice is confirmed with its own amount and a quoted fee', async () => {
    const invoice = await invoiceFromLightningAddress(lightningAddress, AMOUNT_SATS);
    assert.strictEqual(bolt11.decode(invoice).millisatoshis, String(AMOUNT_SATS * 1000));

    await enterSendDestination(invoice);
    await waitForId('ScanLndInvoiceNext', 60_000);
    await expect(element(by.id('BitcoinAmountInput'))).toHaveText(String(AMOUNT_SATS));
    await element(by.id('ScanLndInvoiceNext')).tap();

    await waitForId('LnurlPayFee', 60_000);
    await expect(element(by.id('BitcoinAmountInput'))).toHaveText(String(AMOUNT_SATS));
    const fee = await readQuotedFee();
    assert.ok(fee >= 0 && fee <= AMOUNT_SATS, `implausible fee ${fee} sats for ${AMOUNT_SATS} sats`);
    const pay = await element(by.id('LnurlPayButton')).getAttributes();
    assert.strictEqual(pay.enabled, true, 'Pay must be enabled once the fee is quoted');
  });

  it('a Lightning address is confirmed with the typed amount and a quoted fee', async () => {
    await launchFresh();
    await regularImport(requireEnv('SPARK_E2E_MNEMONIC'));
    await waitForId('LightningWalletRow', 300_000);

    await enterSendDestination(lightningAddress);
    await waitForId('BitcoinAmountInput', 60_000);
    await element(by.id('BitcoinAmountInput')).replaceText(String(AMOUNT_SATS));
    await element(by.id('ScanLndInvoiceNext')).tap();

    await waitForId('LnurlPayFee', 60_000);
    await expect(element(by.id('BitcoinAmountInput'))).toHaveText(String(AMOUNT_SATS));
    const fee = await readQuotedFee();
    assert.ok(fee >= 0 && fee <= AMOUNT_SATS, `implausible fee ${fee} sats for ${AMOUNT_SATS} sats`);
  });
});
