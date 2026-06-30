import { MultisigHDWallet } from './wallets/multisig-hd-wallet';

/**
 * DFX-custom helper for the "import multisig" flow: determines whether a seed (mnemonic + optional
 * BIP39 passphrase) belongs to one of `wallet`'s cosigners, returning its 1-based index, or -1.
 *
 * Kept out of MultisigHDWallet (BlueWallet-derived) so that class stays identical to upstream and
 * doesn't conflict on fork sync. BlueWallet has no equivalent matcher; the check is DFX-specific.
 *
 * Matches by master fingerprint first (robust regardless of derivation path, passphrase or xpub
 * encoding), then falls back to deriving the xpub at each cosigner's own path with the passphrase —
 * the same derivation BlueWallet uses internally for cosigners.
 */
export function findCosignerIndexForSeed(wallet: MultisigHDWallet, mnemonic?: string, passphrase?: string): number {
  if (!mnemonic) return -1;

  let fingerprint: string | undefined;
  try {
    fingerprint = MultisigHDWallet.mnemonicToFingerprint(mnemonic, passphrase as string);
  } catch {
    fingerprint = undefined;
  }

  const cosigners = wallet.getCosigners();
  for (let index = 1; index <= cosigners.length; index++) {
    const cosigner = cosigners[index - 1];

    if (fingerprint && wallet.getFingerprint(index) === fingerprint) return index;
    if (cosigner === mnemonic) return index;
    if (!MultisigHDWallet.isXpubString(cosigner)) continue;

    const path = wallet.getCustomDerivationPathForCosigner(index);
    if (!path) continue;

    try {
      const derivedXpub = MultisigHDWallet.seedToXpub(mnemonic, path, passphrase);
      if (MultisigHDWallet.zpubToXpub(cosigner) === MultisigHDWallet.zpubToXpub(derivedXpub)) return index;
    } catch {
      // not derivable at this cosigner's path; keep looking
    }
  }

  return -1;
}
