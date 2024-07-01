export interface BoltcardUpdateDTO {
  card_name: string;
  counter: number;
  daily_limit: number;
  enable: boolean;
  id: string;
  k0: string;
  k1: string;
  k2: string;
  prev_k0: string;
  prev_k1: string;
  prev_k2: string;
  time: number;
  tx_limit: number;
  uid: string;
  wallet: string;
}

export interface BoltcardCreateDTO {
  card_name: string;
  counter: number;
  daily_limit: number;
  tx_limit: number;
  uid: string;
  k0: string;
  k1: string;
  k2: string;
  k3: string;
  k4: string;
}

export interface Hit {
  id: string;
  amount: number;
  card_id: string;
  ip: string;
  new_ctr: number;
  old_ctr: number;
  spent: boolean;
  time: number;
  useragent: string;
}