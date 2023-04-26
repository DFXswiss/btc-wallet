import { Asset } from './asset';
import { Blockchain } from './blockchain';
import { Fiat } from './fiat';

export const SellUrl = { receive: 'sell/paymentInfos', get: 'sell' };

export interface Sell {
  routeId: number;
  deposit: string;
  blockchain: Blockchain;
  fee: number;
  minFee: number;
  minVolume: number;
  estimatedAmount: number;
}

export interface SellPaymentInfo {
  iban: string;
  currency: Fiat;
  asset: Asset;
  amount: number;
}

export interface SellInfo {
  deposit: {
    id: number;
    address: string;
    blockchain: Blockchain;
  };
  iban: string;
  currency: Fiat;
  fee: number;
}
