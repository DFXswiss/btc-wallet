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

export class SparkSessionStaleError extends Error {
  constructor() {
    super('Spark session is no longer the one this call started with');
    this.name = 'SparkSessionStaleError';
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
  return passphrase ? passphrase : undefined;
}

function errorKind(e: unknown): string {
  return e instanceof Error ? e.name : typeof e;
}

function enqueueLifecycle<T>(op: () => Promise<T>): Promise<T> {
  const run = lifecycleTail.then(op, op);
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

  try {
    await instance.disconnect();
    poisonedSdk = null;
    listenerId = null;
  } catch (e) {
    // Native session may still hold storageDir. Keep the instance and listener id
    // so the next connect can retry both teardown steps against the same directory.
    console.warn('disconnectSparkSdk: disconnect failed', errorKind(e));
    poisonedSdk = instance;
  }
}

async function disconnectLocked(): Promise<void> {
  connectedSeedFingerprint = null;
  connectedIdentityPubkey = null;

  const instance = sdk ?? poisonedSdk;
  const id = listenerId;
  sdk = null;

  if (!instance) {
    listenerId = null;
    return;
  }

  await teardownInstance(instance, id);
}

export async function disconnectSparkSdk(): Promise<void> {
  await enqueueLifecycle(() => disconnectLocked());
}

async function connectLocked(
  mnemonic: string,
  onEvent?: (event: SdkEvent) => Promise<void>,
  passphrase?: string,
): Promise<BreezSdkInterface> {
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

  let newListenerId: string | null = null;
  try {
    const info = await instance.getInfo({ ensureSynced: false });

    if (onEvent) {
      const listener: EventListener = {
        onEvent: async (event: SdkEvent) => {
          await onEvent(event);
        },
      };
      newListenerId = await instance.addEventListener(listener);
    }

    sdk = instance;
    listenerId = newListenerId;
    connectedSeedFingerprint = fingerprint;
    connectedIdentityPubkey = info.identityPubkey;
    return instance;
  } catch (e) {
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
}
