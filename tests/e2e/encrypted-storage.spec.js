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
    await answerPasswordPrompt(REAL_PASSWORD);
    await answerPasswordPrompt(REAL_PASSWORD);
    await waitForId('PlausibleDeniabilityButton');

    await device.launchApp({ newInstance: true });
    await waitForDialogText('Enter password');
    await answerPasswordPrompt('not-the-password');
    await waitForDialogText('Incorrect password. Please try again.');
    await answerPasswordPrompt(REAL_PASSWORD);

    assert.strictEqual(await readOnChainReceiveAddress(), realAddress);
  });

  it('a plausible-deniability password opens separate storage and leaves the real wallet intact', async () => {
    await device.launchApp({ newInstance: true });
    await answerPasswordPrompt(REAL_PASSWORD);
    await openSecuritySettings();
    await element(by.id('PlausibleDeniabilityButton')).tap();
    await waitForId('CreateFakeStorageButton');
    await element(by.id('CreateFakeStorageButton')).tap();
    await answerPasswordPrompt(FAKE_PASSWORD);
    await answerPasswordPrompt(FAKE_PASSWORD);
    await waitForDialogText('Success');
    await element(by.text('OK')).tap();

    await device.launchApp({ newInstance: true });
    await answerPasswordPrompt(FAKE_PASSWORD);
    await createOnChainWallet();
    const fakeAddress = await readOnChainReceiveAddress();
    assert.notStrictEqual(fakeAddress, realAddress);

    await device.launchApp({ newInstance: true });
    await answerPasswordPrompt(REAL_PASSWORD);
    assert.strictEqual(await readOnChainReceiveAddress(), realAddress);
  });
});
