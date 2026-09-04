import assert from 'assert';
import { PaymentDetails_Tags, PaymentStatus, PaymentType, SdkEvent_Tags } from '@breeztech/breez-sdk-spark-react-native';
import {
  applyOutgoingSdkEvent,
  attachOutgoingPaymentId,
  beginOutgoingPayment,
  getOutgoingPayment,
  settleOutgoingPayment,
  subscribeOutgoingPayment,
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

  it('does not copy a foreign settlement onto a running payment', () => {
    beginOutgoingPayment({ paymentHash: 'h-b', paymentId: 'p-b' });
    settleOutgoingPayment({ status: 'completed', paymentHash: 'h-a', paymentId: 'p-a', preimage: 'pre-a' });
    const running = getOutgoingPayment();
    assert.strictEqual(running.paymentHash, 'h-b');
    assert.strictEqual(running.paymentId, 'p-b');
    assert.strictEqual(running.status, 'pending');
    assert.strictEqual(running.preimage, undefined);
    assert.notStrictEqual(running.preimage, 'pre-a');
    assert.notStrictEqual(running.status, 'completed');

    const claimed = beginOutgoingPayment({ paymentHash: 'h-a', paymentId: 'p-a' });
    assert.strictEqual(claimed.status, 'completed');
    assert.strictEqual(claimed.paymentHash, 'h-a');
    assert.strictEqual(claimed.preimage, 'pre-a');
  });

  it('settleOutgoingPayment still completes the matching in-flight payment', () => {
    beginOutgoingPayment({ paymentHash: 'h1', paymentId: 'p1' });
    settleOutgoingPayment({ status: 'completed', paymentHash: 'h1', paymentId: 'p1', preimage: 'pre-1' });
    const outgoing = getOutgoingPayment();
    assert.strictEqual(outgoing.status, 'completed');
    assert.strictEqual(outgoing.paymentHash, 'h1');
    assert.strictEqual(outgoing.paymentId, 'p1');
    assert.strictEqual(outgoing.preimage, 'pre-1');
  });

  it('does not settle the running payment from a terminal event that has no payment hash', () => {
    beginOutgoingPayment({ paymentHash: 'h1', paymentId: 'p1' });
    const foreign = sendPayment('foreign-id', PaymentStatus.Completed, { preimage: 'stolen-preimage', invoice: 'inv-foreign' });
    foreign.details.inner.htlcDetails = { preimage: 'stolen-preimage' };
    applyOutgoingSdkEvent({
      tag: SdkEvent_Tags.PaymentSucceeded,
      inner: { payment: foreign },
    });
    const outgoing = getOutgoingPayment();
    assert.strictEqual(outgoing.status, 'pending');
    assert.strictEqual(outgoing.paymentHash, 'h1');
    assert.strictEqual(outgoing.paymentId, 'p1');
    assert.strictEqual(outgoing.preimage, undefined);
    assert.notStrictEqual(outgoing.preimage, 'stolen-preimage');
    assert.notStrictEqual(outgoing.status, 'completed');
  });

  it('drops the oldest unclaimed terminal event once more than 20 arrive without a tracker', () => {
    const hashes = [];
    for (let i = 0; i < 21; i++) {
      const paymentHash = `overflow-h${i}`;
      hashes.push(paymentHash);
      applyOutgoingSdkEvent({
        tag: SdkEvent_Tags.PaymentSucceeded,
        inner: {
          payment: sendPayment(`overflow-p${i}`, PaymentStatus.Completed, {
            paymentHash,
            preimage: `overflow-pre${i}`,
          }),
        },
      });
    }
    assert.strictEqual(getOutgoingPayment(), null);

    const dropped = beginOutgoingPayment({ paymentHash: hashes[0] });
    assert.strictEqual(dropped.status, 'pending');
    assert.strictEqual(dropped.preimage, undefined);

    for (let i = 1; i < 21; i++) {
      const claimed = beginOutgoingPayment({ paymentHash: hashes[i] });
      assert.strictEqual(claimed.status, 'completed');
      assert.strictEqual(claimed.paymentHash, hashes[i]);
      assert.strictEqual(claimed.preimage, `overflow-pre${i}`);
    }
  });

  it('does not invent a tracker from a settlement that has no payment hash', () => {
    const seen = [];
    const unsubscribe = subscribeOutgoingPayment(payment => seen.push(payment));
    const settled = settleOutgoingPayment({ status: 'failed', paymentId: 'p-orphan' });
    unsubscribe();
    assert.strictEqual(settled, null);
    assert.strictEqual(getOutgoingPayment(), null);
    assert.strictEqual(seen.length, 0);
  });

  it('adopts a hashed settlement that arrives before a tracker exists and notifies subscribers', () => {
    const seen = [];
    const unsubscribe = subscribeOutgoingPayment(payment => seen.push(payment));
    const settled = settleOutgoingPayment({
      status: 'completed',
      paymentHash: 'h-late',
      paymentId: 'p-late',
      preimage: 'pre-late',
    });
    unsubscribe();
    assert.strictEqual(settled.status, 'completed');
    assert.strictEqual(settled.paymentHash, 'h-late');
    assert.strictEqual(settled.paymentId, 'p-late');
    assert.strictEqual(settled.preimage, 'pre-late');
    assert.strictEqual(getOutgoingPayment(), settled);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].status, 'completed');
    assert.strictEqual(seen[0].paymentHash, 'h-late');
    assert.strictEqual(seen[0].paymentId, 'p-late');
    assert.strictEqual(seen[0].preimage, 'pre-late');
  });

  it('settles a send from an event that only shares the invoice', () => {
    beginOutgoingPayment({ paymentHash: 'h1', invoice: 'lnbc1same' });
    const eventPayment = sendPayment('p-event', PaymentStatus.Completed, { invoice: 'lnbc1same', preimage: 'pre-inv' });
    eventPayment.details.inner.htlcDetails = { preimage: 'pre-inv' };
    delete eventPayment.id;
    applyOutgoingSdkEvent({
      tag: SdkEvent_Tags.PaymentSucceeded,
      inner: { payment: eventPayment },
    });
    const outgoing = getOutgoingPayment();
    assert.strictEqual(outgoing.status, 'completed');
    assert.strictEqual(outgoing.paymentHash, 'h1');
    assert.strictEqual(outgoing.invoice, 'lnbc1same');
    assert.strictEqual(outgoing.preimage, 'pre-inv');
  });

  it('treats a PaymentSucceeded event as completed even when the payload is still pending', () => {
    beginOutgoingPayment({ paymentHash: 'h1', paymentId: 'p1' });
    applyOutgoingSdkEvent({
      tag: SdkEvent_Tags.PaymentSucceeded,
      inner: { payment: sendPayment('p1', PaymentStatus.Pending, { paymentHash: 'h1', preimage: 'pre-lag' }) },
    });
    const outgoing = getOutgoingPayment();
    assert.strictEqual(outgoing.status, 'completed');
    assert.strictEqual(outgoing.preimage, 'pre-lag');
  });

  it('treats a PaymentFailed event as failed even when the payload is still pending', () => {
    beginOutgoingPayment({ paymentHash: 'h1', paymentId: 'p1' });
    applyOutgoingSdkEvent({
      tag: SdkEvent_Tags.PaymentFailed,
      inner: { payment: sendPayment('p1', PaymentStatus.Pending, { paymentHash: 'h1' }) },
    });
    assert.strictEqual(getOutgoingPayment().status, 'failed');
  });

  it('attaching a payment id without a hash keeps the hash already on the tracker', () => {
    beginOutgoingPayment({ paymentHash: 'h1', paymentId: 'p1' });
    const again = attachOutgoingPaymentId({ paymentHash: '', paymentId: 'p1' });
    assert.strictEqual(again.paymentHash, 'h1');
    assert.strictEqual(again.paymentId, 'p1');
    assert.strictEqual(again.status, 'pending');
  });

  it('attaching a payment id without an invoice keeps the invoice already on the tracker', () => {
    beginOutgoingPayment({ paymentHash: 'h1', invoice: 'lnbc1keep' });
    const again = attachOutgoingPaymentId({ paymentHash: 'h1', paymentId: 'p1' });
    assert.strictEqual(again.invoice, 'lnbc1keep');
    assert.strictEqual(again.paymentId, 'p1');
    assert.strictEqual(again.paymentHash, 'h1');
  });

  it('claims a completion that arrived without a hash once the send is registered again with that invoice', () => {
    beginOutgoingPayment({ paymentHash: 'h1' });
    const early = sendPayment('p-event', PaymentStatus.Completed, { invoice: 'lnbc1same', preimage: 'pre-early' });
    early.details.inner.htlcDetails = { preimage: 'pre-early' };
    applyOutgoingSdkEvent({
      tag: SdkEvent_Tags.PaymentSucceeded,
      inner: { payment: early },
    });
    assert.strictEqual(getOutgoingPayment().status, 'pending');
    assert.strictEqual(getOutgoingPayment().paymentHash, 'h1');

    const claimed = attachOutgoingPaymentId({ paymentHash: 'h1', paymentId: 'p-event', invoice: 'lnbc1same' });
    assert.strictEqual(claimed.status, 'completed');
    assert.strictEqual(claimed.paymentHash, 'h1');
    assert.strictEqual(claimed.invoice, 'lnbc1same');
    assert.strictEqual(claimed.preimage, 'pre-early');
  });

  it('a send registered only by payment id still takes the hash from a completion that arrived first', () => {
    applyOutgoingSdkEvent({
      tag: SdkEvent_Tags.PaymentSucceeded,
      inner: { payment: sendPayment('p1', PaymentStatus.Completed, { paymentHash: 'h1', preimage: 'pre-first' }) },
    });
    const started = attachOutgoingPaymentId({ paymentHash: '', paymentId: 'p1' });
    assert.strictEqual(started.status, 'completed');
    assert.strictEqual(started.paymentHash, 'h1');
    assert.strictEqual(started.paymentId, 'p1');
    assert.strictEqual(started.preimage, 'pre-first');
  });

  it('a completion that only carries the payment id keeps the hash already on the tracker', () => {
    beginOutgoingPayment({ paymentHash: 'h1', paymentId: 'p1' });
    settleOutgoingPayment({ status: 'completed', paymentId: 'p1', preimage: 'pre-id' });
    const outgoing = getOutgoingPayment();
    assert.strictEqual(outgoing.status, 'completed');
    assert.strictEqual(outgoing.paymentHash, 'h1');
    assert.strictEqual(outgoing.paymentId, 'p1');
    assert.strictEqual(outgoing.preimage, 'pre-id');
  });

  it('a completion confirmation without payment id or preimage keeps both already on the tracker', () => {
    beginOutgoingPayment({ paymentHash: 'h1', paymentId: 'p1' });
    applyOutgoingSdkEvent({
      tag: SdkEvent_Tags.PaymentSucceeded,
      inner: { payment: sendPayment('p1', PaymentStatus.Completed, { paymentHash: 'h1', preimage: 'pre-kept' }) },
    });
    settleOutgoingPayment({ status: 'completed', paymentHash: 'h1' });
    const outgoing = getOutgoingPayment();
    assert.strictEqual(outgoing.status, 'completed');
    assert.strictEqual(outgoing.paymentHash, 'h1');
    assert.strictEqual(outgoing.paymentId, 'p1');
    assert.strictEqual(outgoing.preimage, 'pre-kept');
  });

  it('keeps a foreign completion that only carries a payment id for the later send', () => {
    beginOutgoingPayment({ paymentHash: 'h-b', paymentId: 'p-b' });
    settleOutgoingPayment({ status: 'completed', paymentId: 'p-a', preimage: 'pre-a' });
    const running = getOutgoingPayment();
    assert.strictEqual(running.paymentHash, 'h-b');
    assert.strictEqual(running.status, 'pending');
    assert.strictEqual(running.preimage, undefined);

    const claimed = attachOutgoingPaymentId({ paymentHash: '', paymentId: 'p-a' });
    assert.strictEqual(claimed.status, 'completed');
    assert.strictEqual(claimed.paymentId, 'p-a');
    assert.strictEqual(claimed.preimage, 'pre-a');
  });

  it('keeps the current attempt when a foreign payment id is attached and returns the attached payment', () => {
    beginOutgoingPayment({ paymentHash: 'h-a' });
    beginOutgoingPayment({ paymentHash: 'h-b', paymentId: 'p-b' });

    const attached = attachOutgoingPaymentId({ paymentHash: 'h-a', paymentId: 'p-a' });
    assert.strictEqual(attached.paymentHash, 'h-a');
    assert.strictEqual(attached.paymentId, 'p-a');
    assert.strictEqual(attached.status, 'pending');

    const running = getOutgoingPayment();
    assert.strictEqual(running.paymentHash, 'h-b');
    assert.strictEqual(running.paymentId, 'p-b');
    assert.strictEqual(running.status, 'pending');
  });

  it('does not keep a settlement that has no hash and no payment id', () => {
    beginOutgoingPayment({ paymentHash: 'h-b', paymentId: 'p-b' });
    settleOutgoingPayment({ status: 'completed', preimage: 'pre-orphan' });
    assert.strictEqual(getOutgoingPayment().status, 'pending');
    assert.strictEqual(getOutgoingPayment().preimage, undefined);

    const later = beginOutgoingPayment({ paymentHash: 'h-other' });
    assert.strictEqual(later.status, 'pending');
    assert.strictEqual(later.preimage, undefined);
  });

  it('an event without lightning details keeps the hash and invoice already on the tracker', () => {
    beginOutgoingPayment({ paymentHash: 'h1', paymentId: 'p1', invoice: 'lnbc1keep' });
    applyOutgoingSdkEvent({
      tag: SdkEvent_Tags.PaymentSucceeded,
      inner: {
        payment: {
          id: 'p1',
          paymentType: PaymentType.Send,
          status: PaymentStatus.Completed,
          amount: 1n,
          fees: 0n,
          timestamp: 1n,
          method: {},
          details: { tag: PaymentDetails_Tags.Spark, inner: {} },
        },
      },
    });
    const outgoing = getOutgoingPayment();
    assert.strictEqual(outgoing.status, 'completed');
    assert.strictEqual(outgoing.paymentHash, 'h1');
    assert.strictEqual(outgoing.paymentId, 'p1');
    assert.strictEqual(outgoing.invoice, 'lnbc1keep');
  });

  it('an event without a payment id keeps the id already on the tracker', () => {
    beginOutgoingPayment({ paymentHash: 'h1', paymentId: 'p1' });
    const eventPayment = sendPayment('ignored', PaymentStatus.Completed, { paymentHash: 'h1', preimage: 'pre-no-id' });
    delete eventPayment.id;
    applyOutgoingSdkEvent({
      tag: SdkEvent_Tags.PaymentSucceeded,
      inner: { payment: eventPayment },
    });
    const outgoing = getOutgoingPayment();
    assert.strictEqual(outgoing.status, 'completed');
    assert.strictEqual(outgoing.paymentId, 'p1');
    assert.strictEqual(outgoing.paymentHash, 'h1');
    assert.strictEqual(outgoing.preimage, 'pre-no-id');
  });

  it('claims a failed event that arrived before the send was registered', () => {
    applyOutgoingSdkEvent({
      tag: SdkEvent_Tags.PaymentFailed,
      inner: { payment: sendPayment('p1', PaymentStatus.Failed, { paymentHash: 'h1' }) },
    });
    assert.strictEqual(getOutgoingPayment(), null);
    const started = beginOutgoingPayment({ paymentHash: 'h1' });
    assert.strictEqual(started.status, 'failed');
    assert.strictEqual(started.paymentHash, 'h1');
  });

  it('does not keep a pending event that arrived before the send was registered', () => {
    applyOutgoingSdkEvent({
      tag: SdkEvent_Tags.PaymentPending,
      inner: { payment: sendPayment('p1', PaymentStatus.Pending, { paymentHash: 'h1', invoice: 'lnbc-early' }) },
    });
    const started = beginOutgoingPayment({ paymentHash: 'h1' });
    assert.strictEqual(started.status, 'pending');
    assert.strictEqual(started.invoice, undefined);
  });

  it('does not let a later failed settlement overwrite a completed payment', () => {
    beginOutgoingPayment({ paymentHash: 'h1', paymentId: 'p1' });
    settleOutgoingPayment({ status: 'completed', paymentHash: 'h1', preimage: 'pre-1' });
    const settled = settleOutgoingPayment({ status: 'failed', paymentHash: 'h1', paymentId: 'p-late' });
    assert.strictEqual(settled.status, 'completed');
    assert.strictEqual(settled.preimage, 'pre-1');
    assert.strictEqual(settled.paymentId, 'p-late');
    assert.strictEqual(getOutgoingPayment().status, 'completed');
  });

  it('does not let a later completed settlement overwrite a failed payment', () => {
    beginOutgoingPayment({ paymentHash: 'h1', paymentId: 'p1' });
    settleOutgoingPayment({ status: 'failed', paymentHash: 'h1' });
    const settled = settleOutgoingPayment({
      status: 'completed',
      paymentHash: 'h1',
      paymentId: 'p-late',
      preimage: 'pre-late',
    });
    assert.strictEqual(settled.status, 'failed');
    assert.strictEqual(settled.paymentId, 'p-late');
    assert.strictEqual(settled.preimage, 'pre-late');
    assert.strictEqual(getOutgoingPayment().status, 'failed');
  });

  it('does not let a later PaymentFailed event overwrite a completed payment', () => {
    beginOutgoingPayment({ paymentHash: 'h1', paymentId: 'p1' });
    applyOutgoingSdkEvent({
      tag: SdkEvent_Tags.PaymentSucceeded,
      inner: { payment: sendPayment('p1', PaymentStatus.Completed, { paymentHash: 'h1', preimage: 'pre-1' }) },
    });
    applyOutgoingSdkEvent({
      tag: SdkEvent_Tags.PaymentFailed,
      inner: { payment: sendPayment('p1', PaymentStatus.Failed, { paymentHash: 'h1' }) },
    });
    const outgoing = getOutgoingPayment();
    assert.strictEqual(outgoing.status, 'completed');
    assert.strictEqual(outgoing.preimage, 'pre-1');
  });

  it('does not let a later PaymentSucceeded event overwrite a failed payment', () => {
    beginOutgoingPayment({ paymentHash: 'h1', paymentId: 'p1' });
    applyOutgoingSdkEvent({
      tag: SdkEvent_Tags.PaymentFailed,
      inner: { payment: sendPayment('p1', PaymentStatus.Failed, { paymentHash: 'h1' }) },
    });
    applyOutgoingSdkEvent({
      tag: SdkEvent_Tags.PaymentSucceeded,
      inner: { payment: sendPayment('p1', PaymentStatus.Completed, { paymentHash: 'h1', preimage: 'pre-late' }) },
    });
    const outgoing = getOutgoingPayment();
    assert.strictEqual(outgoing.status, 'failed');
    assert.strictEqual(outgoing.preimage, 'pre-late');
  });

  it('claims an unclaimed failure for a fresh attempt after the previous attempt completed', () => {
    beginOutgoingPayment({ paymentHash: 'h1' });
    settleOutgoingPayment({ status: 'completed', paymentHash: 'h1', preimage: 'pre-1' });
    const lateFail = sendPayment('p-late', PaymentStatus.Failed, { invoice: 'lnbc1same' });
    lateFail.details.inner.htlcDetails = {};
    delete lateFail.id;
    applyOutgoingSdkEvent({
      tag: SdkEvent_Tags.PaymentFailed,
      inner: { payment: lateFail },
    });
    assert.strictEqual(getOutgoingPayment().status, 'completed');

    const again = beginOutgoingPayment({ paymentHash: 'h1', invoice: 'lnbc1same' });
    assert.strictEqual(again.status, 'failed');
    assert.strictEqual(again.preimage, undefined);
    assert.strictEqual(again.invoice, 'lnbc1same');
  });
});
