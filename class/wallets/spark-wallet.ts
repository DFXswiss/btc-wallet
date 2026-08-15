import createHash from 'create-hash';
import bolt11 from 'bolt11';
import {
  PaymentDetails_Tags,
  PaymentRequest,
  PaymentStatus,
  PaymentType,
  ReceivePaymentMethod,
  SendPaymentOptions,
  type Payment,
} from '@breeztech/breez-sdk-spark-react-native';
import { BitcoinUnit, Chain } from '../../models/bitcoinUnits';
import { requireSparkSdk } from '../../api/spark/spark-sdk';
import { AbstractWallet } from './abstract-wallet';

/** Shape expected by LND screens (lndReceive, transaction list, etc.). */
export type SparkInvoiceRecord = {
  payment_request: string;
  payment_hash?: string;
  description?: string;
  memo?: string;
  amt?: number;
  value?: number;
  timestamp: number;
  expire_time: number;
  ispaid: boolean;
  type: string;
  fee?: number;
  walletID?: string;
  received?: string;
};

export class SparkWallet extends AbstractWallet {
  static type = 'sparkWallet';
  static typeReadable = 'Lightning (Spark)';
  /**
   * Without a timeout the SDK returns as soon as the payment is initiated,
   * before Lightning settlement completes -- payInvoice would then report
   * success for a payment that may still fail. 30s gives real LN routing
   * room to settle without blocking the UI indefinitely.
   */
  private static readonly SEND_PAYMENT_COMPLETION_TIMEOUT_SECS = 30;

  lnAddress?: string;
  identityPubkey?: string;
  user_invoices_raw: SparkInvoiceRecord[] = [];
  transactions_raw: SparkInvoiceRecord[] = [];
  pending_transactions_raw: SparkInvoiceRecord[] = [];

  constructor() {
    super();
    this.preferredBalanceUnit = BitcoinUnit.SATS;
    this.chain = Chain.OFFCHAIN;
    // Seed lives only in the on-chain wallet; never persist it here.
    this.secret = '';
  }

  static create(identityPubkey: string, lnAddress?: string): SparkWallet {
    if (!identityPubkey) {
      throw new Error('SparkWallet.create requires identityPubkey');
    }
    const wallet = new SparkWallet();
    wallet.identityPubkey = identityPubkey;
    wallet.lnAddress = lnAddress;
    return wallet;
  }

  /**
   * Stable id from type + public identity key. Empty secret is intentional —
   * the recovery phrase must never be stored on this record.
   * identityPubkey is mandatory: without it every Spark wallet would hash to
   * the same id (type + empty secret).
   */
  getID(): string {
    if (!this.identityPubkey) {
      throw new Error('SparkWallet identityPubkey is required for getID');
    }
    const string2hash = this.type + this.identityPubkey + this.getSecret();
    return createHash('sha256').update(string2hash).digest().toString('hex');
  }

  getBaseURI(): string {
    return 'Breez Spark';
  }

  allowSend(): boolean {
    return true;
  }

  allowReceive(): boolean {
    return true;
  }

  getBalance(): number {
    return this.balance;
  }

  async fetchBalance(): Promise<void> {
    const sdk = requireSparkSdk();
    const info = await sdk.getInfo({ ensureSynced: false });
    this.identityPubkey = info.identityPubkey;
    this.balance = Number(info.balanceSats);
    this._lastBalanceFetch = +new Date();
  }

  /**
   * LND screens expect lightning invoice records, not on-chain Transaction shapes.
   * AbstractWallet types this as Transaction[]; the override is intentional.
   */
  // @ts-expect-error -- off-chain list uses SparkInvoiceRecord, not on-chain Transaction
  getTransactions(): SparkInvoiceRecord[] {
    this.pending_transactions_raw = this.pending_transactions_raw || [];
    this.user_invoices_raw = this.user_invoices_raw || [];
    this.transactions_raw = this.transactions_raw || [];

    const invoicesWithoutSignInTx = this.user_invoices_raw.filter(invoice => invoice.amt !== 1 || invoice.ispaid);
    const txs: SparkInvoiceRecord[] = this.pending_transactions_raw
      .slice()
      .concat(this.transactions_raw.slice())
      .concat(invoicesWithoutSignInTx);

    for (const tx of txs) {
      tx.walletID = this.getID();
      if (typeof tx.value === 'undefined' && typeof tx.amt !== 'undefined') {
        if (tx.type === 'paid_invoice') {
          tx.value = -Math.abs(tx.amt + (tx.fee || 0));
        } else if (tx.type === 'user_invoice') {
          tx.value = tx.amt;
        }
      }
      tx.received = new Date(tx.timestamp * 1000).toString();
    }

    return txs.sort((a, b) => b.timestamp - a.timestamp);
  }

