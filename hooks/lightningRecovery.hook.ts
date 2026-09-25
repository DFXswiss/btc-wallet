import { useCallback, useContext } from 'react';
import { BlueStorageContext } from '../blue_modules/storage-context';
import { HDLegacyBreadwalletWallet, HDLegacyP2PKHWallet, HDSegwitBech32Wallet, HDSegwitP2SHWallet } from '../class';
import { useLds } from '../api/lds/hooks/lds.hook';
import { User } from '../api/lds/definitions/user';
import { openLightningLdsWallet } from '../api/lds/lightning-lds-wallet-factory';
import { useSparkContext } from '../api/spark/contexts/spark.context';
import { reportError } from '../helpers/errors';

type SigningHdWallet = {
  type: string;
  getSecret: () => string;
  getPassphrase: () => string | undefined;
  getID: () => string;
  getLabel: () => string;
  _getExternalAddressByIndex: (index: number) => string;
  signMessage: (message: string, address: string) => string;
};

const BIP39_HD_WALLET_TYPES = new Set([
  HDSegwitBech32Wallet.type,
  HDSegwitP2SHWallet.type,
  HDLegacyP2PKHWallet.type,
  HDLegacyBreadwalletWallet.type,
]);

/**
 * Login addresses a lightning.space account of this seed can be keyed to: the imported wallet's own first
 * address, then the first BIP84 and BIP49 address (app-created wallets before May 2023 were BIP49).
 */
function loginCandidates(wallet: SigningHdWallet): SigningHdWallet[] {
  const candidates: SigningHdWallet[] = [wallet];
  for (const WalletClass of [HDSegwitBech32Wallet, HDSegwitP2SHWallet]) {
    if (WalletClass.type === wallet.type) continue;
    const candidate = new WalletClass() as unknown as SigningHdWallet & {
      setSecret: (s: string) => void;
      setPassphrase: (p: string) => void;
    };
    candidate.setSecret(wallet.getSecret());
    const passphrase = wallet.getPassphrase();
    if (passphrase) candidate.setPassphrase(passphrase);
    candidates.push(candidate);
  }
  return candidates;
}

/**
 * Discovers the Lightning wallet a seed already has. A lightning.space (LNDHub) account takes precedence:
 * - recoverLightningWallet (after an import) restores it, or else a previously used Spark wallet; any failed
 *   check stops the recovery instead of guessing, so nothing is created on uncertain results.
 * - addLightningWallet (the home add button) restores it, or else creates the Spark wallet, which brings back
 *   a Spark wallet the seed already had. A failed lightning.space check is thrown to the caller.
 */
/** How long an import screen waits for the recovery before it continues; the recovery keeps running afterwards. */
export const LIGHTNING_RECOVERY_MAX_WAIT_MS = 30000;

export function useLightningRecovery(): {
  recoverLightningWallet: (wallet: SigningHdWallet) => Promise<void>;
  waitForLightningRecovery: (wallet: SigningHdWallet) => Promise<void>;
  addLightningWallet: (wallet: SigningHdWallet) => Promise<void>;
} {
  const { findUser } = useLds();
  const { recoverSparkWallet, createSparkWallet } = useSparkContext();
  const { addAndSaveWallet } = useContext(BlueStorageContext);

  /** Adds the seed's lightning.space wallet if it has one; returns whether it did. */
  const addExistingLdsWallet = useCallback(
    async (wallet: SigningHdWallet): Promise<boolean> => {
      if (!BIP39_HD_WALLET_TYPES.has(wallet.type)) return false;
      let user: User | undefined;
      for (const candidate of loginCandidates(wallet)) {
        const address = candidate._getExternalAddressByIndex(0);
        user = await findUser(address, async message => candidate.signMessage(message, address));
        if (user) break;
      }
      const lndhub = user?.lightning.wallets.find(w => w.asset.name === 'BTC' && w.lndhubAdminUrl);
      if (!user || !lndhub?.lndhubAdminUrl) return false;
      await addAndSaveWallet(
        await openLightningLdsWallet(lndhub.lndhubAdminUrl, user.lightning.address, user.lightning.addressOwnershipProof),
      );
      return true;
    },
    [findUser, addAndSaveWallet],
  );

  const recoverLightningWallet = useCallback(
    async (wallet: SigningHdWallet): Promise<void> => {
      if (!BIP39_HD_WALLET_TYPES.has(wallet.type)) return;
      try {
        if (await addExistingLdsWallet(wallet)) return;
        await recoverSparkWallet(wallet);
      } catch (e) {
        reportError('lightningRecovery: recovery check failed', e);
      }
    },
    [addExistingLdsWallet, recoverSparkWallet],
  );

  const waitForLightningRecovery = useCallback(
    async (wallet: SigningHdWallet): Promise<void> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<void>(resolve => {
        timer = setTimeout(resolve, LIGHTNING_RECOVERY_MAX_WAIT_MS);
      });
      try {
        await Promise.race([recoverLightningWallet(wallet), timeout]);
      } finally {
        clearTimeout(timer);
      }
    },
    [recoverLightningWallet],
  );

  const addLightningWallet = useCallback(
    async (wallet: SigningHdWallet): Promise<void> => {
      if (await addExistingLdsWallet(wallet)) return;
      await createSparkWallet();
    },
    [addExistingLdsWallet, createSparkWallet],
  );

  return { recoverLightningWallet, waitForLightningRecovery, addLightningWallet };
}
