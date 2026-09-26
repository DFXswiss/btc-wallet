import BIP32Factory, { BIP32Interface } from 'bip32';
import * as bip39 from 'bip39';
import { createHmac } from 'crypto';
import * as bip39custom from '../../blue_modules/bip39';
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
  if (!bip39custom.validateMnemonic(mnemonic)) {
    throw new Error('On-chain recovery phrase is not available');
  }
  return sparkMnemonicFromRoot(bip32.fromSeed(bip39.mnemonicToSeedSync(mnemonic, passphrase || undefined)));
}

// Breez Spark SDK identity key on mainnet: m/8797555'/1'/0' of the Spark phrase (account 0 is testnet/regtest).
export const SPARK_IDENTITY_PATH = "m/8797555'/1'/0'";

/** Identity key pair of a Spark wallet; its public key is the identity pubkey inside the wallet's Spark address. */
export function sparkIdentityKey(sparkMnemonic: string): { privateKey: Buffer; publicKey: string } {
  const node = bip32.fromSeed(bip39.mnemonicToSeedSync(sparkMnemonic)).derivePath(SPARK_IDENTITY_PATH);
  if (!node.privateKey) {
    throw new Error('Spark identity key is not available');
  }
  return { privateKey: Buffer.from(node.privateKey), publicKey: Buffer.from(node.publicKey).toString('hex') };
}
