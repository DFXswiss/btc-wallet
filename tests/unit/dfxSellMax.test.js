/**
 * DFX sell-flow Max-amount regression suite, adapted from the failing-test bug report in #216.
 *
 * Unlike the original report, this exercises the real production code (DfxMaxAmount,
 * wallet.createTransaction/getUtxo, currency.btcToSatoshi) instead of reimplemented mirrors of
 * the pre-fix logic - a mirror of an already-fixed bug would keep asserting the old behaviour
 * forever, silently drifting from what the app actually does.
 *
 * Defect chain the gates below guard against (see helpers/dfxMaxAmount.ts and screen/dfx/sell.tsx
 * for the actual fix):
 *   1. Launch proposes a Max balance to the DFX web widget, computed from spendable UTXOs.
 *   2. The backend rounds that amount to 5 significant digits before echoing it back.
 *   3. Confirm must recognise that rounded echo as "still the max" and build a send-max target -
 *      not a fixed-value one - so frozen coins and fee-rate drift between launch and confirm
 *      can't turn a Max sell into "Not enough balance".
 *   4. Separately, any confirmed amount - Max or not - must never reach coinselect as a
 *      fractional number of satoshis.
 */
import assert from 'assert';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BigNumber from 'bignumber.js';
import { HDSegwitBech32Wallet } from '../../class';
import { DfxMaxAmount } from '../../helpers/dfxMaxAmount';
import { DfxService } from '../../api/dfx/contexts/session.context';
import { Utils } from '../../helpers/utils';

const currency = require('../../blue_modules/currency');

const SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// External addresses of SEED (BIP84)
const ADDR0 = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'; // 1,000,000 sats
const ADDR1 = 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g'; // 500,000 sats
const ADDR2 = 'bc1qp59yckz4ae5c4efgw2s5wfyvrz0ala7rgvuz8z'; // 250,000 sats (frozen in freeze cases)

const VAL0 = 1000000;
const VAL1 = 500000;
const VAL2 = 250000;
const SPENDABLE_WHEN_FROZEN = VAL0 + VAL1;
const TOTAL_BALANCE = VAL0 + VAL1 + VAL2;

const TXID0 = 'a'.repeat(64);
const TXID1 = 'b'.repeat(64);
const TXID2 = 'c'.repeat(64);

const DEPOSIT_ADDR = '3HoYu1UhmuZe33puQtkt9Q21y7kyi4adiC';
const DUST_ADDR = '36JxaUrpDzkEerkTf1FzwHNE1Hb7cCjgJV'; // fee-estimate dust address, verbatim from DfxServicesButtons

const WALLET_ID = 'sell-max-test-wallet';

function makeWallet({ freeze } = {}) {
  const w = new HDSegwitBech32Wallet();
  w.setSecret(SEED);
  w._utxo = [
    { value: VAL0, address: ADDR0, txId: TXID0, vout: 0, txid: TXID0, amount: VAL0, wif: '-' },
    { value: VAL1, address: ADDR1, txId: TXID1, vout: 0, txid: TXID1, amount: VAL1, wif: '-' },
    { value: VAL2, address: ADDR2, txId: TXID2, vout: 0, txid: TXID2, amount: VAL2, wif: '-' },
  ];
  if (freeze) w.setUTXOMetadata(TXID2, 0, { frozen: true });
  return w;
}

function changeAddress(w) {
  return w._getInternalAddressByIndex(w.getNextFreeChangeAddressIndex());
}

// Mirrors DfxServicesButtons.tsx's getBalanceByDfxService()/getEstimatedOnChainFee() for the
// onchain Sell/Swap case - real Utils.sumUtxoValue and wallet.createTransaction, not reimplemented.
function launchMax(w, feeRate) {
  const lutxo = w.getUtxo();
  const sweepable = Utils.sumUtxoValue(lutxo);
  const { fee } = w.createTransaction(lutxo, [{ address: DUST_ADDR }], feeRate, changeAddress(w), false);
  return { maxSats: sweepable - fee, sweepable };
}

// Mirrors the DFX backend's Util.roundReadable(amount, AmountType.ASSET): 5 significant digits,
// ROUND_HALF_UP - the widget doesn't echo the exact proposal, it echoes this rounded amount.
function backendRoundedAmountString(sats) {
  return currency.satoshiToBTC(new BigNumber(sats).precision(5, BigNumber.ROUND_HALF_UP).toNumber());
}

