import BIP32Factory from 'bip32';
import * as bip39 from 'bip39';
import { createHmac } from 'crypto';

import ecc from '../../blue_modules/noble_ecc';

const bip32 = BIP32Factory(ecc);

/** BIP-85 BIP39 application, English, 12 words, index 0 — written from the spec, independent of the app code. */
export function bip85Mnemonic12(mnemonic) {
  const node = bip32.fromSeed(bip39.mnemonicToSeedSync(mnemonic)).derivePath("m/83696968'/39'/0'/12'/0'");
  const entropy = createHmac('sha512', 'bip-entropy-from-k').update(node.privateKey).digest().subarray(0, 16);
  return bip39.entropyToMnemonic(Buffer.from(entropy).toString('hex'));
}
