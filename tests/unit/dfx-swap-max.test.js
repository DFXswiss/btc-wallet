/**
 * DFX swap-flow Max-amount regression suite.
 *
 * Defect chain (why swap confirm can throw while in-wallet Max never does):
 *   1. Launch (DfxServicesButtons) computes Max from getBalance() — includes frozen
 *      and unconfirmed sats — minus a fee estimated over getUtxo() (excludes frozen).
 *      Launch is shared between sell and swap.
 *   2. That BTC amount is handed to the web app as the Max balance, then floored by the
 *      backend to 5 significant digits, then returned via deeplink as a fixed amount.
 *   3. Swap confirm (screen/dfx/swap) builds a FIXED-value target via btcToSatoshi(amount)
 *      and coinselects over getUtxo() only — so frozen funds counted at launch are not
 *      spendable at confirm → coinselect throws "Not enough balance…".
 *   4. Related gaps: fee rate moving between launch and confirm, and fractional satoshis
 *      from btcToSatoshi on >8-decimal strings, also trip the fixed-value path.
 *
 * Structural difference vs. sell: swap.tsx fetches FRESH fees at confirm time via
 * NetworkTransactionFees.recommendedFees() (screen/dfx/swap.tsx:81-83), so a fee-rate
 * change between launch and confirm is not an edge case here — it is the expected steady
 * state whenever the mempool moves. Sell instead reads the AsyncStorage fee cache written
 * at launch. Both still fail the same fixed-value / coinselect defects.
 *
 * Controls document behaviour that already works and must stay green.
 * Regression gates encode the REQUIRED post-fix behaviour; they FAIL today on purpose
 * so CI stays red until the sell/swap-Max defect is fixed.
 *
 * No network, no AsyncStorage — pure wallet/coinselect math with injected UTXOs/balances.
 * confirmFeeRate is a separate parameter precisely because swap re-fetches fees.
 */

import assert from 'assert';
import BigNumber from 'bignumber.js';
import { HDSegwitBech32Wallet } from '../../class';

const currency = require('../../blue_modules/currency');

const SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// External addresses of SEED (BIP84)
const ADDR0 = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'; // 1,000,000 sats
const ADDR1 = 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g'; // 500,000 sats
const ADDR2 = 'bc1qp59yckz4ae5c4efgw2s5wfyvrz0ala7rgvuz8z'; // 250,000 sats (frozen in freeze cases)

const VAL0 = 1000000;
const VAL1 = 500000;
const VAL2 = 250000;
const SPENDABLE_WHEN_FROZEN = VAL0 + VAL1; // 1,500,000
const TOTAL_BALANCE = VAL0 + VAL1 + VAL2; // 1,750,000

// Distinct fake 64-hex txids (one per utxo)
const TXID0 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TXID1 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const TXID2 = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

// Backend swap deposit address (P2SH) — same fixture shape as sell
const DEPOSIT_ADDR = '3HoYu1UhmuZe33puQtkt9Q21y7kyi4adiC';
// Fee-estimate dust address (verbatim from DfxServicesButtons)
const DUST_ADDR = '36JxaUrpDzkEerkTf1FzwHNE1Hb7cCjgJV';

/**
 * Build an HDSegwitBech32Wallet with deterministic injected UTXOs + balances.
 * mirrors abstract-hd-electrum-wallet getBalance/getUtxo structure — update this mirror
 * together with the production flow when fixing; the assertions define the required behaviour
 */
function makeWallet({ freeze } = {}) {
  const w = new HDSegwitBech32Wallet();
  w.setSecret(SEED);

  w._utxo = [
    { value: VAL0, address: ADDR0, txId: TXID0, vout: 0, txid: TXID0, amount: VAL0, wif: '-' },
    { value: VAL1, address: ADDR1, txId: TXID1, vout: 0, txid: TXID1, amount: VAL1, wif: '-' },
    { value: VAL2, address: ADDR2, txId: TXID2, vout: 0, txid: TXID2, amount: VAL2, wif: '-' },
  ];

  // Exactly the structure a real electrum fetch fills — so getBalance() behaves like production
  w._balances_by_external_index[0] = { c: VAL0, u: 0 };
  w._balances_by_external_index[1] = { c: VAL1, u: 0 };
  w._balances_by_external_index[2] = { c: VAL2, u: 0 };

  if (freeze) {
    w.setUTXOMetadata(TXID2, 0, { frozen: true });
  }

  return w;
}

