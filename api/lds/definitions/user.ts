import { Asset } from './asset';

export const UserUrl = { get: 'user' };

export interface User {
  address: string;
  lightning: LnInfo;
}

export interface LnInfo {
  address: string;

  addressLnurl: string;
  addressOwnershipProof: string;
  wallets: LnWallet[];
}

export interface LnWallet {
  asset: Asset;
  lndhubAdminUrl?: string;
  lndhubInvoiceUrl?: string;
  // Returned by the LDS user endpoint and consumed in add-lightning.tsx when
  // creating Taproot asset wallets (passed to TaprootLdsWallet.create).
  lnbitsWalletId: string;
}
