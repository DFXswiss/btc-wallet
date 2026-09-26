import { SparkWallet } from '../../class/wallets/spark-wallet';

/**
 * Wallets whose DFX session needs a live native SDK (Spark) or that DFX
 * never authenticates (multisig) stay out of connect() at app start.
 * Spark is signed in openServices once the user taps Buy/Sell/Swap.
 */
export function dfxConnectAtInit(type: string): boolean {
  // Literal, not MultisigHDWallet.type: importing that class pulls class/index
  // and a circular import that breaks the module graph.
  return type !== 'HDmultisig' && type !== SparkWallet.type;
}

function isForbidden(result: PromiseSettledResult<unknown>): boolean {
  if (result.status !== 'rejected') return false;
  const reason = result.reason;
  return Boolean(reason) && typeof reason === 'object' && (reason as { statusCode?: number }).statusCode === 403;
}

export function dfxAvailabilityFromSettled(results: PromiseSettledResult<unknown>[]): 'available' | 'forbidden' | 'throw' {
  if (results.some(r => r.status === 'fulfilled')) return 'available';
  if (results.length > 0 && results.every(isForbidden)) return 'forbidden';
  return 'throw';
}

/** The wallets DFX refused (403), so their services stay hidden while other wallets keep them. */
export function dfxForbiddenWalletIds(walletIds: string[], results: PromiseSettledResult<unknown>[]): string[] {
  return walletIds.filter((_, i) => results[i] && isForbidden(results[i]));
}