/**
 * mirrors screen/dfx/swap.tsx change-address resolution — update this mirror together with
 * the production flow when fixing; the assertions define the required behaviour
 */
function changeAddress(w) {
  return w._getInternalAddressByIndex(w.getNextFreeChangeAddressIndex());
}

/**
 * mirrors components/DfxServicesButtons.tsx:89-117 — update this mirror together with the
 * production flow when fixing; the assertions define the required behaviour
 *
 * Launch Max is shared between sell and swap: fee from dust send-max over getUtxo(), then
 * getBalance() - fee (balance includes frozen/unconfirmed; utxo path does not).
 */
function launchBalancesParam(w, feeRate) {
  const { fee } = w.createTransaction(w.getUtxo(), [{ address: DUST_ADDR }], feeRate, changeAddress(w), false);
  return new BigNumber(currency.satoshiToBTC(w.getBalance() - fee)).toString();
}

/**
 * mirrors the backend's asset floor (5 significant digits, BigNumber.ROUND_FLOOR) — update
 * this mirror together with the production flow when fixing; the assertions define the
 * required behaviour
 */
function apiFloor5(amountStr) {
  return new BigNumber(amountStr).precision(5, BigNumber.ROUND_FLOOR).toString();
}

/**
 * mirrors screen/dfx/swap.tsx:81-95 — update this mirror together with the production flow
 * when fixing; the assertions define the required behaviour
 *
 * Production confirm (swap.tsx:81-91):
 *   const networkTransactionFees = await NetworkTransactionFees.recommendedFees();
 *   const requestedSatPerByte = Number(networkTransactionFees.fastestFee);
 *   const targets = [{ address: swapInfo?.deposit.address, value: currency.btcToSatoshi(amount) }];
 *   wallet.createTransaction(lutxo, targets, requestedSatPerByte, changeAddress, …)
 *
 * confirmFeeRate is a separate parameter because swap always re-fetches fees at confirm
 * time (unlike sell, which reads the AsyncStorage cache written at launch).
 */
function swapConfirm(w, amountString, confirmFeeRate) {
  const targets = [{ address: DEPOSIT_ADDR, value: currency.btcToSatoshi(amountString) }];
  return w.createTransaction(w.getUtxo(), targets, confirmFeeRate, changeAddress(w), HDSegwitBech32Wallet.defaultRBFSequence);
}

