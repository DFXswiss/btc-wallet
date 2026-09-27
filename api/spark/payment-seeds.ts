import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomBytes } from '../../class/rng';
import { subscribeOutgoingPayment } from './outgoing-payment';

/**
 * Idempotency seeds of Spark payments whose outcome is not known yet. A retry of the same payment reuses its
 * seed, so the SDK recognises the resend instead of paying twice. The store survives leaving the pay screen
 * and an app restart, and drops a seed once its payment settles.
 */
type SeedRef = { current?: string };

const SPARK_SEED_STORAGE_KEY = 'sparkUnresolvedPaymentSeeds';
const unresolvedSparkSeeds = new Map<string, string>();
const sparkSeedKeyByPaymentId = new Map<string, string>();
const unsentSparkSeeds = new Set<string>();
let sparkSeedsLoaded: Promise<void> | null = null;
let sparkSeedsPersisted = false;

function sparkSeedKey(destination: string, amountSats: number, operationId?: string): string {
  return `${destination}\0${amountSats}\0${operationId || ''}`;
}

function sparkSeedStoragePayload(): string {
  return JSON.stringify({
    seeds: Object.fromEntries(unresolvedSparkSeeds),
    payments: Object.fromEntries(sparkSeedKeyByPaymentId),
  });
}

function applySparkSeedStorage(raw: string | null): void {
  if (!raw) return;
  const parsed = JSON.parse(raw);
  for (const [key, seed] of Object.entries<string>(parsed.seeds || {})) {
    if (!unresolvedSparkSeeds.has(key)) unresolvedSparkSeeds.set(key, seed);
  }
  for (const [id, key] of Object.entries<string>(parsed.payments || {})) {
    if (!sparkSeedKeyByPaymentId.has(id)) sparkSeedKeyByPaymentId.set(id, key);
  }
  if (unresolvedSparkSeeds.size > 0) sparkSeedsPersisted = true;
}

async function loadSparkSeeds(): Promise<void> {
  if (sparkSeedsLoaded) return sparkSeedsLoaded;
  try {
    const raw = await AsyncStorage.getItem(SPARK_SEED_STORAGE_KEY);
    applySparkSeedStorage(raw);
    sparkSeedsLoaded = Promise.resolve();
  } catch (error) {
    sparkSeedsLoaded = null;
    throw error;
  }
  return sparkSeedsLoaded;
}

function persistSparkSeeds(): Promise<void> {
  if (unresolvedSparkSeeds.size === 0) {
    if (!sparkSeedsPersisted) return Promise.resolve();
    sparkSeedsPersisted = false;
    return AsyncStorage.removeItem(SPARK_SEED_STORAGE_KEY);
  }
  sparkSeedsPersisted = true;
  return AsyncStorage.setItem(SPARK_SEED_STORAGE_KEY, sparkSeedStoragePayload());
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

/** The seed for this payment: the one of an unresolved earlier attempt, or a new one. */
export async function createSparkPaymentSeed(
  seedRef: SeedRef,
  destination: string,
  amountSats: number,
  operationId?: string,
): Promise<string> {
  await loadSparkSeeds();
  if (seedRef.current) return seedRef.current;
  const key = sparkSeedKey(destination, amountSats, operationId);
  const kept = unresolvedSparkSeeds.get(key);
  if (kept) {
    seedRef.current = kept;
    return kept;
  }
  // A finished attempt must not reuse its key. An unresolved one must, or a
  // later tap sends the payment a second time.
  const seed = (await randomBytes(16)).toString('hex');
  seedRef.current = seed;
  unresolvedSparkSeeds.set(key, seed);
  unsentSparkSeeds.add(seed);
  await persistSparkSeeds();
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
  if (seedRef) seedRef.current = undefined;
  if (!seed) return persistSparkSeeds();
  dropSparkSeed(seed);
  return persistSparkSeeds();
}

// A payment can settle after the pay screen closed; its seed is dropped here for the app's lifetime.
subscribeOutgoingPayment(payment => {
  if (!payment || payment.status === 'pending') return;
  const ids = [payment.paymentId, payment.paymentHash].filter((id): id is string => Boolean(id));
  let dropped = false;
  for (const id of ids) {
    const key = sparkSeedKeyByPaymentId.get(id);
    const seed = key && unresolvedSparkSeeds.get(key);
    if (!seed) continue;
    dropSparkSeed(seed);
    dropped = true;
  }
  if (dropped) persistSparkSeeds();
});

export function __resetSparkPaymentSeedsForTests(): void {
  unresolvedSparkSeeds.clear();
  sparkSeedKeyByPaymentId.clear();
  unsentSparkSeeds.clear();
  sparkSeedsLoaded = null;
  sparkSeedsPersisted = false;
}
