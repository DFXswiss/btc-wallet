/**
 * Wallets whose DFX session needs a live native SDK (Spark) or that DFX
 * never authenticates (multisig) stay out of connect() at app start.
 * Spark is signed in openServices once the user taps Buy/Sell/Swap.
 */
export function dfxConnectAtInit(type: string): boolean {
  return type !== 'HDmultisig' && type !== 'sparkWallet';
}

export function dfxAvailabilityFromSettled(results: PromiseSettledResult<unknown>[]): 'available' | 'forbidden' | 'throw' {
  if (results.some(r => r.status === 'fulfilled')) return 'available';
  const reasons = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map(r => r.reason);
  if (
    reasons.length > 0 &&
    reasons.every(r => r && typeof r === 'object' && (r as { statusCode?: number }).statusCode === 403)
  ) {
    return 'forbidden';
  }
  return 'throw';
}
