import { LnurlpResponse } from '../../models/lnurl';
import BoltCard from '../boltcard';
import Lnurl from '../lnurl';
import { LightningCustodianWallet } from './lightning-custodian-wallet';

export class LightningLdsWallet extends LightningCustodianWallet {
  static type = 'lightningLdsWallet';
  static typeReadable = 'Lightning';

  lnAddress?: string;
  addressOwnershipProof?: string;
  lndhubInvoiceUrl?: string;
  boltcard?: BoltCard;
  boltcards: BoltCard[] = [];
  isPosMode: boolean = false;

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

  addBoltcard(_boltcard: BoltCard): BoltCard {
    const existingCard = this.boltcards.find(card => card.uid === _boltcard.uid);
    if (!existingCard) {
      this.boltcards.push(_boltcard);
    }
    return _boltcard;
  }

  getBoltcards(): BoltCard[] {
    return this.boltcards;
  }

  deleteBoltcard(cardDetails: BoltCard): void {
    this.boltcards = this.boltcards.filter(card => card.uid !== cardDetails.uid);
  }

  getLnurl() {
    const [address, domain] = (this.lnAddress as string).split('@');
    return Lnurl.encode(`https://${domain}/.well-known/lnurlp/${address}`);
  }

  async queryLnurlPayService(): Promise<LnurlpResponse> {
    const url = Lnurl.decode(this.getLnurl());
    const response = await fetch(url);
    return await response.json();
  }

  async adjustLnurlPayAmount(min: number, max: number): Promise<any> {
    const response = await fetch(`${Lnurl.decode(this.getLnurl())}/asset/BTC`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': this.getAdminKey(),
      },
      body: JSON.stringify({
        min,
        max,
      }),
    });
    return await response.json();
  }
}
