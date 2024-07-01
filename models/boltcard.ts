export interface BoltCardModel {
  id: string;
  wallet: string;
  external_id: string;
  card_name: string;
  daily_limit: number;
  tx_limit: number;
  counter: number;
  enable: boolean;
  uid: string;
  k0: string;
  k1: string;
  k2: string;
  otp: string;
  prev_k0: string;
  prev_k1: string;
  prev_k2: string;
  time: number;
}
export interface BolcardSecrets {
  uid: string;
  k0: string;
  k1: string;
  k2: string;
  k3: string;
  k4: string;
  lnurlw_base: string;
  protocol_name: string;
  protocol_version: string;
}
