import Config from 'react-native-config';
import RNFS from 'react-native-fs';
import {
  connect,
  defaultConfig,
  Network,
  Seed,
  type BreezSdkInterface,
  type EventListener,
  type SdkEvent,
} from '@breeztech/breez-sdk-spark-react-native';

export const BREEZ_API_KEY_MISSING =
  'BREEZ_API_KEY is not configured. Spark Lightning cannot start without it. Set the key in the build environment (react-native-config); do not commit it to tracked .env files.';

let sdk: BreezSdkInterface | null = null;
let listenerId: string | null = null;
let connectPromise: Promise<BreezSdkInterface> | null = null;

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

/**
 * Connects the Breez Spark SDK once per app session.
 * Uses the recovery phrase of the on-chain wallet (no passphrase).
 * Does not set a custom LNURL domain — the SDK default Breez server is used.
 */
export async function connectSparkSdk(mnemonic: string, onEvent?: (event: SdkEvent) => Promise<void>): Promise<BreezSdkInterface> {
  if (sdk) {
    return sdk;
  }
  if (connectPromise) {
    return connectPromise;
  }

  const apiKey = Config.BREEZ_API_KEY;
  if (!apiKey) {
    throw new Error(BREEZ_API_KEY_MISSING);
  }

  connectPromise = (async () => {
    const config = defaultConfig(Network.Mainnet);
    config.apiKey = apiKey;

    const seed = new Seed.Mnemonic({ mnemonic, passphrase: undefined });
    const instance = await connect({
      config,
      seed,
      storageDir: `${RNFS.DocumentDirectoryPath}/breezSdkSpark`,
    });

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
    connectPromise = null;
    sdk = null;
    listenerId = null;
    throw e;
  }
}

export async function disconnectSparkSdk(): Promise<void> {
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
  } catch (_) {
    // Listener may already be gone after disconnect.
  }

  try {
    await instance.disconnect();
  } catch (_) {
    // Best-effort teardown.
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
}
