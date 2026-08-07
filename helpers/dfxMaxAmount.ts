import AsyncStorage from '@react-native-async-storage/async-storage';
import { DfxService } from '../api/dfx/contexts/session.context';
const currency = require('../blue_modules/currency');

// Rounding slack for the BTC string round-tripping through the DFX web widget (Number() parse + toString()).
const SATS_TOLERANCE = 1;

/**
 * DfxServicesButtons sends the wallet's max sellable balance to the DFX web widget as a reference
 * amount for its own MAX button - it doesn't fix the amount the user ends up confirming there.
 * This remembers what we sent, so sell.tsx/swap.tsx can tell, once the widget redirects back,
 * whether the confirmed amount is that same max (the user kept/re-hit the widget's MAX) or a
 * genuine partial amount they typed - only the former is safe to build as a sweep target.
 */
export class DfxMaxAmount {
  private static key(walletId: string, service: DfxService): string {
    return `DfxMaxAmountSats:${walletId}:${service}`;
  }

  static async remember(walletId: string, service: DfxService, amountSats: number): Promise<void> {
    await AsyncStorage.setItem(DfxMaxAmount.key(walletId, service), String(amountSats));
  }

  static async wasConfirmed(walletId: string, service: DfxService, confirmedAmountBtc: string): Promise<boolean> {
    const stored = await AsyncStorage.getItem(DfxMaxAmount.key(walletId, service));
    if (!stored) return false;

    const confirmedSats = currency.btcToSatoshi(confirmedAmountBtc);
    return Math.abs(Number(stored) - confirmedSats) <= SATS_TOLERANCE;
  }
}
