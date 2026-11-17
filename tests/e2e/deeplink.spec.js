/* global device */
import assert from 'assert';

import { createOnChainWallet, extractTextFromElementById, launchFresh, unpayableInvoice, waitForDialogText, waitForId } from './helperz';

const ADDRESS = 'bc1q063ctu6jhe5k4v8ka99qac8rcm2tzjjnuktyrl';
const REQUEST = `bitcoin:${ADDRESS}?amount=0.00012345&label=dfx%20e2e`;

async function expectSendScreenForRequest() {
  await waitForId('SendDetailsAddress0', 60_000);
  assert.strictEqual((await extractTextFromElementById('SendDetailsAddress0')).trim(), ADDRESS);
  assert.strictEqual((await extractTextFromElementById('BitcoinAmountInput')).trim(), '0.00012345');
  assert.strictEqual((await extractTextFromElementById('SendDetailsMemo')).trim(), 'dfx e2e');
}

describe('Deep links', () => {
  beforeAll(async () => {
    await launchFresh();
    await createOnChainWallet();
  });

  it('a bitcoin: link opens the send screen with its address, amount and label', async () => {
    await device.openURL({ url: REQUEST });
    await expectSendScreenForRequest();
  });

  it('the same request nested in a bluewallet: link opens the same send screen', async () => {
    await device.launchApp({ newInstance: true });
    await waitForId('OnChainWalletRow');
    await device.openURL({ url: `bluewallet:${REQUEST}` });
    await expectSendScreenForRequest();
  });

  it('a lightning: link is refused while there is no Lightning wallet', async () => {
    await device.launchApp({ newInstance: true });
    await waitForId('LightningWalletRowAdd');
    await device.openURL({ url: `lightning:${unpayableInvoice(1234, 'dfx e2e')}` });
    await waitForDialogText('Before paying a Lightning invoice, you must first add a Lightning wallet.');
  });
});
