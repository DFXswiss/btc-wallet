import AsyncStorage from '@react-native-async-storage/async-storage';
import BigNumber from 'bignumber.js';
import { DfxService } from '../api/dfx/contexts/session.context';
const currency = require('../blue_modules/currency');

// The amount the widget echoes back has already lost precision: it's floored to 5 significant
// digits, not just subject to a small string round-trip wobble. Floor our own proposal the same
// way before comparing, instead of guessing at a tolerance window that doesn't scale with the
// amount's magnitude.
const ASSET_PRECISION = 5;

// Slack for the actual BTC string round-trip through the widget (Number() parse + toString()) on
// top of the shared 5-significant-digit rounding above.
const SATS_TOLERANCE = 1;

interface StoredMaxAmount {
  amountSats: number;
  walletBalanceSats: number;
}

/**
 * DfxServicesButtons sends the wallet's max sellable balance to the DFX web widget as a reference
 * amount for its own MAX button - it doesn't fix the amount the user ends up confirming there.
 * This remembers what we sent and the wallet balance at that moment, so sell.tsx/swap.tsx can
 * tell, once the widget redirects back, whether the confirmed amount is that same max (the user
 * kept/re-hit the widget's MAX) with nothing else having changed in the wallet meanwhile - only
 * then is it safe to build a sweep target for the wallet's now-current balance. If the wallet's
 * balance moved since (e.g. an unrelated pay-in landed while the user was still in the widget),
 * a sweep would spend more than what the user actually saw confirmed on the widget's amount
 * field, so this deliberately falls back to treating it as a genuine fixed amount instead.
 *
 * A remembered value is left in place (not consumed on read) so that retrying handleConfirm() -
 * e.g. after backing out of the review screen, or after a transient createTransaction() failure -
 * still gets the safe sweep treatment as long as nothing about the proposal is actually stale.
 * It's naturally superseded the next time this wallet/service opens the widget again.
 *
 * Known, accepted limitation: matching is necessarily done against the widget's own 5-significant-
 * digit-floored echo (see ASSET_PRECISION below), since that's the only amount this ever sees -
 * the widget doesn't tell us whether the user pressed MAX or typed a number that happens to floor
 * to the same value. A manually-edited amount landing in the same bucket as the true max is
 * indistinguishable from a genuine MAX re-confirmation and will sweep the full balance instead of
 * leaving that difference unspent. The bucket scales with the amount's own magnitude - up to
 * roughly 10^(digit count - 5) sats, so tens of sats for a sub-0.01 BTC balance but up to tens of
 * thousands for a multi-BTC one. The destination is still the one the user confirmed; only the
 * swept amount can be off by less than one bucket. Closing this fully would need the widget to
 * signal "this was MAX" explicitly rather than just echoing a number.
 */
export class DfxMaxAmount {
  private static key(walletId: string, service: DfxService): string {
    return `DfxMaxAmountSats:${walletId}:${service}`;
  }

  // Matches the widget's own precision loss: 5 significant digits, floored. Applying this to the
  // sats integer directly gives the same digits as applying it to the BTC string would -
  // multiplying/dividing by a power of ten doesn't change significant digits.
  private static floorToAssetPrecision(sats: number): number {
    return new BigNumber(sats).precision(ASSET_PRECISION, BigNumber.ROUND_FLOOR).toNumber();
  }

  static async remember(walletId: string, service: DfxService, amountSats: number, walletBalanceSats: number): Promise<void> {
    const value: StoredMaxAmount = { amountSats: DfxMaxAmount.floorToAssetPrecision(amountSats), walletBalanceSats };
    await AsyncStorage.setItem(DfxMaxAmount.key(walletId, service), JSON.stringify(value));
  }

  static async wasConfirmed(
    walletId: string,
    service: DfxService,
    confirmedAmountBtc: string,
    currentWalletBalanceSats: number,
  ): Promise<boolean> {
    const stored = await AsyncStorage.getItem(DfxMaxAmount.key(walletId, service));
    if (!stored) return false;

    const { amountSats, walletBalanceSats }: StoredMaxAmount = JSON.parse(stored);
    if (walletBalanceSats !== currentWalletBalanceSats) return false;

    const confirmedSats = currency.btcToSatoshi(confirmedAmountBtc);
    return Math.abs(amountSats - confirmedSats) <= SATS_TOLERANCE;
  }
}
