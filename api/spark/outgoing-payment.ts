import {
  PaymentDetails_Tags,
  PaymentStatus,
  PaymentType,
  SdkEvent_Tags,
  type Payment,
  type SdkEvent,
} from '@breeztech/breez-sdk-spark-react-native';

export type OutgoingPaymentStatus = 'pending' | 'completed' | 'failed';

export type OutgoingPayment = {
  status: OutgoingPaymentStatus;
  paymentHash: string;
  paymentId?: string;
  invoice?: string;
  preimage?: string;
};

export type OutgoingPaymentIdentity = {
  paymentHash: string;
  paymentId?: string;
  invoice?: string;
};

type Listener = (payment: OutgoingPayment | null) => void;

let current: OutgoingPayment | null = null;
/** Terminal events that arrived before the matching send was registered. */
let unclaimed: OutgoingPayment[] = [];
const listeners = new Set<Listener>();

function present(value?: string): value is string {
  return Boolean(value);
}

function isTerminal(status: OutgoingPaymentStatus): boolean {
  return status === 'completed' || status === 'failed';
}

/** The first completed or failed status for a payment is kept. Later disagreements are ignored. */
function firstTerminalWins(currentStatus: OutgoingPaymentStatus, incoming: OutgoingPaymentStatus): OutgoingPaymentStatus {
  return isTerminal(currentStatus) ? currentStatus : incoming;
}

function samePayment(a: OutgoingPaymentIdentity | OutgoingPayment, b: OutgoingPaymentIdentity | OutgoingPayment): boolean {
  if (present(a.paymentId) && present(b.paymentId) && a.paymentId === b.paymentId) return true;
  if (present(a.paymentHash) && present(b.paymentHash) && a.paymentHash === b.paymentHash) return true;
  if (present(a.invoice) && present(b.invoice) && a.invoice === b.invoice) return true;
  return false;
}

function notify(): void {
  for (const listener of listeners) {
    listener(current);
  }
}

function paymentFromEvent(event: SdkEvent): Payment | undefined {
  if (
    event.tag !== SdkEvent_Tags.PaymentSucceeded &&
    event.tag !== SdkEvent_Tags.PaymentFailed &&
    event.tag !== SdkEvent_Tags.PaymentPending
  ) {
    return undefined;
  }
  const inner = (event as { inner?: { payment?: Payment } }).inner;
  return inner?.payment;
}

function identityFromPayment(payment: Payment): OutgoingPaymentIdentity & { preimage?: string } {
  let paymentHash: string | undefined;
  let invoice: string | undefined;
  let preimage: string | undefined;
  if (payment.details && payment.details.tag === PaymentDetails_Tags.Lightning) {
    invoice = payment.details.inner.invoice;
    paymentHash = payment.details.inner.htlcDetails?.paymentHash;
    preimage = payment.details.inner.htlcDetails?.preimage;
  }
  return {
    paymentId: payment.id,
    paymentHash: paymentHash || '',
    invoice,
    preimage,
  };
}

function statusFrom(event: SdkEvent, payment: Payment): OutgoingPaymentStatus {
  if (payment.status === PaymentStatus.Completed) return 'completed';
  if (payment.status === PaymentStatus.Failed) return 'failed';
  if (event.tag === SdkEvent_Tags.PaymentSucceeded) return 'completed';
  if (event.tag === SdkEvent_Tags.PaymentFailed) return 'failed';
  return 'pending';
}

function takeUnclaimed(identity: OutgoingPaymentIdentity): OutgoingPayment | undefined {
  const index = unclaimed.findIndex(item => samePayment(item, identity));
  if (index < 0) return undefined;
  const [found] = unclaimed.splice(index, 1);
  return found;
}

function rememberUnclaimed(payment: OutgoingPayment): void {
  unclaimed.push(payment);
  if (unclaimed.length > 20) {
    unclaimed.shift();
  }
}

function identityOf(value: { paymentHash?: string; paymentId?: string; invoice?: string }): OutgoingPaymentIdentity {
  return {
    paymentHash: value.paymentHash || '',
    paymentId: value.paymentId,
    invoice: value.invoice,
  };
}

export function getOutgoingPayment(): OutgoingPayment | null {
  return current;
}

