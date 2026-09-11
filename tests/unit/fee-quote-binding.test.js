import assert from 'assert';
import { FeePolicy, SendPaymentMethod_Tags, PaymentStatus, PaymentType } from '@breeztech/breez-sdk-spark-react-native';

const mockSdk = {
  prepareSendPayment: jest.fn(),
  sendPayment: jest.fn(),
  prepareLnurlPay: jest.fn(),
  lnurlPay: jest.fn(),
};
let mockSessionIdentity = null;

jest.mock('../../api/spark/spark-sdk', () => ({
  isSparkSdkConnected: () => true,
  acquireSparkSessionLease: () => ({
    get identity() {
      return mockSessionIdentity;
    },
    requireSdk: () => mockSdk,
  }),
}));

const { SparkWallet } = require('../../class/wallets/spark-wallet');
const { __resetOutgoingPaymentForTests } = require('../../api/spark/outgoing-payment');

const SAMPLE_INVOICE =
  'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp';
const SPARK_INVOICE = 'spark1v3n8sgrjv46hxctzd3jjqumpw3ejq6twwehkjcm9xxwdrh';

function preparedInvoice(lightningFeeSats) {
  return {
    amount: 250000n,
    paymentMethod: {
      tag: SendPaymentMethod_Tags.Bolt11Invoice,
      inner: { invoiceDetails: {}, lightningFeeSats, sparkTransferFeeSats: undefined },
    },
  };
}

function preparedSparkInvoice(fee) {
  return {
    amount: 12_345n,
    paymentMethod: {
      tag: SendPaymentMethod_Tags.SparkInvoice,
      inner: { sparkInvoiceDetails: { invoice: SPARK_INVOICE }, fee, tokenIdentifier: undefined },
    },
  };
}

const SPARK_ADDRESS = 'spark1v3n8sgrjv46hxctzd3jjqumpw3ejq6twwehkjcm9xxwdrh';

function preparedSparkAddress(fee) {
  return {
    amount: 12_345n,
    paymentMethod: {
      tag: SendPaymentMethod_Tags.SparkAddress,
      inner: { address: SPARK_ADDRESS, fee, tokenIdentifier: undefined },
    },
  };
}

function preparedLnurlMax(feeSats, amountSats = 10n) {
  return {
    amountSats,
    feeSats,
    feePolicy: FeePolicy.FeesIncluded,
    invoiceDetails: { paymentHash: 'lnurl-max-hash', invoice: { bolt11: SAMPLE_INVOICE } },
    successAction: undefined,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSdk.prepareSendPayment.mockReset();
  mockSdk.sendPayment.mockReset();
  mockSdk.prepareLnurlPay.mockReset();
  mockSdk.lnurlPay.mockReset();
  mockSessionIdentity = 'id-pk';
  __resetOutgoingPaymentForTests();
});

it('does not send a previously quoted payment at a higher fee without fresh confirmation', async () => {
  mockSdk.prepareSendPayment.mockResolvedValueOnce(preparedInvoice(1n)).mockResolvedValueOnce(preparedInvoice(50n));
  mockSdk.sendPayment.mockResolvedValue({
    payment: { id: 'payment-1', paymentType: PaymentType.Send, status: PaymentStatus.Completed },
  });

  const wallet = SparkWallet.create('id-pk');
  const quote = await wallet.getPaymentFeeQuote(SAMPLE_INVOICE, 250000);
  assert.strictEqual(quote.feeSats, 1);

  await assert.rejects(() => wallet.payInvoice(SAMPLE_INVOICE, 250000, quote));

  assert.strictEqual(mockSdk.sendPayment.mock.calls.length, 0);
});

it.each([
  ['same', 1n],
  ['lower', 0n],
])('sends a %s fee after the user quote', async (_label, paymentFee) => {
  mockSdk.prepareSendPayment.mockResolvedValueOnce(preparedInvoice(1n)).mockResolvedValueOnce(preparedInvoice(paymentFee));
  mockSdk.sendPayment.mockResolvedValue({
    payment: { id: 'payment-1', paymentType: PaymentType.Send, status: PaymentStatus.Completed },
  });

  const wallet = SparkWallet.create('id-pk');
  const quote = await wallet.getPaymentFeeQuote(SAMPLE_INVOICE, 250000);
  await wallet.payInvoice(SAMPLE_INVOICE, 250000, quote);

  assert.strictEqual(mockSdk.sendPayment.mock.calls.length, 1);
});

