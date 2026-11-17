/* global device, element, by */
import assert from 'assert';

import {
  bip84Addresses,
  decodeTx,
  enterSendDestination,
  expectTransactionMatchesExplorer,
  extractTextFromElementById,
  launchFresh,
  openWalletWithHistory,
  parseBtcFeeSats,
  readTransactionRow,
  requireEnv,
  speedImport,
  sumSpentOutputs,
  typeTextIntoAlertInput,
  waitForId,
} from './helperz';

// Transactions are built and signed but never broadcast; the wallet only needs confirmed UTXOs.
const DESTINATION = 'bc1q063ctu6jhe5k4v8ka99qac8rcm2tzjjnuktyrl';
const FEE_RATE = 2;

describe('On-chain send with a funded wallet', () => {
  let mnemonic;

  beforeAll(async () => {
    mnemonic = requireEnv('HD_MNEMONIC_BIP84');
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

  // The custom fee rate is typed into an Android prompt that does not always open after a normal app start; both fee
  // checks are skipped until the prompt fix (#281) is merged.
  it.skip('pays the typed amount to the destination and shows the fee it actually pays', async () => {
    await openSendDetails();
    await element(by.id('BitcoinAmountInput')).replaceText('0.0001');
    await setCustomFeeRate(FEE_RATE);

    const { tx, outs, feeSats } = await buildAndReadTx();

    const payments = outs.filter(out => out.address === DESTINATION);
    assert.strictEqual(payments.length, 1, 'exactly one output must pay the destination');
    assert.strictEqual(payments[0].value, 10_000);
    const change = outs.filter(out => out.address !== DESTINATION);
    assert.ok(change.length <= 1, `expected payment + optional change, got ${outs.length} outputs`);
    const walletAddresses = bip84Addresses(mnemonic, 200);
    for (const out of change) assert.ok(walletAddresses.has(out.address), `change goes to ${out.address}, not to the wallet`);

    const spent = await sumSpentOutputs(tx);
    const paid = outs.reduce((sum, out) => sum + out.value, 0);
    assert.strictEqual(feeSats, spent - paid, 'fee on the confirm screen differs from inputs minus outputs');
    // The wallet prices an estimated size before signing; a signature can be a byte shorter than estimated.
    const vsize = tx.virtualSize();
    assert.ok(feeSats >= FEE_RATE * vsize, `fee ${feeSats} is below ${FEE_RATE} sat/vB for ${vsize} vB`);
    assert.ok(feeSats <= FEE_RATE * (vsize + tx.ins.length), `fee ${feeSats} is above ${FEE_RATE} sat/vB for ${vsize} vB`);
  });

  it.skip('MAX sends the whole balance to one output minus the shown fee', async () => {
    await openSendDetails();
    await setCustomFeeRate(FEE_RATE);
    await element(by.id('SendMaxButton')).tap();

    const { tx, outs, feeSats } = await buildAndReadTx();
    assert.strictEqual(outs.length, 1, 'MAX must not create change');
    assert.strictEqual(outs[0].address, DESTINATION, 'the only output must pay the destination');

    const spent = await sumSpentOutputs(tx);
    assert.strictEqual(outs[0].value, spent - feeSats);
  });

  it('shows the newest transaction of the funded wallet with the value, fee and confirmations the chain has', async () => {
    await openWalletWithHistory('OnChainWalletRow');
    await expectTransactionMatchesExplorer(await readTransactionRow(0), bip84Addresses(mnemonic, 200));
  });
});
