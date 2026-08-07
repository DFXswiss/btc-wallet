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
 *   5. Fee-cache gap: sell confirm reads AsyncStorage NetworkTransactionFee.StorageKey and
 *      does Number(JSON.parse(res).fastestFee) with no empty-cache guard — reachable via
 *      an external dfxtaro://sell deeplink that never ran the launch path that writes the cache.
 *
 * Controls (tests 1–2, C3–C5) document behaviour that already works and must stay green.
 * Regression gates (tests 3–5, G6) encode the REQUIRED post-fix behaviour; they FAIL today
 * on purpose so CI stays red until the sell-Max defect is fixed.
 *
 * Note: the unit gate runs with jest -b (bail), so while the gates are red, suites
 * scheduled after this one are skipped in that run. This is a known, temporary
 * side effect until the fix lands.
 *
 * No network — pure wallet/coinselect math with injected UTXOs/balances.
 * G6 uses the AsyncStorage jest mock only to exercise the empty fee-cache path.
 */

import assert from 'assert';
import BigNumber from 'bignumber.js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { HDSegwitBech32Wallet } from '../../class';
import { NetworkTransactionFee } from '../../models/networkTransactionFees';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

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
// Dust utxos for C4 (addresses 3..7)
const TXID_DUST = [
  'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  '1111111111111111111111111111111111111111111111111111111111111111',
  '2222222222222222222222222222222222222222222222222222222222222222',
];

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
 * Flexible wallet builder for robustness controls (C3–C5). Does NOT replace makeWallet —
 * the original five tests keep using makeWallet unchanged.
 *
 * Each spec: { index, value, txid, unconfirmed?, confirmations?, frozen? }
 * Address is derived from the wallet via _getExternalAddressByIndex(index).
 */
