/* global device, element, by, waitFor */
import assert from 'assert';
import BIP32Factory from 'bip32';
import * as bip39 from 'bip39';
import * as bitcoin from 'bitcoinjs-lib';
import bitcoinMessage from 'bitcoinjs-message';

import ecc from '../../blue_modules/noble_ecc';
import { expectMainWalletPhrase, extractTextFromElementById, launchFresh, speedImport, waitForId } from './helperz';

const bip32 = BIP32Factory(ecc);
// SLIP-132 version bytes for a BIP84 account public key (zpub).
const ZPUB_NETWORK = { ...bitcoin.networks.bitcoin, bip32: { public: 0x04b24746, private: 0x04b2430c } };

async function openWalletDetails() {
  await device.launchApp({ newInstance: true });
  await waitForId('Settings');
  await element(by.id('Settings')).tap();
  await waitForId('WalletDetails');
  await element(by.id('WalletDetails')).tap();
  await waitForId('WalletDetailsScroll');
}

/** An address row reads "<position> <address>". */
async function shownAddress(id) {
  return (await extractTextFromElementById(id)).trim().split(/\s+/).pop();
}

async function tapInDetails(id) {
  await waitFor(element(by.id(id)))
    .toBeVisible()
    .whileElement(by.id('WalletDetailsScroll'))
    .scroll(200, 'down');
  await element(by.id(id)).tap();
}

describe('Wallet details', () => {
  const mnemonic = bip39.generateMnemonic(128);
  const account = bip32.fromSeed(bip39.mnemonicToSeedSync(mnemonic), ZPUB_NETWORK).derivePath("m/84'/0'/0'");
  const address = (chain, index) => bitcoin.payments.p2wpkh({ pubkey: Buffer.from(account.derive(chain).derive(index).publicKey) }).address;
  const firstAddress = address(0, 0);

  beforeAll(async () => {
    await launchFresh();
    await speedImport(mnemonic);
  });

  it('exports exactly the imported recovery phrase', async () => {
    await expectMainWalletPhrase(mnemonic.split(' '));
  });

  it('shows the zpub of the BIP84 account', async () => {
    await openWalletDetails();
    await tapInDetails('XPub');
    await waitForId('AddressValue');
    assert.strictEqual(await extractTextFromElementById('AddressValue'), account.neutered().toBase58());
  });

  it('signs a message that verifies against the first receive address', async () => {
    const message = 'dfx e2e sign test';
    await openWalletDetails();
    await tapInDetails('SignVerify');
    await waitForId('SignAddress');
    await element(by.id('SignAddress')).replaceText(firstAddress);
    await element(by.id('Message')).replaceText(message);
    await element(by.id('SignButton')).tap();
    let signature = '';
    for (let attempt = 0; attempt < 20 && !signature; attempt++) {
      signature = (await extractTextFromElementById('Signature')).trim();
      if (!signature) await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.ok(signature, 'no signature was produced');
    assert.ok(bitcoinMessage.verify(message, firstAddress, signature, null, true), 'signature does not verify for the address');
  });

  it('lists the receive and change addresses derived from the phrase', async () => {
    await openWalletDetails();
    await tapInDetails('ShowAddresses');
    for (const index of [0, 1, 2]) {
      await waitFor(element(by.id(`AddressReceive${index}`)))
        .toExist()
        .withTimeout(60_000);
      assert.strictEqual(await shownAddress(`AddressReceive${index}`), address(0, index));
    }
    await element(by.id('AddressTabChange')).tap();
    await waitForId('AddressChange0');
    assert.strictEqual(await shownAddress('AddressChange0'), address(1, 0));
  });
});
