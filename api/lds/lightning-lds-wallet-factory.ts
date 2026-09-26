import { LightningLdsWallet } from '../../class/wallets/lightning-lds-wallet';
import { Chain, WalletLabel } from '../../models/bitcoinUnits';

/** Opens the LNDHub wallet behind a lightning.space account and loads its state; the caller persists it. */
export async function openLightningLdsWallet(
  lndhubAdminUrl: string,
  lnAddress: string,
  addressOwnershipProof: string,
): Promise<LightningLdsWallet> {
  const [secret, baseUri] = lndhubAdminUrl.split('@');

  const wallet = LightningLdsWallet.create(lnAddress, addressOwnershipProof);
  wallet.setLabel(WalletLabel[Chain.OFFCHAIN]);
  wallet.setBaseURI(baseUri);
  wallet.setSecret(secret);
  await wallet.init();
  await wallet.authorize();
  await wallet.fetchTransactions();
  await wallet.fetchUserInvoices();
  await wallet.fetchPendingTransactions();
  await wallet.fetchBalance();
  return wallet;
}
