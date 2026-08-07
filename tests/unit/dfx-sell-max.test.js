/**
 * DFX sell-flow Max-amount regression suite.
 *
 * Defect chain (why sell confirm can throw while in-wallet Max never does):
 *   1. Launch (DfxServicesButtons) computes Max from getBalance() — includes frozen
 *      and unconfirmed sats — minus a fee estimated over getUtxo() (excludes frozen).
 *   2. That BTC amount is handed to the web app as the Max balance, then floored by the
 *      backend to 5 significant digits, then returned via deeplink as a fixed amount.
 *   3. Sell confirm (screen/dfx/sell) builds a FIXED-value target via btcToSatoshi(amount)
 *      and coinselects over getUtxo() only — so frozen/unconfirmed funds counted at launch
 *      are not spendable at confirm → coinselect throws "Not enough balance…".
 *   4. Related gaps: fee-rate rise between launch and confirm, and fractional satoshis
 *      from btcToSatoshi on >8-decimal strings, also trip the fixed-value path.
 *
 * Controls (tests 1–2) document behaviour that already works and must stay green.
 * Regression gates (tests 3–5) encode the REQUIRED post-fix behaviour; they FAIL today
 * on purpose so CI stays red until the sell-Max defect is fixed.
 *
 * No network, no AsyncStorage — pure wallet/coinselect math with injected UTXOs/balances.
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

// Backend sell deposit address (P2SH)
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
 * mirrors screen/dfx/sell.tsx change-address resolution — update this mirror together with
 * the production flow when fixing; the assertions define the required behaviour
 */
function changeAddress(w) {
  return w._getInternalAddressByIndex(w.getNextFreeChangeAddressIndex());
}

/**
 * mirrors components/DfxServicesButtons.tsx:89-117 — update this mirror together with the
 * production flow when fixing; the assertions define the required behaviour
 *
 * Launch Max: fee from dust send-max over getUtxo(), then getBalance() - fee (balance includes
 * frozen/unconfirmed; utxo path does not).
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
 * mirrors screen/dfx/sell.tsx:75-89 — update this mirror together with the production flow
 * when fixing; the assertions define the required behaviour
 *
 * Confirm: fixed-value target from the deeplink amount, coinselect over getUtxo().
 */
function sellConfirm(w, amountString, feeRate) {
  const targets = [{ address: DEPOSIT_ADDR, value: currency.btcToSatoshi(amountString) }];
  return w.createTransaction(w.getUtxo(), targets, feeRate, changeAddress(w), HDSegwitBech32Wallet.defaultRBFSequence);
}

describe('DFX sell flow: Max amount handling', () => {
  it('control: in-wallet Max (send-max target) builds a tx even with a frozen UTXO', () => {
    const w = makeWallet({ freeze: true });
    // Target WITHOUT value = internal Max path (cf. screen/send/details.js:440-443)
    const { tx, psbt, fee } = w.createTransaction(
      w.getUtxo(),
      [{ address: DEPOSIT_ADDR }],
      3,
      changeAddress(w),
      HDSegwitBech32Wallet.defaultRBFSequence,
    );

    assert.ok(tx, 'expected a transaction');
    assert.ok(psbt, 'expected a psbt');
    assert.ok(fee > 0, 'expected a positive fee');
  });

  it('control: sell confirm builds a tx in the clean case (same fee rate, nothing frozen)', () => {
    const w = makeWallet();
    const amount = apiFloor5(launchBalancesParam(w, 3));
    const { tx, outputs, fee } = sellConfirm(w, amount, 3);

    assert.ok(tx, 'expected a transaction');
    assert.ok(
      outputs.some(o => o.address === DEPOSIT_ADDR),
      'expected deposit address in outputs',
    );
    assert.ok(fee > 0, 'expected a positive fee');
  });

  // FAILS until the sell-Max defect is fixed; this is the regression gate
  it('sell confirm must not fail when part of the balance is frozen', () => {
    const w = makeWallet({ freeze: true });
    const amount = apiFloor5(launchBalancesParam(w, 3));
    const amountSats = currency.btcToSatoshi(amount);

    // Defect precondition: launch amount exceeds spendable (non-frozen) utxo sum
    assert.ok(
      amountSats > SPENDABLE_WHEN_FROZEN,
      `precondition: launch amount (${amountSats} sats) must exceed spendable non-frozen sum (${SPENDABLE_WHEN_FROZEN}); ` +
        'getBalance() includes the frozen UTXO while getUtxo() does not — that gap is the defect',
    );

    // Must not throw ("Not enough balance…" is the current broken outcome)
    const { tx, outputs, fee } = sellConfirm(w, amount, 3);

    assert.ok(tx, 'expected a transaction');
    assert.ok(
      outputs.some(o => o.address === DEPOSIT_ADDR),
      'expected deposit address in outputs',
    );
    const depositOut = outputs.find(o => o.address === DEPOSIT_ADDR);
    // A correct fix may reduce the sent amount send-max-style or clamp it — both acceptable
    assert.ok(
      depositOut.value + fee <= SPENDABLE_WHEN_FROZEN,
      `output value (${depositOut.value}) + fee (${fee}) must not exceed spendable ${SPENDABLE_WHEN_FROZEN}`,
    );
  });

  // FAILS until the sell-Max defect is fixed; this is the regression gate
  it('sell confirm must survive a fee-rate increase between launch and confirm', () => {
    const w = makeWallet();
    const amount = apiFloor5(launchBalancesParam(w, 3));

    // Launch estimated at feeRate 3; confirm runs at feeRate 4 — must not throw
    const { tx, outputs, fee } = sellConfirm(w, amount, 4);

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
  });

  // FAILS until the sell-Max defect is fixed; this is the regression gate
  it('sell confirm must handle amounts with more than 8 decimal places', () => {
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
    const { tx, outputs } = sellConfirm(w, amountStr, 3);

    assert.ok(tx, 'expected a transaction');
    const depositOut = outputs.find(o => o.address === DEPOSIT_ADDR);
    assert.ok(depositOut, 'expected deposit address in outputs');
    // 1234 or 1235 both acceptable (floor or round of 1234.5)
    assert.ok(Number.isInteger(depositOut.value), `output value must be an integer number of satoshis, got ${depositOut.value}`);
    assert.ok(depositOut.value >= 1234 && depositOut.value <= 1235, `output value must be 1234 or 1235, got ${depositOut.value}`);
  });
});
