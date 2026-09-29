/* global device, element, by, waitFor, expect */
import assert from 'assert';
import BIP32Factory from 'bip32';
import * as bip39 from 'bip39';
import * as bitcoin from 'bitcoinjs-lib';
import bolt11 from 'bolt11';
import { randomBytes } from 'crypto';

import ecc from '../../blue_modules/noble_ecc';

const bip32 = BIP32Factory(ecc);

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
  const attributes = await element(by.id(id)).getAttributes();
  if ('elements' in attributes) throw new Error(`${attributes.elements.length} elements match ${id}`);
  return attributes.text ?? attributes.label ?? '';
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

/** AddWallet → Import → keyboard → 5 taps on the explanation opens the speed import (no discovery). */
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

/** Import through the regular flow: account discovery, then home. */
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

/**
 * Imports `mnemonic`, then taps Add on the home Lightning row, which brings back the Lightning wallet the seed used
 * before (import itself no longer looks for one).
 */
export async function importWithLightning(mnemonic) {
  await regularImport(mnemonic);
  await waitForId('LightningWalletRowAdd');
  await element(by.id('LightningWalletRowAdd')).tap();
  await waitForId('LightningWalletRow', 300_000);
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
    if (attempt < attempts) await sleep(attempt * 2000);
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

/** "-0.0001 BTC" → -10000 */
export function parseBtcSats(text) {
  const match = text.match(/-?[0-9]+(?:\.[0-9]+)?/);
  if (!match) throw new Error(`No BTC amount in "${text}"`);
  return Math.round(Number(match[0]) * 1e8);
}

/** Relaunches the app and opens a wallet right away; the refresh started at launch loads its history. */
export async function openWalletWithHistory(rowId) {
  await device.launchApp({ newInstance: true });
  await waitForId(rowId);
  await element(by.id(rowId)).tap();
}

/** On the open wallet: taps transaction row `index` and returns what the status and details screens show. */
export async function readTransactionRow(index) {
  await waitFor(element(by.id(`TransactionRow${index}`)))
    .toExist()
    .withTimeout(300_000);
  await element(by.id(`TransactionRow${index}`)).tap();
  await waitForId('TransactionStatusValue', 120_000);
  const shown = {
    value: await extractTextFromElementById('TransactionStatusValue'),
    fee: await extractTextFromElementById('TransactionStatusFee').catch(() => undefined),
    confirmations: await extractTextFromElementById('TransactionStatusConfirmations'),
    to: await extractTextFromElementById('TransactionStatusTo').catch(() => undefined),
  };
  await element(by.id('TransactionDetailsButton')).tap();
  await waitForId('TransactionId');
  shown.txid = (await extractTextFromElementById('TransactionId')).trim();
  await device.pressBack();
  await waitForId('TransactionStatusValue');
  await device.pressBack();
  return shown;
}

/**
 * Checks a transaction as the app showed it against a public explorer: the value is what the wallet's addresses
 * received minus what they spent, the fee is inputs minus outputs, and the confirmation count matches the tip.
 * Returns the explorer's transaction.
 */
export async function expectTransactionMatchesExplorer(shown, walletAddresses) {
  const tx = await fetchJsonWithRetry(`https://mempool.space/api/tx/${shown.txid}`);
  const received = tx.vout.filter(out => walletAddresses.has(out.scriptpubkey_address)).reduce((sum, out) => sum + out.value, 0);
  const spent = tx.vin
    .filter(input => walletAddresses.has(input.prevout?.scriptpubkey_address))
    .reduce((sum, input) => sum + input.prevout.value, 0);
  assert.ok(received > 0 || spent > 0, `${shown.txid} touches none of the wallet's addresses`);
  assert.strictEqual(parseBtcSats(shown.value), received - spent, `value of ${shown.txid}`);
  assert.ok(shown.fee, `no fee shown for ${shown.txid}`);
  assert.strictEqual(parseBtcFeeSats(shown.fee), tx.fee, `fee of ${shown.txid}`);
  if (received < spent) {
    // An OP_RETURN first output has no address; the screen then has nothing to show as the recipient.
    assert.strictEqual(shown.to?.trim() || undefined, tx.vout[0].scriptpubkey_address, `recipient of ${shown.txid}`);
  }
  if (tx.status.confirmed) {
    const tip = await fetchJsonWithRetry('https://mempool.space/api/blocks/tip/height');
    const confirmations = tip - tx.status.block_height + 1;
    // The tip can move by a block between the app's lookup and this one.
    const expected = confirmations > 6 ? ['6+'] : [String(confirmations), String(confirmations - 1)];
    assert.ok(
      expected.some(count => shown.confirmations.startsWith(`${count} `)),
      `${shown.txid} shows "${shown.confirmations}", explorer has ${confirmations}`,
    );
  }
  return tx;
}

/** BIP84 receive and change addresses 0..count-1 of `mnemonic`. */
export function bip84Addresses(mnemonic, count) {
  const account = bip32.fromSeed(bip39.mnemonicToSeedSync(mnemonic)).derivePath("m/84'/0'/0'");
  const addresses = new Set();
  for (const chain of [0, 1]) {
    const node = account.derive(chain);
    for (let index = 0; index < count; index++) {
      addresses.add(bitcoin.payments.p2wpkh({ pubkey: Buffer.from(node.derive(index).publicKey) }).address);
    }
  }
  return addresses;
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

/** A mainnet BOLT11 invoice signed with a throwaway key: it decodes like a real one but nobody can settle it. */
export function unpayableInvoice(sats, description) {
  const encoded = bolt11.encode({
    satoshis: sats,
    timestamp: Math.floor(Date.now() / 1000),
    tags: [
      { tagName: 'payment_hash', data: randomBytes(32).toString('hex') },
      { tagName: 'payment_secret', data: randomBytes(32).toString('hex') },
      { tagName: 'description', data: description },
      { tagName: 'expire_time', data: 3600 },
    ],
  });
  return bolt11.sign(encoded, randomBytes(32).toString('hex')).paymentRequest;
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

/** Relaunches the app and returns the Lightning wallet balance in sats, read on its wallet screen. */
export async function readLightningBalance() {
  await device.launchApp({ newInstance: true });
  await waitForId('LightningWalletRow', 300_000);
  await element(by.id('LightningWalletRow')).tap();
  await waitForId('WalletBalance');
  return parseSats(await extractTextFromElementById('WalletBalance'));
}

/** Polls the Lightning balance until it differs from `before` (payments settle asynchronously). */
export async function waitForLightningBalanceChange(before) {
  let after = before;
  for (let i = 0; i < 12 && after === before; i++) {
    after = await readLightningBalance();
    if (after === before) await sleep(5000);
  }
  return after;
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

/** Feeds `text` to the open QR scanner through its hidden backdoor (six taps on ScanQrBackdoorButton). */
export async function scanText(text) {
  await waitForId('ScanQrBackdoorButton');
  for (let tap = 0; tap < 6; tap++) {
    await element(by.id('ScanQrBackdoorButton')).tap();
  }
  await waitForId('scanQrBackdoorInput');
  await element(by.id('scanQrBackdoorInput')).replaceText(text);
  await element(by.id('scanQrBackdoorOkButton')).tap();
}

/** Scans an animated (multi-part) UR code part by part and waits until the scanner closes. */
export async function scanUrParts(parts) {
  for (const part of parts.slice(0, -1)) {
    await scanText(part);
    await waitForId('UrProgressBar');
  }
  await scanText(parts[parts.length - 1]);
  await waitFor(element(by.id('ScanQrBackdoorButton')))
    .not.toBeVisible()
    .withTimeout(60_000);
}

/**
 * Leaves a fresh install on the Add Wallet screen with Advanced Mode on. Add Wallet is only reachable without
 * wallets, so this creates a wallet, turns Advanced Mode on and deletes the wallet again (the setting survives).
 */
export async function openAddWalletWithAdvancedMode() {
  await launchFresh();
  await createOnChainWallet();
  await element(by.id('Settings')).tap();
  await waitForId('GeneralSettings');
  await element(by.id('GeneralSettings')).tap();
  await waitForId('AdvancedMode');
  await element(by.id('AdvancedMode')).tap();
  await device.pressBack();
  await waitForId('WalletDetails');
  await element(by.id('WalletDetails')).tap();
  await waitForId('WalletDetailsScroll');
  await element(by.id('WalletDetailsScroll')).scrollTo('bottom');
  await element(by.id('DeleteButton')).tap();
  await waitForText('Yes, delete');
  await element(by.text('Yes, delete')).tap();
  await waitForId('Create');
}

/** Opens the recovery phrase of the main on-chain wallet and expects exactly these words in this order. */
export async function expectMainWalletPhrase(words) {
  await waitForId('Settings');
  await element(by.id('Settings')).tap();
  await waitForId('WalletDetails');
  await element(by.id('WalletDetails')).tap();
  await waitForId('WalletDetailsScroll');
  await waitFor(element(by.id('WalletExport')))
    .toBeVisible()
    .whileElement(by.id('WalletDetailsScroll'))
    .scroll(200, 'down');
  await element(by.id('WalletExport')).tap();
  await waitForId('WalletExportScroll');
  for (const [index, word] of words.entries()) {
    await expect(element(by.text(`${index + 1}. ${word}  `))).toExist();
  }
}