  async fetchTransactions(): Promise<void> {
    const sdk = requireSparkSdk();
    const response = await sdk.listPayments({
      typeFilter: undefined,
      statusFilter: undefined,
      assetFilter: undefined,
      paymentDetailsFilter: undefined,
      fromTimestamp: undefined,
      toTimestamp: undefined,
      offset: undefined,
      limit: 50,
      sortAscending: false,
    });

    const completed: SparkInvoiceRecord[] = [];
    const pending: SparkInvoiceRecord[] = [];

    for (const payment of response.payments) {
      const mapped = this.mapPayment(payment);
      if (payment.status === PaymentStatus.Pending) {
        pending.push(mapped);
      } else if (payment.status === PaymentStatus.Completed) {
        completed.push(mapped);
      }
    }

    this.transactions_raw = completed;
    this.pending_transactions_raw = pending;
    this._lastTxFetch = +new Date();
  }

  async fetchPendingTransactions(): Promise<void> {
    // Pending entries are filled by fetchTransactions from payment status.
    if (!this.transactions_raw.length && !this.pending_transactions_raw.length) {
      await this.fetchTransactions();
    }
  }

  async fetchUserInvoices(): Promise<void> {
    const sdk = requireSparkSdk();
    const response = await sdk.listPayments({
      typeFilter: [PaymentType.Receive],
      statusFilter: undefined,
      assetFilter: undefined,
      paymentDetailsFilter: undefined,
      fromTimestamp: undefined,
      toTimestamp: undefined,
      offset: undefined,
      limit: 50,
      sortAscending: false,
    });

    const remote = response.payments.map(p => this.mapPayment(p));
    // Keep locally created unpaid invoices that the network has not seen yet.
    for (const old of this.user_invoices_raw) {
      if (!remote.some(r => r.payment_request === old.payment_request)) {
        remote.push(old);
      }
    }
    this.user_invoices_raw = remote.sort((a, b) => a.timestamp - b.timestamp);
  }

  isInvoiceGeneratedByWallet(paymentRequest: string): boolean {
    return this.user_invoices_raw.some(invoice => invoice.payment_request === paymentRequest);
  }

  weOwnAddress(_address: string): boolean {
    return false;
  }

  weOwnTransaction(txid: string): boolean {
    for (const tx of this.getTransactions()) {
      if (tx && tx.payment_hash && tx.payment_hash === txid) return true;
    }
    return false;
  }

  async addInvoice(amt: number | string, memo: string): Promise<string> {
    const sdk = requireSparkSdk();
    const amountNum = typeof amt === 'string' ? parseInt(amt, 10) : amt;
    const amountSats = amountNum && !Number.isNaN(amountNum) && amountNum > 0 ? BigInt(amountNum) : undefined;

    const response = await sdk.receivePayment({
      paymentMethod: new ReceivePaymentMethod.Bolt11Invoice({
        description: memo || '',
        amountSats,
        expirySecs: undefined,
        paymentHash: undefined,
      }),
    });

    const paymentRequest = response.paymentRequest;
    const decoded = this.decodeInvoice(paymentRequest);
    const record: SparkInvoiceRecord = {
      payment_request: paymentRequest,
      payment_hash: decoded.payment_hash,
      description: memo || '',
      memo: memo || '',
      amt: amountNum || 0,
      value: amountNum || 0,
      timestamp: Math.floor(Date.now() / 1000),
      expire_time: parseInt(decoded.expiry || '3600', 10),
      ispaid: false,
      type: 'user_invoice',
      fee: 0,
    };
    this.user_invoices_raw = this.user_invoices_raw || [];
    this.user_invoices_raw.push(record);
    return paymentRequest;
  }

