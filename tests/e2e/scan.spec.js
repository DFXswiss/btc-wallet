/* global element, by */
import assert from 'assert';

import { createOnChainWallet, extractTextFromElementById, launchFresh, scanText, waitForId } from './helperz';

const ADDRESS = 'bc1q063ctu6jhe5k4v8ka99qac8rcm2tzjjnuktyrl';

describe('Scan from the home screen', () => {
  beforeAll(async () => {
    await launchFresh();
    await createOnChainWallet();
  });

  it('a scanned BIP21 request opens the send screen with its address and amount', async () => {
    await element(by.id('HomeScanButton')).tap();
    await scanText(`bitcoin:${ADDRESS}?amount=0.0001`);
    await waitForId('SendDetailsAddress0', 60_000);
    assert.strictEqual((await extractTextFromElementById('SendDetailsAddress0')).trim(), ADDRESS);
    assert.strictEqual((await extractTextFromElementById('BitcoinAmountInput')).trim(), '0.0001');
  });
});
