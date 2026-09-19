import BIP32Factory, { BIP32Interface } from 'bip32';
import * as bip39 from 'bip39';
import { createHmac } from 'crypto';
import ecc from '../../blue_modules/noble_ecc';

const bip32 = BIP32Factory(ecc);

// BIP-85, BIP39 application: English, 12 words, index 0.
// Part of the recovery recipe for every Spark wallet ever created — never change it.
export const SPARK_BIP85_PATH = "m/83696968'/39'/0'/12'/0'";

export function sparkMnemonicFromRoot(root: BIP32Interface): string {
  const privateKey = root.derivePath(SPARK_BIP85_PATH).privateKey;
  if (!privateKey) {
    throw new Error('On-chain recovery phrase is not available');
  }
  const entropy = createHmac('sha512', 'bip-entropy-from-k').update(privateKey).digest().slice(0, 16);
  return bip39.entropyToMnemonic(entropy.toString('hex'));
}

export function deriveSparkMnemonic(mnemonic: string, passphrase?: string): string {
  if (!bip39.validateMnemonic(mnemonic)) {
    throw new Error('On-chain recovery phrase is not available');
  }
  return sparkMnemonicFromRoot(bip32.fromSeed(bip39.mnemonicToSeedSync(mnemonic, passphrase || undefined)));
}