describe('DFX swap flow: Max amount handling', () => {
  it('control: swap confirm builds a tx in the clean case (fee unchanged, nothing frozen)', () => {
    const w = makeWallet();
    const amount = apiFloor5(launchBalancesParam(w, 3));
    // Launch rate 3, confirm rate 3 (fee unchanged)
    const { tx, outputs, fee } = swapConfirm(w, amount, 3);

    assert.ok(tx, 'expected a transaction');
    assert.ok(
      outputs.some(o => o.address === DEPOSIT_ADDR),
      'expected deposit address in outputs',
    );
    assert.ok(fee > 0, 'expected a positive fee');
  });

  // FAILS until the sell/swap-Max defect is fixed; this is the regression gate
  it('swap confirm must not fail when part of the balance is frozen', () => {
    const w = makeWallet({ freeze: true });
    const amount = apiFloor5(launchBalancesParam(w, 3));

    // With the current launch mirror the amount (~1,749,400 sats) exceeds the spendable
    // non-frozen sum (1,500,000): getBalance() includes the frozen UTXO while getUtxo()
    // does not — that gap is the defect. A launch-side fix shrinks the amount, a
    // confirm-side fix absorbs it; either way the confirm below must build a tx.
    const { tx, outputs, fee } = swapConfirm(w, amount, 3);

    assert.ok(tx, 'expected a transaction');
    assert.ok(
      outputs.some(o => o.address === DEPOSIT_ADDR),
      'expected deposit address in outputs',
    );
    const depositOut = outputs.find(o => o.address === DEPOSIT_ADDR);
    // A correct fix may reduce the sent amount send-max-style or clamp it — both acceptable.
    // Upper bound: must not spend frozen funds. Lower bound: must still be a genuine
    // Max-swap (a token 1-sat deposit output would not fix anything).
    assert.ok(
      depositOut.value + fee <= SPENDABLE_WHEN_FROZEN,
      `output value (${depositOut.value}) + fee (${fee}) must not exceed spendable ${SPENDABLE_WHEN_FROZEN}`,
    );
    assert.ok(
      depositOut.value + fee >= SPENDABLE_WHEN_FROZEN - 1000,
      `output value (${depositOut.value}) + fee (${fee}) must stay within 1000 sats of spendable ${SPENDABLE_WHEN_FROZEN} — ` +
        'a Max swap must move essentially the whole spendable balance',
    );
  });

  // FAILS until the sell/swap-Max defect is fixed; this is the regression gate
  it('swap confirm must survive the fee rate moving between launch and confirm', () => {
    const w = makeWallet();
    const amount = apiFloor5(launchBalancesParam(w, 3));

    // Launch at feeRate 3; confirm at feeRate 4. For swap this is the NORMAL case, not
    // drift: confirm re-fetches via NetworkTransactionFees.recommendedFees()
    // (screen/dfx/swap.tsx:81), so any mempool move yields a different rate at confirm.
    const { tx, outputs, fee } = swapConfirm(w, amount, 4);

    assert.ok(tx, 'expected a transaction');
    assert.ok(
      outputs.some(o => o.address === DEPOSIT_ADDR),
      'expected deposit address in outputs',
    );
    const depositOut = outputs.find(o => o.address === DEPOSIT_ADDR);
    assert.ok(
      depositOut.value + fee <= TOTAL_BALANCE,
      `output value (${depositOut.value}) + fee (${fee}) must not exceed spendable ${TOTAL_BALANCE}`,
    );
    // Lower bound: the fix must still move essentially the whole balance (no token output)
    assert.ok(
      depositOut.value + fee >= TOTAL_BALANCE - 1000,
      `output value (${depositOut.value}) + fee (${fee}) must stay within 1000 sats of spendable ${TOTAL_BALANCE}`,
    );
    // The freshly fetched confirm-time rate must actually be honored: a "fix" that
    // falls back to the stale launch rate 3 would also build — catch it via the
    // effective fee rate.
    assert.ok(fee >= tx.virtualSize() * 4, `fee (${fee}) must cover the confirm-time rate of 4 sat/vB over ${tx.virtualSize()} vB`);
  });

  // FAILS until the sell/swap-Max defect is fixed; this is the regression gate
  it('swap confirm must handle amounts with more than 8 decimal places', () => {
    const w = makeWallet();

    // 9 decimals — exactly what a 5-significant-digit backend floor emits for sub-10,000-sat balances
    assert.strictEqual(apiFloor5('0.0000123456789'), '0.000012345', 'backend 5-sig-digit floor must emit 0.000012345 for this input');
    const amountStr = '0.000012345';

    // Precondition: btcToSatoshi yields a fractional satoshi (1234.5)
    const sats = currency.btcToSatoshi(amountStr);
    assert.ok(
      !Number.isInteger(sats),
      `precondition: btcToSatoshi('${amountStr}') is ${sats} — fractional satoshis; fixed-value confirm must tolerate this`,
    );

    // Must not throw despite 1,750,000 sats available
    const { tx, outputs } = swapConfirm(w, amountStr, 3);

    assert.ok(tx, 'expected a transaction');
    const depositOut = outputs.find(o => o.address === DEPOSIT_ADDR);
    assert.ok(depositOut, 'expected deposit address in outputs');
    // Exactly the floor: rounding 1234.5 UP would send more than the user confirmed
    assert.ok(Number.isInteger(depositOut.value), `output value must be an integer number of satoshis, got ${depositOut.value}`);
    assert.strictEqual(depositOut.value, 1234, `output value must be the floored 1234 sats, got ${depositOut.value}`);
  });
});