// Mirrors screen/dfx/sell.tsx's handleConfirm() target selection - real DfxMaxAmount,
// wallet.createTransaction, and currency.btcToSatoshi.
async function sellConfirm(w, confirmedAmountBtc, feeRate) {
  const lutxo = w.getUtxo();
  const isMaxAmount = await DfxMaxAmount.wasConfirmed(WALLET_ID, DfxService.SELL, confirmedAmountBtc, Utils.sumUtxoValue(lutxo));
  const targets = isMaxAmount ? [{ address: DEPOSIT_ADDR }] : [{ address: DEPOSIT_ADDR, value: currency.btcToSatoshi(confirmedAmountBtc) }];
  return w.createTransaction(lutxo, targets, feeRate, changeAddress(w), HDSegwitBech32Wallet.defaultRBFSequence);
}

describe('DFX sell flow: Max amount handling (regression suite from #216)', () => {
  afterEach(async () => {
    await AsyncStorage.clear();
  });

  it('control: in-wallet Max (send-max target) builds a tx even with a frozen UTXO', () => {
    const w = makeWallet({ freeze: true });
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

  it('sell confirm does not fail when part of the balance is frozen', async () => {
    const w = makeWallet({ freeze: true });
    const { maxSats, sweepable } = launchMax(w, 3);
    await DfxMaxAmount.remember(WALLET_ID, DfxService.SELL, maxSats, sweepable);

    const { tx, outputs, fee } = await sellConfirm(w, backendRoundedAmountString(maxSats), 3);

    assert.ok(tx, 'expected a transaction');
    const depositOut = outputs.find(o => o.address === DEPOSIT_ADDR);
    assert.ok(depositOut, 'expected deposit address in outputs');
    assert.ok(
      depositOut.value + fee <= SPENDABLE_WHEN_FROZEN,
      `must not spend the frozen coin: ${depositOut.value} + ${fee} > ${SPENDABLE_WHEN_FROZEN}`,
    );
    assert.ok(
      depositOut.value + fee >= SPENDABLE_WHEN_FROZEN - 1000,
      `must still be a genuine max sell, not a token amount: ${depositOut.value} + ${fee} vs ${SPENDABLE_WHEN_FROZEN}`,
    );
  });

  it('sell confirm survives a fee-rate increase between launch and confirm', async () => {
    const w = makeWallet();
    const { maxSats, sweepable } = launchMax(w, 3);
    await DfxMaxAmount.remember(WALLET_ID, DfxService.SELL, maxSats, sweepable);

    // Launch estimated at feeRate 3; confirm runs at feeRate 4 - must not throw.
    const { tx, outputs, fee } = await sellConfirm(w, backendRoundedAmountString(maxSats), 4);

    assert.ok(tx, 'expected a transaction');
    const depositOut = outputs.find(o => o.address === DEPOSIT_ADDR);
    assert.ok(depositOut, 'expected deposit address in outputs');
    assert.ok(depositOut.value + fee <= TOTAL_BALANCE, `must not exceed the spendable balance: ${depositOut.value} + ${fee}`);
    assert.ok(
      depositOut.value + fee >= TOTAL_BALANCE - 1000,
      `must still move essentially the whole balance: ${depositOut.value} + ${fee} vs ${TOTAL_BALANCE}`,
    );
  });

  it('sell confirm handles amounts with more than 8 decimal places without crashing', async () => {
    // Not a Max scenario - a genuine small partial amount, exactly what the backend's
    // 5-significant-digit floor can produce for a sub-0.001 BTC balance.
    const amountStr = '0.000012345';
    const sats = currency.btcToSatoshi(amountStr);
    assert.ok(Number.isInteger(sats), `btcToSatoshi must always return a whole number of satoshis, got ${sats}`);

    const w = makeWallet();
    const { tx, outputs } = await sellConfirm(w, amountStr, 3);

    assert.ok(tx, 'expected a transaction');
    const depositOut = outputs.find(o => o.address === DEPOSIT_ADDR);
    assert.ok(depositOut, 'expected deposit address in outputs');
    assert.strictEqual(depositOut.value, sats, 'the confirmed (already-integer) satoshi amount must reach coinselect unchanged');
  });
});
