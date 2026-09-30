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
    // Selecting fetches the rate first and only then saves the currency and shows its rate. A tap that lands while
    // the list still settles after the scroll can get lost, so tap again if nothing changed.
    for (let attempt = 0; attempt < 3 && !(await extractTextFromElementById('CurrencyRate')).includes('€'); attempt++) {
      await element(by.id('CurrencyEUR')).tap();
      for (let i = 0; i < 10 && !(await extractTextFromElementById('CurrencyRate')).includes('€'); i++) await sleep(1000);
    }
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
    // As with the currency, a tap while the list still settles after the scroll can get lost; the screen retitles
    // itself in German once the language is applied.
    for (let attempt = 0; attempt < 3; attempt++) {
      await element(by.id('Languagede')).tap();
      try {
        await waitFor(element(by.text('Sprache')))
          .toExist()
          .withTimeout(5_000);
        break;
      } catch {}
    }
    await expect(element(by.text('Sprache'))).toExist();
    await device.pressBack();
    await waitForId('SettingsScroll');
    // The language is saved asynchronously after the tap.
    await waitFor(element(by.text('Allgemein')))
      .toExist()
      .withTimeout(10_000);
    await expect(element(by.text('Währung'))).toExist();

    await device.launchApp({ newInstance: true });
    await waitForId('Settings');
    await element(by.id('Settings')).tap();
    await waitForId('SettingsScroll');
    await expect(element(by.text('Allgemein'))).toExist();
  });
});