  async payInvoice(invoice: string, freeAmount = 0): Promise<void> {
    const sdk = requireSparkSdk();
    const amount = freeAmount && freeAmount > 0 ? BigInt(freeAmount) : undefined;

    const prepareResponse = await sdk.prepareSendPayment({
      paymentRequest: new PaymentRequest.Input({ input: invoice }),
      amount,
      tokenIdentifier: undefined,
      conversionOptions: undefined,
      feePolicy: undefined,
    });

    const { payment } = await sdk.sendPayment({
      prepareResponse,
      options: new SendPaymentOptions.Bolt11Invoice({
        preferSpark: false,
        completionTimeoutSecs: SparkWallet.SEND_PAYMENT_COMPLETION_TIMEOUT_SECS,
      }),
      idempotencyKey: undefined,
    });

    if (payment.status === PaymentStatus.Failed) {
      throw new Error('Payment failed');
    }
    if (payment.status !== PaymentStatus.Completed) {
      // Mirrors the LND custodian path (lightning-custodian-wallet.js), which also
      // refuses to report success without a confirmed payment_preimage.
      throw new Error('Payment is in transit');
    }
  }

  /**
   * Same shape as LightningCustodianWallet.decodeInvoice for LND screens.
   */
  decodeInvoice(invoice: string): {
    destination?: string;
    num_satoshis: string;
    num_millisatoshis: string;
    timestamp: string;
    fallback_addr: string;
    route_hints: unknown[];
    payment_hash?: string;
    description_hash?: string;
    cltv_expiry?: string;
    expiry: string;
    description?: string;
  } {
    const { payeeNodeKey, tags, satoshis, millisatoshis, timestamp } = bolt11.decode(invoice);

    const decoded: {
      destination?: string;
      num_satoshis: string;
      num_millisatoshis: string;
      timestamp: string;
      fallback_addr: string;
      route_hints: unknown[];
      payment_hash?: string;
      description_hash?: string;
      cltv_expiry?: string;
      expiry: string;
      description?: string;
    } = {
      destination: payeeNodeKey,
      num_satoshis: satoshis ? satoshis.toString() : '0',
      num_millisatoshis: millisatoshis ? millisatoshis.toString() : '0',
      timestamp: (timestamp ?? 0).toString(),
      fallback_addr: '',
      route_hints: [],
      expiry: '3600',
    };

    for (let i = 0; i < tags.length; i++) {
      const { tagName, data } = tags[i];
      switch (tagName) {
        case 'payment_hash':
          decoded.payment_hash = data as string;
          break;
        case 'purpose_commit_hash':
          decoded.description_hash = data as string;
          break;
        case 'min_final_cltv_expiry':
          decoded.cltv_expiry = data.toString();
          break;
        case 'expire_time':
          decoded.expiry = data.toString();
          break;
        case 'description':
          decoded.description = data as string;
          break;
      }
    }

    if (!decoded.expiry) decoded.expiry = '3600';

    if (parseInt(decoded.num_satoshis, 10) === 0 && parseInt(decoded.num_millisatoshis, 10) > 0) {
      decoded.num_satoshis = (parseInt(decoded.num_millisatoshis, 10) / 1000).toString();
    }

    return decoded;
  }

  private mapPayment(payment: Payment): SparkInvoiceRecord {
    const amount = Number(payment.amount);
    const fees = Number(payment.fees);
    const isSend = payment.paymentType === PaymentType.Send;
    const isCompleted = payment.status === PaymentStatus.Completed;

    let paymentRequest = '';
    let description = '';
    const paymentHash = payment.id;

    if (payment.details && payment.details.tag === PaymentDetails_Tags.Lightning) {
      paymentRequest = payment.details.inner.invoice;
      description = payment.details.inner.description || '';
    }

    return {
      payment_request: paymentRequest,
      payment_hash: paymentHash,
      description,
      memo: description || (isSend ? 'Lightning payment' : 'Lightning invoice'),
      amt: amount,
      value: isSend ? -(amount + fees) : amount,
      timestamp: Number(payment.timestamp),
      expire_time: 3600,
      ispaid: isCompleted,
      type: isSend ? 'paid_invoice' : 'user_invoice',
      fee: fees,
    };
  }
}
