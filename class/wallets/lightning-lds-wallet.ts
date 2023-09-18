import { LightningCustodianWallet } from './lightning-custodian-wallet';

export class LightningLdsWallet extends LightningCustodianWallet {
  static type = 'lightningLdsWallet';
  static typeReadable = 'Lightning';

  lnAddress?: string;
  addressOwnershipProof?: string;

  static create(address: string, addressOwnershipProof: string): LightningLdsWallet {
    const wallet = new LightningLdsWallet();

    wallet.lnAddress = address;
    wallet.addressOwnershipProof = addressOwnershipProof;

    return wallet;
  }
}
