/* global device, element, by, waitFor, expect */
import * as bitcoin from 'bitcoinjs-lib';

export async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function waitForId(id, timeout = 60_000) {
  await waitFor(element(by.id(id)))
    .toBeVisible()
    .withTimeout(timeout);
}

export async function waitForText(text, timeout = 60_000) {
  await waitFor(element(by.text(text)))
    .toBeVisible()
    .withTimeout(timeout);
}

export function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set; this suite cannot run without it`);
  }
  return value;
}

export async function launchFresh() {
  await device.launchApp({ delete: true, newInstance: true, permissions: { notifications: 'NO', camera: 'YES' } });
}

/**
 * Detox has no text getter; the failing toHaveText assertion reports the element's text.
 * @see https://github.com/wix/detox/issues/445
 */
export async function extractTextFromElementById(id) {
  try {
    await expect(element(by.id(id))).toHaveText('_unfoundable_text');
  } catch (error) {
    const message = error.message.toString();
    if (device.getPlatform() === 'ios') {
      const [, rest] = message.split('accessibilityLabel was "');
      return rest.split('" on ')[0];
    }
    const [, rest] = message.split('Got:');
    const textField = rest
      .split('}"')[0]
      .split(',')
      .find(part => part.includes('text='));
    return textField.trim().split('=').slice(1).join('=');
  }
  throw new Error(`Element ${id} unexpectedly has the probe text`);
}

export async function typeTextIntoAlertInput(text) {
  if (device.getPlatform() === 'android') {
    await element(by.type('android.widget.EditText')).replaceText(text);
  } else {
    await element(by.type('_UIAlertControllerTextField')).replaceText(text);
  }
}

/** Fresh install lands on AddWallet; "Create" builds the on-chain wallet offline and opens home. */
export async function createOnChainWallet() {
  await waitForId('Create');
  await element(by.id('Create')).tap();
  await waitForId('OnChainWalletRow');
}

/** AddWallet → Import → keyboard → 5 taps on the explanation opens the speed import (no discovery, no Lightning recovery). */
export async function speedImport(mnemonic, walletType = 'HDsegwitBech32') {
  await waitForId('ImportWallet');
  await element(by.id('ImportWallet')).tap();
  await waitForId('ImportFromTextButton');
  await element(by.id('ImportFromTextButton')).tap();
  await waitForId('SpeedBackdoor');
  for (let i = 0; i < 5; i++) {
    await element(by.id('SpeedBackdoor')).tap();
    await sleep(300);
  }
  await waitForId('SpeedMnemonicInput');
  await element(by.id('SpeedMnemonicInput')).replaceText(mnemonic);
  await element(by.id('SpeedWalletTypeInput')).replaceText(walletType);
  await element(by.id('SpeedDoImport')).tap();
  await waitForId('OnChainWalletRow', 180_000);
}

/** Import through the regular flow, which also recovers a previously used Lightning (Spark) wallet. */
export async function regularImport(mnemonic) {
  await waitForId('ImportWallet');
  await element(by.id('ImportWallet')).tap();
  await waitForId('ImportFromTextButton');
  await element(by.id('ImportFromTextButton')).tap();
  await waitForId('MnemonicInput');
  await element(by.id('MnemonicInput')).replaceText(mnemonic);
  await element(by.id('DoImport')).tap();
  await waitForId('OnChainWalletRow', 300_000);
}

/** Home → on-chain wallet → Receive; returns the shown address and leaves the receive screen open. */
export async function readOnChainReceiveAddress() {
  await waitForId('OnChainWalletRow');
  await element(by.id('OnChainWalletRow')).tap();
  await waitForId('ReceiveButton');
  await element(by.id('ReceiveButton')).tap();
  await waitForId('AddressValue');
  return extractTextFromElementById('AddressValue');
}

/** Waits for text inside a native dialog, which waitFor() cannot see. */
export async function waitForDialogText(text, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      await expect(element(by.text(text))).toBeVisible();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await sleep(1000);
    }
  }
}

/** Answers the native password prompt (react-native-prompt-android) that shows `dialogText`. */
export async function answerPasswordPrompt(password, dialogText) {
  await waitForDialogText(dialogText);
  await typeTextIntoAlertInput(password);
  await element(by.text('OK')).tap();
}

/** Home Send → keyboard → manual entry → Continue. */
export async function enterSendDestination(destination) {
  await waitForId('SendButton');
  await element(by.id('SendButton')).tap();
  await waitForId('ManualEntryButton');
  await element(by.id('ManualEntryButton')).tap();
  await waitForId('ManualAddressInput');
  await element(by.id('ManualAddressInput')).replaceText(destination);
  await element(by.id('ManualAddressContinue')).tap();
}

async function fetchJsonWithRetry(url, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (response.ok) return await response.json();
      lastError = new Error(`${url}: HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(attempt * 2000);
  }
  throw lastError;
}

/** Sums the values of the outputs a transaction spends, looked up on a public explorer. */
export async function sumSpentOutputs(tx) {
  let total = 0;
  for (const input of tx.ins) {
    const txid = Buffer.from(input.hash).reverse().toString('hex');
    const prev = await fetchJsonWithRetry(`https://mempool.space/api/tx/${txid}`);
    total += prev.vout[input.index].value;
  }
  return total;
}

export function decodeTx(hex) {
  const tx = bitcoin.Transaction.fromHex(hex);
  const outs = tx.outs.map(out => ({ address: bitcoin.address.fromOutputScript(out.script), value: Number(out.value) }));
  return { tx, outs };
}

/** "Fee: 0.00000292 BTC (…)" → 292 */
export function parseBtcFeeSats(text) {
  const match = text.match(/([0-9]+[.,][0-9]+|[0-9]+)\s*BTC/);
  if (!match) throw new Error(`No BTC amount in "${text}"`);
  return Math.round(Number(match[1].replace(',', '.')) * 1e8);
}

/** "Fee: 12 sats" / "12 sats" → 12 */
export function parseSats(text) {
  const match = text.replace(/[’',\s](?=\d{3}\b)/g, '').match(/([0-9]+)\s*sats/);
  if (!match) throw new Error(`No sats amount in "${text}"`);
  return Number(match[1]);
}

/** Requests a fresh BOLT11 invoice for `sats` from a Lightning address (LNURL-pay). */
export async function invoiceFromLightningAddress(lightningAddress, sats) {
  const [user, domain] = lightningAddress.split('@');
  const meta = await (await fetch(`https://${domain}/.well-known/lnurlp/${user}`)).json();
  if (meta.status === 'ERROR') throw new Error(`LNURL-pay metadata: ${meta.reason}`);
  const separator = meta.callback.includes('?') ? '&' : '?';
  const response = await (await fetch(`${meta.callback}${separator}amount=${sats * 1000}`)).json();
  if (!response.pr) throw new Error(`LNURL-pay callback returned no invoice: ${JSON.stringify(response)}`);
  return response.pr;
}

/** Waits for the Spark fee quote on the Lightning confirmation screen. */
export async function readQuotedFee() {
  for (let i = 0; i < 60; i++) {
    const text = await extractTextFromElementById('LnurlPayFee');
    if (/\d+\s*sats/.test(text)) return parseSats(text);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('no Spark fee quote arrived');
}