function makeWalletWith(utxoSpecs) {
  const w = new HDSegwitBech32Wallet();
  w.setSecret(SEED);

  w._utxo = utxoSpecs.map(spec => {
    const address = w._getExternalAddressByIndex(spec.index);
    const entry = {
      value: spec.value,
      address,
      txId: spec.txid,
      vout: 0,
      txid: spec.txid,
      amount: spec.value,
      wif: '-',
    };
    if (spec.confirmations !== undefined) {
      entry.confirmations = spec.confirmations;
    }
    return entry;
  });

  for (const spec of utxoSpecs) {
    if (spec.unconfirmed) {
      w._balances_by_external_index[spec.index] = { c: 0, u: spec.value };
    } else {
      w._balances_by_external_index[spec.index] = { c: spec.value, u: 0 };
    }
    if (spec.frozen) {
      w.setUTXOMetadata(spec.txid, 0, { frozen: true });
    }
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

/**
 * mirrors screen/dfx/sell.tsx:75-89 INCLUDING the fee-cache read — update this mirror
 * together with the production flow when fixing; the assertions define the required behaviour
 *
 * Production (sell.tsx:75-80):
 *   AsyncStorage.getItem(NetworkTransactionFee.StorageKey).then(res => JSON.parse(res as string))
 *   then Number(networkTransactionFees.fastestFee)
 * Empty cache: getItem → null → JSON.parse(null) → null → .fastestFee TypeError.
 */
async function sellConfirmViaFeeCache(w, amountString) {
  const networkTransactionFees = await AsyncStorage.getItem(NetworkTransactionFee.StorageKey).then(res => JSON.parse(res));
  const requestedSatPerByte = Number(networkTransactionFees.fastestFee);
  const targets = [{ address: DEPOSIT_ADDR, value: currency.btcToSatoshi(amountString) }];
  return w.createTransaction(w.getUtxo(), targets, requestedSatPerByte, changeAddress(w), HDSegwitBech32Wallet.defaultRBFSequence);
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

  it('control: sell confirm builds in the clean case with a single-utxo wallet', () => {
    const w = makeWalletWith([{ index: 0, value: VAL0, txid: TXID0 }]);
    const amount = apiFloor5(launchBalancesParam(w, 3));
    const { tx, outputs, fee } = sellConfirm(w, amount, 3);

    assert.ok(tx, 'expected a transaction');
    assert.ok(
      outputs.some(o => o.address === DEPOSIT_ADDR),
      'expected deposit address in outputs',
    );
    assert.ok(fee > 0, 'expected a positive fee');
  });

  it('control: sell confirm builds when the wallet also holds detrimental dust utxos', () => {
    // Three standard utxos PLUS five 150-sat dust utxos on external indexes 3..7.
    // At fee rate 3 a P2WPKH input costs ~204 sats — more than each dust contributes —
    // so launch's send-max fee estimate still walks getUtxo() (includes dust) while
    // confirm's coinselect can skip the uneconomic inputs. That asymmetry must not
    // prevent confirm from building.
    const specs = [
      { index: 0, value: VAL0, txid: TXID0 },
      { index: 1, value: VAL1, txid: TXID1 },
      { index: 2, value: VAL2, txid: TXID2 },
    ];
    for (let i = 0; i < 5; i++) {
      specs.push({ index: 3 + i, value: 150, txid: TXID_DUST[i] });
    }
    const w = makeWalletWith(specs);
    const amount = apiFloor5(launchBalancesParam(w, 3));
    const { tx, outputs, fee } = sellConfirm(w, amount, 3);

    assert.ok(tx, 'expected a transaction');
    assert.ok(
      outputs.some(o => o.address === DEPOSIT_ADDR),
      'expected deposit address in outputs',
    );
    assert.ok(fee > 0, 'expected a positive fee');
  });

  it('control: sell confirm builds when part of the balance is unconfirmed', () => {
    // Standard three utxos, but the 250,000-sat one is unconfirmed: balances {c:0,u:VAL2}
    // and utxo confirmations: 0. Launch counts it (getBalance includes u); getUtxo also
    // carries it — consistent end-to-end, so confirm must build.
    const w = makeWalletWith([
      { index: 0, value: VAL0, txid: TXID0 },
      { index: 1, value: VAL1, txid: TXID1 },
      { index: 2, value: VAL2, txid: TXID2, unconfirmed: true, confirmations: 0 },
    ]);
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

    // With the current launch mirror the amount (~1,749,400 sats) exceeds the spendable
    // non-frozen sum (1,500,000): getBalance() includes the frozen UTXO while getUtxo()
    // does not — that gap is the defect. A launch-side fix shrinks the amount, a
    // confirm-side fix absorbs it; either way the confirm below must build a tx.
    const { tx, outputs, fee } = sellConfirm(w, amount, 3);

    assert.ok(tx, 'expected a transaction');
    assert.ok(
      outputs.some(o => o.address === DEPOSIT_ADDR),
      'expected deposit address in outputs',
    );
    const depositOut = outputs.find(o => o.address === DEPOSIT_ADDR);
    // A correct fix may reduce the sent amount send-max-style or clamp it — both acceptable.
    // Upper bound: must not spend frozen funds. Lower bound: must still be a genuine
    // Max-sell (a token 1-sat deposit output would not fix anything).
    assert.ok(
      depositOut.value + fee <= SPENDABLE_WHEN_FROZEN,
      `output value (${depositOut.value}) + fee (${fee}) must not exceed spendable ${SPENDABLE_WHEN_FROZEN}`,
    );
    assert.ok(
      depositOut.value + fee >= SPENDABLE_WHEN_FROZEN - 5000,
      `output value (${depositOut.value}) + fee (${fee}) must stay within 5000 sats of spendable ${SPENDABLE_WHEN_FROZEN} — ` +
        'a Max sell must move essentially the whole spendable balance',
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
    // Lower bound: the fix must still move essentially the whole balance (no token output)
    assert.ok(
      depositOut.value + fee >= TOTAL_BALANCE - 5000,
      `output value (${depositOut.value}) + fee (${fee}) must stay within 5000 sats of spendable ${TOTAL_BALANCE}`,
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

  // FAILS until the sell-Max defect is fixed; this is the regression gate
  it('sell confirm must not depend on a pre-populated network fee cache', async () => {
    // Empty cache: do not seed NetworkTransactionFee.StorageKey.
    // Rationale: the sell screen is reachable via an external dfxtaro://sell deeplink
    // without the launch path (DfxServicesButtons.getEstimatedOnChainFee) ever having
    // written the cache. Required behaviour: a sane fallback fee so confirm still builds.
    // Today: JSON.parse(null) → null → .fastestFee TypeError.
    const w = makeWallet();
    const amount = apiFloor5(launchBalancesParam(w, 3));

    const { tx, outputs } = await sellConfirmViaFeeCache(w, amount);

    assert.ok(tx, 'expected a transaction');
    assert.ok(
      outputs.some(o => o.address === DEPOSIT_ADDR),
      'expected deposit address in outputs',
    );
    // No fee-band assertion — any sane fee is fine for this gate
  });
});