it('rejects a quote from another wallet before sending', async () => {
  mockSdk.prepareSendPayment.mockResolvedValue(preparedInvoice(1n));
  const wallet = SparkWallet.create('id-pk');
  const quote = await wallet.getPaymentFeeQuote(SAMPLE_INVOICE, 250000);
  const otherWallet = SparkWallet.create('other-pk');
  mockSessionIdentity = 'other-pk';

  await assert.rejects(
    () => otherWallet.payInvoice(SAMPLE_INVOICE, 250000, quote),
    error => error?.name === 'SparkPaymentFeeQuoteError',
  );
  assert.strictEqual(mockSdk.sendPayment.mock.calls.length, 0);
});

it.each([
  ['missing quote', undefined],
  ['wrong invoice', { invoice: 'other-invoice' }],
  ['wrong amount', { amountSats: 14 }],
])('rejects a %s before sending', async (_label, change) => {
  mockSdk.prepareSendPayment.mockResolvedValue(preparedInvoice(1n));
  const wallet = SparkWallet.create('id-pk');
  const quote = await wallet.getPaymentFeeQuote(SAMPLE_INVOICE, 250000);
  const invalidQuote = quote && change ? { ...quote, ...change } : change;

  await assert.rejects(() => wallet.payInvoice(SAMPLE_INVOICE, 250000, invalidQuote));
  assert.strictEqual(mockSdk.sendPayment.mock.calls.length, 0);
});

it('rejects an unsafe fee from the new preparation before sending', async () => {
  mockSdk.prepareSendPayment.mockResolvedValueOnce(preparedInvoice(1n)).mockResolvedValueOnce(preparedInvoice(9007199254740992n));
  const wallet = SparkWallet.create('id-pk');
  const quote = await wallet.getPaymentFeeQuote(SAMPLE_INVOICE, 250000);

  await assert.rejects(() => wallet.payInvoice(SAMPLE_INVOICE, 250000, quote));
  assert.strictEqual(mockSdk.sendPayment.mock.calls.length, 0);
});

it('rejects a returned BOLT11 amount that differs from the requested LNURL amount', async () => {
  mockSdk.prepareSendPayment.mockResolvedValue({
    ...preparedInvoice(1n),
    amount: 999n,
  });
  const wallet = SparkWallet.create('id-pk');

  await assert.rejects(
    () => wallet.getPaymentFeeQuote(SAMPLE_INVOICE, 1000),
    error => error?.name === 'SparkPaymentFeeQuoteError',
  );
  assert.strictEqual(mockSdk.sendPayment.mock.calls.length, 0);
});

it('rejects a higher Spark-Invoice fee after a real quote without sending', async () => {
  mockSdk.prepareSendPayment.mockResolvedValueOnce(preparedSparkInvoice(1n)).mockResolvedValueOnce(preparedSparkInvoice(50n));
  const wallet = SparkWallet.create('id-pk');
  const quote = await wallet.getPaymentFeeQuote(SPARK_INVOICE, 12_345);

  await assert.rejects(
    () => wallet.paySparkInvoice(SPARK_INVOICE, 12_345, 'spark-case', quote),
    error => error?.name === 'SparkPaymentFeeQuoteError',
  );
  assert.strictEqual(mockSdk.sendPayment.mock.calls.length, 0);
});

it('allows a lower Spark-Invoice fee after a real quote', async () => {
  mockSdk.prepareSendPayment.mockResolvedValueOnce(preparedSparkInvoice(2n)).mockResolvedValueOnce(preparedSparkInvoice(1n));
  mockSdk.sendPayment.mockResolvedValue({ payment: { id: 'spark-payment', status: PaymentStatus.Completed } });
  const wallet = SparkWallet.create('id-pk');
  const quote = await wallet.getPaymentFeeQuote(SPARK_INVOICE, 12_345);

  await wallet.paySparkInvoice(SPARK_INVOICE, 12_345, 'spark-case', quote);
  assert.strictEqual(mockSdk.sendPayment.mock.calls.length, 1);
});

it('does not send a previously quoted Spark-address payment at a higher fee without fresh confirmation', async () => {
  mockSdk.prepareSendPayment.mockResolvedValueOnce(preparedSparkAddress(1n)).mockResolvedValueOnce(preparedSparkAddress(50n));
  const wallet = SparkWallet.create('id-pk');
  wallet.balance = 1_000_000;
  const quote = await wallet.getPaymentFeeQuote(SPARK_ADDRESS, 12_345);
  assert.strictEqual(quote.method, SendPaymentMethod_Tags.SparkAddress);
  assert.strictEqual(quote.feeSats, 1);

  await assert.rejects(
    () => wallet.paySparkAddress(SPARK_ADDRESS, 12_345, 'spark-address-case', quote),
    error => error?.name === 'SparkPaymentFeeQuoteError',
  );
  assert.strictEqual(mockSdk.sendPayment.mock.calls.length, 0);
});

