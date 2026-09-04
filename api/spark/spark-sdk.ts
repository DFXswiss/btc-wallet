import createHash from 'create-hash';
import Config from 'react-native-config';
import RNFS from 'react-native-fs';
import {
  connect,
  defaultConfig,
  MaxFee,
  Network,
  Seed,
  type BreezSdkInterface,
  type EventListener,
  type SdkEvent,
} from '@breeztech/breez-sdk-spark-react-native';

export const BREEZ_API_KEY_MISSING =
  'BREEZ_API_KEY is not configured. Spark Lightning cannot start without it. Set the key in the build environment (react-native-config); do not commit it to tracked .env files.';

/** Cap on auto-claim: bounds what the app spends for the user when the mempool is expensive. */
const MAX_DEPOSIT_CLAIM_FEE_SAT_PER_VBYTE = 10n;

let sdk: BreezSdkInterface | null = null;
let listenerId: string | null = null;
let connectedSeedFingerprint: string | null = null;
let connectedIdentityPubkey: string | null = null;
/** Instance whose native disconnect() failed. The next connect tears it down before opening another. */
let poisonedSdk: BreezSdkInterface | null = null;
/** Tail of the connect/disconnect queue. Always settles so a failed transition cannot stall the next. */
let lifecycleTail: Promise<void> = Promise.resolve();
/** Bumped when a transition times out so a late native return cannot commit the session. */
let lifecycleEpoch = 0;
/** Native instance of a connect that has returned but is not yet committed. */
let inFlightInstance: BreezSdkInterface | null = null;
/** Connect attempt currently holding the fail-closed lock, or null. */
let pendingNativeConnect: { readonly nativeConnect: true } | null = null;
/** True while teardownInstance is awaiting a native remove/disconnect. */
let teardownInFlight = false;

/** Bound on each lifecycle transition. A hang poisons the session instead of wedging the queue. */
export const SPARK_LIFECYCLE_TIMEOUT_MS = 60_000;
let lifecycleTimeoutMs = SPARK_LIFECYCLE_TIMEOUT_MS;

export class SparkSessionStaleError extends Error {
  constructor() {
    super('Spark session is no longer the one this call started with');
    this.name = 'SparkSessionStaleError';
  }
}

export class SparkLifecycleHungError extends Error {
  constructor() {
    super('Spark SDK lifecycle transition timed out');
    this.name = 'SparkLifecycleHungError';
  }
}

export type SparkSessionLease = {
  readonly identity: string | null;
  requireSdk(): BreezSdkInterface;
};

function fingerprintSeed(mnemonic: string, passphrase?: string): string {
  const hash = createHash('sha256');
  hash.update(mnemonic);
  hash.update('\0');
  if (passphrase) {
    hash.update(passphrase);
  }
  return hash.digest().toString('hex');
}

function seedPassphrase(passphrase?: string): string | undefined {
  return passphrase || undefined;
}

function errorKind(e: unknown): string {
  return e instanceof Error ? e.name : typeof e;
}

function abandonOnTimeout(): void {
  lifecycleEpoch += 1;
  const instance = sdk ?? inFlightInstance;
  connectedSeedFingerprint = null;
  connectedIdentityPubkey = null;
  sdk = null;
  if (instance) {
    poisonedSdk = instance;
  }
  inFlightInstance = null;
  // The queue has moved on. A later native teardown finally must not keep
  // blocking a rebuild against the poisoned instance.
  teardownInFlight = false;
  console.warn('spark-sdk: lifecycle transition timed out', 'SparkLifecycleHungError');
}

/**
 * A timed-out connect must not commit, and must not clobber a session that
 * a later connect already built. sdk and poisonedSdk stay mutually exclusive.
 */
function discardStaleInstance(instance: BreezSdkInterface): void {
  if (sdk === instance) {
    sdk = null;
    connectedSeedFingerprint = null;
    connectedIdentityPubkey = null;
    listenerId = null;
    poisonedSdk = instance;
    return;
  }
  if (!sdk) {
    poisonedSdk = instance;
    return;
  }
  instance.disconnect().catch((cleanupErr: unknown) => {
    console.warn('connectSparkSdk: disconnect failed', errorKind(cleanupErr));
  });
}

