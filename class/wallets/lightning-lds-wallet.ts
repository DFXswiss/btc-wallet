import BoltCard from '../boltcard';
import { LightningCustodianWallet } from './lightning-custodian-wallet';

export class LightningLdsWallet extends LightningCustodianWallet {
  static type = 'lightningLdsWallet';
  static typeReadable = 'Lightning';

  lnAddress?: string;
  addressOwnershipProof?: string;
  lndhubInvoiceUrl?: string;
  boltcard?: BoltCard;

  static create(address: string, addressOwnershipProof: string): LightningLdsWallet {
    const wallet = new LightningLdsWallet();

    wallet.lnAddress = address;
    wallet.addressOwnershipProof = addressOwnershipProof;

    return wallet;
  }

  getLndhubInvoiceUrl(): string {
    return this.lndhubInvoiceUrl || '';
  }

  setLndhubInvoiceUrl(url: string): void {
    this.lndhubInvoiceUrl = url;
  }

  getInvoiceId(): string {
    if (!this.lndhubInvoiceUrl) throw new Error('Lndhub invoice url is not set');
    const [_, invoiceId] = this.lndhubInvoiceUrl.split('lndhub://invoice:');
    return invoiceId;
  }

  getAdminKey(): string {
    const secret = this.getSecret();
    const [adminKeyUrl] = secret.split('@');
    const [_, adminKey] = adminKeyUrl.split('lndhub://admin:');
    return adminKey;
  }

  getBoltcard(): BoltCard | undefined {
    return this.boltcard;
  }

  setBoltcard(_boltcard: BoltCard): void {
    if (this.boltcard) throw new Error('Boltcard is already set');
    this.boltcard = _boltcard;
  }

  deleteBoltcard(): void {
    this.boltcard = undefined;
  }
}