it('allows a lower Spark-address fee after a real quote', async () => {
  mockSdk.prepareSendPayment.mockResolvedValueOnce(preparedSparkAddress(2n)).mockResolvedValueOnce(preparedSparkAddress(1n));
  mockSdk.sendPayment.mockResolvedValue({ payment: { id: 'spark-address-payment', status: PaymentStatus.Completed } });
  const wallet = SparkWallet.create('id-pk');
  wallet.balance = 1_000_000;
  const quote = await wallet.getPaymentFeeQuote(SPARK_ADDRESS, 12_345);

  await wallet.paySparkAddress(SPARK_ADDRESS, 12_345, 'spark-address-case', quote);
  assert.strictEqual(mockSdk.sendPayment.mock.calls.length, 1);
});

it('rejects a changed LNURL-MAX comment/request after quoting', async () => {
  const payRequest = {
    callback: 'https://example.com/callback',
    minSendable: 1_000n,
    maxSendable: 1_000_000n,
    metadataStr: '[["text/plain","tea"]]',
    commentAllowed: 32,
    domain: 'example.com',
    url: 'https://example.com/lnurl',
  };
  mockSdk.prepareLnurlPay.mockResolvedValueOnce(preparedLnurlMax(1n)).mockResolvedValueOnce(preparedLnurlMax(1n));
  const wallet = SparkWallet.create('id-pk');
  const quote = await wallet.getLnurlMaxFeeQuote(payRequest, 10, 'one');

  await assert.rejects(
    () => wallet.payLnurlMax(payRequest, 10, 'two', quote),
    error => error?.name === 'SparkPaymentFeeQuoteError',
  );
  assert.strictEqual(mockSdk.lnurlPay.mock.calls.length, 0);
});

it('rejects a higher LNURL-MAX fee after a real quote without paying', async () => {
  const payRequest = {
    callback: 'https://example.com/callback',
    minSendable: 1_000n,
    maxSendable: 1_000_000n,
    metadataStr: '[["text/plain","tea"]]',
    commentAllowed: 32,
    domain: 'example.com',
    url: 'https://example.com/lnurl',
  };
  mockSdk.prepareLnurlPay.mockResolvedValueOnce(preparedLnurlMax(1n, 100n)).mockResolvedValueOnce(preparedLnurlMax(50n, 100n));
  const wallet = SparkWallet.create('id-pk');
  const quote = await wallet.getLnurlMaxFeeQuote(payRequest, 100, 'one');

  await assert.rejects(
    () => wallet.payLnurlMax(payRequest, 100, 'one', quote),
    error => error?.name === 'SparkPaymentFeeQuoteError',
  );
  assert.strictEqual(mockSdk.lnurlPay.mock.calls.length, 0);
});

it('fails closed when a wallet has no identity for either payment quote path', async () => {
  const wallet = new SparkWallet();
  mockSessionIdentity = null;
  mockSdk.prepareSendPayment.mockResolvedValue(preparedInvoice(1n));
  await assert.rejects(
    () => wallet.getPaymentFeeQuote(SAMPLE_INVOICE, 250000),
    error => error?.name === 'SparkPaymentFeeQuoteError',
  );

  const payRequest = {
    callback: 'https://example.com/callback',
    minSendable: 1_000n,
    maxSendable: 1_000_000n,
    metadataStr: '[["text/plain","tea"]]',
    commentAllowed: 32,
    domain: 'example.com',
    url: 'https://example.com/lnurl',
  };
  mockSdk.prepareLnurlPay.mockResolvedValue(preparedLnurlMax(1n));
  await assert.rejects(
    () => wallet.getLnurlMaxFeeQuote(payRequest, 10, 'one'),
    error => error?.name === 'SparkPaymentFeeQuoteError',
  );
});

it('does not let an undefined wallet identity satisfy the send binding', async () => {
  const wallet = new SparkWallet();
  mockSessionIdentity = null;
  mockSdk.prepareSendPayment.mockResolvedValue(preparedInvoice(1n));
  const quote = {
    invoice: SAMPLE_INVOICE,
    amountSats: 250000,
    walletIdentity: undefined,
    method: SendPaymentMethod_Tags.Bolt11Invoice,
    feeSats: 1,
  };

  await assert.rejects(
    () => wallet.payInvoice(SAMPLE_INVOICE, 250000, quote),
    error => error?.name === 'SparkPaymentFeeQuoteError',
  );
  assert.strictEqual(mockSdk.sendPayment.mock.calls.length, 0);
});
