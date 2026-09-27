/* global device, element, by */
import assert from 'assert';

import {
  decodeTx,
  enterSendDestination,
  extractTextFromElementById,
  launchFresh,
  parseBtcFeeSats,
  requireEnv,
  speedImport,
  sumSpentOutputs,
  typeTextIntoAlertInput,
  waitForId,
  waitForText,
} from './helperz';

// Transactions are built and signed but never broadcast; the wallet only needs confirmed UTXOs.
const DESTINATION = 'bc1q063ctu6jhe5k4v8ka99qac8rcm2tzjjnuktyrl';
const FEE_RATE = 2;

describe('On-chain send with a funded wallet', () => {
  beforeAll(async () => {
    const mnemonic = requireEnv('HD_MNEMONIC_BIP84');
    await launchFresh();
    await speedImport(mnemonic);
  });

  async function openSendDetails() {
    await device.launchApp({ newInstance: true });
    await enterSendDestination(DESTINATION);
    await waitForId('BitcoinAmountInput');
  }

  async function setCustomFeeRate(rate) {
    await element(by.id('chooseFee')).tap();
    await waitForId('feeCustom');
    await element(by.id('feeCustom')).tap();
    await typeTextIntoAlertInput(String(rate));
    await element(by.text('OK')).tap();
  }

  async function buildAndReadTx() {
    await element(by.id('CreateTransactionButton')).tap();
    await waitForId('TransactionFee', 120_000);
    const feeText = await extractTextFromElementById('TransactionFee');
    await element(by.id('TransactionDetailsButton')).tap();
    await waitForId('TxhexInput');
    const hex = await extractTextFromElementById('TxhexInput');
    return { feeSats: parseBtcFeeSats(feeText), ...decodeTx(hex) };
  }

  it('pays the typed amount to the destination and shows the fee it actually pays', async () => {
    await openSendDetails();
    await element(by.id('BitcoinAmountInput')).replaceText('0.0001');
    await setCustomFeeRate(FEE_RATE);

    const { tx, outs, feeSats } = await buildAndReadTx();

    assert.strictEqual(outs[0].address, DESTINATION);
    assert.strictEqual(outs[0].value, 10_000);
    assert.ok(outs.length <= 2, `expected payment + optional change, got ${outs.length} outputs`);

    const spent = await sumSpentOutputs(tx);
    const paid = outs.reduce((sum, out) => sum + out.value, 0);
    assert.strictEqual(feeSats, spent - paid, 'fee on the confirm screen differs from inputs minus outputs');
    assert.strictEqual(Math.round((spent - paid) / tx.virtualSize()), FEE_RATE);
  });

  it('MAX sends the whole balance to one output minus the shown fee', async () => {
    await openSendDetails();
    await setCustomFeeRate(FEE_RATE);
    await element(by.id('SendMaxButton')).tap();
    await waitForText('OK').catch(() => {});
    await element(by.text('OK'))
      .tap()
      .catch(() => {});

    const { tx, outs, feeSats } = await buildAndReadTx();
    assert.strictEqual(outs.length, 1, 'MAX must not create change');
    assert.strictEqual(outs[0].address, DESTINATION);

    const spent = await sumSpentOutputs(tx);
    assert.strictEqual(outs[0].value, spent - feeSats);
  });
});
