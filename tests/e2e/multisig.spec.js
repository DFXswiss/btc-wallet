/* global device, element, by, waitFor */
import assert from 'assert';
import BIP32Factory from 'bip32';
import * as bip39 from 'bip39';
import * as bitcoin from 'bitcoinjs-lib';

import ecc from '../../blue_modules/noble_ecc';
import { extractTextFromElementById, launchFresh, scanText, speedImport, waitForId, waitForText } from './helperz';

const bip32 = BIP32Factory(ecc);
const NATIVE_SEGWIT_PATH = "m/48'/0'/0'/2'";

function cosignerKey(mnemonic) {
  const root = bip32.fromSeed(bip39.mnemonicToSeedSync(mnemonic));
  const account = root.derivePath(NATIVE_SEGWIT_PATH);
  return {
    xfp: Buffer.from(root.fingerprint).toString('hex').toUpperCase(),
    xpub: account.neutered().toBase58(),
    receivePubkey: Buffer.from(account.derive(0).derive(0).publicKey),
  };
}

/** First receive address of a 2-of-3 native segwit sortedmulti vault, computed from the three account keys. */
function expectedVaultAddress(keys) {
  const pubkeys = keys.map(key => key.receivePubkey).sort(Buffer.compare);
  const redeem = bitcoin.payments.p2ms({ m: 2, pubkeys, network: bitcoin.networks.bitcoin });
  return bitcoin.payments.p2wsh({ redeem, network: bitcoin.networks.bitcoin }).address;
}

describe('Multisig vault', () => {
  const mainMnemonic = bip39.generateMnemonic(128);
  const cosignerMnemonics = [bip39.generateMnemonic(128), bip39.generateMnemonic(128)];
  const keys = [cosignerKey(mainMnemonic), ...cosignerMnemonics.map(cosignerKey)];

  beforeAll(async () => {
    await launchFresh();
    await speedImport(mainMnemonic);
  });

  it('creates a 2-of-3 native segwit vault from the main seed and two scanned cosigners', async () => {
    await element(by.id('MultisigWalletRowAdd')).tap();
    await waitForId('LetsStart');
    await element(by.id('LetsStart')).tap();

    await waitForId('CreateButton');
    for (const key of keys.slice(1)) {
      await scanText(JSON.stringify({ xfp: key.xfp, xpub: key.xpub, path: NATIVE_SEGWIT_PATH }));
    }
    await element(by.id('CreateButton')).tap();

    await waitForId('MultisigWalletRow', 120_000);
    await element(by.id('MultisigWalletRow')).tap();
    await waitForId('ReceiveButton');
    await element(by.id('ReceiveButton')).tap();
    await waitForId('AddressValue');
    assert.strictEqual(await extractTextFromElementById('AddressValue'), expectedVaultAddress(keys));
  });

  it('shows the quorum, all three cosigners and a coordination setup with their fingerprints', async () => {
    await device.launchApp({ newInstance: true });
    await waitForId('Settings');
    await element(by.id('Settings')).tap();
    await waitForId('WalletDetailsMultisig');
    await element(by.id('WalletDetailsMultisig')).tap();
    await waitForId('WalletDetailsScroll');
    await waitForText('2 / 3 (native segwit)');

    await waitFor(element(by.id('MultisigCoordinationSetup')))
      .toBeVisible()
      .whileElement(by.id('WalletDetailsScroll'))
      .scroll(150, 'down');
    await element(by.id('MultisigCoordinationSetup')).tap();
    // The setup screen animates a QR code on a timer, which never lets the app go idle.
    await device.disableSynchronization();
    try {
      await waitFor(element(by.id('MultisigCoordinationSetupText')))
        .toExist()
        .withTimeout(60_000);
      const setup = await extractTextFromElementById('MultisigCoordinationSetupText');
      for (const key of keys) {
        assert.ok(setup.toUpperCase().includes(key.xfp), `coordination setup lacks fingerprint ${key.xfp}`);
      }
      assert.ok(setup.includes(NATIVE_SEGWIT_PATH), 'coordination setup lacks the derivation path');
      await device.pressBack();
    } finally {
      await device.enableSynchronization();
    }

    await waitForId('WalletDetailsScroll');
    await waitFor(element(by.id('ViewEditCosigners')))
      .toBeVisible()
      .whileElement(by.id('WalletDetailsScroll'))
      .scroll(150, 'down');
    await element(by.id('ViewEditCosigners')).tap();
    for (const number of [1, 2, 3]) {
      await waitFor(element(by.text(`Vault Key ${number}`)))
        .toExist()
        .withTimeout(30_000);
    }
  });
});
