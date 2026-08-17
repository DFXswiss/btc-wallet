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
let connectPromise: Promise<BreezSdkInterface> | null = null;
let connectedSeedFingerprint: string | null = null;
let connectGeneration = 0;

function fingerprintMnemonic(mnemonic: string): string {
  return createHash('sha256').update(mnemonic).digest().toString('hex');
}

export function getSparkSdk(): BreezSdkInterface | null {
  return sdk;
}

export function requireSparkSdk(): BreezSdkInterface {
  if (!sdk) {
    throw new Error('Spark SDK is not connected');
  }
  return sdk;
}

export function isSparkSdkConnected(): boolean {
  return sdk !== null;
}

export async function disconnectSparkSdk(): Promise<void> {
  connectGeneration += 1;
  connectedSeedFingerprint = null;
  if (!sdk) {
    connectPromise = null;
    return;
  }

  const instance = sdk;
  const id = listenerId;
  sdk = null;
  listenerId = null;
  connectPromise = null;

  try {
    if (id) {
      await instance.removeEventListener(id);
    }
  } catch (e) {
    // Best-effort: the SDK may already have dropped the listener during disconnect.
    // Follow-up is impossible without a live instance. Log class only — this SDK instance
    // was built with seed + API key; Sentry breadcrumbs ride along with later issues.
    console.warn('disconnectSparkSdk: removeEventListener failed', e instanceof Error ? e.name : typeof e);
  }

  try {
    await instance.disconnect();
  } catch (e) {
    // Best-effort session teardown: the process is exiting or the native side is already gone.
    // Leaving a zombie listener is preferable to crashing the app on cleanup.
    // Class only (seed/key may live in SDK error text); see App.js captureConsoleIntegration.
    console.warn('disconnectSparkSdk: disconnect failed', e instanceof Error ? e.name : typeof e);
  }
}

/**
 * Connects the Breez Spark SDK once per app session.
 * Uses the recovery phrase of the on-chain wallet (no passphrase).
 * Does not set a custom LNURL domain — the SDK default Breez server is used.
 */
export async function connectSparkSdk(mnemonic: string, onEvent?: (event: SdkEvent) => Promise<void>): Promise<BreezSdkInterface> {
  const fingerprint = fingerprintMnemonic(mnemonic);

  if (sdk && connectedSeedFingerprint === fingerprint) {
    return sdk;
  }
  if (sdk) {
    await disconnectSparkSdk();
  }
  if (connectPromise && connectedSeedFingerprint === fingerprint) {
    return connectPromise;
  }
  if (connectPromise) {
    // Drop the in-flight session so this caller does not inherit the other seed.
    connectGeneration += 1;
    connectPromise = null;
    connectedSeedFingerprint = null;
  }

  const apiKey = Config.BREEZ_API_KEY;
  if (!apiKey) {
    throw new Error(BREEZ_API_KEY_MISSING);
  }

  const generation = ++connectGeneration;
  connectedSeedFingerprint = fingerprint;

  connectPromise = (async () => {
    const config = defaultConfig(Network.Mainnet);
    config.apiKey = apiKey;
    // A cap, not "always claim": expensive blocks must not spend unbounded sats for the user.
    config.maxDepositClaimFee = new MaxFee.Rate({ satPerVbyte: MAX_DEPOSIT_CLAIM_FEE_SAT_PER_VBYTE });

    const seed = new Seed.Mnemonic({ mnemonic, passphrase: undefined });
    const instance = await connect({
      config,
      seed,
      storageDir: `${RNFS.DocumentDirectoryPath}/breezSdkSpark`,
    });

    if (generation !== connectGeneration) {
      try {
        await instance.disconnect();
      } catch {
        // Native teardown of a superseded connect; the replacement session is already starting.
      }
      throw new Error('Spark SDK connect superseded');
    }

    if (onEvent) {
      const listener: EventListener = {
        onEvent: async (event: SdkEvent) => {
          await onEvent(event);
        },
      };
      listenerId = await instance.addEventListener(listener);
    }

    sdk = instance;
    return instance;
  })();

  try {
    return await connectPromise;
  } catch (e) {
    if (generation === connectGeneration) {
      connectPromise = null;
      sdk = null;
      listenerId = null;
      connectedSeedFingerprint = null;
    }
    throw e;
  }
}

export async function syncSparkWallet(): Promise<void> {
  if (!sdk) return;
  await sdk.syncWallet({});
}

/** Test-only: drop in-memory session without calling native disconnect. */
export function __resetSparkSdkForTests(): void {
  sdk = null;
  listenerId = null;
  connectPromise = null;
  connectedSeedFingerprint = null;
  connectGeneration = 0;
}
