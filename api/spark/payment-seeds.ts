import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomBytes } from '../../class/rng';
import { subscribeOutgoingPayment } from './outgoing-payment';

/**
 * Idempotency seeds of Spark payments whose outcome is not known yet. A retry of the same payment reuses its
 * seed, so the SDK recognises the resend instead of paying twice. The store survives leaving the pay screen
 * and an app restart, and drops a seed once its payment settles.
 */
/** The pay screen's seed and the payment it belongs to, so a different payment never picks it up. */
type SeedRef = { current?: string; key?: string };

const SPARK_SEED_STORAGE_KEY = 'sparkUnresolvedPaymentSeeds';
const unresolvedSparkSeeds = new Map<string, string>();
const sparkSeedKeyByPaymentId = new Map<string, string>();
const unsentSparkSeeds = new Set<string>();
/** Seeds being created, so two attempts at the same new payment wait for one seed instead of minting two. */
const sparkSeedsBeingCreated = new Map<string, Promise<string>>();
let sparkSeedsLoaded: Promise<void> | null = null;
let sparkSeedsPersisted = false;
/** Set when a write failed, so the next write is made even if nothing else changed. */
let sparkSeedsWriteFailed = false;
/** Set once this session has checked the stored seeds against the SDK's payment list. */
let sparkSeedsReconciled = false;
let sparkSeedWrites: Promise<void> = Promise.resolve();

function sparkSeedKey(destination: string, amountSats: number, operationId?: string): string {
  return `${destination}\0${amountSats}\0${operationId || ''}`;
}

function sparkSeedStoragePayload(): string {
  return JSON.stringify({
    seeds: Object.fromEntries(unresolvedSparkSeeds),
    payments: Object.fromEntries(sparkSeedKeyByPaymentId),
  });
}

/** The string entries of a stored map; anything else in it is ignored. */
function storedStrings(value: unknown): [string, string][] {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
}

function applySparkSeedStorage(raw: string | null): void {
  if (!raw) return;
  const parsed: unknown = JSON.parse(raw);
  const stored = parsed && typeof parsed === 'object' ? (parsed as { seeds?: unknown; payments?: unknown }) : {};
  for (const [key, seed] of storedStrings(stored.seeds)) {
    if (!unresolvedSparkSeeds.has(key)) unresolvedSparkSeeds.set(key, seed);
  }
  for (const [id, key] of storedStrings(stored.payments)) {
    if (!sparkSeedKeyByPaymentId.has(id)) sparkSeedKeyByPaymentId.set(id, key);
  }
  if (unresolvedSparkSeeds.size > 0) sparkSeedsPersisted = true;
}

/** Concurrent callers share one read, so a later read cannot bring back a seed another caller dropped. */
function loadSparkSeeds(): Promise<void> {
  if (!sparkSeedsLoaded) {
    const loading = AsyncStorage.getItem(SPARK_SEED_STORAGE_KEY).then(applySparkSeedStorage);
    sparkSeedsLoaded = loading;
    // A failed read is tried again by the next caller.
    loading.catch(() => {
      if (sparkSeedsLoaded === loading) sparkSeedsLoaded = null;
    });
  }
  return sparkSeedsLoaded;
}

/** The stored-state flags change only after the write succeeded, so a failed write is retried by the next one. */
async function writeSparkSeeds(): Promise<void> {
  try {
    if (unresolvedSparkSeeds.size === 0) {
      if (sparkSeedsPersisted) {
        await AsyncStorage.removeItem(SPARK_SEED_STORAGE_KEY);
        sparkSeedsPersisted = false;
      }
    } else {
      await AsyncStorage.setItem(SPARK_SEED_STORAGE_KEY, sparkSeedStoragePayload());
      sparkSeedsPersisted = true;
    }
    sparkSeedsWriteFailed = false;
  } catch (error) {
    sparkSeedsWriteFailed = true;
    throw error;
  }
}

/** Writes run one at a time, each with the state current when it runs, so a late write cannot undo a newer one. */
function persistSparkSeeds(): Promise<void> {
  const write = sparkSeedWrites.then(writeSparkSeeds);
  sparkSeedWrites = write.catch(() => undefined);
  return write;
}

function keyForSparkSeed(seed: string): string | undefined {
  for (const [key, kept] of unresolvedSparkSeeds) {
    if (kept === seed) return key;
  }
  return undefined;
}

function dropSparkSeed(seed: string): void {
  unsentSparkSeeds.delete(seed);
  const key = keyForSparkSeed(seed);
  if (!key) return;
  unresolvedSparkSeeds.delete(key);
  for (const [id, storedKey] of sparkSeedKeyByPaymentId) {
    if (storedKey === key) sparkSeedKeyByPaymentId.delete(id);
  }
}

