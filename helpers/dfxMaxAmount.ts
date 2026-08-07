import AsyncStorage from '@react-native-async-storage/async-storage';
import { DfxService } from '../api/dfx/contexts/session.context';
const currency = require('../blue_modules/currency');

// Rounding slack for the BTC string round-tripping through the DFX web widget (Number() parse + toString()).
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
 */
export class DfxMaxAmount {
  private static key(walletId: string, service: DfxService): string {
    return `DfxMaxAmountSats:${walletId}:${service}`;
  }

  static async remember(walletId: string, service: DfxService, amountSats: number, walletBalanceSats: number): Promise<void> {
    const value: StoredMaxAmount = { amountSats, walletBalanceSats };
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
