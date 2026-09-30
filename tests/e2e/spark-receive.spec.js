/* global device, element, by, waitFor */
import assert from 'assert';
import bolt11 from 'bolt11';

import {
  extractTextFromElementById,
  launchFresh,
  readLightningBalance,
  importWithLightning,
  requireEnv,
  sleep,
  waitForId,
  waitForLightningBalanceChange,
} from './helperz';
import { connectSpark, sparkBalance } from './spark-sdk';

// Moves real sats between two team wallets on every run: the payer (SPARK_E2E_PAYER_MNEMONIC, driven from the test
// runner) pays AMOUNT_SATS plus its routing fee to the app's wallet (SPARK_E2E_MNEMONIC); spark-pay sends sats out again.
const AMOUNT_SATS = 21;

async function openLightningReceive() {
  await device.launchApp({ newInstance: true });
  await waitForId('LightningWalletRow', 300_000);
  await element(by.id('LightningWalletRow')).tap();
  await waitForId('ReceiveButton');
  await element(by.id('ReceiveButton')).tap();
  await waitForId('ReceiveAmountInput', 120_000);
}

describe('Spark Lightning receive', () => {
  let payer;
  let mnemonic;

  beforeAll(async () => {
    mnemonic = requireEnv('SPARK_E2E_MNEMONIC');
    payer = await connectSpark(requireEnv('SPARK_E2E_PAYER_MNEMONIC'));
    const payerBalance = await sparkBalance(payer);
    assert.ok(payerBalance >= AMOUNT_SATS * 10, `Spark payer wallet holds only ${payerBalance} sats; top it up`);

    await launchFresh();
    await importWithLightning(mnemonic);
  });

  afterAll(async () => {
    await payer?.close();
  });

  it('Add after an import brings back the Spark wallet of the seed with its balance and a Lightning address that resolves', async () => {
    const shownBalance = await readLightningBalance();
    await openLightningReceive();
    await waitForId('AddressValue');
    const address = (await extractTextFromElementById('AddressValue')).trim();
    assert.match(address, /^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]+$/i, `"${address}" is not a Lightning address`);

    // Read the same wallet from the test runner once the app has opened it (and registered an address if it had none).
    const own = await connectSpark(mnemonic);
    try {
      assert.strictEqual(address, (await own.getLightningAddress())?.lightningAddress);
      assert.strictEqual(shownBalance, await sparkBalance(own));
    } finally {
      await own.close();
    }

    const [user, domain] = address.split('@');
    const meta = await (await fetch(`https://${domain}/.well-known/lnurlp/${user}`)).json();
    assert.strictEqual(meta.tag, 'payRequest', `LNURL-pay metadata for ${address}: ${JSON.stringify(meta)}`);
    assert.ok(meta.minSendable <= AMOUNT_SATS * 1000 && meta.maxSendable >= AMOUNT_SATS * 1000);
  });

  it('receives a payment to an invoice it created: the screen turns to paid and the balance grows by the amount', async () => {
    const before = await readLightningBalance();

    await openLightningReceive();
    await element(by.id('ReceiveAmountInput')).replaceText(String(AMOUNT_SATS));
    await element(by.id('ReceiveDescriptionInput')).replaceText('e2e receive');
    await element(by.id('ReceiveDescriptionInput')).tapReturnKey();
    let invoice = '';
    for (let i = 0; i < 60 && !/^lnbc/i.test(invoice); i++) {
      invoice = (await extractTextFromElementById('AddressValue').catch(() => '')).trim();
      if (!/^lnbc/i.test(invoice)) await sleep(1000);
    }
    assert.match(invoice, /^lnbc/i, 'receive screen never showed a BOLT11 invoice');
    assert.strictEqual(bolt11.decode(invoice).satoshis, AMOUNT_SATS);

    const prepareResponse = await payer.prepareSendPayment({ paymentRequest: { type: 'input', input: invoice } });
    await payer.sendPayment({ prepareResponse });

    await waitFor(element(by.id('SuccessAmount')))
      .toExist()
      .withTimeout(120_000);
    assert.strictEqual(Number((await extractTextFromElementById('SuccessAmount')).replace(/[^0-9]/g, '')), AMOUNT_SATS);

    await sleep(2_000);
    const after = await waitForLightningBalanceChange(before);
    assert.strictEqual(after - before, AMOUNT_SATS, `balance went from ${before} to ${after}`);

    // Tie the credit to this invoice: the wallet, read from the test runner, holds a completed receive with its hash.
    const paymentHash = bolt11.decode(invoice).tags.find(tag => tag.tagName === 'payment_hash').data;
    const own = await connectSpark(mnemonic);
    try {
      const { payments } = await own.listPayments({ typeFilter: ['receive'], limit: 20, sortAscending: false });
      const payment = payments.find(p => p.details?.htlcDetails?.paymentHash === paymentHash);
      assert.ok(payment, 'the wallet has no receive for this invoice');
      assert.strictEqual(payment.status, 'completed');
      assert.strictEqual(Number(payment.amount), AMOUNT_SATS);
    } finally {
      await own.close();
    }
  });
});
