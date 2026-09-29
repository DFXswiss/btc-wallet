import { connect, defaultConfig } from '@breeztech/breez-sdk-spark/nodejs';
import BIP32Factory from 'bip32';
import * as bip39 from 'bip39';
import { createHmac } from 'crypto';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import ecc from '../../blue_modules/noble_ecc';
import { requireEnv, sleep } from './helperz';

const bip32 = BIP32Factory(ecc);

/** BIP-85 BIP39 application, English, 12 words, index 0 — written from the spec, independent of the app code. */
export function bip85Mnemonic12(mnemonic) {
  const node = bip32.fromSeed(bip39.mnemonicToSeedSync(mnemonic)).derivePath("m/83696968'/39'/0'/12'/0'");
  const entropy = createHmac('sha512', 'bip-entropy-from-k').update(node.privateKey).digest().subarray(0, 16);
  return bip39.entropyToMnemonic(Buffer.from(entropy).toString('hex'));
}

/** The Lightning address domain the e2e build uses (the build reads `.env.dev`). */
function buildLnurlDomain() {
  const line = readFileSync(join(__dirname, '../../.env.dev'), 'utf8')
    .split('\n')
    .find(entry => entry.startsWith('BREEZ_LNURL_DOMAIN='));
  return line?.split('=')[1].trim();
}

/** Connects a Spark wallet in the test runner with the same network settings as the app; `close()` disconnects it. */
export async function connectSpark(mnemonic) {
  const config = defaultConfig('mainnet');
  config.apiKey = requireEnv('BREEZ_API_KEY');
  const lnurlDomain = buildLnurlDomain();
  if (lnurlDomain) config.lnurlDomain = lnurlDomain;
  const storageDir = mkdtempSync(join(tmpdir(), 'spark-e2e-'));
  const sdk = await connect({ config, seed: { type: 'mnemonic', mnemonic }, storageDir });
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
