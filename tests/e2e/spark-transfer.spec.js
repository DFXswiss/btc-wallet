/* global device, element, by */
import assert from 'assert';

import {
  enterSendDestination,
  extractTextFromElementById,
  importWithLightning,
  launchFresh,
  parseSats,
  readLightningBalance,
  readQuotedFee,
  requireEnv,
  waitForId,
  waitForLightningBalanceChange,
} from './helperz';
import { connectSpark, lightningAddressOf, sparkBalance, waitForSparkBalanceChange } from './spark-sdk';

// Moves real sats from the Spark test wallet (SPARK_E2E_MNEMONIC) back to the payer wallet (SPARK_E2E_PAYER_MNEMONIC)
// on every run: four payments of AMOUNT_SATS plus fees.
const AMOUNT_SATS = 10;

/** Pays `destination` from the app's Spark wallet; with `doubleTap` the Pay button is tapped twice in a row. */
async function payFromApp(destination, { amount, doubleTap = false } = {}) {
  await device.launchApp({ newInstance: true });
  await enterSendDestination(destination);
  await waitForId('ScanLndInvoiceNext', 60_000);
  if (amount !== undefined) await element(by.id('BitcoinAmountInput')).replaceText(String(amount));
  await element(by.id('ScanLndInvoiceNext')).tap();
  await waitForId('LnurlPayFee', 60_000);
  await readQuotedFee();
  // multiTap taps twice in one action, so the second tap lands before the app reacts to the first.
  if (doubleTap) await element(by.id('LnurlPayButton')).multiTap(2);
  else await element(by.id('LnurlPayButton')).tap();
  await waitForId('SendSuccessDone', 120_000);
  return parseSats(await extractTextFromElementById('SuccessFee'));
}

describe('Spark to Spark payments', () => {
  let payer;
  let payerSparkAddress;

  beforeAll(async () => {
    payer = await connectSpark(requireEnv('SPARK_E2E_PAYER_MNEMONIC'));
    payerSparkAddress = (await payer.receivePayment({ paymentMethod: { type: 'sparkAddress' } })).paymentRequest;
    await launchFresh();
    await importWithLightning(requireEnv('SPARK_E2E_MNEMONIC'));
  });

  afterAll(async () => {
    await payer?.close();
  });

  async function expectPaid(pay) {
    const appBefore = await readLightningBalance();
    assert.ok(appBefore >= AMOUNT_SATS * 10, `Spark test wallet holds only ${appBefore} sats; top it up`);
    const payerBefore = await sparkBalance(payer);
    const fee = await pay();
    assert.strictEqual(
      (await waitForSparkBalanceChange(payer, payerBefore)) - payerBefore,
      AMOUNT_SATS,
      'the payer received a different amount',
    );
    const appAfter = await waitForLightningBalanceChange(appBefore);
    assert.strictEqual(appBefore - appAfter, AMOUNT_SATS + fee, `balance went from ${appBefore} to ${appAfter}; fee was ${fee}`);
  }

  it('pays a Spark address: the receiver gets the amount and the balance drops by amount plus fee', async () => {
    assert.match(payerSparkAddress, /^spark1/);
    await expectPaid(() => payFromApp(payerSparkAddress, { amount: AMOUNT_SATS }));
  });

  it('pays the same Spark address the same amount again as a new payment', async () => {
    await expectPaid(() => payFromApp(payerSparkAddress, { amount: AMOUNT_SATS }));
  });

  it('pays only once when Pay is tapped twice', async () => {
    await expectPaid(() => payFromApp(payerSparkAddress, { amount: AMOUNT_SATS, doubleTap: true }));
  });

  it("pays another Spark user's Lightning address directly over Spark", async () => {
    const address = await lightningAddressOf(payer);
    await expectPaid(() => payFromApp(address, { amount: AMOUNT_SATS }));
    const [latest] = (await payer.listPayments({ typeFilter: ['receive'], limit: 1, sortAscending: false })).payments;
    assert.strictEqual(latest.method, 'spark', `the payment reached the payer over ${latest.method}, not Spark`);
  });
});
