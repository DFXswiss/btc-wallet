// The wallet classes are not imported: loading them from here first trips their circular imports. The
// values equal LightningLdsWallet.type, LightningCustodianWallet.type and SparkWallet.type (a test pins it).
export const LIGHTNING_WALLET_TYPES = ['lightningLdsWallet', 'lightningCustodianWallet', 'sparkWallet'];

/**
 * The user's Lightning wallet: an LNDHub one (lightning.space or custom) or a Spark one. A user has one of
 * them; should both exist, LNDHub wins, as in wallet discovery. Taproot asset wallets are off-chain too but
 * are not the Lightning wallet.
 */
export function getLightningWallet<T extends { type: string }>(wallets: T[]): T | undefined {
  for (const type of LIGHTNING_WALLET_TYPES) {
    const wallet = wallets.find(w => w.type === type);
    if (wallet) return wallet;
  }
  return undefined;
}
