import assert from 'assert';
import { PaymentDetails_Tags, PaymentStatus, PaymentType, SdkEvent_Tags } from '@breeztech/breez-sdk-spark-react-native';
import {
  applyOutgoingSdkEvent,
  beginOutgoingPayment,
  getOutgoingPayment,
  __resetOutgoingPaymentForTests,
} from '../../api/spark/outgoing-payment';

function sendPayment(id, status, { paymentHash, preimage, invoice } = {}) {
  return {
    id,
    paymentType: PaymentType.Send,
    status,
    amount: 1n,
    fees: 0n,
    timestamp: 1n,
    method: {},
    details: {
      tag: PaymentDetails_Tags.Lightning,
      inner: {
        description: '',
        invoice: invoice || `inv-${id}`,
        destinationPubkey: 'x',
        htlcDetails: { paymentHash: paymentHash || id, preimage },
      },
    },
  };
}

beforeEach(() => {
  __resetOutgoingPaymentForTests();
});

describe('outgoing payment tracker', () => {
  it('stays pending until a matching PaymentSucceeded event completes it', () => {
    const started = beginOutgoingPayment({ paymentHash: 'h1', paymentId: 'p1' });
    assert.strictEqual(started.status, 'pending');
    applyOutgoingSdkEvent({
      tag: SdkEvent_Tags.PaymentSucceeded,
      inner: { payment: sendPayment('p1', PaymentStatus.Completed, { paymentHash: 'h1', preimage: 'pre-1' }) },
    });
    const outgoing = getOutgoingPayment();
    assert.strictEqual(outgoing.status, 'completed');
    assert.strictEqual(outgoing.preimage, 'pre-1');
    assert.notStrictEqual(outgoing.status, 'pending');
    assert.notStrictEqual(outgoing.status, 'failed');
  });

  it('does not treat a PaymentSucceeded for a different payment as this payment completing', () => {
    beginOutgoingPayment({ paymentHash: 'h1', paymentId: 'p1' });
    applyOutgoingSdkEvent({
      tag: SdkEvent_Tags.PaymentSucceeded,
      inner: { payment: sendPayment('other', PaymentStatus.Completed, { paymentHash: 'other-hash', preimage: 'nope' }) },
    });
    const outgoing = getOutgoingPayment();
    assert.strictEqual(outgoing.status, 'pending');
    assert.strictEqual(outgoing.paymentId, 'p1');
  });

  it('does not settle an outgoing send from a receive event with the same hash', () => {
    beginOutgoingPayment({ paymentHash: 'h1', paymentId: 'p1' });
    const receive = sendPayment('p1', PaymentStatus.Completed, { paymentHash: 'h1', preimage: 'pre-1' });
    receive.paymentType = PaymentType.Receive;
    applyOutgoingSdkEvent({
      tag: SdkEvent_Tags.PaymentSucceeded,
      inner: { payment: receive },
    });
    assert.strictEqual(getOutgoingPayment().status, 'pending');
  });

  it('claims a terminal event that arrived before the send was registered', () => {
    applyOutgoingSdkEvent({
      tag: SdkEvent_Tags.PaymentSucceeded,
      inner: { payment: sendPayment('p1', PaymentStatus.Completed, { paymentHash: 'h1', preimage: 'pre-late' }) },
    });
    assert.strictEqual(getOutgoingPayment(), null);
    const started = beginOutgoingPayment({ paymentHash: 'h1' });
    assert.strictEqual(started.status, 'completed');
    assert.strictEqual(started.preimage, 'pre-late');
  });

  it('marks a matching PaymentFailed event as failed, not pending', () => {
    beginOutgoingPayment({ paymentHash: 'h1', paymentId: 'p1' });
    applyOutgoingSdkEvent({
      tag: SdkEvent_Tags.PaymentFailed,
      inner: { payment: sendPayment('p1', PaymentStatus.Failed, { paymentHash: 'h1' }) },
    });
    const outgoing = getOutgoingPayment();
    assert.strictEqual(outgoing.status, 'failed');
    assert.notStrictEqual(outgoing.status, 'pending');
  });

  it('ignores a payment event that carries no payment payload', () => {
    beginOutgoingPayment({ paymentHash: 'h1', paymentId: 'p1' });
    applyOutgoingSdkEvent({ tag: SdkEvent_Tags.PaymentSucceeded });
    applyOutgoingSdkEvent({ tag: SdkEvent_Tags.Synced });
    assert.strictEqual(getOutgoingPayment().status, 'pending');
  });

  it('does not regress a completed payment back to pending', () => {
    beginOutgoingPayment({ paymentHash: 'h1', paymentId: 'p1' });
    applyOutgoingSdkEvent({
      tag: SdkEvent_Tags.PaymentSucceeded,
      inner: { payment: sendPayment('p1', PaymentStatus.Completed, { paymentHash: 'h1', preimage: 'pre-1' }) },
    });
    applyOutgoingSdkEvent({
      tag: SdkEvent_Tags.PaymentPending,
      inner: { payment: sendPayment('p1', PaymentStatus.Pending, { paymentHash: 'h1' }) },
    });
    assert.strictEqual(getOutgoingPayment().status, 'completed');
  });
});