async function runLifecycle<T>(op: () => Promise<T>): Promise<T> {
  const work = op();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((resolve, reject) => {
    timer = setTimeout(() => {
      abandonOnTimeout();
      reject(new SparkLifecycleHungError());
    }, lifecycleTimeoutMs);
  });
  // Race observes this reject. The extra handler keeps it from becoming an
  // unhandled rejection when the race consumer attaches after a timer flush.
  timeout.catch(() => undefined);
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    // The native call is not cancelled. Swallow a late settle so it cannot
    // reject unhandled after the queue has already moved on.
    work.then(
      () => undefined,
      () => undefined,
    );
  }
}

function enqueueLifecycle<T>(op: () => Promise<T>): Promise<T> {
  const run = lifecycleTail.then(() => runLifecycle(op));
  lifecycleTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function requireSparkSdk(): BreezSdkInterface {
  if (!sdk) {
    throw new Error('Spark SDK is not connected');
  }
  return sdk;
}

export function isSparkSdkConnected(): boolean {
  return sdk !== null;
}

/**
 * Holds the committed session across the caller's awaits.
 * requireSdk() throws SparkSessionStaleError once that session is gone or replaced.
 */
export function acquireSparkSessionLease(): SparkSessionLease {
  const held = requireSparkSdk();
  const identity = connectedIdentityPubkey;
  return {
    identity,
    requireSdk() {
      if (sdk !== held) {
        throw new SparkSessionStaleError();
      }
      return held;
    },
  };
}

async function teardownInstance(instance: BreezSdkInterface, id: string | null): Promise<void> {
  const epoch = lifecycleEpoch;
  teardownInFlight = true;
  try {
    if (id) {
      try {
        await instance.removeEventListener(id);
      } catch (e) {
        // Best-effort: the SDK may already have dropped the listener during disconnect.
        // Log class only — this SDK instance was built with seed + API key;
        // Sentry breadcrumbs ride along with later issues.
        console.warn('disconnectSparkSdk: removeEventListener failed', errorKind(e));
      }
    }

    if (epoch !== lifecycleEpoch) {
      discardStaleInstance(instance);
      return;
    }

    try {
      await instance.disconnect();
      if (epoch !== lifecycleEpoch) {
        return;
      }
      poisonedSdk = null;
      listenerId = null;
    } catch (e) {
      // Native session may still hold storageDir. Keep the instance and listener id
      // so the next connect can retry both teardown steps against the same directory.
      console.warn('disconnectSparkSdk: disconnect failed', errorKind(e));
      if (epoch !== lifecycleEpoch) {
        discardStaleInstance(instance);
        return;
      }
      poisonedSdk = instance;
    }
  } finally {
    // A timed-out teardown keeps running natively. abandonOnTimeout already
    // released this flag; a later session may have set it again. Clearing it
    // here on a stale epoch would unblock a connect while that session is
    // still tearing down.
    if (epoch === lifecycleEpoch) {
      teardownInFlight = false;
    }
  }
}

async function disconnectLocked(): Promise<void> {
  connectedSeedFingerprint = null;
  connectedIdentityPubkey = null;

  const instance = sdk ?? poisonedSdk;
  const id = listenerId;
  sdk = null;
  inFlightInstance = instance;

  if (!instance) {
    listenerId = null;
    inFlightInstance = null;
    return;
  }

  try {
    await teardownInstance(instance, id);
  } finally {
    if (inFlightInstance === instance) {
      inFlightInstance = null;
    }
  }
}

export async function disconnectSparkSdk(): Promise<void> {
  await enqueueLifecycle(() => disconnectLocked());
}

async function connectLocked(
  mnemonic: string,
  onEvent?: (event: SdkEvent) => Promise<void>,
  passphrase?: string,
): Promise<BreezSdkInterface> {
  // A hang with no instance yet cannot be torn down; fail closed instead of opening a second native session.
  // A hang that already produced an instance is poisoned so this connect can rebuild.
  if (teardownInFlight || (pendingNativeConnect && !sdk && !poisonedSdk && !inFlightInstance)) {
    throw new Error('Spark SDK previous session is still open');
  }

  const epoch = lifecycleEpoch;
  const nativeConnectAttempt = { nativeConnect: true as const };
  pendingNativeConnect = nativeConnectAttempt;
  try {
    const resolvedPassphrase = seedPassphrase(passphrase);
    const fingerprint = fingerprintSeed(mnemonic, resolvedPassphrase);

    if (sdk && connectedSeedFingerprint === fingerprint) {
      return sdk;
    }

    if (sdk || poisonedSdk) {
      await disconnectLocked();
      if (poisonedSdk) {
        throw new Error('Spark SDK previous session is still open');
      }
      if (epoch !== lifecycleEpoch) {
        throw new SparkLifecycleHungError();
      }
    }

    const apiKey = Config.BREEZ_API_KEY;
    if (!apiKey) {
      throw new Error(BREEZ_API_KEY_MISSING);
    }

    const config = defaultConfig(Network.Mainnet);
    config.apiKey = apiKey;
    // A cap, not "always claim": expensive blocks must not spend unbounded sats for the user.
    config.maxDepositClaimFee = new MaxFee.Rate({ satPerVbyte: MAX_DEPOSIT_CLAIM_FEE_SAT_PER_VBYTE });

    const seed = new Seed.Mnemonic({ mnemonic, passphrase: resolvedPassphrase });
    const instance = await connect({
      config,
      seed,
      storageDir: `${RNFS.DocumentDirectoryPath}/breezSdkSpark`,
    });
    if (epoch !== lifecycleEpoch) {
      discardStaleInstance(instance);
      throw new SparkLifecycleHungError();
    }
    inFlightInstance = instance;

    let newListenerId: string | null = null;
    try {
      const info = await instance.getInfo({ ensureSynced: false });
      if (epoch !== lifecycleEpoch) {
        discardStaleInstance(instance);
        throw new SparkLifecycleHungError();
      }

      if (onEvent) {
        const listener: EventListener = {
          onEvent: async (event: SdkEvent) => {
            await onEvent(event);
          },
        };
        newListenerId = await instance.addEventListener(listener);
        if (epoch !== lifecycleEpoch) {
          discardStaleInstance(instance);
          throw new SparkLifecycleHungError();
        }
      }

      sdk = instance;
      listenerId = newListenerId;
      connectedSeedFingerprint = fingerprint;
      connectedIdentityPubkey = info.identityPubkey;
      return instance;
    } catch (e) {
      if (epoch !== lifecycleEpoch) {
        discardStaleInstance(instance);
        throw e instanceof SparkLifecycleHungError ? e : new SparkLifecycleHungError();
      }
      // Native connect() succeeded but setup did not. Drop the instance; a failed
      // disconnect is remembered so the next connect does not open a second session.
      try {
        await instance.disconnect();
      } catch (cleanupErr) {
        console.warn('connectSparkSdk: disconnect failed', errorKind(cleanupErr));
        poisonedSdk = instance;
      }
      throw e;
    }
  } finally {
    // A timed-out connect keeps running natively. A later attempt may have
    // claimed these globals, so only release state that still belongs here.
    // Identity, not epoch: a hang (no settle) keeps the lock; a settle —
    // instance or error — releases it even after the epoch moved on.
    if (pendingNativeConnect === nativeConnectAttempt) {
      pendingNativeConnect = null;
      inFlightInstance = null;
    }
  }
}

/**
 * Connects the Breez Spark SDK once per app session.
 * Uses the recovery phrase of the on-chain wallet, including its BIP39 passphrase when set.
 * An empty passphrase is treated as unset so the derived seed matches a wallet with no passphrase.
 * Does not set a custom LNURL domain — the SDK default Breez server is used.
 */
export async function connectSparkSdk(
  mnemonic: string,
  onEvent?: (event: SdkEvent) => Promise<void>,
  passphrase?: string,
): Promise<BreezSdkInterface> {
  return enqueueLifecycle(() => connectLocked(mnemonic, onEvent, passphrase));
}

export async function syncSparkWallet(): Promise<void> {
  if (!sdk) return;
  await sdk.syncWallet({});
}

/** Test-only: drop in-memory session without calling native disconnect. */
export function __resetSparkSdkForTests(): void {
  sdk = null;
  listenerId = null;
  connectedSeedFingerprint = null;
  connectedIdentityPubkey = null;
  poisonedSdk = null;
  lifecycleTail = Promise.resolve();
  lifecycleEpoch = 0;
  inFlightInstance = null;
  pendingNativeConnect = null;
  teardownInFlight = false;
  lifecycleTimeoutMs = SPARK_LIFECYCLE_TIMEOUT_MS;
}

/** Test-only: shorten the lifecycle hang bound. Omit to restore the default. */
export function __setLifecycleTimeoutMsForTests(ms?: number): void {
  lifecycleTimeoutMs = ms === undefined ? SPARK_LIFECYCLE_TIMEOUT_MS : ms;
}

/** Test-only: whether teardownInstance is awaiting a native remove/disconnect. */
export function __isTeardownInFlightForTests(): boolean {
  return teardownInFlight;
}
