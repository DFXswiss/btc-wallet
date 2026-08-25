import assert from 'assert';
import {
  PaymentDetails_Tags,
  PaymentStatus,
  PaymentType,
  SdkEvent_Tags,
  SendPaymentMethod_Tags,
  SendPaymentOptions_Tags,
} from '@breeztech/breez-sdk-spark-react-native';

const mockSdk = {
  getInfo: jest.fn(),
  listPayments: jest.fn(),
  receivePayment: jest.fn(),
  prepareSendPayment: jest.fn(),
  sendPayment: jest.fn(),
  getLightningAddress: jest.fn(),
};

let mockSessionIdentity = null;
let mockLeaseValid = true;
let mockLeaseSdkOverride = null;
let mockSdkConnected = true;

jest.mock('../../api/spark/spark-sdk', () => {
  class SparkSessionStaleError extends Error {
    constructor() {
      super('Spark session is no longer the one this call started with');
      this.name = 'SparkSessionStaleError';
    }
  }
  return {
    isSparkSdkConnected: () => mockSdkConnected,
    SparkSessionStaleError,
    acquireSparkSessionLease: () => ({
      get identity() {
        return mockSessionIdentity;
      },
      requireSdk() {
        if (mockLeaseSdkOverride) {
          return mockLeaseSdkOverride();
        }
        if (!mockLeaseValid) {
          throw new SparkSessionStaleError();
        }
        return mockSdk;
      },
    }),
  };
});

// Known bolt11 test vector (BOLT 11 examples).
const SAMPLE_INVOICE =
  'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp';

function bolt11PrepareResponse({ amount = 250000n, lightningFeeSats = 1n, sparkTransferFeeSats } = {}) {
  return {
    amount,
    paymentMethod: {
      tag: SendPaymentMethod_Tags.Bolt11Invoice,
      inner: {
        invoiceDetails: {},
        lightningFeeSats,
        sparkTransferFeeSats,
      },
    },
  };
}

function completedSend(id, timestamp = 1n) {
  return {
    id,
    paymentType: PaymentType.Send,
    status: PaymentStatus.Completed,
    amount: 1n,
    fees: 0n,
    timestamp,
    method: {},
    details: undefined,
  };
}

function lightningReceive(id, invoice = `inv-${id}`) {
  return {
    id,
    paymentType: PaymentType.Receive,
    status: PaymentStatus.Completed,
    amount: 1n,
    fees: 0n,
    timestamp: 1n,
    method: {},
    details: {
      tag: PaymentDetails_Tags.Lightning,
      inner: {
        description: '',
        invoice,
        destinationPubkey: 'x',
        htlcDetails: { paymentHash: id },
      },
    },
  };
}

const { SparkWallet, SparkPayInvoiceStatus, sparkMaxSendFeeSats } = require('../../class/wallets/spark-wallet');
const { BitcoinUnit, Chain } = require('../../models/bitcoinUnits');
const loc = require('../../loc').default;
const {
  applyOutgoingSdkEvent,
  beginOutgoingPayment,
  getOutgoingPayment,
  __resetOutgoingPaymentForTests,
} = require('../../api/spark/outgoing-payment');

beforeEach(() => {
  jest.clearAllMocks();
  mockSessionIdentity = null;
  mockLeaseValid = true;
  mockSdkConnected = true;
  mockLeaseSdkOverride = null;
  __resetOutgoingPaymentForTests();
});

