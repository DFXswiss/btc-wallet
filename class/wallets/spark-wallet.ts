import createHash from 'create-hash';
import bolt11 from 'bolt11';
import {
  AssetFilter,
  PaymentDetails_Tags,
  PaymentDetailsFilter,
  PaymentRequest,
  PaymentStatus,
  PaymentType,
  ReceivePaymentMethod,
  SendPaymentMethod_Tags,
  SendPaymentOptions,
  type Payment,
  type PrepareSendPaymentResponse,
} from '@breeztech/breez-sdk-spark-react-native';
import { BitcoinUnit, Chain } from '../../models/bitcoinUnits';
import { acquireSparkSessionLease, SparkSessionStaleError, type SparkSessionLease } from '../../api/spark/spark-sdk';
import loc from '../../loc';
import { AbstractWallet } from './abstract-wallet';

/**
 * Fixed 16-byte namespace so the same invoice always maps to the same UUID.
 * A fresh namespace per call would make a retry look like a new payment.
 */
const IDEMPOTENCY_NAMESPACE = Buffer.from('6b8f3c2a1d9e0475b3c8a0f4e21769d1', 'hex');

function invoiceIdempotencyKey(paymentHash: string): string {
  const digest = createHash('sha1').update(IDEMPOTENCY_NAMESPACE).update(paymentHash).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // eslint-disable-line no-bitwise
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // eslint-disable-line no-bitwise
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * 3% of the prepared amount, at least 1 sat. Without the floor,
 * Math.floor(n * 0.03) is 0 for every payment under 34 sats.
 */
function assertSendFeeWithinLimit(prepareResponse: PrepareSendPaymentResponse): void {
  const { paymentMethod, amount } = prepareResponse;
  if (paymentMethod.tag !== SendPaymentMethod_Tags.Bolt11Invoice) {
    throw new Error(loc.wallets.lightning_spark_invoice_unreadable);
  }
  const feeSats = paymentMethod.inner.lightningFeeSats + (paymentMethod.inner.sparkTransferFeeSats ?? 0n);
  const maxFeeSats = Math.max(Math.floor(Number(amount) * 0.03), 1);
  if (feeSats > BigInt(maxFeeSats)) {
    throw new Error(
      loc.formatString(loc.wallets.lightning_spark_fee_too_high, {
        fee: String(feeSats),
        maxFee: String(maxFeeSats),
        amount: String(amount),
      }),
    );
  }
}

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

  /**
   * Lease on the live session. Rejects a session bound to another identity.
   * fetchBalance does not use this: it is the one path that may still set
   * identityPubkey when the wallet has none.
   */
  private holdMatchingSession(): SparkSessionLease {
    const lease = acquireSparkSessionLease();
    if (this.identityPubkey && lease.identity !== this.identityPubkey) {
      throw new Error(loc.wallets.lightning_spark_session_mismatch);
    }
    return lease;
  }

  /** Re-check after an await. Throws the same mismatch error once the held session is gone. */
  private requireHeld(lease: SparkSessionLease): ReturnType<SparkSessionLease['requireSdk']> {
    try {
      return lease.requireSdk();
    } catch (e) {
      if (e instanceof SparkSessionStaleError) {
        throw new Error(loc.wallets.lightning_spark_session_mismatch);
      }
      throw e;
    }
  }

  async fetchBalance(): Promise<void> {
    const lease = acquireSparkSessionLease();
    const info = await lease.requireSdk().getInfo({ ensureSynced: false });
    this.requireHeld(lease);
    if (this.identityPubkey && this.identityPubkey !== info.identityPubkey) {
      throw new Error(loc.wallets.lightning_spark_session_mismatch);
    }
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
    const lease = this.holdMatchingSession();
    const response = await lease.requireSdk().listPayments({
      typeFilter: undefined,
      statusFilter: undefined,
      assetFilter: new AssetFilter.Bitcoin(),
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

    this.requireHeld(lease);
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

  async getUserInvoices(limit = 0): Promise<SparkInvoiceRecord[]> {
    const lease = this.holdMatchingSession();
    const response = await lease.requireSdk().listPayments({
      typeFilter: [PaymentType.Receive],
      statusFilter: undefined,
      assetFilter: undefined,
      paymentDetailsFilter: [new PaymentDetailsFilter.Lightning({ htlcStatus: undefined })],
      fromTimestamp: undefined,
      toTimestamp: undefined,
      offset: undefined,
      limit: limit > 0 ? limit : 50,
      sortAscending: false,
    });

    // Lightning without htlcStatus adds no SQL clause in breez-sdk 0.19.2, so
    // the request filter above is a hint, not a guarantee. Drop other kinds here.
    const remote = response.payments
      .filter(payment => payment.details && payment.details.tag === PaymentDetails_Tags.Lightning)
      .map(p => this.mapPayment(p));
    // Keep locally created unpaid invoices that the network has not seen yet.
    // Match on payment_hash (mapPayment sets it from the Lightning HTLC hash
    // when present, otherwise payment.id; addInvoice from the bolt11 decode)
    // or a non-empty payment_request. An empty request is not an identity —
    // Lightning details.inner.invoice can be missing. A row with neither key
    // cannot be told apart from a new empty row, so it is not re-appended:
    // re-appending would grow the list on every fetch.
    for (const old of this.user_invoices_raw) {
      const hasKey = Boolean(old.payment_hash) || Boolean(old.payment_request);
      if (!hasKey) {
        continue;
      }
      if (
        !remote.some(
          r =>
            (Boolean(r.payment_hash) && r.payment_hash === old.payment_hash) ||
            (Boolean(r.payment_request) && r.payment_request === old.payment_request),
        )
      ) {
        remote.push(old);
      }
    }
    this.requireHeld(lease);
    this.user_invoices_raw = remote.sort((a, b) => a.timestamp - b.timestamp);
    return this.user_invoices_raw;
  }

  async fetchUserInvoices(): Promise<void> {
    await this.getUserInvoices();
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
    const lease = this.holdMatchingSession();
    const amountNum = typeof amt === 'string' ? parseInt(amt, 10) : amt;
    // Round after the > 0 check so a sub-sat amount (e.g. 0.4) stays a fixed invoice (0n),
    // not an amountless one. BigInt() rejects non-integers.
    const amountSats = amountNum && !Number.isNaN(amountNum) && amountNum > 0 ? BigInt(Math.round(amountNum)) : undefined;

    const response = await lease.requireSdk().receivePayment({
      paymentMethod: new ReceivePaymentMethod.Bolt11Invoice({
        description: memo || '',
        amountSats,
        expirySecs: undefined,
        paymentHash: undefined,
      }),
    });

    this.requireHeld(lease);
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
    const decoded = this.decodeInvoice(invoice);
    if (!decoded.payment_hash) {
      throw new Error(loc.wallets.lightning_spark_invoice_unreadable);
    }

    const lease = this.holdMatchingSession();
    const amount = freeAmount && freeAmount > 0 ? BigInt(freeAmount) : undefined;

    const prepareResponse = await lease.requireSdk().prepareSendPayment({
      paymentRequest: new PaymentRequest.Input({ input: invoice }),
      amount,
      tokenIdentifier: undefined,
      conversionOptions: undefined,
      feePolicy: undefined,
    });

    const sdk = this.requireHeld(lease);
    assertSendFeeWithinLimit(prepareResponse);

    const { payment } = await sdk.sendPayment({
      prepareResponse,
      options: new SendPaymentOptions.Bolt11Invoice({
        preferSpark: false,
        completionTimeoutSecs: SparkWallet.SEND_PAYMENT_COMPLETION_TIMEOUT_SECS,
      }),
      idempotencyKey: invoiceIdempotencyKey(decoded.payment_hash),
    });

    if (payment.status === PaymentStatus.Failed) {
      throw new Error(loc.wallets.lightning_spark_payment_failed);
    }
    if (payment.status !== PaymentStatus.Completed) {
      // Pending is not success: the payment may still fail, and the caller must not treat it as paid.
      throw new Error(loc.wallets.lightning_spark_payment_in_transit);
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
    // payment.id is the SDK payment id, not the Lightning payment hash. Use
    // the HTLC hash when the Lightning details carry one; otherwise keep id
    // so an empty invoice still has a merge key.
    let paymentHash = payment.id;

    if (payment.details && payment.details.tag === PaymentDetails_Tags.Lightning) {
      paymentRequest = payment.details.inner.invoice;
      description = payment.details.inner.description || '';
      const htlcHash = payment.details.inner.htlcDetails?.paymentHash;
      if (htlcHash) {
        paymentHash = htlcHash;
      }
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
