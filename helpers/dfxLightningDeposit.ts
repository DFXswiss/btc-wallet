import { SparkWallet } from '../class/wallets/spark-wallet';

export type LightningDepositPayParams =
  | { sparkAddress: string; walletID: string; amountSat: number; routeId: string }
  | { sparkInvoice: string; walletID: string; amountSat: number; routeId: string }
  | { lnurl?: string; walletID: string; amountSat: number };

/**
 * Pay-screen parameters for the deposit of a DFX sell or swap paid from a Lightning wallet. A Spark wallet pays a
 * Spark deposit directly; any other deposit is an LNURL, which every Lightning wallet, Spark included, can pay.
 */
export function lightningDepositPayParams(
  wallet: { type: string; getID(): string },
  depositAddress: string | undefined,
  amountSat: number,
  routeId: string,
): LightningDepositPayParams {
  const walletID = wallet.getID();
  const sparkKind = wallet.type === SparkWallet.type && depositAddress ? SparkWallet.sparkDepositKind(depositAddress) : null;
  if (sparkKind === 'address' && depositAddress) {
    return { sparkAddress: depositAddress, walletID, amountSat, routeId };
  }
  if (sparkKind === 'invoice' && depositAddress) {
    return { sparkInvoice: SparkWallet.parseSparkPaymentUri(depositAddress).invoice, walletID, amountSat, routeId };
  }
  return { lnurl: depositAddress, walletID, amountSat };
}
