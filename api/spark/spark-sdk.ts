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
let connectedIdentityPubkey: string | null = null;
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

/** Public identity of the live session, or null when none is committed. */
export function getSparkSessionIdentity(): string | null {
  return connectedIdentityPubkey;
}

export async function disconnectSparkSdk(): Promise<void> {
  connectGeneration += 1;
  connectedSeedFingerprint = null;
  connectedIdentityPubkey = null;
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

  // Never start a second native connect against the same storageDir. Wait, then
  // tear down, then start. The generation counter still covers disconnect-during-connect.
  while (true) {
    if (connectPromise && !sdk && connectedSeedFingerprint !== fingerprint) {
      const pending = connectPromise;
      try {
        await pending;
      } catch {
        // In-flight connect failed or was superseded; re-evaluate.
      }
      continue;
    }
    if (sdk && connectedSeedFingerprint === fingerprint) {
      return sdk;
    }
    if (sdk) {
      await disconnectSparkSdk();
      continue;
    }
    if (connectPromise && connectedSeedFingerprint === fingerprint) {
      return connectPromise;
    }
    break;
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

    const info = await instance.getInfo({ ensureSynced: false });

    if (generation !== connectGeneration) {
      try {
        await instance.disconnect();
      } catch {
        // Native teardown of a superseded connect; the replacement session is already starting.
      }
      throw new Error('Spark SDK connect superseded');
    }

    let newListenerId: string | null = null;
    if (onEvent) {
      const listener: EventListener = {
        onEvent: async (event: SdkEvent) => {
          await onEvent(event);
        },
      };
      newListenerId = await instance.addEventListener(listener);
    }

    if (generation !== connectGeneration) {
      try {
        if (newListenerId) {
          await instance.removeEventListener(newListenerId);
        }
      } catch {
        // Listener may already be gone with the superseded instance.
      }
      try {
        await instance.disconnect();
      } catch {
        // Native teardown of a superseded connect; the replacement session is already starting.
      }
      throw new Error('Spark SDK connect superseded');
    }

    sdk = instance;
    listenerId = newListenerId;
    connectedIdentityPubkey = info.identityPubkey;
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
      connectedIdentityPubkey = null;
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
  connectedIdentityPubkey = null;
  connectGeneration = 0;
}
