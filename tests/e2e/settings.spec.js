/* global device, element, by, expect, waitFor */
import assert from 'assert';

import { createOnChainWallet, extractTextFromElementById, launchFresh, sleep, waitForId } from './helperz';

async function openSettingsItem(id) {
  await waitForId('Settings');
  await element(by.id('Settings')).tap();
  await waitFor(element(by.id(id)))
    .toBeVisible()
    .whileElement(by.id('SettingsScroll'))
    .scroll(150, 'down');
  await element(by.id(id)).tap();
}

async function backToHome() {
  for (let i = 0; i < 3; i++) {
    try {
      await waitForId('WalletBalanceButton', 3_000);
      return;
    } catch {
      await device.pressBack();
    }
  }
  await waitForId('WalletBalanceButton');
}

/** Taps the home balance until its text satisfies `predicate` (the tap cycles BTC → sats → fiat → hidden). */
async function cycleBalanceUntil(predicate, description) {
  const seen = [];
  for (let tap = 0; tap < 4; tap++) {
    const text = await extractTextFromElementById('WalletBalance').catch(() => undefined);
    if (text !== undefined && predicate(text)) return text;
    seen.push(text);
    await element(by.id('WalletBalanceButton')).tap();
    await sleep(500);
  }
  throw new Error(`home balance never showed ${description}; saw ${JSON.stringify(seen)}`);
}

describe('Settings', () => {
  beforeAll(async () => {
    await launchFresh();
    await createOnChainWallet();
  });

  it('shows the balance in the chosen fiat currency', async () => {
    await openSettingsItem('Currency');
    await waitFor(element(by.id('CurrencyEUR')))
      .toBeVisible()
      .whileElement(by.id('CurrencyList'))
      .scroll(300, 'down');
    await element(by.id('CurrencyEUR')).tap();
    // Selecting fetches the rate first and only then saves the currency and shows its rate.
    for (let i = 0; i < 30 && !(await extractTextFromElementById('CurrencyRate')).includes('€'); i++) await sleep(1000);
    assert.match(await extractTextFromElementById('CurrencyRate'), /€/);
    await backToHome();
    await cycleBalanceUntil(text => text.includes('€'), 'a euro amount');
  });

  it('hides every balance on home and keeps it hidden after a restart', async () => {
    await cycleBalanceUntil(text => text.includes('€'), 'a euro amount');
    await element(by.id('WalletBalanceButton')).tap();
    await expect(element(by.id('WalletBalance'))).not.toExist();
    await expect(element(by.text('*****').withAncestor(by.id('OnChainWalletRow')))).toExist();

    await device.launchApp({ newInstance: true });
    await waitForId('WalletBalanceButton');
    await expect(element(by.id('WalletBalance'))).not.toExist();
    await expect(element(by.text('*****').withAncestor(by.id('OnChainWalletRow')))).toExist();

    await element(by.id('WalletBalanceButton')).tap();
    await waitForId('WalletBalance');
    assert.match(await extractTextFromElementById('WalletBalance'), /BTC/);
    await expect(element(by.text('*****').withAncestor(by.id('OnChainWalletRow')))).not.toExist();
  });

  it('switches the interface to German right away and after a restart', async () => {
    await device.launchApp({ newInstance: true });
    await openSettingsItem('Language');
    await waitFor(element(by.id('Languagede')))
      .toBeVisible()
      .whileElement(by.id('LanguageList'))
      .scroll(300, 'down');
    await element(by.id('Languagede')).tap();
    await device.pressBack();
    await waitForId('SettingsScroll');
    await expect(element(by.text('Allgemein'))).toExist();
    await expect(element(by.text('Währung'))).toExist();

    await device.launchApp({ newInstance: true });
    await waitForId('Settings');
    await element(by.id('Settings')).tap();
    await waitForId('SettingsScroll');
    await expect(element(by.text('Allgemein'))).toExist();
  });
});
