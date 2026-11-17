/* global device, element, by, expect */
import assert from 'assert';
import * as bip39 from 'bip39';

import { extractTextFromElementById, launchFresh, speedImport, waitForDialogText, waitForId } from './helperz';
import { NATIVE_SEGWIT_PATH, cosignerKey, expectedVault } from './multisig-keys';

/** A Coldcard-style coordination setup for a 2-of-3 native segwit vault. */
function coordinationSetup(keys) {
  const cosigners = keys.map(key => `${key.xfp}: ${key.xpub}`).join('\n');
  return `Name: e2e vault\nPolicy: 2 of 3\nDerivation: ${NATIVE_SEGWIT_PATH}\nFormat: P2WSH\n\n${cosigners}\n`;
}

async function importSetup(text) {
  await waitForId('MultisigWalletRowAdd');
  await element(by.id('MultisigWalletRowAdd')).tap();
  await waitForId('ScanImport');
  await element(by.id('ScanImport')).tap();
  // The import screen runs a camera preview, which never lets the app go idle; the caller turns synchronization
  // back on once it has left that screen.
  await device.disableSynchronization();
  await waitForId('ImportMultisigManualInput');
  await element(by.id('ImportMultisigManualInput')).tap();
  await waitForId('ManualTextInput');
  await element(by.id('ManualTextInput')).replaceText(text);
  await element(by.id('ManualTextContinue')).tap();
}

describe('Multisig vault import', () => {
  const mainMnemonic = bip39.generateMnemonic(128);
  const keys = [mainMnemonic, bip39.generateMnemonic(128), bip39.generateMnemonic(128)].map(cosignerKey);

  beforeAll(async () => {
    await launchFresh();
    await speedImport(mainMnemonic);
  });

  it('refuses a setup that does not contain the main seed', async () => {
    const foreign = [1, 2, 3].map(() => cosignerKey(bip39.generateMnemonic(128)));
    try {
      await importSetup(coordinationSetup(foreign));
      // Matching the phrase against every cosigner is slow on a CI emulator (over a minute).
      await waitForDialogText('Your wallet is not part of this multisig setup', 300_000);
      await element(by.text('OK')).tap();
      for (let i = 0; i < 3; i++) {
        try {
          await waitForId('MultisigWalletRowAdd', 3_000);
          break;
        } catch {
          await device.pressBack();
        }
      }
      await waitForId('MultisigWalletRowAdd');
    } finally {
      await device.enableSynchronization();
    }
    await expect(element(by.id('MultisigWalletRow'))).not.toExist();
  });

  it('imports a setup that contains the main seed as the vault computed from its three keys', async () => {
    await launchFresh();
    await speedImport(mainMnemonic);
    try {
      await importSetup(coordinationSetup(keys));
      await waitForId('MultisigWalletRow', 300_000);
    } finally {
      await device.enableSynchronization();
    }
    await element(by.id('MultisigWalletRow')).tap();
    await waitForId('ReceiveButton');
    await element(by.id('ReceiveButton')).tap();
    await waitForId('AddressValue');
    assert.strictEqual(await extractTextFromElementById('AddressValue'), expectedVault(keys).address);
  });
});
