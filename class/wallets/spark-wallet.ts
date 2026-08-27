import createHash from 'create-hash';
import bolt11 from 'bolt11';
import { bech32m } from 'bech32';
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
  type ListPaymentsRequest,
  type Payment,
  type PrepareSendPaymentResponse,
} from '@breeztech/breez-sdk-spark-react-native';
import { BitcoinUnit, Chain } from '../../models/bitcoinUnits';
import { acquireSparkSessionLease, isSparkSdkConnected, SparkSessionStaleError, type SparkSessionLease } from '../../api/spark/spark-sdk';
import { beginOutgoingPayment, getOutgoingPayment, settleOutgoingPayment } from '../../api/spark/outgoing-payment';
import loc from '../../loc';
import { AbstractWallet } from './abstract-wallet';

export const SparkPayInvoiceStatus = {
  Completed: 'completed',
  Pending: 'pending',
} as const;

export type SparkPayInvoiceResult = {
  status: (typeof SparkPayInvoiceStatus)[keyof typeof SparkPayInvoiceStatus];
  paymentHash: string;
  paymentId?: string;
};

/**
 * Fixed 16-byte namespace so the same invoice always maps to the same UUID.
 * A fresh namespace per call would make a retry look like a new payment.
 */
const IDEMPOTENCY_NAMESPACE = Buffer.from('6b8f3c2a1d9e0475b3c8a0f4e21769d1', 'hex');

