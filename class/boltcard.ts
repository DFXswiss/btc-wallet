import { BolcardSecrets, BoltCardModel } from '../models/boltcard';

enum Status {
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR',
}

interface WidthdrawResponse {
  tag: 'withdrawRequest' | 'payRequest';
  callback: string;
  k1: string;
  minWithdrawable: number;
  maxWithdrawable: number;
  defaultDescription: string;
  payLink: string;
}

interface PayResponse {
  tag: 'payRequest';
  callback: string;
  minSendable: number;
  maxSendable: number;
  metadata: string;
}

export default class BoltCard implements BoltCardModel {
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
  secrets: BolcardSecrets;
  isPhisicalCardWritten: boolean;

  constructor(details: BoltCardModel, secrets: BolcardSecrets) {
    this.id = details.id;
    this.wallet = details.wallet;
    this.external_id = details.external_id;
    this.card_name = details.card_name;
    this.daily_limit = details.daily_limit;
    this.tx_limit = details.tx_limit;
    this.counter = details.counter;
    this.enable = details.enable;
    this.uid = details.uid;
    this.k0 = details.k0;
    this.k1 = details.k1;
    this.k2 = details.k2;
    this.otp = details.otp;
    this.prev_k0 = details.prev_k0;
    this.prev_k1 = details.prev_k1;
    this.prev_k2 = details.prev_k2;
    this.time = details.time;
    this.secrets = secrets;
    this.isPhisicalCardWritten = false;
  }

  /**
   * Check if the url is a boltcard withdraw url
   * @param payload url
   * @returns boolean
   */
  static isBoltcardWidthdrawUrl(payload: string): boolean {
    return payload.startsWith('lnurlw');
  }

  /**
   * @param payload url
   * @returns WidthdrawResponse
   */
  static async queryWidthdrawDetails(lnurlw: string): Promise<WidthdrawResponse> {
    const url = lnurlw.replace('lnurlw', 'https');
    const response = await fetch(url);
    return await response.json();
  }

  static async queryPayDetails(lnurlp: string): Promise<PayResponse> {
    const url = lnurlp.replace('lnurlp', 'https');
    const response = await fetch(url);
    return await response.json();
  }

  /**
   *
   * @param lnurlw payload from the nfc tag (Boltcard or similar)
   * @param paymentRequest A ligning invoice
   */
  static async widthdraw(lnurlw: string, paymentRequest: string) {
    try {
      const { callback, k1 } = await BoltCard.queryWidthdrawDetails(lnurlw);
      const callbackUrl = new URL(callback);
      callbackUrl.searchParams.append('k1', k1);
      callbackUrl.searchParams.append('pr', paymentRequest);
      const callbackResponse = await fetch(callbackUrl.toString());
      const { status, reason }: { status: Status; reason: string } = await callbackResponse.json();
      return { isError: status === Status.ERROR, reason };
    } catch (error: any) {
      return { isError: true, reason: error.message };
    }
  }

  getKeys(): BolcardSecrets {
    return this.secrets;
  }

  updateUid(uid: string) {
    return (this.secrets.uid = uid);
  }


  static isPossiblyBoltcardTapDetails(jsonPayload: any = {}) {
    return (
      jsonPayload.hasOwnProperty('lnurlw_base') ||
      jsonPayload.hasOwnProperty('uid') ||
      jsonPayload.hasOwnProperty('k0Version') ||
      jsonPayload.hasOwnProperty('k1Version') ||
      jsonPayload.hasOwnProperty('k2Version') ||
      jsonPayload.hasOwnProperty('k3Version') ||
      jsonPayload.hasOwnProperty('k4Version') 
    );
  }
}