describe('SparkWallet', () => {
  it('exposes the spark type and readable label', () => {
    assert.strictEqual(SparkWallet.type, 'sparkWallet');
    assert.strictEqual(SparkWallet.typeReadable, 'Lightning (Spark)');
  });

  it('creates a wallet without storing a secret', () => {
    const wallet = SparkWallet.create('pubkey-hex', 'user@breez.blitz');
    assert.strictEqual(wallet.identityPubkey, 'pubkey-hex');
    assert.strictEqual(wallet.lnAddress, 'user@breez.blitz');
    assert.strictEqual(wallet.getSecret(), '');
    assert.strictEqual(wallet.chain, Chain.OFFCHAIN);
    assert.strictEqual(wallet.preferredBalanceUnit, BitcoinUnit.SATS);
    assert.strictEqual(wallet.sourceWalletId, undefined);
  });

  it('keeps a source wallet binding off the secret and out of getID', () => {
    const wallet = SparkWallet.create('pubkey-hex');
    wallet.sourceWalletId = 'hd-not-the-seed';
    wallet.sourceWalletLabel = 'Savings';
    assert.strictEqual(wallet.getSecret(), '');
    assert.strictEqual(wallet.sourceWalletId, 'hd-not-the-seed');
    assert.notStrictEqual(wallet.getID(), 'hd-not-the-seed');
    assert.ok(!wallet.getID().includes('hd-not-the-seed'));
  });

  it('never keeps key material in secret after create', () => {
    const wallet = SparkWallet.create('pk');
    wallet.secret = '';
    assert.strictEqual(wallet.secret, '');
    // getID must not require a seed
    assert.ok(wallet.getID().length === 64);
  });

  it('getID is stable for the same identity and changes when identity changes', () => {
    const a = SparkWallet.create('aaa');
    const b = SparkWallet.create('aaa');
    const c = SparkWallet.create('bbb');
    assert.strictEqual(a.getID(), b.getID());
    assert.notStrictEqual(a.getID(), c.getID());
  });

  it('getID fails closed when identityPubkey is missing', () => {
    const wallet = new SparkWallet();
    assert.strictEqual(wallet.identityPubkey, undefined);
    assert.throws(() => wallet.getID(), /identityPubkey is required/);
  });

  it('create rejects an empty identityPubkey', () => {
    assert.throws(() => SparkWallet.create(''), /requires identityPubkey/);
  });

  it('getBaseURI identifies Breez Spark', () => {
    assert.strictEqual(new SparkWallet().getBaseURI(), 'Breez Spark');
  });

  it('allows send and receive', () => {
    const wallet = new SparkWallet();
    assert.strictEqual(wallet.allowSend(), true);
    assert.strictEqual(wallet.allowReceive(), true);
  });

  it('fetchBalance reads sats from the SDK and stores identity', async () => {
    mockSdk.getInfo.mockResolvedValue({ identityPubkey: 'id-pk', balanceSats: 42n, tokenBalances: new Map() });
    const wallet = new SparkWallet();
    await wallet.fetchBalance();
    assert.strictEqual(wallet.getBalance(), 42);
    assert.strictEqual(wallet.identityPubkey, 'id-pk');
    expect(mockSdk.getInfo).toHaveBeenCalledWith({ ensureSynced: false });
  });

  it('fetchBalance keeps a matching identity and updates the balance', async () => {
    mockSdk.getInfo.mockResolvedValue({ identityPubkey: 'id-pk', balanceSats: 99n, tokenBalances: new Map() });
    const wallet = SparkWallet.create('id-pk');
    wallet.balance = 1;
    await wallet.fetchBalance();
    assert.strictEqual(wallet.identityPubkey, 'id-pk');
    assert.strictEqual(wallet.getBalance(), 99);
  });

  it('fetchBalance is a no-op when the Spark SDK is not connected', async () => {
    mockSdkConnected = false;
    const wallet = SparkWallet.create('id-pk');
    wallet.balance = 3;
    await wallet.fetchBalance();
    expect(mockSdk.getInfo).not.toHaveBeenCalled();
    assert.strictEqual(wallet.getBalance(), 3);
  });

  it('fetchTransactions is a no-op when the Spark SDK is not connected', async () => {
    mockSdkConnected = false;
    const wallet = SparkWallet.create('id-pk');
    await wallet.fetchTransactions();
    expect(mockSdk.listPayments).not.toHaveBeenCalled();
  });

  it('getUserInvoices returns the stored list when the Spark SDK is not connected', async () => {
    mockSdkConnected = false;
    const wallet = SparkWallet.create('id-pk');
    const stored = [{ payment_request: 'lnbc1', ispaid: false, timestamp: 1 }];
    wallet.user_invoices_raw = stored;
    const out = await wallet.getUserInvoices();
    expect(mockSdk.listPayments).not.toHaveBeenCalled();
    assert.strictEqual(out, stored);
  });

  it('fetchBalance is a no-op when the session goes stale after the connected check', async () => {
    mockLeaseValid = false;
    const wallet = SparkWallet.create('id-pk');
    wallet.balance = 3;
    await wallet.fetchBalance();
    expect(mockSdk.getInfo).not.toHaveBeenCalled();
    assert.strictEqual(wallet.getBalance(), 3);
  });

  it('fetchTransactions is a no-op when the session goes stale after the connected check', async () => {
    mockLeaseValid = false;
    mockSessionIdentity = 'id-pk';
    const wallet = SparkWallet.create('id-pk');
    await wallet.fetchTransactions();
    expect(mockSdk.listPayments).not.toHaveBeenCalled();
  });

  it('getUserInvoices returns the stored list when the session goes stale after the connected check', async () => {
    mockLeaseValid = false;
    mockSessionIdentity = 'id-pk';
    const wallet = SparkWallet.create('id-pk');
    const stored = [{ payment_request: 'lnbc1', ispaid: false, timestamp: 1 }];
    wallet.user_invoices_raw = stored;
    const out = await wallet.getUserInvoices();
    expect(mockSdk.listPayments).not.toHaveBeenCalled();
    assert.strictEqual(out, stored);
  });

  it('fetchBalance throws and leaves the wallet unchanged when the session identity differs', async () => {
    mockSdk.getInfo.mockResolvedValue({ identityPubkey: 'other-pk', balanceSats: 99n, tokenBalances: new Map() });
    const wallet = SparkWallet.create('stored-pk');
    wallet.balance = 7;
    await assert.rejects(() => wallet.fetchBalance(), new RegExp(loc.wallets.lightning_spark_session_mismatch));
    assert.strictEqual(wallet.identityPubkey, 'stored-pk');
    assert.strictEqual(wallet.getBalance(), 7);
  });

  it('rejects payInvoice, lists and addInvoice when the session identity differs', async () => {
    mockSessionIdentity = 'session-pk';
    mockSdk.listPayments.mockResolvedValue({ payments: [] });
    mockSdk.receivePayment.mockResolvedValue({ paymentRequest: SAMPLE_INVOICE, fee: 0n });
    mockSdk.prepareSendPayment.mockResolvedValue(bolt11PrepareResponse());
    mockSdk.sendPayment.mockResolvedValue({ payment: { status: PaymentStatus.Completed } });
    const wallet = SparkWallet.create('other-pk');
    const mismatch = new RegExp(loc.wallets.lightning_spark_session_mismatch);
    await assert.rejects(() => wallet.payInvoice(SAMPLE_INVOICE, 0), mismatch);
    await assert.rejects(() => wallet.fetchTransactions(), mismatch);
    await assert.rejects(() => wallet.getUserInvoices(), mismatch);
    await assert.rejects(() => wallet.fetchUserInvoices(), mismatch);
    await assert.rejects(() => wallet.addInvoice(1, 'x'), mismatch);
    await assert.rejects(() => wallet.getDepositAddress(), mismatch);
    expect(mockSdk.prepareSendPayment).not.toHaveBeenCalled();
    expect(mockSdk.sendPayment).not.toHaveBeenCalled();
    expect(mockSdk.listPayments).not.toHaveBeenCalled();
    expect(mockSdk.receivePayment).not.toHaveBeenCalled();
  });

  it('allows payInvoice when the session identity matches the wallet', async () => {
    mockSessionIdentity = 'id-pk';
    mockSdk.prepareSendPayment.mockResolvedValue(bolt11PrepareResponse());
    mockSdk.sendPayment.mockResolvedValue({ payment: { status: PaymentStatus.Completed } });
    const wallet = SparkWallet.create('id-pk');
    await wallet.payInvoice(SAMPLE_INVOICE, 0);
    expect(mockSdk.prepareSendPayment).toHaveBeenCalled();
    expect(mockSdk.sendPayment).toHaveBeenCalled();
  });

  it('addInvoice creates a bolt11 invoice via receivePayment and tracks it', async () => {
    mockSdk.receivePayment.mockResolvedValue({ paymentRequest: SAMPLE_INVOICE, fee: 0n });
    const wallet = new SparkWallet();
    const payReq = await wallet.addInvoice(1000, 'coffee');
    assert.strictEqual(payReq, SAMPLE_INVOICE);
    assert.strictEqual(wallet.isInvoiceGeneratedByWallet(SAMPLE_INVOICE), true);
    assert.strictEqual(wallet.user_invoices_raw.length, 1);
    assert.strictEqual(wallet.user_invoices_raw[0].type, 'user_invoice');
    assert.strictEqual(wallet.user_invoices_raw[0].amt, 1000);
    assert.strictEqual(wallet.user_invoices_raw[0].ispaid, false);
    expect(mockSdk.receivePayment).toHaveBeenCalled();
    const arg = mockSdk.receivePayment.mock.calls[0][0];
    assert.ok(arg.paymentMethod);
  });

  it('decodeInvoice returns the LND-compatible shape', () => {
    const wallet = new SparkWallet();
    const decoded = wallet.decodeInvoice(SAMPLE_INVOICE);
    assert.ok(decoded.payment_hash);
    assert.ok(typeof decoded.num_satoshis === 'string');
    assert.ok(decoded.expiry);
  });

  it('payInvoice prepares and sends through the SDK, resolving on a completed payment', async () => {
    const prepareResponse = bolt11PrepareResponse();
    mockSdk.prepareSendPayment.mockResolvedValue(prepareResponse);
    mockSdk.sendPayment.mockResolvedValue({ payment: { status: PaymentStatus.Completed } });
    const wallet = new SparkWallet();
    const result = await wallet.payInvoice(SAMPLE_INVOICE, 0);
    assert.strictEqual(result.status, SparkPayInvoiceStatus.Completed);
    expect(mockSdk.prepareSendPayment).toHaveBeenCalled();
    const arg = mockSdk.sendPayment.mock.calls[0][0];
    assert.strictEqual(arg.prepareResponse, prepareResponse);
    assert.ok(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(arg.idempotencyKey));
    assert.notStrictEqual(arg.idempotencyKey, wallet.decodeInvoice(SAMPLE_INVOICE).payment_hash);
    assert.strictEqual(arg.options.tag, SendPaymentOptions_Tags.Bolt11Invoice);
    assert.strictEqual(arg.options.inner.preferSpark, false);
    assert.strictEqual(arg.options.inner.completionTimeoutSecs, 30);
  });

  it('payInvoice writes payment_preimage onto last_paid_invoice_result', async () => {
    const preimage = 'bf62911aa53c017c27ba34391f694bc8bf8aaf59b4ebfd9020e66ac0412e189b';
    mockSdk.prepareSendPayment.mockResolvedValue(bolt11PrepareResponse());
    mockSdk.sendPayment.mockResolvedValue({
      payment: {
        status: PaymentStatus.Completed,
        details: {
          tag: PaymentDetails_Tags.Lightning,
          inner: {
            description: '',
            invoice: SAMPLE_INVOICE,
            destinationPubkey: 'x',
            htlcDetails: { paymentHash: 'h', preimage },
          },
        },
      },
    });
    const wallet = new SparkWallet();
    await wallet.payInvoice(SAMPLE_INVOICE, 0);
    assert.ok(wallet.last_paid_invoice_result);
    assert.strictEqual(wallet.last_paid_invoice_result.payment_preimage, preimage);
  });

  it('payInvoice passes freeAmount for amountless invoices', async () => {
    mockSdk.prepareSendPayment.mockResolvedValue(bolt11PrepareResponse());
    mockSdk.sendPayment.mockResolvedValue({ payment: { status: PaymentStatus.Completed } });
    const wallet = new SparkWallet();
    await wallet.payInvoice(SAMPLE_INVOICE, 250);
    const arg = mockSdk.prepareSendPayment.mock.calls[0][0];
    assert.strictEqual(arg.amount, 250n);
  });

  it('payInvoice returns pending when the payment is still pending, and does not throw', async () => {
    mockSdk.prepareSendPayment.mockResolvedValue(bolt11PrepareResponse());
    mockSdk.sendPayment.mockResolvedValue({ payment: { id: 'pay-pending', status: PaymentStatus.Pending } });
    const wallet = new SparkWallet();
    const result = await wallet.payInvoice(SAMPLE_INVOICE, 0);
    assert.strictEqual(result.status, SparkPayInvoiceStatus.Pending);
    assert.strictEqual(result.paymentId, 'pay-pending');
    assert.notStrictEqual(result.status, SparkPayInvoiceStatus.Completed);
    const outgoing = getOutgoingPayment();
    assert.ok(outgoing);
    assert.strictEqual(outgoing.status, 'pending');
    assert.strictEqual(outgoing.paymentId, 'pay-pending');
  });

  it('payInvoice keeps a success event that arrives before sendPayment returns pending', async () => {
    const wallet = new SparkWallet();
    const paymentHash = wallet.decodeInvoice(SAMPLE_INVOICE).payment_hash;
    mockSdk.prepareSendPayment.mockResolvedValue(bolt11PrepareResponse());
    mockSdk.sendPayment.mockImplementation(async () => {
      applyOutgoingSdkEvent({
        tag: SdkEvent_Tags.PaymentSucceeded,
        inner: {
          payment: {
            id: 'pay-event-first',
            paymentType: PaymentType.Send,
            status: PaymentStatus.Completed,
            amount: 1n,
            fees: 0n,
            timestamp: 1n,
            method: {},
            details: {
              tag: PaymentDetails_Tags.Lightning,
              inner: {
                description: '',
                invoice: SAMPLE_INVOICE,
                destinationPubkey: 'x',
                htlcDetails: { paymentHash, preimage: 'event-first-preimage' },
              },
            },
          },
        },
      });
      return { payment: { id: 'pay-event-first', status: PaymentStatus.Pending } };
    });

    const result = await wallet.payInvoice(SAMPLE_INVOICE, 0);

    assert.deepStrictEqual(result, {
      status: SparkPayInvoiceStatus.Completed,
      paymentHash,
      paymentId: 'pay-event-first',
    });
    assert.strictEqual(wallet.last_paid_invoice_result.payment_preimage, 'event-first-preimage');
    assert.strictEqual(getOutgoingPayment().status, 'completed');
  });

  it('payInvoice keeps a failure event that arrives before sendPayment returns pending', async () => {
    const wallet = new SparkWallet();
    const paymentHash = wallet.decodeInvoice(SAMPLE_INVOICE).payment_hash;
    mockSdk.prepareSendPayment.mockResolvedValue(bolt11PrepareResponse());
    mockSdk.sendPayment.mockImplementation(async () => {
      applyOutgoingSdkEvent({
        tag: SdkEvent_Tags.PaymentFailed,
        inner: {
          payment: {
            id: 'pay-failed-event-first',
            paymentType: PaymentType.Send,
            status: PaymentStatus.Failed,
            amount: 1n,
            fees: 0n,
            timestamp: 1n,
            method: {},
            details: {
              tag: PaymentDetails_Tags.Lightning,
              inner: {
                description: '',
                invoice: SAMPLE_INVOICE,
                destinationPubkey: 'x',
                htlcDetails: { paymentHash },
              },
            },
          },
        },
      });
      return { payment: { id: 'pay-failed-event-first', status: PaymentStatus.Pending } };
    });

    await assert.rejects(() => wallet.payInvoice(SAMPLE_INVOICE, 0), new RegExp(loc.wallets.lightning_spark_payment_failed));
    assert.strictEqual(getOutgoingPayment().status, 'failed');
    assert.strictEqual(getOutgoingPayment().paymentId, 'pay-failed-event-first');
  });

  it('payInvoice keeps a success event when sendPayment later returns failed', async () => {
    const wallet = new SparkWallet();
    const paymentHash = wallet.decodeInvoice(SAMPLE_INVOICE).payment_hash;
    mockSdk.prepareSendPayment.mockResolvedValue(bolt11PrepareResponse());
    mockSdk.sendPayment.mockImplementation(async () => {
      applyOutgoingSdkEvent({
        tag: SdkEvent_Tags.PaymentSucceeded,
        inner: {
          payment: {
            id: 'pay-win',
            paymentType: PaymentType.Send,
            status: PaymentStatus.Completed,
            amount: 1n,
            fees: 0n,
            timestamp: 1n,
            method: {},
            details: {
              tag: PaymentDetails_Tags.Lightning,
              inner: {
                description: '',
                invoice: SAMPLE_INVOICE,
                destinationPubkey: 'x',
                htlcDetails: { paymentHash, preimage: 'pre-win' },
              },
            },
          },
        },
      });
      return { payment: { id: 'pay-win', status: PaymentStatus.Failed } };
    });

    const result = await wallet.payInvoice(SAMPLE_INVOICE, 0);

    assert.deepStrictEqual(result, {
      status: SparkPayInvoiceStatus.Completed,
      paymentHash,
      paymentId: 'pay-win',
    });
    assert.strictEqual(wallet.last_paid_invoice_result.payment_preimage, 'pre-win');
    assert.strictEqual(getOutgoingPayment().status, 'completed');
  });

  it('payInvoice keeps a failure event when sendPayment later returns completed', async () => {
    const wallet = new SparkWallet();
    const paymentHash = wallet.decodeInvoice(SAMPLE_INVOICE).payment_hash;
    mockSdk.prepareSendPayment.mockResolvedValue(bolt11PrepareResponse());
    mockSdk.sendPayment.mockImplementation(async () => {
      applyOutgoingSdkEvent({
        tag: SdkEvent_Tags.PaymentFailed,
        inner: {
          payment: {
            id: 'pay-lose',
            paymentType: PaymentType.Send,
            status: PaymentStatus.Failed,
            amount: 1n,
            fees: 0n,
            timestamp: 1n,
            method: {},
            details: {
              tag: PaymentDetails_Tags.Lightning,
              inner: {
                description: '',
                invoice: SAMPLE_INVOICE,
                destinationPubkey: 'x',
                htlcDetails: { paymentHash },
              },
            },
          },
        },
      });
      return { payment: { id: 'pay-lose', status: PaymentStatus.Completed } };
    });

    await assert.rejects(() => wallet.payInvoice(SAMPLE_INVOICE, 0), new RegExp(loc.wallets.lightning_spark_payment_failed));
    assert.strictEqual(getOutgoingPayment().status, 'failed');
    assert.strictEqual(wallet.last_paid_invoice_result, undefined);
  });

  it('payInvoice treats a teardown during send as pending, not failed', async () => {
    mockSdk.prepareSendPayment.mockResolvedValue(bolt11PrepareResponse());
    mockSdk.sendPayment.mockImplementation(async () => {
      mockLeaseValid = false;
      throw new Error('native session dropped');
    });
    const wallet = new SparkWallet();
    const result = await wallet.payInvoice(SAMPLE_INVOICE, 0);
    assert.strictEqual(result.status, SparkPayInvoiceStatus.Pending);
    assert.notStrictEqual(result.status, SparkPayInvoiceStatus.Completed);
    const outgoing = getOutgoingPayment();
    assert.ok(outgoing);
    assert.strictEqual(outgoing.status, 'pending');
    assert.notStrictEqual(outgoing.status, 'failed');
  });

  it('payInvoice treats an explicit stale-session send error as pending without probing the lease again', async () => {
    const { SparkSessionStaleError } = require('../../api/spark/spark-sdk');
    mockSdk.prepareSendPayment.mockResolvedValue(bolt11PrepareResponse());
    mockSdk.sendPayment.mockRejectedValue(new SparkSessionStaleError());
    const wallet = new SparkWallet();

    const result = await wallet.payInvoice(SAMPLE_INVOICE, 0);

    assert.strictEqual(result.status, SparkPayInvoiceStatus.Pending);
    assert.strictEqual(getOutgoingPayment().status, 'pending');
  });

  it('payInvoice reports a completed tracker when sendPayment fails with a stale session', async () => {
    const { SparkSessionStaleError } = require('../../api/spark/spark-sdk');
    const wallet = new SparkWallet();
    const paymentHash = wallet.decodeInvoice(SAMPLE_INVOICE).payment_hash;
    mockSdk.prepareSendPayment.mockResolvedValue(bolt11PrepareResponse());
    mockSdk.sendPayment.mockImplementation(async () => {
      applyOutgoingSdkEvent({
        tag: SdkEvent_Tags.PaymentSucceeded,
        inner: {
          payment: {
            id: 'pay-stale-win',
            paymentType: PaymentType.Send,
            status: PaymentStatus.Completed,
            amount: 1n,
            fees: 0n,
            timestamp: 1n,
            method: {},
            details: {
              tag: PaymentDetails_Tags.Lightning,
              inner: {
                description: '',
                invoice: SAMPLE_INVOICE,
                destinationPubkey: 'x',
                htlcDetails: { paymentHash, preimage: 'pre-stale-win' },
              },
            },
          },
        },
      });
      throw new SparkSessionStaleError();
    });

    const result = await wallet.payInvoice(SAMPLE_INVOICE, 0);

    assert.deepStrictEqual(result, {
      status: SparkPayInvoiceStatus.Completed,
      paymentHash,
      paymentId: 'pay-stale-win',
    });
    assert.strictEqual(wallet.last_paid_invoice_result.payment_preimage, 'pre-stale-win');
    assert.strictEqual(getOutgoingPayment().status, 'completed');
  });

  it('payInvoice reports a failed tracker when sendPayment fails with a stale session', async () => {
    const { SparkSessionStaleError } = require('../../api/spark/spark-sdk');
    const wallet = new SparkWallet();
    const paymentHash = wallet.decodeInvoice(SAMPLE_INVOICE).payment_hash;
    mockSdk.prepareSendPayment.mockResolvedValue(bolt11PrepareResponse());
    mockSdk.sendPayment.mockImplementation(async () => {
      applyOutgoingSdkEvent({
        tag: SdkEvent_Tags.PaymentFailed,
        inner: {
          payment: {
            id: 'pay-stale-lose',
            paymentType: PaymentType.Send,
            status: PaymentStatus.Failed,
            amount: 1n,
            fees: 0n,
            timestamp: 1n,
            method: {},
            details: {
              tag: PaymentDetails_Tags.Lightning,
              inner: {
                description: '',
                invoice: SAMPLE_INVOICE,
                destinationPubkey: 'x',
                htlcDetails: { paymentHash },
              },
            },
          },
        },
      });
      throw new SparkSessionStaleError();
    });

    await assert.rejects(() => wallet.payInvoice(SAMPLE_INVOICE, 0), new RegExp(loc.wallets.lightning_spark_payment_failed));
    assert.strictEqual(getOutgoingPayment().status, 'failed');
    assert.strictEqual(getOutgoingPayment().paymentId, 'pay-stale-lose');
  });

  it('payInvoice treats a stale-session send error as pending when the tracker is a different payment', async () => {
    const { SparkSessionStaleError } = require('../../api/spark/spark-sdk');
    mockSdk.prepareSendPayment.mockResolvedValue(bolt11PrepareResponse());
    mockSdk.sendPayment.mockImplementation(async () => {
      beginOutgoingPayment({ paymentHash: 'other-payment', paymentId: 'other-id', invoice: 'other-invoice' });
      throw new SparkSessionStaleError();
    });
    const wallet = new SparkWallet();

    const result = await wallet.payInvoice(SAMPLE_INVOICE, 0);

    assert.strictEqual(result.status, SparkPayInvoiceStatus.Pending);
    assert.deepStrictEqual(getOutgoingPayment(), {
      status: 'pending',
      paymentHash: 'other-payment',
      paymentId: 'other-id',
      invoice: 'other-invoice',
    });
  });

  it('payInvoice treats a teardown during send as pending when the tracker is a different payment', async () => {
    mockSdk.prepareSendPayment.mockResolvedValue(bolt11PrepareResponse());
    mockSdk.sendPayment.mockImplementation(async () => {
      beginOutgoingPayment({ paymentHash: 'other-payment', paymentId: 'other-id', invoice: 'other-invoice' });
      mockLeaseValid = false;
      throw new Error('native session dropped');
    });
    const wallet = new SparkWallet();
    const result = await wallet.payInvoice(SAMPLE_INVOICE, 0);
    assert.strictEqual(result.status, SparkPayInvoiceStatus.Pending);
  });

  it('payInvoice treats a send as pending when a lease probe fails for a non-stale reason', async () => {
    const sendError = new Error('network error');
    let leaseChecks = 0;
    mockLeaseSdkOverride = () => {
      leaseChecks += 1;
      if (leaseChecks === 3) {
        throw new TypeError('lease implementation failed');
      }
      return mockSdk;
    };
    mockSdk.prepareSendPayment.mockResolvedValue(bolt11PrepareResponse());
    mockSdk.sendPayment.mockRejectedValue(sendError);
    const wallet = new SparkWallet();

    const result = await wallet.payInvoice(SAMPLE_INVOICE, 0);
    assert.strictEqual(result.status, SparkPayInvoiceStatus.Pending);
    const outgoing = getOutgoingPayment();
    assert.ok(outgoing);
    assert.strictEqual(outgoing.status, 'pending');
  });

  it('payInvoice surfaces a send error when a lease probe fails for a non-stale reason and the tracker is a different payment', async () => {
    const sendError = new Error('first payment failed to send');
    let leaseChecks = 0;
    mockLeaseSdkOverride = () => {
      leaseChecks += 1;
      if (leaseChecks === 3) {
        throw new TypeError('lease implementation failed');
      }
      return mockSdk;
    };
    mockSdk.prepareSendPayment.mockResolvedValue(bolt11PrepareResponse());
    mockSdk.sendPayment.mockImplementation(async () => {
      beginOutgoingPayment({ paymentHash: 'other-payment', paymentId: 'other-id', invoice: 'other-invoice' });
      throw sendError;
    });
    const wallet = new SparkWallet();

    await assert.rejects(
      () => wallet.payInvoice(SAMPLE_INVOICE, 0),
      error => error === sendError,
    );
    assert.deepStrictEqual(getOutgoingPayment(), {
      status: 'pending',
      paymentHash: 'other-payment',
      paymentId: 'other-id',
      invoice: 'other-invoice',
    });
  });

  it('payInvoice returns completed when a PaymentSucceeded event beats a sendPayment network error', async () => {
    const wallet = new SparkWallet();
    const paymentHash = wallet.decodeInvoice(SAMPLE_INVOICE).payment_hash;
    mockSdk.prepareSendPayment.mockResolvedValue(bolt11PrepareResponse());
    mockSdk.sendPayment.mockImplementation(async () => {
      applyOutgoingSdkEvent({
        tag: SdkEvent_Tags.PaymentSucceeded,
        inner: {
          payment: {
            id: 'pay-a',
            paymentType: PaymentType.Send,
            status: PaymentStatus.Completed,
            amount: 1n,
            fees: 0n,
            timestamp: 1n,
            method: {},
            details: {
              tag: PaymentDetails_Tags.Lightning,
              inner: {
                description: '',
                invoice: SAMPLE_INVOICE,
                destinationPubkey: 'x',
                htlcDetails: { paymentHash, preimage: 'pre-from-event' },
              },
            },
          },
        },
      });
      throw new Error('network error');
    });
    const result = await wallet.payInvoice(SAMPLE_INVOICE, 0);
    assert.strictEqual(result.status, SparkPayInvoiceStatus.Completed);
    assert.strictEqual(result.paymentHash, paymentHash);
    assert.strictEqual(result.paymentId, 'pay-a');
    assert.notStrictEqual(result.status, SparkPayInvoiceStatus.Pending);
    assert.strictEqual(wallet.last_paid_invoice_result.payment_preimage, 'pre-from-event');
    const outgoing = getOutgoingPayment();
    assert.strictEqual(outgoing.status, 'completed');
    assert.strictEqual(outgoing.paymentHash, paymentHash);
    assert.strictEqual(outgoing.preimage, 'pre-from-event');
  });

  it('payInvoice surfaces the failed tracker when a PaymentFailed event beats a sendPayment network error', async () => {
    const wallet = new SparkWallet();
    const paymentHash = wallet.decodeInvoice(SAMPLE_INVOICE).payment_hash;
    mockSdk.prepareSendPayment.mockResolvedValue(bolt11PrepareResponse());
    mockSdk.sendPayment.mockImplementation(async () => {
      applyOutgoingSdkEvent({
        tag: SdkEvent_Tags.PaymentFailed,
        inner: {
          payment: {
            id: 'pay-a',
            paymentType: PaymentType.Send,
            status: PaymentStatus.Failed,
            amount: 1n,
            fees: 0n,
            timestamp: 1n,
            method: {},
            details: {
              tag: PaymentDetails_Tags.Lightning,
              inner: {
                description: '',
                invoice: SAMPLE_INVOICE,
                destinationPubkey: 'x',
                htlcDetails: { paymentHash },
              },
            },
          },
        },
      });
      throw new Error('network error');
    });
    await assert.rejects(() => wallet.payInvoice(SAMPLE_INVOICE, 0), new RegExp(loc.wallets.lightning_spark_payment_failed));
    const outgoing = getOutgoingPayment();
    assert.strictEqual(outgoing.status, 'failed');
    assert.strictEqual(outgoing.paymentHash, paymentHash);
    assert.notStrictEqual(outgoing.status, 'pending');
  });

  it('payInvoice treats a sendPayment network error as pending when nothing has settled', async () => {
    mockSdk.prepareSendPayment.mockResolvedValue(bolt11PrepareResponse());
    mockSdk.sendPayment.mockRejectedValue(new Error('network error'));
    const wallet = new SparkWallet();
    const paymentHash = wallet.decodeInvoice(SAMPLE_INVOICE).payment_hash;
    const result = await wallet.payInvoice(SAMPLE_INVOICE, 0);
    assert.strictEqual(result.status, SparkPayInvoiceStatus.Pending);
    assert.strictEqual(result.paymentHash, paymentHash);
    const outgoing = getOutgoingPayment();
    assert.ok(outgoing);
    assert.strictEqual(outgoing.status, 'pending');
    assert.strictEqual(outgoing.paymentHash, paymentHash);
  });

  it('payInvoice lets a PaymentSucceeded after a sendPayment network error settle the kept tracker', async () => {
    const wallet = new SparkWallet();
    const paymentHash = wallet.decodeInvoice(SAMPLE_INVOICE).payment_hash;
    mockSdk.prepareSendPayment.mockResolvedValue(bolt11PrepareResponse());
    mockSdk.sendPayment.mockRejectedValue(new Error('network error'));

    const result = await wallet.payInvoice(SAMPLE_INVOICE, 0);
    assert.strictEqual(result.status, SparkPayInvoiceStatus.Pending);

    applyOutgoingSdkEvent({
      tag: SdkEvent_Tags.PaymentSucceeded,
      inner: {
        payment: {
          id: 'pay-after-network',
          paymentType: PaymentType.Send,
          status: PaymentStatus.Completed,
          amount: 1n,
          fees: 0n,
          timestamp: 1n,
          method: {},
          details: {
            tag: PaymentDetails_Tags.Lightning,
            inner: {
              description: '',
              invoice: SAMPLE_INVOICE,
              destinationPubkey: 'x',
              htlcDetails: { paymentHash, preimage: 'pre-after-reject' },
            },
          },
        },
      },
    });

    const outgoing = getOutgoingPayment();
    assert.strictEqual(outgoing.status, 'completed');
    assert.strictEqual(outgoing.paymentHash, paymentHash);
    assert.strictEqual(outgoing.paymentId, 'pay-after-network');
    assert.strictEqual(outgoing.preimage, 'pre-after-reject');
  });

  it('payInvoice does not clear a different payment that starts before its send error returns', async () => {
    mockSdk.prepareSendPayment.mockResolvedValue(bolt11PrepareResponse());
    mockSdk.sendPayment.mockImplementation(async () => {
      beginOutgoingPayment({ paymentHash: 'other-payment', paymentId: 'other-id', invoice: 'other-invoice' });
      throw new Error('first payment failed to send');
    });
    const wallet = new SparkWallet();

    await assert.rejects(() => wallet.payInvoice(SAMPLE_INVOICE, 0), /first payment failed to send/);

    assert.deepStrictEqual(getOutgoingPayment(), {
      status: 'pending',
      paymentHash: 'other-payment',
      paymentId: 'other-id',
      invoice: 'other-invoice',
    });
  });

  it('payInvoice returns completed without replacing a different payment that starts before sendPayment returns', async () => {
    mockSdk.prepareSendPayment.mockResolvedValue(bolt11PrepareResponse());
    mockSdk.sendPayment.mockImplementation(async () => {
      beginOutgoingPayment({ paymentHash: 'other-payment', paymentId: 'other-id', invoice: 'other-invoice' });
      applyOutgoingSdkEvent({
        tag: SdkEvent_Tags.PaymentSucceeded,
        inner: {
          payment: {
            id: 'other-id',
            paymentType: PaymentType.Send,
            status: PaymentStatus.Completed,
            amount: 1n,
            fees: 0n,
            timestamp: 1n,
            method: {},
            details: {
              tag: PaymentDetails_Tags.Lightning,
              inner: {
                description: '',
                invoice: 'other-invoice',
                destinationPubkey: 'x',
                htlcDetails: { paymentHash: 'other-payment', preimage: 'other-preimage' },
              },
            },
          },
        },
      });
      return {
        payment: {
          id: 'pay-us',
          status: PaymentStatus.Completed,
          details: {
            tag: PaymentDetails_Tags.Lightning,
            inner: {
              description: '',
              invoice: SAMPLE_INVOICE,
              destinationPubkey: 'x',
              htlcDetails: { preimage: 'pre-from-sdk' },
            },
          },
        },
      };
    });
    const wallet = new SparkWallet();
    const paymentHash = wallet.decodeInvoice(SAMPLE_INVOICE).payment_hash;

    const result = await wallet.payInvoice(SAMPLE_INVOICE, 0);

    assert.deepStrictEqual(result, {
      status: SparkPayInvoiceStatus.Completed,
      paymentHash,
      paymentId: 'pay-us',
    });
    assert.strictEqual(wallet.last_paid_invoice_result.payment_preimage, 'pre-from-sdk');
    assert.deepStrictEqual(getOutgoingPayment(), {
      status: 'completed',
      paymentHash: 'other-payment',
      paymentId: 'other-id',
      invoice: 'other-invoice',
      preimage: 'other-preimage',
    });
  });

  it('payInvoice throws when the payment fails', async () => {
    mockSdk.prepareSendPayment.mockResolvedValue(bolt11PrepareResponse());
    mockSdk.sendPayment.mockResolvedValue({ payment: { id: 'pay-fail', status: PaymentStatus.Failed } });
    const wallet = new SparkWallet();
    await assert.rejects(() => wallet.payInvoice(SAMPLE_INVOICE, 0), new RegExp(loc.wallets.lightning_spark_payment_failed));
    const outgoing = getOutgoingPayment();
    assert.ok(outgoing);
    assert.strictEqual(outgoing.status, 'failed');
  });

  it('payInvoice reuses a UUID idempotencyKey derived from the invoice', async () => {
    mockSdk.prepareSendPayment.mockResolvedValue(bolt11PrepareResponse());
    mockSdk.sendPayment.mockResolvedValue({ payment: { status: PaymentStatus.Completed } });
    const wallet = new SparkWallet();
    const otherInvoice =
      'lnbc89n1p0zptvhpp5j3h5e80vdlzn32df8y80nl2t7hssn74lzdr96ve0u4kpaupflx2sdphgfkx7cmtwd68yetpd5s9xct5v4kxc6t5v5s9gunpdeek66tnwd5k7mscqp2sp57m89zv0lrgc9zzaxy5p3d5rr2cap2pm6zm4n0ew9vyp2d5zf2mfqrzjqfxj8p6qjf5l8du7yuytkwdcjhylfd4gxgs48t65awjg04ye80mq7z990yqq9jsqqqqqqqqqqqqq05qqrc9qy9qsq9mynpa9ucxg53hwnvw323r55xdd3l6lcadzs584zvm4wdw5pv3eksdlcek425pxaqrn9u5gpw0dtpyl9jw2pynjtqexxgh50akwszjgq4ht4dh';
    await wallet.payInvoice(SAMPLE_INVOICE, 0);
    await wallet.payInvoice(SAMPLE_INVOICE, 0);
    await wallet.payInvoice(otherInvoice, 0);
    assert.strictEqual(mockSdk.sendPayment.mock.calls.length, 3);
    const firstKey = mockSdk.sendPayment.mock.calls[0][0].idempotencyKey;
    const secondKey = mockSdk.sendPayment.mock.calls[1][0].idempotencyKey;
    const otherKey = mockSdk.sendPayment.mock.calls[2][0].idempotencyKey;
    const uuidForm = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    assert.ok(uuidForm.test(firstKey));
    assert.ok(uuidForm.test(otherKey));
    assert.strictEqual(firstKey, secondKey);
    assert.notStrictEqual(firstKey, otherKey);
    assert.notStrictEqual(firstKey, wallet.decodeInvoice(SAMPLE_INVOICE).payment_hash);
  });

  it('payInvoice does not send when the invoice has no payment_hash', async () => {
    mockSdk.prepareSendPayment.mockResolvedValue(bolt11PrepareResponse());
    mockSdk.sendPayment.mockResolvedValue({ payment: { status: PaymentStatus.Completed } });
    const wallet = new SparkWallet();
    wallet.decodeInvoice = () => ({
      num_satoshis: '0',
      num_millisatoshis: '0',
      timestamp: '0',
      fallback_addr: '',
      route_hints: [],
      expiry: '3600',
    });
    await assert.rejects(() => wallet.payInvoice(SAMPLE_INVOICE, 0), new RegExp(loc.wallets.lightning_spark_invoice_unreadable));
    expect(mockSdk.prepareSendPayment).not.toHaveBeenCalled();
    expect(mockSdk.sendPayment).not.toHaveBeenCalled();
  });

  it('payInvoice sends when the prepared fee is under the 3% cap', async () => {
    // 100 sats * 0.03 floors to 3; a 2-sat fee must still send.
    mockSdk.prepareSendPayment.mockResolvedValue(bolt11PrepareResponse({ amount: 100n, lightningFeeSats: 2n }));
    mockSdk.sendPayment.mockResolvedValue({ payment: { status: PaymentStatus.Completed } });
    const wallet = new SparkWallet();
    await wallet.payInvoice(SAMPLE_INVOICE, 0);
    expect(mockSdk.sendPayment).toHaveBeenCalledTimes(1);
  });

  it('payInvoice does not send when the prepared fee is over the 3% floor cap', async () => {
    // 50 * 0.03 = 1.5 → floor 1, round 2. lightning 1 + spark 1 = 2, so:
    // floor rejects, round would accept, and omitting sparkTransferFeeSats would accept.
    mockSdk.prepareSendPayment.mockResolvedValue(bolt11PrepareResponse({ amount: 50n, lightningFeeSats: 1n, sparkTransferFeeSats: 1n }));
    mockSdk.sendPayment.mockResolvedValue({ payment: { status: PaymentStatus.Completed } });
    const wallet = new SparkWallet();
    const expected = loc.formatString(loc.wallets.lightning_spark_fee_too_high, {
      fee: '2',
      maxFee: '1',
      amount: '50',
    });
    await assert.rejects(() => wallet.payInvoice(SAMPLE_INVOICE, 0), { message: expected });
    expect(mockSdk.sendPayment).not.toHaveBeenCalled();
  });

  it('payInvoice sends a 1-sat fee on a small amount whose 3% floors below 1 sat', async () => {
    // 10 * 0.03 floors to 0; the 1-sat minimum must still accept a 1-sat fee.
    // `>=` instead of `>` would reject this payment.
    mockSdk.prepareSendPayment.mockResolvedValue(bolt11PrepareResponse({ amount: 10n, lightningFeeSats: 1n }));
    mockSdk.sendPayment.mockResolvedValue({ payment: { status: PaymentStatus.Completed } });
    const wallet = new SparkWallet();
    await wallet.payInvoice(SAMPLE_INVOICE, 0);
    expect(mockSdk.sendPayment).toHaveBeenCalledTimes(1);
  });

  it('sparkMaxSendFeeSats floors 3% and never goes below 1 sat', () => {
    assert.strictEqual(sparkMaxSendFeeSats(10), 1);
    assert.strictEqual(sparkMaxSendFeeSats(50), 1);
    assert.strictEqual(sparkMaxSendFeeSats(100), 3);
    assert.notStrictEqual(sparkMaxSendFeeSats(50), Math.round(50 * 0.03));
  });

  it('payInvoice does not send when prepare is not a bolt11 invoice', async () => {
    mockSdk.prepareSendPayment.mockResolvedValue({
      amount: 100n,
      paymentMethod: { tag: SendPaymentMethod_Tags.SparkAddress, inner: { fee: 1n } },
    });
    mockSdk.sendPayment.mockResolvedValue({ payment: { status: PaymentStatus.Completed } });
    const wallet = new SparkWallet();
    await assert.rejects(() => wallet.payInvoice(SAMPLE_INVOICE, 0), new RegExp(loc.wallets.lightning_spark_invoice_unreadable));
    expect(mockSdk.sendPayment).not.toHaveBeenCalled();
  });

  it('fetchTransactions maps completed and pending payments', async () => {
    mockSdk.listPayments.mockResolvedValue({
      payments: [
        {
          id: 'p1',
          paymentType: PaymentType.Send,
          status: PaymentStatus.Completed,
          amount: 100n,
          fees: 1n,
          timestamp: 1700000000n,
          method: {},
          details: {
            tag: PaymentDetails_Tags.Lightning,
            inner: { description: 'out', invoice: SAMPLE_INVOICE, destinationPubkey: 'x', htlcDetails: {} },
          },
        },
        {
          id: 'p2',
          paymentType: PaymentType.Receive,
          status: PaymentStatus.Pending,
          amount: 50n,
          fees: 0n,
          timestamp: 1700000001n,
          method: {},
          details: undefined,
        },
      ],
    });
    const wallet = new SparkWallet();
    await wallet.fetchTransactions();
    assert.strictEqual(wallet.transactions_raw.length, 1);
    assert.strictEqual(wallet.pending_transactions_raw.length, 1);
    assert.strictEqual(wallet.transactions_raw[0].type, 'paid_invoice');
    assert.strictEqual(wallet.transactions_raw[0].value, -101);
    assert.strictEqual(wallet.pending_transactions_raw[0].type, 'user_invoice');
  });

  it('fetchTransactions lists payments with the Bitcoin asset filter', async () => {
    mockSdk.listPayments.mockResolvedValue({ payments: [] });
    const wallet = new SparkWallet();
    await wallet.fetchTransactions();
    expect(mockSdk.listPayments).toHaveBeenCalledWith(
      expect.objectContaining({
        assetFilter: expect.objectContaining({ tag: 'Bitcoin' }),
      }),
    );
  });

  it('getTransactions merges lists and sorts newest first', async () => {
    const wallet = SparkWallet.create('list-pk');
    wallet.transactions_raw = [
      { payment_request: 'a', timestamp: 10, type: 'paid_invoice', amt: 1, fee: 0, ispaid: true, expire_time: 3600 },
    ];
    wallet.user_invoices_raw = [{ payment_request: 'b', timestamp: 20, type: 'user_invoice', amt: 5, ispaid: true, expire_time: 3600 }];
    wallet.pending_transactions_raw = [];
    const txs = wallet.getTransactions();
    assert.strictEqual(txs[0].payment_request, 'b');
    assert.strictEqual(txs[1].payment_request, 'a');
  });

  it('getTransactions lists a receive present in both source lists only once', () => {
    const wallet = SparkWallet.create('dedup-pk');
    const receive = {
      payment_request: SAMPLE_INVOICE,
      payment_hash: 'recv-htlc',
      timestamp: 20,
      type: 'user_invoice',
      amt: 20,
      ispaid: true,
      expire_time: 3600,
    };
    wallet.transactions_raw = [
      {
        payment_request: 'send-req',
        payment_hash: 'send-htlc',
        timestamp: 10,
        type: 'paid_invoice',
        amt: 5,
        fee: 1,
        ispaid: true,
        expire_time: 3600,
      },
      { ...receive },
    ];
    wallet.user_invoices_raw = [{ ...receive }];
    wallet.pending_transactions_raw = [];
    const txs = wallet.getTransactions();
    assert.strictEqual(txs.length, 2);
    const receives = txs.filter(tx => tx.payment_hash === 'recv-htlc');
    assert.strictEqual(receives.length, 1);
    assert.strictEqual(receives[0].payment_request, SAMPLE_INVOICE);
    assert.strictEqual(receives[0].amt, 20);
    assert.strictEqual(receives[0].type, 'user_invoice');
    assert.strictEqual(txs.filter(tx => tx.payment_hash === 'send-htlc').length, 1);
  });

  it('getTransactions deduplicates by payment request when no payment hash is available', () => {
    const wallet = SparkWallet.create('request-dedup-pk');
    const receive = {
      payment_request: SAMPLE_INVOICE,
      timestamp: 20,
      type: 'user_invoice',
      amt: 20,
      ispaid: true,
      expire_time: 3600,
    };
    wallet.transactions_raw = [{ ...receive }];
    wallet.user_invoices_raw = [{ ...receive }];

    const txs = wallet.getTransactions();

    assert.strictEqual(txs.length, 1);
    assert.strictEqual(txs[0].payment_request, SAMPLE_INVOICE);
  });

  it('getTransactions treats missing and empty transaction types as the same dedupe namespace', () => {
    const wallet = SparkWallet.create('untyped-dedup-pk');
    const receiveWithoutType = {
      payment_request: SAMPLE_INVOICE,
      payment_hash: 'untyped-payment-hash',
      timestamp: 20,
      amt: 20,
      ispaid: true,
      expire_time: 3600,
    };
    wallet.transactions_raw = [receiveWithoutType];
    wallet.user_invoices_raw = [{ ...receiveWithoutType, type: '' }];

    const txs = wallet.getTransactions();

    assert.strictEqual(txs.length, 1);
    assert.strictEqual(txs[0], receiveWithoutType);
  });

  it('getTransactions preserves separate rows when neither invoice identity is available', () => {
    const wallet = SparkWallet.create('identity-free-pk');
    const receive = {
      payment_request: '',
      timestamp: 20,
      type: 'user_invoice',
      amt: 20,
      ispaid: true,
      expire_time: 3600,
    };
    wallet.transactions_raw = [{ ...receive }];
    wallet.user_invoices_raw = [{ ...receive }];

    const txs = wallet.getTransactions();

    assert.strictEqual(txs.length, 2);
  });

  it('getTransactions keeps a send and a receive that share a payment_hash', () => {
    const wallet = SparkWallet.create('selfpay-pk');
    const hash = 'same-invoice-hash';
    wallet.transactions_raw = [
      {
        payment_request: SAMPLE_INVOICE,
        payment_hash: hash,
        timestamp: 10,
        type: 'paid_invoice',
        amt: 20,
        fee: 1,
        ispaid: true,
        expire_time: 3600,
      },
    ];
    wallet.user_invoices_raw = [
      {
        payment_request: SAMPLE_INVOICE,
        payment_hash: hash,
        timestamp: 10,
        type: 'user_invoice',
        amt: 20,
        ispaid: true,
        expire_time: 3600,
      },
    ];
    wallet.pending_transactions_raw = [];
    const txs = wallet.getTransactions();
    assert.strictEqual(txs.length, 2);
    assert.strictEqual(txs.filter(tx => tx.type === 'paid_invoice' && tx.payment_hash === hash).length, 1);
    assert.strictEqual(txs.filter(tx => tx.type === 'user_invoice' && tx.payment_hash === hash).length, 1);
  });

  it('fetchUserInvoices keeps unpaid local invoices the network has not seen', async () => {
    mockSdk.listPayments.mockResolvedValue({ payments: [] });
    const wallet = new SparkWallet();
    wallet.user_invoices_raw = [
      {
        payment_request: SAMPLE_INVOICE,
        timestamp: 1,
        type: 'user_invoice',
        amt: 10,
        ispaid: false,
        expire_time: 3600,
      },
    ];
    await wallet.fetchUserInvoices();
    assert.strictEqual(wallet.user_invoices_raw.length, 1);
    assert.strictEqual(wallet.user_invoices_raw[0].payment_request, SAMPLE_INVOICE);
  });

  it('getUserInvoices returns a findable array and merges unpaid local invoices', async () => {
    mockSdk.listPayments.mockResolvedValue({
      payments: [
        {
          id: 'remote-1',
          paymentType: PaymentType.Receive,
          status: PaymentStatus.Completed,
          amount: 20n,
          fees: 0n,
          timestamp: 20n,
          method: {},
          details: {
            tag: PaymentDetails_Tags.Lightning,
            inner: { description: 'paid', invoice: 'remote-invoice', destinationPubkey: 'x', htlcDetails: {} },
          },
        },
        {
          id: 'remote-empty',
          paymentType: PaymentType.Receive,
          status: PaymentStatus.Completed,
          amount: 1n,
          fees: 0n,
          timestamp: 5n,
          method: {},
          details: {
            tag: PaymentDetails_Tags.Lightning,
            inner: { description: '', invoice: '', destinationPubkey: 'x', htlcDetails: {} },
          },
        },
      ],
    });
    const wallet = new SparkWallet();
    wallet.user_invoices_raw = [
      {
        payment_request: SAMPLE_INVOICE,
        timestamp: 1,
        type: 'user_invoice',
        amt: 10,
        ispaid: false,
        expire_time: 3600,
      },
    ];
    const invoices = await wallet.getUserInvoices(1);
    assert.ok(Array.isArray(invoices));
    assert.ok(typeof invoices.find === 'function');
    assert.strictEqual(invoices.find(i => i.payment_request === SAMPLE_INVOICE)?.ispaid, false);
    assert.strictEqual(invoices.find(i => i.payment_request === 'remote-invoice')?.ispaid, true);
    assert.strictEqual(wallet.user_invoices_raw, invoices);
    expect(mockSdk.listPayments).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 1,
        typeFilter: [PaymentType.Receive],
        paymentDetailsFilter: [expect.objectContaining({ tag: 'Lightning' })],
      }),
    );
  });

  it('getUserInvoices uses limit 50 when called with 0', async () => {
    mockSdk.listPayments.mockResolvedValue({ payments: [] });
    const wallet = new SparkWallet();
    const invoices = await wallet.getUserInvoices(0);
    assert.ok(Array.isArray(invoices));
    expect(mockSdk.listPayments).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 50,
        paymentDetailsFilter: [expect.objectContaining({ tag: 'Lightning' })],
      }),
    );
  });

  it('fetchTransactions walks listPayments pages until a short page', async () => {
    mockSdk.listPayments.mockImplementation(async ({ offset, limit }) => {
      assert.strictEqual(limit, 50);
      if (offset === 0) {
        return { payments: Array.from({ length: 50 }, (_, i) => completedSend(`p${i}`, BigInt(i))) };
      }
      if (offset === 50) {
        return { payments: Array.from({ length: 7 }, (_, i) => completedSend(`p${50 + i}`, BigInt(50 + i))) };
      }
      return { payments: [] };
    });
    const wallet = new SparkWallet();
    await wallet.fetchTransactions();
    assert.strictEqual(wallet.transactions_raw.length, 57);
    assert.strictEqual(wallet.transactions_raw[0].payment_hash, 'p0');
    assert.strictEqual(wallet.transactions_raw[56].payment_hash, 'p56');
    expect(mockSdk.listPayments).toHaveBeenCalledTimes(2);
    assert.strictEqual(mockSdk.listPayments.mock.calls[0][0].offset, 0);
    assert.strictEqual(mockSdk.listPayments.mock.calls[1][0].offset, 50);
  });

  it('fetchTransactions stops after 100 full pages', async () => {
    mockSdk.listPayments.mockImplementation(async ({ offset, limit }) => {
      assert.strictEqual(limit, 50);
      return {
        payments: Array.from({ length: 50 }, (_, i) => completedSend(`cap-${offset + i}`, BigInt(offset + i))),
      };
    });
    const wallet = new SparkWallet();
    await wallet.fetchTransactions();
    expect(mockSdk.listPayments).toHaveBeenCalledTimes(100);
    assert.strictEqual(wallet.transactions_raw.length, 5000);
    assert.strictEqual(wallet.transactions_raw[0].payment_hash, 'cap-0');
    assert.strictEqual(wallet.transactions_raw[4999].payment_hash, 'cap-4999');
  });

  it('getUserInvoices without a limit walks every page of Lightning receives', async () => {
    mockSdk.listPayments.mockImplementation(async ({ offset, limit }) => {
      assert.strictEqual(limit, 50);
      if (offset === 0) {
        return { payments: Array.from({ length: 50 }, (_, i) => lightningReceive(`r${i}`)) };
      }
      if (offset === 50) {
        return { payments: [lightningReceive('r50')] };
      }
      return { payments: [] };
    });
    const wallet = new SparkWallet();
    const invoices = await wallet.getUserInvoices();
    assert.strictEqual(invoices.length, 51);
    assert.strictEqual(invoices.find(i => i.payment_hash === 'r50')?.payment_request, 'inv-r50');
    expect(mockSdk.listPayments).toHaveBeenCalledTimes(2);
  });

  it('getUserInvoices with a small limit fetches a single page even when that page is full', async () => {
    mockSdk.listPayments.mockResolvedValue({ payments: [lightningReceive('only', 'inv-only')] });
    const wallet = new SparkWallet();
    const invoices = await wallet.getUserInvoices(1);
    assert.strictEqual(invoices.length, 1);
    assert.strictEqual(invoices[0].payment_hash, 'only');
    assert.strictEqual(invoices[0].payment_request, 'inv-only');
    expect(mockSdk.listPayments).toHaveBeenCalledTimes(1);
    expect(mockSdk.listPayments).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 1,
        offset: 0,
        typeFilter: [PaymentType.Receive],
      }),
    );
  });

  it('getUserInvoices keeps only Lightning invoices when the SDK returns mixed incoming payments', async () => {
    const soughtInvoice = 'sought-ln-invoice';
    mockSdk.listPayments.mockResolvedValue({
      payments: [
        {
          id: 'spark-newer',
          paymentType: PaymentType.Receive,
          status: PaymentStatus.Completed,
          amount: 1n,
          fees: 0n,
          timestamp: 30n,
          method: {},
          details: { tag: PaymentDetails_Tags.Spark, inner: {} },
        },
        {
          id: 'ln-sought',
          paymentType: PaymentType.Receive,
          status: PaymentStatus.Completed,
          amount: 20n,
          fees: 0n,
          timestamp: 20n,
          method: {},
          details: {
            tag: PaymentDetails_Tags.Lightning,
            inner: { description: 'sought', invoice: soughtInvoice, destinationPubkey: 'x', htlcDetails: {} },
          },
        },
        {
          id: 'token',
          paymentType: PaymentType.Receive,
          status: PaymentStatus.Completed,
          amount: 3n,
          fees: 0n,
          timestamp: 10n,
          method: {},
          details: { tag: PaymentDetails_Tags.Token, inner: {} },
        },
        {
          id: 'no-details',
          paymentType: PaymentType.Receive,
          status: PaymentStatus.Completed,
          amount: 4n,
          fees: 0n,
          timestamp: 8n,
          method: {},
          details: undefined,
        },
        {
          id: 'deposit',
          paymentType: PaymentType.Receive,
          status: PaymentStatus.Completed,
          amount: 5n,
          fees: 0n,
          timestamp: 6n,
          method: {},
          details: { tag: PaymentDetails_Tags.Deposit, inner: {} },
        },
      ],
    });
    const wallet = new SparkWallet();
    const invoices = await wallet.getUserInvoices();
    assert.strictEqual(invoices.length, 1);
    assert.strictEqual(invoices[0].payment_request, soughtInvoice);
    assert.strictEqual(wallet.user_invoices_raw.length, 1);
    assert.strictEqual(wallet.user_invoices_raw[0].payment_request, soughtInvoice);
    assert.strictEqual(
      wallet.user_invoices_raw.some(
        invoice =>
          invoice.payment_hash === 'spark-newer' ||
          invoice.payment_hash === 'token' ||
          invoice.payment_hash === 'no-details' ||
          invoice.payment_hash === 'deposit',
      ),
      false,
    );
  });

  it('getUserInvoices does not let a single non-Lightning receive displace a local unpaid invoice', async () => {
    mockSdk.listPayments.mockResolvedValue({
      payments: [
        {
          id: 'onchain-only',
          paymentType: PaymentType.Receive,
          status: PaymentStatus.Completed,
          amount: 1n,
          fees: 0n,
          timestamp: 99n,
          method: {},
          details: { tag: PaymentDetails_Tags.Spark, inner: {} },
        },
      ],
    });
    const wallet = new SparkWallet();
    wallet.user_invoices_raw = [
      {
        payment_request: SAMPLE_INVOICE,
        timestamp: 1,
        type: 'user_invoice',
        amt: 10,
        ispaid: false,
        expire_time: 3600,
      },
    ];
    const invoices = await wallet.getUserInvoices(1);
    assert.strictEqual(invoices.length, 1);
    assert.strictEqual(invoices[0].payment_request, SAMPLE_INVOICE);
    assert.strictEqual(invoices[0].ispaid, false);
    assert.strictEqual(wallet.user_invoices_raw.length, 1);
    assert.strictEqual(wallet.user_invoices_raw[0].payment_request, SAMPLE_INVOICE);
    assert.strictEqual(
      wallet.user_invoices_raw.some(invoice => invoice.payment_hash === 'onchain-only' || invoice.payment_request === ''),
      false,
    );
    expect(mockSdk.listPayments).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 1,
        typeFilter: [PaymentType.Receive],
      }),
    );
  });

  it('getUserInvoices does not grow across fetches when a Lightning payment has an empty invoice', async () => {
    mockSdk.listPayments.mockResolvedValue({
      payments: [
        {
          id: 'empty-invoice',
          paymentType: PaymentType.Receive,
          status: PaymentStatus.Completed,
          amount: 7n,
          fees: 0n,
          timestamp: 11n,
          method: {},
          details: {
            tag: PaymentDetails_Tags.Lightning,
            inner: { description: '', invoice: '', destinationPubkey: 'x', htlcDetails: {} },
          },
        },
      ],
    });
    const wallet = new SparkWallet();
    const first = await wallet.getUserInvoices();
    assert.strictEqual(first.length, 1);
    assert.strictEqual(first[0].payment_request, '');
    assert.strictEqual(first[0].payment_hash, 'empty-invoice');
    const second = await wallet.getUserInvoices();
    assert.strictEqual(second.length, 1);
    const third = await wallet.getUserInvoices();
    assert.strictEqual(third.length, 1);
    assert.strictEqual(wallet.user_invoices_raw.length, 1);
  });

  it('mapPayment sets payment_hash from the Lightning HTLC hash, not the payment id', async () => {
    mockSdk.listPayments.mockResolvedValue({
      payments: [
        {
          id: 'payment-id-not-a-hash',
          paymentType: PaymentType.Send,
          status: PaymentStatus.Completed,
          amount: 100n,
          fees: 1n,
          timestamp: 20n,
          method: {},
          details: {
            tag: PaymentDetails_Tags.Lightning,
            inner: {
              description: 'out',
              invoice: SAMPLE_INVOICE,
              destinationPubkey: 'x',
              htlcDetails: { paymentHash: 'htlc-real-hash' },
            },
          },
        },
      ],
    });
    const wallet = new SparkWallet();
    await wallet.fetchTransactions();
    assert.strictEqual(wallet.transactions_raw.length, 1);
    assert.strictEqual(wallet.transactions_raw[0].payment_hash, 'htlc-real-hash');
    assert.notStrictEqual(wallet.transactions_raw[0].payment_hash, 'payment-id-not-a-hash');

    mockSdk.listPayments.mockResolvedValue({
      payments: [
        {
          id: 'recv-id-not-a-hash',
          paymentType: PaymentType.Receive,
          status: PaymentStatus.Completed,
          amount: 20n,
          fees: 0n,
          timestamp: 21n,
          method: {},
          details: {
            tag: PaymentDetails_Tags.Lightning,
            inner: {
              description: 'in',
              invoice: 'remote-invoice',
              destinationPubkey: 'x',
              htlcDetails: { paymentHash: 'htlc-recv-hash' },
            },
          },
        },
      ],
    });
    const invoices = await wallet.getUserInvoices();
    assert.strictEqual(invoices.length, 1);
    assert.strictEqual(invoices[0].payment_hash, 'htlc-recv-hash');
    assert.notStrictEqual(invoices[0].payment_hash, 'recv-id-not-a-hash');
  });

  it('mapPayment keeps payment.id when Lightning HTLC details are missing', async () => {
    mockSdk.listPayments.mockResolvedValue({
      payments: [
        {
          id: 'empty-invoice',
          paymentType: PaymentType.Receive,
          status: PaymentStatus.Completed,
          amount: 7n,
          fees: 0n,
          timestamp: 11n,
          method: {},
          details: {
            tag: PaymentDetails_Tags.Lightning,
            inner: { description: '', invoice: '', destinationPubkey: 'x' },
          },
        },
        {
          id: 'hashed',
          paymentType: PaymentType.Receive,
          status: PaymentStatus.Completed,
          amount: 3n,
          fees: 0n,
          timestamp: 12n,
          method: {},
          details: {
            tag: PaymentDetails_Tags.Lightning,
            inner: {
              description: 'has-htlc',
              invoice: 'hashed-invoice',
              destinationPubkey: 'x',
              htlcDetails: { paymentHash: 'real-htlc-hash' },
            },
          },
        },
      ],
    });
    const wallet = new SparkWallet();
    const first = await wallet.getUserInvoices();
    assert.strictEqual(first.length, 2);
    const byRequest = Object.fromEntries(first.map(invoice => [invoice.payment_request, invoice]));
    assert.strictEqual(byRequest[''].payment_hash, 'empty-invoice');
    assert.strictEqual(byRequest['hashed-invoice'].payment_hash, 'real-htlc-hash');
    assert.notStrictEqual(byRequest['hashed-invoice'].payment_hash, 'hashed');
    const second = await wallet.getUserInvoices();
    assert.strictEqual(second.length, 2);
    const third = await wallet.getUserInvoices();
    assert.strictEqual(third.length, 2);
  });

  it('getUserInvoices matches a local unpaid invoice to a remote paid payment by hash', async () => {
    mockSdk.receivePayment.mockResolvedValue({ paymentRequest: SAMPLE_INVOICE, fee: 0n });
    const wallet = new SparkWallet();
    await wallet.addInvoice(1000, 'coffee');
    const localHash = wallet.decodeInvoice(SAMPLE_INVOICE).payment_hash;
    assert.ok(localHash);
    assert.strictEqual(wallet.user_invoices_raw.length, 1);
    assert.strictEqual(wallet.user_invoices_raw[0].ispaid, false);
    assert.strictEqual(wallet.user_invoices_raw[0].payment_hash, localHash);

    mockSdk.listPayments.mockResolvedValue({
      payments: [
        {
          id: 'counterparty-payment-id',
          paymentType: PaymentType.Receive,
          status: PaymentStatus.Completed,
          amount: 1000n,
          fees: 0n,
          timestamp: 99n,
          method: {},
          details: {
            tag: PaymentDetails_Tags.Lightning,
            inner: {
              description: 'coffee',
              invoice: '',
              destinationPubkey: 'x',
              htlcDetails: { paymentHash: localHash },
            },
          },
        },
      ],
    });
    const invoices = await wallet.getUserInvoices();
    assert.strictEqual(invoices.length, 1);
    assert.strictEqual(invoices[0].payment_hash, localHash);
    assert.notStrictEqual(invoices[0].payment_hash, 'counterparty-payment-id');
    assert.strictEqual(invoices[0].ispaid, true);
    assert.strictEqual(invoices[0].payment_request, SAMPLE_INVOICE);
  });

  it('getUserInvoices matches a local unpaid invoice by payment request when it has no hash', async () => {
    mockSdk.listPayments.mockResolvedValue({ payments: [lightningReceive('remote-payment-id', 'same-invoice')] });
    const wallet = new SparkWallet();
    wallet.user_invoices_raw = [
      {
        payment_request: 'same-invoice',
        timestamp: 1,
        type: 'user_invoice',
        amt: 1,
        ispaid: false,
        expire_time: 3600,
      },
    ];

    const invoices = await wallet.getUserInvoices();

    assert.strictEqual(invoices.length, 1);
    assert.strictEqual(invoices[0].payment_hash, 'remote-payment-id');
    assert.strictEqual(invoices[0].payment_request, 'same-invoice');
    assert.strictEqual(invoices[0].ispaid, true);
  });

  it('getUserInvoices does not re-append a local invoice that has no identity', async () => {
    mockSdk.listPayments.mockResolvedValue({ payments: [] });
    const wallet = new SparkWallet();
    wallet.user_invoices_raw = [{ payment_request: '', timestamp: 1, type: 'user_invoice', amt: 1, ispaid: false, expire_time: 3600 }];
    const first = await wallet.getUserInvoices();
    assert.strictEqual(first.length, 0);
    const second = await wallet.getUserInvoices();
    assert.strictEqual(second.length, 0);
    const third = await wallet.getUserInvoices();
    assert.strictEqual(third.length, 0);
  });

  it('exposes the invoice methods the Lightning receive screens call', () => {
    const wallet = new SparkWallet();
    assert.strictEqual(typeof wallet.getUserInvoices, 'function');
    assert.strictEqual(typeof wallet.fetchUserInvoices, 'function');
    assert.strictEqual(typeof wallet.addInvoice, 'function');
    assert.strictEqual(typeof wallet.decodeInvoice, 'function');
  });

  it('weOwnTransaction matches payment_hash', () => {
    const wallet = SparkWallet.create('own-pk');
    wallet.transactions_raw = [
      {
        payment_request: 'x',
        payment_hash: 'abc',
        timestamp: 1,
        type: 'paid_invoice',
        amt: 1,
        fee: 0,
        ispaid: true,
        expire_time: 3600,
      },
    ];
    assert.strictEqual(wallet.weOwnTransaction('abc'), true);
    assert.strictEqual(wallet.weOwnTransaction('nope'), false);
  });

  it('weOwnAddress matches the cached deposit address and not a foreign one', () => {
    const address = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
    const wallet = new SparkWallet();
    assert.strictEqual(wallet.weOwnAddress(address), false);
    assert.strictEqual(wallet.weOwnAddress(''), false);
    wallet.depositAddress = address;
    assert.strictEqual(wallet.weOwnAddress(address), true);
    assert.strictEqual(wallet.weOwnAddress(address.toUpperCase()), true);
    assert.strictEqual(wallet.weOwnAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'), false);
  });

  it('weOwnAddress keeps non-bech32 address comparison case-sensitive', () => {
    const address = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
    const wallet = new SparkWallet();
    wallet.depositAddress = address;

    assert.strictEqual(wallet.weOwnAddress(address), true);
    assert.strictEqual(wallet.weOwnAddress(address.toLowerCase()), false);
  });

  it('getDepositAddress returns the Bitcoin deposit address and does not request it again', async () => {
    const address = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
    mockSdk.receivePayment.mockResolvedValue({ paymentRequest: address, fee: 0n });
    const wallet = new SparkWallet();
    const first = await wallet.getDepositAddress();
    const second = await wallet.getDepositAddress();
    assert.strictEqual(first, address);
    assert.strictEqual(second, address);
    assert.strictEqual(wallet.depositAddress, address);
    expect(mockSdk.receivePayment).toHaveBeenCalledTimes(1);
    const method = mockSdk.receivePayment.mock.calls[0][0].paymentMethod;
    assert.strictEqual(method.tag, 'BitcoinAddress');
    assert.strictEqual(method.inner.newAddress, false);
  });

  it('getDepositAddress does not cache an empty SDK response', async () => {
    mockSdk.receivePayment.mockResolvedValue({ paymentRequest: '', fee: 0n });
    const wallet = new SparkWallet();
    const first = await wallet.getDepositAddress();
    assert.strictEqual(first, '');
    assert.strictEqual(wallet.depositAddress, undefined);
    await wallet.getDepositAddress();
    expect(mockSdk.receivePayment).toHaveBeenCalledTimes(2);
  });


  it("getSparkAddress returns the Spark address and does not request it again", async () => {
    const wallet = SparkWallet.create("id-pk");
    mockSessionIdentity = "id-pk";
    mockSdk.receivePayment.mockResolvedValue({ paymentRequest: "spark1abcdefghijklmnopqrstuvwxyz", fee: 0n });
    const first = await wallet.getSparkAddress();
    const second = await wallet.getSparkAddress();
    assert.strictEqual(first, "spark1abcdefghijklmnopqrstuvwxyz");
    assert.strictEqual(second, first);
    expect(mockSdk.receivePayment).toHaveBeenCalledTimes(1);
    const method = mockSdk.receivePayment.mock.calls[0][0].paymentMethod;
    assert.strictEqual(method.tag, "SparkAddress");
  });

  it("getSparkAddress does not cache an empty SDK response", async () => {
    const wallet = SparkWallet.create("id-pk");
    mockSessionIdentity = "id-pk";
    mockSdk.receivePayment.mockResolvedValue({ paymentRequest: "", fee: 0n });
    const first = await wallet.getSparkAddress();
    assert.strictEqual(first, "");
    await wallet.getSparkAddress();
    expect(mockSdk.receivePayment).toHaveBeenCalledTimes(2);
  });

  it("signCompactMessage signs with compact true", async () => {
    const wallet = SparkWallet.create("id-pk");
    mockSessionIdentity = "id-pk";
    mockSdk.signMessage = jest.fn().mockResolvedValue({ pubkey: "pk", signature: "ab".repeat(64) });
    const sig = await wallet.signCompactMessage("By_signing_this_message,_you_confirm_spark1abc");
    assert.strictEqual(sig, "ab".repeat(64));
    expect(mockSdk.signMessage).toHaveBeenCalledWith({
      message: "By_signing_this_message,_you_confirm_spark1abc",
      compact: true,
    });
  });

  it('fromJson round-trips type and identity without inventing a secret', () => {
    const wallet = SparkWallet.create('round-trip-pk', 'a@b.c');
    wallet.balance = 7;
    wallet.depositAddress = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
    const json = JSON.stringify(wallet);
    const restored = SparkWallet.fromJson(json);
    assert.strictEqual(restored.type, SparkWallet.type);
    assert.strictEqual(restored.identityPubkey, 'round-trip-pk');
    assert.strictEqual(restored.lnAddress, 'a@b.c');
    assert.strictEqual(restored.depositAddress, 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
    assert.strictEqual(restored.getSecret(), '');
    assert.strictEqual(restored.getBalance(), 7);
  });

  it('fetchPendingTransactions loads from the SDK when caches are empty', async () => {
    mockSdk.listPayments.mockResolvedValue({ payments: [] });
    const wallet = new SparkWallet();
    await wallet.fetchPendingTransactions();
    expect(mockSdk.listPayments).toHaveBeenCalled();
  });

  it('fetchPendingTransactions is a no-op when transactions are already loaded', async () => {
    const wallet = new SparkWallet();
    wallet.transactions_raw = [
      {
        payment_request: 'x',
        timestamp: 1,
        type: 'paid_invoice',
        amt: 1,
        fee: 0,
        ispaid: true,
        expire_time: 3600,
      },
    ];
    await wallet.fetchPendingTransactions();
    expect(mockSdk.listPayments).not.toHaveBeenCalled();
  });

  it('addInvoice with zero amount omits amountSats', async () => {
    mockSdk.receivePayment.mockResolvedValue({ paymentRequest: SAMPLE_INVOICE, fee: 0n });
    const wallet = new SparkWallet();
    await wallet.addInvoice(0, '');
    const method = mockSdk.receivePayment.mock.calls[0][0].paymentMethod;
    assert.strictEqual(method.inner.amountSats, undefined);
  });

  it.each([
    ['not-a-number', 0],
    [-2, -2],
  ])('addInvoice omits an invalid non-positive amount %p instead of passing it to BigInt', async (amount, recordedAmount) => {
    mockSdk.receivePayment.mockResolvedValue({ paymentRequest: SAMPLE_INVOICE, fee: 0n });
    const wallet = new SparkWallet();

    await wallet.addInvoice(amount, 'invalid amount');

    const method = mockSdk.receivePayment.mock.calls[0][0].paymentMethod;
    assert.strictEqual(method.inner.amountSats, undefined);
    assert.strictEqual(wallet.user_invoices_raw[0].amt, recordedAmount);
  });

  it('addInvoice rounds a fractional sat amount before BigInt', async () => {
    mockSdk.receivePayment.mockResolvedValue({ paymentRequest: SAMPLE_INVOICE, fee: 0n });
    const wallet = new SparkWallet();
    await wallet.addInvoice(1.5, 'coffee');
    assert.strictEqual(mockSdk.receivePayment.mock.calls[0][0].paymentMethod.inner.amountSats, 2n);
    await wallet.addInvoice(1.4, 'tea');
    assert.strictEqual(mockSdk.receivePayment.mock.calls[1][0].paymentMethod.inner.amountSats, 1n);
    await wallet.addInvoice(0.4, '');
    assert.strictEqual(mockSdk.receivePayment.mock.calls[2][0].paymentMethod.inner.amountSats, 0n);
  });

  it('addInvoice parses a string amount and defaults an empty local invoice list', async () => {
    mockSdk.receivePayment.mockResolvedValue({ paymentRequest: SAMPLE_INVOICE, fee: 0n });
    const wallet = new SparkWallet();
    wallet.user_invoices_raw = undefined;
    await wallet.addInvoice('250', 'tea');
    assert.strictEqual(wallet.user_invoices_raw.length, 1);
    assert.strictEqual(wallet.user_invoices_raw[0].amt, 250);
    const method = mockSdk.receivePayment.mock.calls[0][0].paymentMethod;
    assert.strictEqual(method.inner.amountSats, 250n);
  });

  it('addInvoice uses a 3600s expiry when decodeInvoice omits one', async () => {
    mockSdk.receivePayment.mockResolvedValue({ paymentRequest: SAMPLE_INVOICE, fee: 0n });
    const wallet = new SparkWallet();
    wallet.decodeInvoice = () => ({
      payment_hash: 'h',
      num_satoshis: '1',
      num_millisatoshis: '1000',
      timestamp: '1',
      fallback_addr: '',
      route_hints: [],
    });
    await wallet.addInvoice(1, 'x');
    assert.strictEqual(wallet.user_invoices_raw[0].expire_time, 3600);
  });

  it('payInvoice without a free amount still completes', async () => {
    mockSdk.prepareSendPayment.mockResolvedValue(bolt11PrepareResponse());
    mockSdk.sendPayment.mockResolvedValue({ payment: { status: PaymentStatus.Completed } });
    const wallet = new SparkWallet();
    await wallet.payInvoice(SAMPLE_INVOICE);
    const arg = mockSdk.prepareSendPayment.mock.calls[0][0];
    assert.strictEqual(arg.amount, undefined);
  });

  it('payInvoice does not pass a negative free amount to the SDK', async () => {
    mockSdk.prepareSendPayment.mockResolvedValue(bolt11PrepareResponse());
    mockSdk.sendPayment.mockResolvedValue({ payment: { status: PaymentStatus.Completed } });
    const wallet = new SparkWallet();

    await wallet.payInvoice(SAMPLE_INVOICE, -1);

    assert.strictEqual(mockSdk.prepareSendPayment.mock.calls[0][0].amount, undefined);
  });

  it('getTransactions fills missing lists and drops unpaid 1-sat sign-in invoices', () => {
    const wallet = SparkWallet.create('lists-pk');
    wallet.pending_transactions_raw = undefined;
    wallet.user_invoices_raw = undefined;
    wallet.transactions_raw = undefined;
    assert.deepStrictEqual(wallet.getTransactions(), []);

    wallet.user_invoices_raw = [
      { payment_request: 'signin', timestamp: 1, type: 'user_invoice', amt: 1, ispaid: false, expire_time: 3600 },
      { payment_request: 'paid-signin', timestamp: 2, type: 'user_invoice', amt: 1, ispaid: true, expire_time: 3600 },
      { payment_request: 'open', timestamp: 3, type: 'user_invoice', amt: 5, ispaid: false, expire_time: 3600 },
    ];
    const txs = wallet.getTransactions();
    assert.strictEqual(
      txs.some(tx => tx.payment_request === 'signin'),
      false,
    );
    assert.strictEqual(
      txs.some(tx => tx.payment_request === 'paid-signin'),
      true,
    );
    assert.strictEqual(
      txs.some(tx => tx.payment_request === 'open'),
      true,
    );
  });

  it('getTransactions derives values and skips records that already have one', () => {
    const wallet = SparkWallet.create('value-pk');
    wallet.transactions_raw = [
      { payment_request: 'paid', timestamp: 4, type: 'paid_invoice', amt: 10, expire_time: 3600, ispaid: true },
      { payment_request: 'kept', timestamp: 5, type: 'paid_invoice', amt: 3, value: -9, expire_time: 3600, ispaid: true },
      { payment_request: 'other', timestamp: 6, type: 'other', expire_time: 3600, ispaid: false },
    ];
    wallet.user_invoices_raw = [{ payment_request: 'in', timestamp: 7, type: 'user_invoice', amt: 8, expire_time: 3600, ispaid: true }];
    const txs = wallet.getTransactions();
    const byReq = Object.fromEntries(txs.map(tx => [tx.payment_request, tx]));
    assert.strictEqual(byReq.paid.value, -10);
    assert.strictEqual(byReq.kept.value, -9);
    assert.strictEqual(byReq.in.value, 8);
    assert.strictEqual(byReq.other.value, undefined);
  });

  it('weOwnTransaction ignores empty entries and invoices without a hash', () => {
    const wallet = SparkWallet.create('own-empty-pk');
    wallet.getTransactions = () => [
      undefined,
      { payment_request: 'x', timestamp: 1, type: 'user_invoice', amt: 1, ispaid: true, expire_time: 3600 },
    ];
    assert.strictEqual(wallet.weOwnTransaction('abc'), false);
  });

  it('fetchTransactions ignores failed payments', async () => {
    mockSdk.listPayments.mockResolvedValue({
      payments: [
        {
          id: 'fail',
          paymentType: PaymentType.Send,
          status: PaymentStatus.Failed,
          amount: 1n,
          fees: 0n,
          timestamp: 1n,
          method: {},
          details: undefined,
        },
      ],
    });
    const wallet = new SparkWallet();
    await wallet.fetchTransactions();
    assert.strictEqual(wallet.transactions_raw.length, 0);
    assert.strictEqual(wallet.pending_transactions_raw.length, 0);
  });

  it('mapPayment uses fallback memos when Lightning details have no description', async () => {
    mockSdk.listPayments.mockResolvedValue({
      payments: [
        {
          id: 's1',
          paymentType: PaymentType.Send,
          status: PaymentStatus.Completed,
          amount: 2n,
          fees: 1n,
          timestamp: 2n,
          method: {},
          details: {
            tag: PaymentDetails_Tags.Lightning,
            inner: { description: undefined, invoice: 'inv-s', destinationPubkey: 'x', htlcDetails: {} },
          },
        },
        {
          id: 'r1',
          paymentType: PaymentType.Receive,
          status: PaymentStatus.Completed,
          amount: 3n,
          fees: 0n,
          timestamp: 3n,
          method: {},
          details: {
            tag: PaymentDetails_Tags.Lightning,
            inner: { description: '', invoice: 'inv-r', destinationPubkey: 'x', htlcDetails: {} },
          },
        },
      ],
    });
    const wallet = new SparkWallet();
    await wallet.fetchTransactions();
    assert.strictEqual(wallet.transactions_raw[0].memo, 'Lightning payment');
    assert.strictEqual(wallet.transactions_raw[1].memo, 'Lightning invoice');
  });

  it('decodeInvoice maps millisatoshis and the remaining bolt11 tags', () => {
    const bolt11 = require('bolt11');
    const spy = jest.spyOn(bolt11, 'decode').mockReturnValue({
      payeeNodeKey: 'dest',
      tags: [
        { tagName: 'payment_hash', data: 'hh' },
        { tagName: 'purpose_commit_hash', data: 'dh' },
        { tagName: 'min_final_cltv_expiry', data: 40 },
        { tagName: 'expire_time', data: '' },
        { tagName: 'description', data: 'memo' },
        { tagName: 'unknown', data: 'x' },
      ],
      satoshis: null,
      millisatoshis: '1500',
      timestamp: undefined,
    });
    const decoded = new SparkWallet().decodeInvoice('lnbc1fake');
    assert.strictEqual(decoded.destination, 'dest');
    assert.strictEqual(decoded.num_satoshis, '1.5');
    assert.strictEqual(decoded.num_millisatoshis, '1500');
    assert.strictEqual(decoded.description_hash, 'dh');
    assert.strictEqual(decoded.cltv_expiry, '40');
    assert.strictEqual(decoded.expiry, '3600');
    assert.strictEqual(decoded.timestamp, '0');
    assert.strictEqual(decoded.description, 'memo');
    spy.mockRestore();
  });

  it('decodeInvoice converts a real millisatoshi invoice into satoshis', () => {
    const wallet = new SparkWallet();
    const decoded = wallet.decodeInvoice(
      'lnbc89n1p0zptvhpp5j3h5e80vdlzn32df8y80nl2t7hssn74lzdr96ve0u4kpaupflx2sdphgfkx7cmtwd68yetpd5s9xct5v4kxc6t5v5s9gunpdeek66tnwd5k7mscqp2sp57m89zv0lrgc9zzaxy5p3d5rr2cap2pm6zm4n0ew9vyp2d5zf2mfqrzjqfxj8p6qjf5l8du7yuytkwdcjhylfd4gxgs48t65awjg04ye80mq7z990yqq9jsqqqqqqqqqqqqq05qqrc9qy9qsq9mynpa9ucxg53hwnvw323r55xdd3l6lcadzs584zvm4wdw5pv3eksdlcek425pxaqrn9u5gpw0dtpyl9jw2pynjtqexxgh50akwszjgq4ht4dh',
    );
    assert.strictEqual(decoded.num_satoshis, '8.9');
    assert.ok(parseInt(decoded.num_millisatoshis, 10) > 0);
  });

  it('payInvoice does not send when the session is replaced after prepare', async () => {
    mockSessionIdentity = 'id-pk';
    mockSdk.prepareSendPayment.mockImplementation(async () => {
      mockLeaseValid = false;
      return { paymentMethod: {} };
    });
    mockSdk.sendPayment.mockResolvedValue({ payment: { status: PaymentStatus.Completed } });
    const wallet = SparkWallet.create('id-pk');
    await assert.rejects(() => wallet.payInvoice(SAMPLE_INVOICE, 0), new RegExp(loc.wallets.lightning_spark_session_mismatch));
    expect(mockSdk.prepareSendPayment).toHaveBeenCalled();
    expect(mockSdk.sendPayment).not.toHaveBeenCalled();
  });

  it('fetchTransactions does not write when the session is replaced during the list', async () => {
    mockSdk.listPayments.mockImplementation(async () => {
      mockLeaseValid = false;
      return {
        payments: [
          {
            id: 'p1',
            paymentType: PaymentType.Send,
            status: PaymentStatus.Completed,
            amount: 100n,
            fees: 1n,
            timestamp: 1700000000n,
            method: {},
            details: undefined,
          },
        ],
      };
    });
    const wallet = new SparkWallet();
    wallet.transactions_raw = [];
    await assert.rejects(() => wallet.fetchTransactions(), new RegExp(loc.wallets.lightning_spark_session_mismatch));
    assert.strictEqual(wallet.transactions_raw.length, 0);
  });

  it('fetchBalance does not write when the session is replaced during getInfo', async () => {
    mockSdk.getInfo.mockImplementation(async () => {
      mockLeaseValid = false;
      return { identityPubkey: 'id-pk', balanceSats: 42n, tokenBalances: new Map() };
    });
    const wallet = new SparkWallet();
    await assert.rejects(() => wallet.fetchBalance(), new RegExp(loc.wallets.lightning_spark_session_mismatch));
    assert.strictEqual(wallet.identityPubkey, undefined);
    assert.strictEqual(wallet.getBalance(), 0);
  });

  it('getUserInvoices does not write when the session is replaced during the list', async () => {
    mockSdk.listPayments.mockImplementation(async () => {
      mockLeaseValid = false;
      return { payments: [] };
    });
    const wallet = new SparkWallet();
    wallet.user_invoices_raw = [
      {
        payment_request: SAMPLE_INVOICE,
        timestamp: 1,
        type: 'user_invoice',
        amt: 10,
        ispaid: false,
        expire_time: 3600,
      },
    ];
    const before = wallet.user_invoices_raw;
    await assert.rejects(() => wallet.getUserInvoices(), new RegExp(loc.wallets.lightning_spark_session_mismatch));
    assert.strictEqual(wallet.user_invoices_raw, before);
  });

  it('addInvoice does not write when the session is replaced during receive', async () => {
    mockSdk.receivePayment.mockImplementation(async () => {
      mockLeaseValid = false;
      return { paymentRequest: SAMPLE_INVOICE, fee: 0n };
    });
    const wallet = new SparkWallet();
    await assert.rejects(() => wallet.addInvoice(1, 'x'), new RegExp(loc.wallets.lightning_spark_session_mismatch));
    assert.strictEqual(wallet.user_invoices_raw.length, 0);
  });

  it('getDepositAddress does not write when the session is replaced during receive', async () => {
    mockSdk.receivePayment.mockImplementation(async () => {
      mockLeaseValid = false;
      return { paymentRequest: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', fee: 0n };
    });
    const wallet = new SparkWallet();
    await assert.rejects(() => wallet.getDepositAddress(), new RegExp(loc.wallets.lightning_spark_session_mismatch));
    assert.strictEqual(wallet.depositAddress, undefined);
  });

  it('maps a non-stale lease error through requireHeld', async () => {
    let calls = 0;
    mockLeaseSdkOverride = () => {
      calls += 1;
      if (calls > 1) {
        throw new TypeError('lease impl exploded');
      }
      return mockSdk;
    };
    mockSdk.getInfo.mockResolvedValue({ identityPubkey: 'id-pk', balanceSats: 1n, tokenBalances: new Map() });
    const wallet = new SparkWallet();
    await assert.rejects(() => wallet.fetchBalance(), /lease impl exploded/);
    assert.strictEqual(wallet.identityPubkey, undefined);
  });

  it('decodeInvoice uses zero millisatoshis when bolt11 omits them', () => {
    const bolt11 = require('bolt11');
    const spy = jest.spyOn(bolt11, 'decode').mockReturnValue({
      payeeNodeKey: 'dest',
      tags: [{ tagName: 'payment_hash', data: 'hh' }],
      satoshis: 12,
      millisatoshis: null,
      timestamp: 1,
    });
    const decoded = new SparkWallet().decodeInvoice('lnbc1fake');
    assert.strictEqual(decoded.num_satoshis, '12');
    assert.strictEqual(decoded.num_millisatoshis, '0');
    spy.mockRestore();
  });
});