export function subscribeOutgoingPayment(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Starts a new outgoing payment attempt so a later SDK event can settle it.
 * A terminal event that already arrived for the same identity is claimed immediately.
 */
export function beginOutgoingPayment(identity: OutgoingPaymentIdentity): OutgoingPayment {
  const claimed = takeUnclaimed(identity);
  // The same payment hash can be attempted more than once, so every explicit begin replaces the
  // previous attempt instead of inheriting its terminal status.
  current = claimed
    ? {
        ...claimed,
        paymentId: identity.paymentId || claimed.paymentId,
        paymentHash: identity.paymentHash || claimed.paymentHash,
        invoice: identity.invoice || claimed.invoice,
      }
    : {
        status: 'pending',
        paymentHash: identity.paymentHash,
        paymentId: identity.paymentId,
        invoice: identity.invoice,
      };
  notify();
  return current;
}

/** Adds an SDK payment id to the current attempt without resetting a status delivered during sendPayment. */
export function attachOutgoingPaymentId(identity: OutgoingPaymentIdentity & { paymentId: string }): OutgoingPayment {
  const claimed = takeUnclaimed(identity);
  if (current && samePayment(current, identity)) {
    current = {
      ...current,
      paymentId: identity.paymentId || current.paymentId,
      paymentHash: identity.paymentHash || current.paymentHash,
      invoice: identity.invoice || current.invoice,
      preimage: claimed?.preimage || current.preimage,
      status: claimed ? firstTerminalWins(current.status, claimed.status) : current.status,
    };
    notify();
    return current;
  }

  const attached: OutgoingPayment = claimed
    ? {
        ...claimed,
        paymentId: identity.paymentId || claimed.paymentId,
        paymentHash: identity.paymentHash || claimed.paymentHash,
        invoice: identity.invoice || claimed.invoice,
      }
    : {
        status: 'pending',
        paymentHash: identity.paymentHash,
        paymentId: identity.paymentId,
        invoice: identity.invoice,
      };

  if (current) return attached;

  current = attached;
  notify();
  return attached;
}

export function settleOutgoingPayment(update: {
  status: 'completed' | 'failed';
  paymentHash?: string;
  paymentId?: string;
  preimage?: string;
}): OutgoingPayment | null {
  const identity = identityOf(update);
  if (current && samePayment(current, identity)) {
    current = {
      ...current,
      status: firstTerminalWins(current.status, update.status),
      paymentId: update.paymentId || current.paymentId,
      paymentHash: update.paymentHash || current.paymentHash,
      preimage: update.preimage || current.preimage,
    };
    notify();
    return current;
  }

  if (current) {
    if (present(identity.paymentHash) || present(identity.paymentId)) {
      rememberUnclaimed({
        status: update.status,
        paymentHash: identity.paymentHash,
        paymentId: update.paymentId,
        preimage: update.preimage,
      });
    }
    return current;
  }

  if (!update.paymentHash) return current;
  current = {
    status: update.status,
    paymentHash: update.paymentHash,
    paymentId: update.paymentId,
    preimage: update.preimage,
  };
  notify();
  return current;
}

export function applyOutgoingSdkEvent(event: SdkEvent): OutgoingPayment | null {
  const payment = paymentFromEvent(event);
  if (!payment) return current;
  if (payment.paymentType === PaymentType.Receive) return current;

  const extracted = identityFromPayment(payment);
  const status = statusFrom(event, payment);
  // Only fields that came from the event go into the match. Filling gaps from
  // `current` here would make samePayment succeed for a foreign payment.
  const extractedIdentity = identityOf(extracted);

  if (current && samePayment(current, extractedIdentity)) {
    if (isTerminal(current.status) && status === 'pending') {
      return current;
    }
    current = {
      ...current,
      status: firstTerminalWins(current.status, status),
      paymentHash: extracted.paymentHash || current.paymentHash,
      paymentId: extracted.paymentId || current.paymentId,
      invoice: extracted.invoice || current.invoice,
      preimage: extracted.preimage || current.preimage,
    };
    notify();
    return current;
  }

  if (status === 'completed' || status === 'failed') {
    rememberUnclaimed({
      status,
      paymentHash: extracted.paymentHash || '',
      paymentId: extracted.paymentId,
      invoice: extracted.invoice,
      preimage: extracted.preimage,
    });
  }
  return current;
}

export function __resetOutgoingPaymentForTests(): void {
  current = null;
  unclaimed = [];
  listeners.clear();
}
