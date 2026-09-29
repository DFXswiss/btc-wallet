/* global device, element, by, waitFor */
import assert from 'assert';

import { answerPasswordPrompt, createOnChainWallet, launchFresh, readOnChainReceiveAddress, waitForDialogText, waitForId } from './helperz';

const REAL_PASSWORD = 'e2e-real-password';
const FAKE_PASSWORD = 'e2e-fake-password';

async function openSecuritySettings() {
  await waitForId('Settings');
  await element(by.id('Settings')).tap();
  await waitForId('SettingsScroll');
  await waitFor(element(by.id('SecurityButton')))
    .toBeVisible()
    .whileElement(by.id('SettingsScroll'))
    .scroll(200, 'down');
  await element(by.id('SecurityButton')).tap();
  await waitForId('EncryptedStorageSwitch');
}

describe('Encrypted storage', () => {
  let realAddress;

  beforeAll(async () => {
    await launchFresh();
    await createOnChainWallet();
    realAddress = await readOnChainReceiveAddress();
    await device.launchApp({ newInstance: true });
  });

  it('asks for the password on launch, rejects a wrong one and restores the same wallet', async () => {
    await openSecuritySettings();
    await element(by.id('EncryptedStorageSwitch')).tap();
    await answerPasswordPrompt(REAL_PASSWORD, 'Create the password you will use to decrypt the storage.');
    await answerPasswordPrompt(REAL_PASSWORD, 'Re-type password');
    await waitForId('PlausibleDeniabilityButton');

    await device.launchApp({ newInstance: true });
    await answerPasswordPrompt('not-the-password', 'Enter password');
    await answerPasswordPrompt(REAL_PASSWORD, 'Incorrect password. Please try again.');

    assert.strictEqual(await readOnChainReceiveAddress(), realAddress);
  });

  it('a plausible-deniability password opens separate storage and leaves the real wallet intact', async () => {
    await device.launchApp({ newInstance: true });
    await answerPasswordPrompt(REAL_PASSWORD, 'Enter password');
    await openSecuritySettings();
    await element(by.id('PlausibleDeniabilityButton')).tap();
    await waitForId('CreateFakeStorageButton');
    await element(by.id('CreateFakeStorageButton')).tap();
    await answerPasswordPrompt(FAKE_PASSWORD, 'Create a password');
    await answerPasswordPrompt(FAKE_PASSWORD, 'Re-type password');
    await waitForDialogText('Alert');
    await waitForDialogText('Success');
    await element(by.text('OK')).tap();

    // The fake password opens empty storage: the app is back at wallet creation.
    await device.launchApp({ newInstance: true });
    await answerPasswordPrompt(FAKE_PASSWORD, 'Enter password');
    await createOnChainWallet();

    await device.launchApp({ newInstance: true });
    await answerPasswordPrompt(REAL_PASSWORD, 'Enter password');
    assert.strictEqual(await readOnChainReceiveAddress(), realAddress);
  });
});
