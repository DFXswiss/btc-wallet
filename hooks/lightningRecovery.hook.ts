import { useCallback, useContext } from 'react';
import { BlueStorageContext } from '../blue_modules/storage-context';
import { HDSegwitBech32Wallet, HDSegwitP2SHWallet } from '../class';
import { useLds } from '../api/lds/hooks/lds.hook';
import { openLightningLdsWallet } from '../api/lds/lightning-lds-wallet-factory';
import { useSparkContext } from '../api/spark/contexts/spark.context';
import { BIP39_HD_WALLET_TYPES } from '../api/spark/spark-seed';

type SigningHdWallet = {
  type: string;
  getSecret: () => string;
  getPassphrase: () => string | undefined;
  getID: () => string;
  getLabel: () => string;
  _getExternalAddressByIndex: (index: number) => string;
  signMessage: (message: string, address: string) => string;
};

/**
 * Login addresses a lightning.space account of this seed can be keyed to: the wallet's own first address, then
 * the first BIP84 and BIP49 address (app-created wallets before May 2023 were BIP49). A wallet on a custom
 * derivation path keeps its type, so a candidate is skipped only when its address is the same.
 */
function loginCandidates(wallet: SigningHdWallet): SigningHdWallet[] {
  const candidates: SigningHdWallet[] = [wallet];
  const ownAddress = wallet._getExternalAddressByIndex(0);
  for (const WalletClass of [HDSegwitBech32Wallet, HDSegwitP2SHWallet]) {
    const candidate = new WalletClass();
    candidate.setSecret(wallet.getSecret());
    const passphrase = wallet.getPassphrase();
    if (passphrase) candidate.setPassphrase(passphrase);
    if (candidate._getExternalAddressByIndex(0) === ownAddress) continue;
    candidates.push(candidate);
  }
  return candidates;
}

/**
 * Adds the Lightning wallet of a seed (the home add button). A lightning.space (LNDHub) account the seed already
 * has takes precedence; otherwise the Spark wallet is created, which brings back a Spark wallet the seed already
 * had. A failed lightning.space check is thrown to the caller.
 */
export function useLightningRecovery(): {
  addLightningWallet: (wallet?: SigningHdWallet) => Promise<void>;
} {
  const { findUser } = useLds();
  const { createSparkWallet } = useSparkContext();
  const { addAndSaveWallet } = useContext(BlueStorageContext);

  /** Adds the seed's lightning.space wallet if it has one; returns whether it did. */
  const addExistingLdsWallet = useCallback(
    async (wallet: SigningHdWallet): Promise<boolean> => {
      if (!BIP39_HD_WALLET_TYPES.has(wallet.type)) return false;
      // Each login address can have its own account; one without a BTC Lightning wallet does not end the search.
      for (const candidate of loginCandidates(wallet)) {
        const address = candidate._getExternalAddressByIndex(0);
        const user = await findUser(address, async message => candidate.signMessage(message, address));
        const lndhub = user?.lightning.wallets.find(w => w.asset.name === 'BTC' && w.lndhubAdminUrl);
        if (!user || !lndhub?.lndhubAdminUrl) continue;
        await addAndSaveWallet(
          await openLightningLdsWallet(lndhub.lndhubAdminUrl, user.lightning.address, user.lightning.addressOwnershipProof),
        );
        return true;
      }
      return false;
    },
    [findUser, addAndSaveWallet],
  );

  const addLightningWallet = useCallback(
    async (wallet?: SigningHdWallet): Promise<void> => {
      if (wallet && (await addExistingLdsWallet(wallet))) return;
      await createSparkWallet(wallet);
    },
    [addExistingLdsWallet, createSparkWallet],
  );

  return { addLightningWallet };
}
