/* global device, element, by */
import assert from 'assert';

import {
  enterSendDestination,
  extractTextFromElementById,
  invoiceFromLightningAddress,
  launchFresh,
  parseSats,
  readQuotedFee,
  regularImport,
  requireEnv,
  waitForId,
} from './helperz';

// Spends real sats on every run: AMOUNT_SATS plus the routing fee go to E2E_LIGHTNING_ADDRESS.
// Point that address at a wallet the team controls so the funds come back.
const AMOUNT_SATS = 10;

async function readLightningBalance() {
  await device.launchApp({ newInstance: true });
  await waitForId('LightningWalletRow', 300_000);
  await element(by.id('LightningWalletRow')).tap();
  await waitForId('WalletBalance');
  return parseSats(await extractTextFromElementById('WalletBalance'));
}

describe('Spark Lightning payment', () => {
  let lightningAddress;

  beforeAll(async () => {
    requireEnv('BREEZ_API_KEY');
    const mnemonic = requireEnv('SPARK_E2E_MNEMONIC');
    lightningAddress = requireEnv('E2E_LIGHTNING_ADDRESS');
    await launchFresh();
    await regularImport(mnemonic);
  });

  it('pays a BOLT11 invoice and the balance drops by exactly the amount plus the charged fee', async () => {
    const before = await readLightningBalance();
    assert.ok(before >= AMOUNT_SATS * 10, `Spark test wallet holds only ${before} sats; top it up`);

    const invoice = await invoiceFromLightningAddress(lightningAddress, AMOUNT_SATS);
    await device.launchApp({ newInstance: true });
    await enterSendDestination(invoice);
    await waitForId('ScanLndInvoiceNext', 60_000);
    await element(by.id('ScanLndInvoiceNext')).tap();
    await waitForId('LnurlPayFee', 60_000);
    const quotedFee = await readQuotedFee();
    await element(by.id('LnurlPayButton')).tap();
    await waitForId('SendSuccessDone', 120_000);
    // The payment is re-prepared when sent; the app refuses a higher fee than quoted but may charge less.
    const chargedFee = parseSats(await extractTextFromElementById('SuccessFee'));
    assert.ok(chargedFee <= quotedFee, `charged fee ${chargedFee} exceeds the quoted ${quotedFee}`);

    let after = before;
    for (let i = 0; i < 12 && after === before; i++) {
      after = await readLightningBalance();
      if (after === before) await new Promise(resolve => setTimeout(resolve, 5000));
    }
    assert.strictEqual(before - after, AMOUNT_SATS + chargedFee, `balance went from ${before} to ${after}; charged fee was ${chargedFee}`);
  });
});