function invoiceIdempotencyKey(paymentIdentity: string): string {
  const digest = createHash('sha1').update(IDEMPOTENCY_NAMESPACE).update(paymentIdentity).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // eslint-disable-line no-bitwise
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // eslint-disable-line no-bitwise
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * 3% of the prepared amount, at least 1 sat. Without the floor,
 * Math.floor(n * 0.03) is 0 for every payment under 34 sats.
 * Shared with the LNURL pay screen so the shown cap matches the check.
 */
export function sparkMaxSendFeeSats(amount: number): number {
  return Math.max(Math.floor(Number(amount) * 0.03), 1);
}

function assertSendFeeWithinLimit(
  prepareResponse: PrepareSendPaymentResponse,
  expectedMethod: SendPaymentMethod_Tags.Bolt11Invoice | SendPaymentMethod_Tags.SparkInvoice = SendPaymentMethod_Tags.Bolt11Invoice,
): void {
  const { paymentMethod, amount } = prepareResponse;
  let feeSats: bigint;
  if (expectedMethod === SendPaymentMethod_Tags.Bolt11Invoice) {
    if (paymentMethod.tag !== SendPaymentMethod_Tags.Bolt11Invoice) {
      throw new Error(loc.wallets.lightning_spark_invoice_unreadable);
    }
    feeSats = paymentMethod.inner.lightningFeeSats + (paymentMethod.inner.sparkTransferFeeSats ?? 0n);
  } else {
    if (paymentMethod.tag !== SendPaymentMethod_Tags.SparkInvoice) {
      throw new Error(loc.wallets.lightning_spark_invoice_unreadable);
    }
    feeSats = paymentMethod.inner.fee;
  }
  const maxFeeSats = sparkMaxSendFeeSats(Number(amount));
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

/**
 * Identity keys for merging pending, completed, and invoice lists.
 * Type is part of the key so a self-payment (send + receive, same hash) stays two rows.
 */
function invoiceDedupeKeys(tx: SparkInvoiceRecord): string[] {
  const keys: string[] = [];
  const type = tx.type || '';
  if (tx.payment_hash) keys.push(`h:${type}:${tx.payment_hash}`);
  if (tx.payment_request) keys.push(`r:${type}:${tx.payment_request}`);
  return keys;
}

export class SparkWallet extends AbstractWallet {
  static type = 'sparkWallet';
  static typeReadable = 'Lightning (Spark)';
  /**
   * Wait this long for Lightning to settle before returning a pending result.
   * Pending is not failure: the SDK may still complete the payment afterwards
   * via PaymentSucceeded / PaymentFailed events.
   */
  private static readonly SEND_PAYMENT_COMPLETION_TIMEOUT_SECS = 30;
  /** Page size for a full history walk. Callers that pass a small limit keep a single page. */
  private static readonly LIST_PAYMENTS_PAGE_SIZE = 50;
  /** Hard stop so a stuck SDK cannot loop forever. 100 pages × 50 = 5000 records. */
  private static readonly LIST_PAYMENTS_MAX_PAGES = 100;

  lnAddress?: string;
  /** On-chain Bitcoin deposit address from receivePayment(BitcoinAddress). */
  depositAddress?: string;
  /** Spark address (spark1…) from receivePayment(SparkAddress). Used for DFX session auth. */
  sparkAddress?: string;
  identityPubkey?: string;
  /**
   * On-chain wallet getID() this Lightning identity was derived from.
   * A hash of type + secret + passphrase + path — not the phrase itself.
   */
  sourceWalletId?: string;
  /** Label of that on-chain wallet at bind time; used only in the missing-source message. */
  sourceWalletLabel?: string;
  user_invoices_raw: SparkInvoiceRecord[] = [];
  transactions_raw: SparkInvoiceRecord[] = [];
  pending_transactions_raw: SparkInvoiceRecord[] = [];
  /** Same field LNURL pay reads (`payment_preimage`) after a successful send. */
  last_paid_invoice_result?: { payment_preimage?: string };

  constructor() {
    super();
    this.preferredBalanceUnit = BitcoinUnit.SATS;
    this.chain = Chain.OFFCHAIN;
    // Seed lives only in the on-chain wallet; never persist it here.
    this.secret = '';
  }

  static parseSparkPaymentUri(input: string): { invoice: string; amountSats?: number } {
    const trimmed = typeof input === 'string' ? input.trim() : '';
    const withoutScheme = /^spark:/i.test(trimmed) ? trimmed.slice(trimmed.indexOf(':') + 1) : trimmed;
    const queryStart = withoutScheme.indexOf('?');
    const invoice = (queryStart >= 0 ? withoutScheme.slice(0, queryStart) : withoutScheme).trim();
    if (queryStart < 0) {
      return { invoice };
    }

    const query = withoutScheme.slice(queryStart + 1);
    for (const part of query.split('&')) {
      const separator = part.indexOf('=');
      const rawKey = separator >= 0 ? part.slice(0, separator) : part;
      if (rawKey.toLowerCase() !== 'amount') continue;

      const rawValue = separator >= 0 ? part.slice(separator + 1) : '';
      let value: string;
      try {
        value = decodeURIComponent(rawValue);
      } catch (_) {
        break;
      }
      const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
      if (!match) break;

      const wholeSats = BigInt(match[1]) * 100_000_000n;
      const fraction = match[2] || '';
      const fractionSats = BigInt((fraction.slice(0, 8) + '00000000').slice(0, 8));
      const roundedSats = wholeSats + fractionSats + (fraction.length > 8 && Number(fraction[8]) >= 5 ? 1n : 0n);
      const amountSats = Number(roundedSats);
      if (Number.isSafeInteger(amountSats)) {
        return { invoice, amountSats };
      }
      break;
    }

    return { invoice };
  }

  static isSparkInvoice(input: string): boolean {
    const { invoice } = SparkWallet.parseSparkPaymentUri(input);
    if (!invoice) return false;
    try {
      return bech32m.decode(invoice, 10000).prefix.toLowerCase() === 'spark';
    } catch (_) {
      return false;
    }
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
    if (!isSparkSdkConnected()) {
      return;
    }
    try {
      const lease = acquireSparkSessionLease();
      const info = await lease.requireSdk().getInfo({ ensureSynced: false });
      this.requireHeld(lease);
      if (this.identityPubkey && this.identityPubkey !== info.identityPubkey) {
        throw new Error(loc.wallets.lightning_spark_session_mismatch);
      }
      this.identityPubkey = info.identityPubkey;
      this.balance = Number(info.balanceSats);
      this._lastBalanceFetch = +new Date();
    } catch (e) {
      if (e instanceof SparkSessionStaleError || !isSparkSdkConnected()) {
        return;
      }
      throw e;
    }
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
    const concatenated: SparkInvoiceRecord[] = this.pending_transactions_raw
      .slice()
      .concat(this.transactions_raw.slice())
      .concat(invoicesWithoutSignInTx);

    // Both fetchTransactions (all Bitcoin types) and getUserInvoices (Lightning
    // receives) write the same completed receive. Collapse on hash or request,
    // keeping type so a send and a receive of the same invoice stay two rows.
    const seen = new Set<string>();
    const txs: SparkInvoiceRecord[] = [];
    for (const tx of concatenated) {
      const keys = invoiceDedupeKeys(tx);
      if (keys.some(key => seen.has(key))) {
        continue;
      }
      for (const key of keys) seen.add(key);
      txs.push(tx);
    }

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

  /**
   * Walk listPayments by offset. `paginate` is for a full history sync; a
   * caller-supplied small limit stays a single request of that size.
   */
  private async listPaymentsPages(
    sdk: ReturnType<SparkSessionLease['requireSdk']>,
    request: Omit<ListPaymentsRequest, 'offset'> & { limit: number },
    paginate: boolean,
  ): Promise<Payment[]> {
    const pageSize = request.limit;
    const maxPages = paginate ? SparkWallet.LIST_PAYMENTS_MAX_PAGES : 1;
    const payments: Payment[] = [];
    let offset = 0;
    for (let page = 0; page < maxPages; page++) {
      const response = await sdk.listPayments({
        ...request,
        offset,
        limit: pageSize,
      });
      payments.push(...response.payments);
      if (response.payments.length < pageSize) {
        break;
      }
      offset += response.payments.length;
    }
    return payments;
  }

  async fetchTransactions(): Promise<void> {
    if (!isSparkSdkConnected()) {
      return;
    }
    try {
    const lease = this.holdMatchingSession();
    const payments = await this.listPaymentsPages(
      lease.requireSdk(),
      {
        typeFilter: undefined,
        statusFilter: undefined,
        assetFilter: new AssetFilter.Bitcoin(),
        paymentDetailsFilter: undefined,
        fromTimestamp: undefined,
        toTimestamp: undefined,
        sortAscending: false,
        limit: SparkWallet.LIST_PAYMENTS_PAGE_SIZE,
      },
      true,
    );

    const completed: SparkInvoiceRecord[] = [];
    const pending: SparkInvoiceRecord[] = [];

    for (const payment of payments) {
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
    } catch (e) {
      if (e instanceof SparkSessionStaleError || !isSparkSdkConnected()) {
        return;
      }
      throw e;
    }
  }

  async fetchPendingTransactions(): Promise<void> {
    // Pending entries are filled by fetchTransactions from payment status.
    if (!this.transactions_raw.length && !this.pending_transactions_raw.length) {
      await this.fetchTransactions();
    }
  }

  async getUserInvoices(limit = 0): Promise<SparkInvoiceRecord[]> {
    if (!isSparkSdkConnected()) {
      return this.user_invoices_raw || [];
    }
    try {
    const lease = this.holdMatchingSession();
    const paginate = !(limit > 0);
    const payments = await this.listPaymentsPages(
      lease.requireSdk(),
      {
        typeFilter: [PaymentType.Receive],
        statusFilter: undefined,
        assetFilter: undefined,
        paymentDetailsFilter: [new PaymentDetailsFilter.Lightning({ htlcStatus: undefined })],
        fromTimestamp: undefined,
        toTimestamp: undefined,
        sortAscending: false,
        limit: limit > 0 ? limit : SparkWallet.LIST_PAYMENTS_PAGE_SIZE,
      },
      paginate,
    );

    // Lightning without htlcStatus adds no SQL clause in breez-sdk 0.19.2, so
    // the request filter above is a hint, not a guarantee. Drop other kinds here.
    const remote = payments
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
      const match = remote.find(
        r =>
          (Boolean(r.payment_hash) && r.payment_hash === old.payment_hash) ||
          (Boolean(r.payment_request) && r.payment_request === old.payment_request),
      );
      if (match) {
        // Spark listPayments can omit details.inner.invoice. Keep the bolt11
        // the receive poller matches on, or a paid invoice never looks paid.
        if (!match.payment_request && old.payment_request) {
          match.payment_request = old.payment_request;
        }
        continue;
      }
      remote.push(old);
    }
    this.requireHeld(lease);
    this.user_invoices_raw = remote.sort((a, b) => a.timestamp - b.timestamp);
    return this.user_invoices_raw;
    } catch (e) {
      if (e instanceof SparkSessionStaleError || !isSparkSdkConnected()) {
        return this.user_invoices_raw || [];
      }
      throw e;
    }
  }

  async fetchUserInvoices(): Promise<void> {
    await this.getUserInvoices();
  }

  isInvoiceGeneratedByWallet(paymentRequest: string): boolean {
    return this.user_invoices_raw.some(invoice => invoice.payment_request === paymentRequest);
  }

  weOwnAddress(address: string): boolean {
    if (!address || !this.depositAddress) return false;
    const normalize = (value: string) => (value.slice(0, 3).toLowerCase() === 'bc1' ? value.toLowerCase() : value);
    return normalize(address) === normalize(this.depositAddress);
  }

  /**
   * Bitcoin deposit address. Cached on the wallet after the first successful SDK call.
   * `newAddress: false` reuses the existing address (the SDK creates one if none exists yet).
   */
  async getDepositAddress(): Promise<string> {
    if (this.depositAddress) {
      return this.depositAddress;
    }

    const lease = this.holdMatchingSession();
    const response = await lease.requireSdk().receivePayment({
      paymentMethod: new ReceivePaymentMethod.BitcoinAddress({ newAddress: false }),
    });

    this.requireHeld(lease);
    const address = response.paymentRequest;
    if (!address) {
      return '';
    }
    this.depositAddress = address;
    return address;
  }

  /**
   * Static Spark identity address (spark1…). Cached after the first successful SDK call.
   */
  async getSparkAddress(): Promise<string> {
    if (this.sparkAddress) {
      return this.sparkAddress;
    }

    const lease = this.holdMatchingSession();
    const response = await lease.requireSdk().receivePayment({
      paymentMethod: new ReceivePaymentMethod.SparkAddress(),
    });

    this.requireHeld(lease);
    const address = response.paymentRequest;
    if (!address) {
      return "";
    }
    this.sparkAddress = address;
    return address;
  }

  /**
   * Compact 64-byte hex ECDSA signature over `message`. DER fails DFX Spark auth.
   */
  async signCompactMessage(message: string): Promise<string> {
    const lease = this.holdMatchingSession();
    const response = await lease.requireSdk().signMessage({ message, compact: true });
    this.requireHeld(lease);
    return response.signature;
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

  private sessionGone(lease: SparkSessionLease): boolean {
    try {
      lease.requireSdk();
      return false;
    } catch (e) {
      return e instanceof SparkSessionStaleError;
    }
  }

  private recordPaidInvoice(payment?: Payment, preimage?: string): void {
    const lightningDetails = payment?.details && payment.details.tag === PaymentDetails_Tags.Lightning ? payment.details.inner : undefined;
    this.last_paid_invoice_result = {
      payment_preimage: preimage || lightningDetails?.htlcDetails?.preimage,
    };
  }

  /**
   * Completed and pending both resolve. Only a definite Failed status throws.
   * A still-open payment is tracked so SDK payment events can settle it.
   */
  async payInvoice(invoice: string, freeAmount = 0): Promise<SparkPayInvoiceResult> {
    const decoded = this.decodeInvoice(invoice);
    if (!decoded.payment_hash) {
      throw new Error(loc.wallets.lightning_spark_invoice_unreadable);
    }

    const lease = this.holdMatchingSession();
    const amount = freeAmount && freeAmount > 0 ? BigInt(freeAmount) : undefined;
    const paymentHash = decoded.payment_hash;

    const prepareResponse = await lease.requireSdk().prepareSendPayment({
      paymentRequest: new PaymentRequest.Input({ input: invoice }),
      amount,
      tokenIdentifier: undefined,
      conversionOptions: undefined,
      feePolicy: undefined,
    });

    const sdk = this.requireHeld(lease);
    assertSendFeeWithinLimit(prepareResponse);

    beginOutgoingPayment({ paymentHash, invoice });

    // The lease is not held for the duration of sendPayment: blocking
    // disconnect until every business call settles would grow the queue
    // back into serialising those calls. A teardown during send is pending.
    let payment: Payment | undefined;
    try {
      const sent = await sdk.sendPayment({
        prepareResponse,
        options: new SendPaymentOptions.Bolt11Invoice({
          preferSpark: false,
          completionTimeoutSecs: SparkWallet.SEND_PAYMENT_COMPLETION_TIMEOUT_SECS,
        }),
        idempotencyKey: invoiceIdempotencyKey(paymentHash),
      });
      payment = sent.payment;
    } catch (e) {
      const tracked = getOutgoingPayment();
      if (tracked?.paymentHash === paymentHash) {
        if (tracked.status === 'completed') {
          this.recordPaidInvoice(undefined, tracked.preimage);
          return { status: SparkPayInvoiceStatus.Completed, paymentHash, paymentId: tracked.paymentId };
        }
        if (tracked.status === 'failed') {
          throw new Error(loc.wallets.lightning_spark_payment_failed);
        }
        // Undetermined send error: keep the tracker so a later SDK event can settle it.
        return { status: SparkPayInvoiceStatus.Pending, paymentHash };
      }
      if (e instanceof SparkSessionStaleError || this.sessionGone(lease)) {
        return { status: SparkPayInvoiceStatus.Pending, paymentHash };
      }
      throw e;
    }

    if (payment.status === PaymentStatus.Failed) {
      const settled = settleOutgoingPayment({ status: 'failed', paymentHash, paymentId: payment.id });
      if (settled?.paymentHash === paymentHash && settled.status === 'completed') {
        this.recordPaidInvoice(payment, settled.preimage);
        return { status: SparkPayInvoiceStatus.Completed, paymentHash, paymentId: settled.paymentId };
      }
      throw new Error(loc.wallets.lightning_spark_payment_failed);
    }

    if (payment.status === PaymentStatus.Completed) {
      const lightningDetails = payment.details && payment.details.tag === PaymentDetails_Tags.Lightning ? payment.details.inner : undefined;
      const settled = settleOutgoingPayment({
        status: 'completed',
        paymentHash,
        paymentId: payment.id,
        preimage: lightningDetails?.htlcDetails?.preimage,
      });
      if (settled?.paymentHash === paymentHash && settled.status === 'failed') {
        throw new Error(loc.wallets.lightning_spark_payment_failed);
      }
      this.recordPaidInvoice(payment, settled?.paymentHash === paymentHash ? settled.preimage : undefined);
      return { status: SparkPayInvoiceStatus.Completed, paymentHash, paymentId: payment.id };
    }

    beginOutgoingPayment({ paymentHash, paymentId: payment.id, invoice });
    const tracked = getOutgoingPayment();
    if (tracked?.status === 'completed') {
      this.recordPaidInvoice(payment, tracked.preimage);
      return { status: SparkPayInvoiceStatus.Completed, paymentHash, paymentId: payment.id };
    }
    if (tracked?.status === 'failed') {
      settleOutgoingPayment({ status: 'failed', paymentHash, paymentId: payment.id });
      throw new Error(loc.wallets.lightning_spark_payment_failed);
    }
    return { status: SparkPayInvoiceStatus.Pending, paymentHash, paymentId: payment.id };
  }

  async paySparkInvoice(invoice: string, amountSats: number, idempotencySeed: string): Promise<SparkPayInvoiceResult> {
    if (!Number.isSafeInteger(amountSats) || amountSats <= 0) {
      throw new Error(loc.lnd.error_tip_invoice_not_supported);
    }

    const lease = this.holdMatchingSession();
    const trackingHash = createHash('sha256')
      .update(invoice)
      .update('\0')
      .update(String(amountSats))
      .update('\0')
      .update(idempotencySeed)
      .digest('hex');
    const prepareResponse = await lease.requireSdk().prepareSendPayment({
      paymentRequest: new PaymentRequest.Input({ input: invoice }),
      amount: BigInt(amountSats),
      tokenIdentifier: undefined,
      conversionOptions: undefined,
      feePolicy: undefined,
    });

    const sdk = this.requireHeld(lease);
    assertSendFeeWithinLimit(prepareResponse, SendPaymentMethod_Tags.SparkInvoice);
    // The raw invoice is reusable, so tracking it directly would collapse a later sale into the old payment.
    beginOutgoingPayment({ paymentHash: trackingHash });

    // A reusable deposit invoice may receive the same amount more than once. The per-payment
    // seed keeps separate payments distinct while preserving SDK deduplication for retries.
    const idempotencyKey = invoiceIdempotencyKey(`${invoice}\0${amountSats}\0${idempotencySeed}`);

    let payment: Payment | undefined;
    try {
      const sent = await sdk.sendPayment({
        prepareResponse,
        options: undefined,
        idempotencyKey,
      });
      payment = sent.payment;
    } catch (e) {
      const tracked = getOutgoingPayment();
      if (tracked?.paymentHash === trackingHash) {
        if (tracked.status === 'completed') {
          this.recordPaidInvoice(undefined, tracked.preimage);
          return { status: SparkPayInvoiceStatus.Completed, paymentHash: trackingHash, paymentId: tracked.paymentId };
        }
        if (tracked.status === 'failed') {
          throw new Error(loc.wallets.lightning_spark_payment_failed);
        }
        return { status: SparkPayInvoiceStatus.Pending, paymentHash: trackingHash };
      }
      if (e instanceof SparkSessionStaleError || this.sessionGone(lease)) {
        return { status: SparkPayInvoiceStatus.Pending, paymentHash: trackingHash };
      }
      throw e;
    }

    const paymentHash = payment.id || trackingHash;
    const trackedAfterSend = getOutgoingPayment();
    if (payment.id && trackedAfterSend?.paymentHash === trackingHash) {
      beginOutgoingPayment({ paymentHash: trackingHash, paymentId: payment.id });
      beginOutgoingPayment({ paymentHash, paymentId: payment.id });
    }

    if (payment.status === PaymentStatus.Failed) {
      const settled = settleOutgoingPayment({ status: 'failed', paymentHash, paymentId: payment.id });
      if (settled?.paymentHash === paymentHash && settled.status === 'completed') {
        this.recordPaidInvoice(payment, settled.preimage);
        return { status: SparkPayInvoiceStatus.Completed, paymentHash, paymentId: settled.paymentId };
      }
      throw new Error(loc.wallets.lightning_spark_payment_failed);
    }

    if (payment.status === PaymentStatus.Completed) {
      const settled = settleOutgoingPayment({ status: 'completed', paymentHash, paymentId: payment.id });
      if (settled?.paymentHash === paymentHash && settled.status === 'failed') {
        throw new Error(loc.wallets.lightning_spark_payment_failed);
      }
      this.recordPaidInvoice(payment, settled?.paymentHash === paymentHash ? settled.preimage : undefined);
      return { status: SparkPayInvoiceStatus.Completed, paymentHash, paymentId: payment.id };
    }

    const tracked = getOutgoingPayment();
    if (tracked?.paymentHash === paymentHash && tracked.status === 'completed') {
      this.recordPaidInvoice(payment, tracked.preimage);
      return { status: SparkPayInvoiceStatus.Completed, paymentHash, paymentId: payment.id };
    }
    if (tracked?.paymentHash === paymentHash && tracked.status === 'failed') {
      settleOutgoingPayment({ status: 'failed', paymentHash, paymentId: payment.id });
      throw new Error(loc.wallets.lightning_spark_payment_failed);
    }
    return { status: SparkPayInvoiceStatus.Pending, paymentHash, paymentId: payment.id };
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
