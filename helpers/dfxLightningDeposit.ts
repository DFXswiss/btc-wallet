import { DfxService } from '../api/dfx/contexts/session.context';
import { SparkWallet } from '../class/wallets/spark-wallet';
import { DfxMaxAmount } from './dfxMaxAmount';

export type LightningDepositPayParams =
  | { sparkAddress: string; walletID: string; amountSat: number; routeId: string }
  | { sparkInvoice: string; walletID: string; amountSat: number; routeId: string }
  | { lnurl?: string; walletID: string; amountSat: number; isMax?: true };

/**
 * Pay-screen parameters for the deposit of a DFX sell or swap paid from a Lightning wallet. A Spark wallet pays a
 * Spark deposit directly; any other deposit is an LNURL, which every Lightning wallet, Spark included, can pay.
 */
export function lightningDepositPayParams(
  wallet: { type: string; getID(): string },
  depositAddress: string | undefined,
  amountSat: number,
  routeId: string,
  isMax = false,
): LightningDepositPayParams {
  const walletID = wallet.getID();
  const sparkKind = wallet.type === SparkWallet.type && depositAddress ? SparkWallet.sparkDepositKind(depositAddress) : null;
  if (sparkKind === 'address' && depositAddress) {
    return { sparkAddress: depositAddress, walletID, amountSat, routeId };
  }
  if (sparkKind === 'invoice' && depositAddress) {
    return { sparkInvoice: SparkWallet.parseSparkPaymentUri(depositAddress).invoice, walletID, amountSat, routeId };
  }
  return isMax ? { lnurl: depositAddress, walletID, amountSat, isMax: true } : { lnurl: depositAddress, walletID, amountSat };
}

/**
 * Whole balance of a Spark wallet when the amount confirmed in the DFX widget is the max proposed to it and the
 * balance has not changed since; undefined otherwise, and for every other wallet type.
 */
export async function sparkMaxDepositSats(
  wallet: { type: string; getID(): string; getBalance(): number; fetchBalance(): Promise<void> },
  service: DfxService,
  confirmedAmountBtc: string,
): Promise<number | undefined> {
  if (wallet.type !== SparkWallet.type) return undefined;

  await wallet.fetchBalance();
  const balance = wallet.getBalance();
  const isMax = await DfxMaxAmount.wasConfirmed(wallet.getID(), service, confirmedAmountBtc, balance);
  return isMax ? balance : undefined;
}
