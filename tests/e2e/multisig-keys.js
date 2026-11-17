import BIP32Factory from 'bip32';
import * as bip39 from 'bip39';
import * as bitcoin from 'bitcoinjs-lib';

import ecc from '../../blue_modules/noble_ecc';

const bip32 = BIP32Factory(ecc);
export const NATIVE_SEGWIT_PATH = "m/48'/0'/0'/2'";

export function cosignerKey(mnemonic) {
  const root = bip32.fromSeed(bip39.mnemonicToSeedSync(mnemonic));
  const account = root.derivePath(NATIVE_SEGWIT_PATH);
  const receiveNode = account.derive(0).derive(0);
  return {
    fingerprint: Buffer.from(root.fingerprint),
    xfp: Buffer.from(root.fingerprint).toString('hex').toUpperCase(),
    xpub: account.neutered().toBase58(),
    receiveNode,
    receivePubkey: Buffer.from(receiveNode.publicKey),
  };
}

/** First receive output of a 2-of-3 native segwit sortedmulti vault, computed from the three account keys. */
export function expectedVault(keys) {
  const pubkeys = keys.map(key => key.receivePubkey).sort(Buffer.compare);
  const redeem = bitcoin.payments.p2ms({ m: 2, pubkeys, network: bitcoin.networks.bitcoin });
  return bitcoin.payments.p2wsh({ redeem, network: bitcoin.networks.bitcoin });
}
