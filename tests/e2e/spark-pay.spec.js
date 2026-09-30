/* global device, element, by, waitFor */
import assert from 'assert';

import {
  enterSendDestination,
  extractTextFromElementById,
  invoiceFromLightningAddress,
  launchFresh,
  parseSats,
  readLightningBalance,
  readQuotedFee,
  importWithLightning,
  requireEnv,
  waitForId,
  waitForLightningBalanceChange,
} from './helperz';
import { connectSpark } from './spark-sdk';

// Spends real sats on every run: AMOUNT_SATS plus the routing fee go to E2E_LIGHTNING_ADDRESS.
// Point that address at a wallet the team controls so the funds come back.
const AMOUNT_SATS = 10;

describe('Spark Lightning payment', () => {
  let lightningAddress;
  let chargedFee;
  let mnemonic;

  beforeAll(async () => {
    requireEnv('BREEZ_API_KEY');
    mnemonic = requireEnv('SPARK_E2E_MNEMONIC');
    lightningAddress = requireEnv('E2E_LIGHTNING_ADDRESS');
    await launchFresh();
    await importWithLightning(mnemonic);
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
    chargedFee = parseSats(await extractTextFromElementById('SuccessFee'));
    assert.ok(chargedFee <= quotedFee, `charged fee ${chargedFee} exceeds the quoted ${quotedFee}`);

    const after = await waitForLightningBalanceChange(before);
    assert.strictEqual(before - after, AMOUNT_SATS + chargedFee, `balance went from ${before} to ${after}; charged fee was ${chargedFee}`);

    // Tie the numbers to this invoice: the wallet, read from the test runner, holds a completed send for it.
    const own = await connectSpark(mnemonic);
    try {
      const { payments } = await own.listPayments({ typeFilter: ['send'], limit: 20, sortAscending: false });
      const payment = payments.find(p => p.details?.type === 'lightning' && p.details.invoice === invoice);
      assert.ok(payment, 'the wallet has no send for this invoice');
      assert.strictEqual(payment.status, 'completed');
      assert.strictEqual(Number(payment.amount), AMOUNT_SATS);
      assert.strictEqual(Number(payment.fees), chargedFee);
    } finally {
      await own.close();
    }
  });

  it('lists the payment first in the history with the amount and fee it took from the balance', async () => {
    assert.ok(chargedFee !== undefined, 'needs the payment from the previous test');
    await device.launchApp({ newInstance: true });
    await waitForId('LightningWalletRow', 300_000);
    await element(by.id('LightningWalletRow')).tap();
    await waitFor(element(by.id('TransactionRow0')))
      .toExist()
      .withTimeout(120_000);
    await element(by.id('TransactionRow0')).tap();
    await waitForId('SuccessAmount', 60_000);
    const shown = Number((await extractTextFromElementById('SuccessAmount')).replace(/[^0-9-]/g, ''));
    assert.strictEqual(Math.abs(shown), AMOUNT_SATS + chargedFee);
  });
});
