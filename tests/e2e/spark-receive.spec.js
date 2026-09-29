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
import { bip85Mnemonic12, connectSpark, sparkBalance } from './spark-sdk';

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
    // The app's Spark wallet is the BIP-85 child of the imported phrase; read the same wallet from the test runner.
    const own = await connectSpark(bip85Mnemonic12(mnemonic));
    let expectedAddress;
    let expectedBalance;
    try {
      expectedAddress = (await own.getLightningAddress())?.lightningAddress;
      expectedBalance = await sparkBalance(own);
    } finally {
      await own.close();
    }
    assert.ok(expectedAddress, 'the Spark test wallet has no Lightning address; open it in the app once to register one');
    assert.strictEqual(await readLightningBalance(), expectedBalance);

    await openLightningReceive();
    await waitForId('AddressValue');
    const address = (await extractTextFromElementById('AddressValue')).trim();
    assert.strictEqual(address, expectedAddress);

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
  });
});
