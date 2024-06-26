import { KycState, KycStatus } from './kyc';
import { Language } from './language';

export const UserUrl = { get: 'user/detail', change: 'user' };

export interface User {
  language: Language;
  mail: string;
  kycDataComplete: boolean;
  kycState: KycState;
  kycStatus: KycStatus;
  tradingLimit: UserTradingLimit;
  kycHash: string;

  ref?: string;
  refFeePercent: number;
  refCount: number;
  refVolume: number;
  paidRefCredit: number;
}

export interface UserTradingLimit {
  limit: number;
  period: 'Day' | 'Year';
}
