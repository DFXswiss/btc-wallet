/* global device, element, by, expect, waitFor */
import assert from 'assert';
import * as bitcoin from 'bitcoinjs-lib';

import { createOnChainWallet, extractTextFromElementById, launchFresh, waitForId, waitForText } from './helperz';

describe('On-chain wallet without funds', () => {
  beforeAll(async () => {
    await launchFresh();
    await createOnChainWallet();
  });

  it('self-test passes', async () => {
    await element(by.id('Settings')).tap();
    await waitForId('SettingsScroll');
    await waitFor(element(by.id('AboutButton')))
      .toBeVisible()
      .whileElement(by.id('SettingsScroll'))
      .scroll(200, 'down');
    await element(by.id('AboutButton')).tap();
    await waitForId('AboutScrollView');
    await element(by.id('AboutScrollView')).scrollTo('bottom');
    await element(by.id('RunSelfTestButton')).tap();
    await waitForId('SelfTestLoading');
    await element(by.id('SelfTestLoading')).tap();
    await waitForId('SelfTestOk', 180_000);
    await device.pressBack();
    await device.pressBack();
  });

  it('keeps the wallet across a restart and shows a mainnet receive address', async () => {
    await device.launchApp({ newInstance: true });
    await waitForId('OnChainWalletRow');
    await element(by.id('OnChainWalletRow')).tap();
    await waitForId('ReceiveButton');
    await element(by.id('ReceiveButton')).tap();
    await waitForId('AddressValue');

    const address = await extractTextFromElementById('AddressValue');
    assert.match(address, /^bc1q[02-9ac-hj-np-z]{38}$/, `unexpected receive address ${address}`);
    assert.doesNotThrow(() => bitcoin.address.toOutputScript(address, bitcoin.networks.bitcoin));
  });

  it('encodes a sats amount and a label into the BIP21 request as BTC', async () => {
    const address = await extractTextFromElementById('AddressValue');

    await element(by.id('ReceiveAmountInput')).replaceText('12345');
    await element(by.id('CustomAmountDescription')).replaceText('e2e label');
    await element(by.id('CustomAmountDescription')).tapReturnKey();

    const uri = await waitForBip21(address);
    const parsed = new URL(uri.replace(/^bitcoin:/i, 'bitcoin://'));
    assert.strictEqual(parsed.host.toLowerCase(), address.toLowerCase());
    assert.strictEqual(parsed.searchParams.get('amount'), '0.00012345');
    assert.strictEqual(parsed.searchParams.get('label'), 'e2e label');
  });

  it('deleting the only wallet resets the app to wallet creation', async () => {
    await device.launchApp({ newInstance: true });
    await waitForId('Settings');
    await element(by.id('Settings')).tap();
    await waitForId('WalletDetails');
    await element(by.id('WalletDetails')).tap();
    await waitForId('WalletDetailsScroll');
    await element(by.id('WalletDetailsScroll')).scrollTo('bottom');
    await element(by.id('DeleteButton')).tap();
    await waitForText('Yes, delete');
    await element(by.text('Yes, delete')).tap();
    await waitForId('Create');

    // The deletion must be persisted, not only reflected in the running app.
    await device.launchApp({ newInstance: true });
    await waitForId('Create');
    await expect(element(by.id('OnChainWalletRow'))).not.toExist();
  });
});

async function waitForBip21(address) {
  for (let i = 0; i < 20; i++) {
    const value = await extractTextFromElementById('AddressValue');
    if (value.toLowerCase().startsWith('bitcoin:') && value.includes('amount=')) return value;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`receive screen never switched from ${address} to a BIP21 request`);
}
