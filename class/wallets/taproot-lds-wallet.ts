import { BitcoinUnit } from '../../models/bitcoinUnits';
import { LightningCustodianWallet } from './lightning-custodian-wallet';

export enum TaprootLdsWalletType {
  BTC = 'BTC',
  CHF = 'CHF',
  USD = 'USD',
  EUR = 'EUC',
}

export interface AssetDetails {
    name: TaprootLdsWalletType;
    displayName: string;
    status: string;
    symbol: string;
    minSendable: number;
    maxSendable: string;
    decimals: number;
}

export class TaprootLdsWallet extends LightningCustodianWallet {
  static type = 'taprootLdsWallet';
  static typeReadable = 'Taproot';

  id: string = '';
  lnAddress?: string;
  addressOwnershipProof?: string;
  private currencyName: TaprootLdsWalletType = TaprootLdsWalletType.BTC; // this should never be BTC, but it's a placeholder for now
  asset?: AssetDetails;

  constructor(props: any = undefined) {
    super(props);
    /* @ts-ignore wtf */
    this.preferredBalanceUnit = BitcoinUnit.LOCAL_CURRENCY
  }

  static create(address: string, addressOwnershipProof: string, asset: AssetDetails, walletID: string): TaprootLdsWallet {
    const wallet = new TaprootLdsWallet();
    wallet.id = walletID;
    wallet.lnAddress = address;
    wallet.addressOwnershipProof = addressOwnershipProof;
    wallet.currencyName = asset.name;
    wallet.asset = asset;

    return wallet;
  }

  getCurrencyName(): TaprootLdsWalletType {
    return this.currencyName;
  }

  // Overwrite super method
  getID(): string {
    return this.id;
  }
}
