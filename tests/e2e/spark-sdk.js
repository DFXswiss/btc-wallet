import { connect, defaultConfig } from '@breeztech/breez-sdk-spark/nodejs';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { bip85Mnemonic12 } from './bip85';
import { requireEnv, sleep } from './helperz';

/** The Lightning address domain of the build under test (`E2E_ENV_FILE`, `.env.dev` by default). */
function buildLnurlDomain() {
  const line = readFileSync(join(__dirname, '../..', process.env.E2E_ENV_FILE || '.env.dev'), 'utf8')
    .split('\n')
    .find(entry => entry.startsWith('BREEZ_LNURL_DOMAIN='));
  return line?.split('=')[1].trim();
}

/**
 * Connects, in the test runner and with the app's network settings, the Spark wallet the app derives from the on-chain
 * phrase `mnemonic` (its BIP-85 child); `close()` disconnects it.
 */
export async function connectSpark(mnemonic) {
  const config = defaultConfig('mainnet');
  config.apiKey = requireEnv('BREEZ_API_KEY');
  const lnurlDomain = buildLnurlDomain();
  if (lnurlDomain) config.lnurlDomain = lnurlDomain;
  const storageDir = mkdtempSync(join(tmpdir(), 'spark-e2e-'));
  const sdk = await connect({ config, seed: { type: 'mnemonic', mnemonic: bip85Mnemonic12(mnemonic) }, storageDir });
  sdk.close = async () => {
    await sdk.disconnect();
    rmSync(storageDir, { recursive: true, force: true });
  };
  return sdk;
}

export async function sparkBalance(sdk) {
  return Number((await sdk.getInfo({ ensureSynced: true })).balanceSats);
}

/** Polls until the balance differs from `before`, then waits one more sync so a second (duplicate) payment would show. */
export async function waitForSparkBalanceChange(sdk, before) {
  let balance = before;
  for (let i = 0; i < 24 && balance === before; i++) {
    await sleep(5000);
    balance = await sparkBalance(sdk);
  }
  await sleep(15_000);
  return sparkBalance(sdk);
}

/** The payer's Lightning address, registered once under a name derived from its identity key. */
export async function lightningAddressOf(sdk) {
  const existing = await sdk.getLightningAddress();
  if (existing) return existing.lightningAddress;
  const { identityPubkey } = await sdk.getInfo({ ensureSynced: false });
  const registered = await sdk.registerLightningAddress({ username: `dfxe2e${identityPubkey.slice(2, 14)}` });
  return registered.lightningAddress;
}
