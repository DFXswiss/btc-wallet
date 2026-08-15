import assert from 'assert';
import { PaymentDetails_Tags, PaymentStatus, PaymentType, SendPaymentOptions_Tags } from '@breeztech/breez-sdk-spark-react-native';

const mockSdk = {
  getInfo: jest.fn(),
  listPayments: jest.fn(),
  receivePayment: jest.fn(),
  prepareSendPayment: jest.fn(),
  sendPayment: jest.fn(),
  getLightningAddress: jest.fn(),
};

jest.mock('../../api/spark/spark-sdk', () => ({
  requireSparkSdk: () => mockSdk,
  getSparkSdk: () => mockSdk,
  isSparkSdkConnected: () => true,
}));

// Known bolt11 test vector (BOLT 11 examples).
const SAMPLE_INVOICE =
  'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp';

const { SparkWallet } = require('../../class/wallets/spark-wallet');
const { BitcoinUnit, Chain } = require('../../models/bitcoinUnits');

beforeEach(() => {
  jest.clearAllMocks();
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
    const prepareResponse = { paymentMethod: {} };
    mockSdk.prepareSendPayment.mockResolvedValue(prepareResponse);
    mockSdk.sendPayment.mockResolvedValue({ payment: { status: PaymentStatus.Completed } });
    const wallet = new SparkWallet();
    await wallet.payInvoice(SAMPLE_INVOICE, 0);
    expect(mockSdk.prepareSendPayment).toHaveBeenCalled();
    const arg = mockSdk.sendPayment.mock.calls[0][0];
    assert.strictEqual(arg.prepareResponse, prepareResponse);
    assert.strictEqual(arg.idempotencyKey, undefined);
    assert.strictEqual(arg.options.tag, SendPaymentOptions_Tags.Bolt11Invoice);
    assert.strictEqual(arg.options.inner.preferSpark, false);
    assert.strictEqual(arg.options.inner.completionTimeoutSecs, 30);
  });

  it('payInvoice passes freeAmount for amountless invoices', async () => {
    mockSdk.prepareSendPayment.mockResolvedValue({ paymentMethod: {} });
    mockSdk.sendPayment.mockResolvedValue({ payment: { status: PaymentStatus.Completed } });
    const wallet = new SparkWallet();
    await wallet.payInvoice(SAMPLE_INVOICE, 250);
    const arg = mockSdk.prepareSendPayment.mock.calls[0][0];
    assert.strictEqual(arg.amount, 250n);
  });

  it('payInvoice does not resolve as success when the payment is still pending', async () => {
    mockSdk.prepareSendPayment.mockResolvedValue({ paymentMethod: {} });
    mockSdk.sendPayment.mockResolvedValue({ payment: { status: PaymentStatus.Pending } });
    const wallet = new SparkWallet();
    await assert.rejects(() => wallet.payInvoice(SAMPLE_INVOICE, 0), /in transit/);
  });

  it('payInvoice throws when the payment fails', async () => {
    mockSdk.prepareSendPayment.mockResolvedValue({ paymentMethod: {} });
    mockSdk.sendPayment.mockResolvedValue({ payment: { status: PaymentStatus.Failed } });
    const wallet = new SparkWallet();
    await assert.rejects(() => wallet.payInvoice(SAMPLE_INVOICE, 0), /failed/);
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

  it('weOwnAddress is always false (no on-chain refill addresses)', () => {
    assert.strictEqual(new SparkWallet().weOwnAddress('bc1qanything'), false);
  });

  it('fromJson round-trips type and identity without inventing a secret', () => {
    const wallet = SparkWallet.create('round-trip-pk', 'a@b.c');
    wallet.balance = 7;
    const json = JSON.stringify(wallet);
    const restored = SparkWallet.fromJson(json);
    assert.strictEqual(restored.type, SparkWallet.type);
    assert.strictEqual(restored.identityPubkey, 'round-trip-pk');
    assert.strictEqual(restored.lnAddress, 'a@b.c');
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
});