async function mintSparkSeed(key: string): Promise<string> {
  const seed = (await randomBytes(16)).toString('hex');
  unresolvedSparkSeeds.set(key, seed);
  unsentSparkSeeds.add(seed);
  try {
    await persistSparkSeeds();
  } catch (error) {
    // An unsaved seed would not survive a restart; drop it so no attempt pays with it.
    unresolvedSparkSeeds.delete(key);
    unsentSparkSeeds.delete(seed);
    throw error;
  }
  return seed;
}

/** The seed for this payment: the one of an unresolved earlier attempt, or a new one. */
export async function createSparkPaymentSeed(
  seedRef: SeedRef,
  destination: string,
  amountSats: number,
  operationId?: string,
): Promise<string> {
  await loadSparkSeeds();
  const key = sparkSeedKey(destination, amountSats, operationId);
  if (seedRef.current && seedRef.key === key) return seedRef.current;
  // A seed still being saved is shared, so every attempt at this payment waits for the same save.
  let creating = sparkSeedsBeingCreated.get(key);
  if (!creating) {
    const kept = unresolvedSparkSeeds.get(key);
    if (kept) {
      seedRef.current = kept;
      seedRef.key = key;
      return kept;
    }
    // A finished attempt must not reuse its key. An unresolved one must, or a
    // later tap sends the payment a second time.
    creating = mintSparkSeed(key);
    sparkSeedsBeingCreated.set(key, creating);
    creating.finally(() => sparkSeedsBeingCreated.delete(key)).catch(() => {});
  }
  const seed = await creating;
  seedRef.current = seed;
  seedRef.key = key;
  return seed;
}

/** Whether the seed was created but its payment was never handed to the SDK. */
export function isUnsentSparkSeed(seed?: string): boolean {
  return seed !== undefined && unsentSparkSeeds.has(seed);
}

/** Keeps the seed of a sent payment whose outcome is open, linked to its payment id and hash. */
export function keepUnresolvedSparkSeed(seedRef?: SeedRef, paymentId?: string, paymentHash?: string): Promise<void> {
  const seed = seedRef?.current;
  if (seed) unsentSparkSeeds.delete(seed);
  const key = seed && keyForSparkSeed(seed);
  if (key && paymentId) sparkSeedKeyByPaymentId.set(paymentId, key);
  if (key && paymentHash) sparkSeedKeyByPaymentId.set(paymentHash, key);
  return persistSparkSeeds();
}

/** Drops the seed of a payment that settled, so a later identical payment gets a new one. */
export function forgetSparkPaymentSeed(seedRef?: SeedRef): Promise<void> {
  const seed = seedRef?.current;
  if (seedRef) {
    seedRef.current = undefined;
    seedRef.key = undefined;
  }
  if (!seed) return persistSparkSeeds();
  dropSparkSeed(seed);
  return persistSparkSeeds();
}

function dropSeedsOfPayments(ids: string[]): boolean {
  let dropped = false;
  for (const id of ids) {
    const key = sparkSeedKeyByPaymentId.get(id);
    const seed = key && unresolvedSparkSeeds.get(key);
    if (!seed) continue;
    dropSparkSeed(seed);
    dropped = true;
  }
  return dropped;
}

/**
 * Drops the seeds of payments the SDK lists as finished, also those that settled while the app was closed.
 * `synced`: the list was read after an SDK sync, so it also counts as this session's check of the stored seeds.
 */
export async function forgetSettledSparkSeeds(paymentIds: string[], synced = false): Promise<void> {
  await loadSparkSeeds();
  const dropped = dropSeedsOfPayments(paymentIds);
  if (synced) sparkSeedsReconciled = true;
  if (dropped || sparkSeedsWriteFailed) await persistSparkSeeds();
}

/**
 * Whether stored seeds of sent payments still wait for this session's check against the SDK. Until then a
 * seed of a payment that settled while the app was closed would make an identical new payment a no-op.
 */
export async function sparkSeedsAwaitReconcile(): Promise<boolean> {
  await loadSparkSeeds();
  return !sparkSeedsReconciled && sparkSeedKeyByPaymentId.size > 0;
}

// A payment can settle after the pay screen closed; its seed is dropped here for the app's lifetime.
subscribeOutgoingPayment(payment => {
  if (!payment || payment.status === 'pending') return;
  const ids = [payment.paymentId, payment.paymentHash].filter((id): id is string => Boolean(id));
  // A failed write is retried by the next one.
  if (dropSeedsOfPayments(ids)) persistSparkSeeds().catch(() => undefined);
});

export function __resetSparkPaymentSeedsForTests(): void {
  unresolvedSparkSeeds.clear();
  sparkSeedKeyByPaymentId.clear();
  unsentSparkSeeds.clear();
  sparkSeedsBeingCreated.clear();
  sparkSeedsLoaded = null;
  sparkSeedsPersisted = false;
  sparkSeedsWriteFailed = false;
  sparkSeedsReconciled = false;
  sparkSeedWrites = Promise.resolve();
}
