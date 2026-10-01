/* global device, element, by, waitFor */
import assert from 'assert';
import * as bip39 from 'bip39';
import * as bitcoin from 'bitcoinjs-lib';

import ecc from '../../blue_modules/noble_ecc';
import { extractTextFromElementById, launchFresh, scanText, speedImport, waitForId, waitForText } from './helperz';
import { NATIVE_SEGWIT_PATH, cosignerKey, expectedVault } from './multisig-keys';

const DESTINATION = 'bc1q063ctu6jhe5k4v8ka99qac8rcm2tzjjnuktyrl';

/** A PSBT spending the vault's first receive output (a made-up UTXO; nothing is broadcast), signed by `signer`. */
function psbtSignedBy(keys, signer) {
  const vault = expectedVault(keys);
  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
  psbt.addInput({
    hash: 'ab'.repeat(32),
    index: 0,
    witnessUtxo: { script: vault.output, value: 100_000 },
    witnessScript: vault.redeem.output,
    bip32Derivation: keys.map(key => ({
      masterFingerprint: key.fingerprint,
      path: `${NATIVE_SEGWIT_PATH}/0/0`,
      pubkey: key.receivePubkey,
    })),
  });
  psbt.addOutput({ address: DESTINATION, value: 90_000 });
  psbt.signInput(0, signer.receiveNode);
  return psbt;
}

describe('Multisig vault', () => {
  const mainMnemonic = bip39.generateMnemonic(128);
  const cosignerMnemonics = [bip39.generateMnemonic(128), bip39.generateMnemonic(128)];
  const keys = [cosignerKey(mainMnemonic), ...cosignerMnemonics.map(cosignerKey)];

  beforeAll(async () => {
    await launchFresh();
    await speedImport(mainMnemonic);
  });

  it('creates a 2-of-3 native segwit vault from the main seed and two scanned cosigners', async () => {
    await element(by.id('MultisigWalletRowAdd')).tap();
    await waitForId('LetsStart');
    await element(by.id('LetsStart')).tap();

    await waitForId('CreateButton');
    for (const key of keys.slice(1)) {
      await scanText(JSON.stringify({ xfp: key.xfp, xpub: key.xpub, path: NATIVE_SEGWIT_PATH }));
    }
    await element(by.id('CreateButton')).tap();

    await waitForId('MultisigWalletRow', 120_000);
    await element(by.id('MultisigWalletRow')).tap();
    await waitForId('ReceiveButton');
    await element(by.id('ReceiveButton')).tap();
    await waitForId('AddressValue');
    assert.strictEqual(await extractTextFromElementById('AddressValue'), expectedVault(keys).address);
  });

  it('shows the quorum, all three cosigners and a coordination setup with their fingerprints', async () => {
    await device.launchApp({ newInstance: true });
    await waitForId('Settings');
    await element(by.id('Settings')).tap();
    await waitForId('WalletDetailsMultisig');
    await element(by.id('WalletDetailsMultisig')).tap();
    await waitForId('WalletDetailsScroll');
    await waitForText('2 / 3 (native segwit)');

    await waitFor(element(by.id('MultisigCoordinationSetup')))
      .toBeVisible()
      .whileElement(by.id('WalletDetailsScroll'))
      .scroll(150, 'down');
    await element(by.id('MultisigCoordinationSetup')).tap();
    // The setup screen animates a QR code on a timer, which never lets the app go idle.
    await device.disableSynchronization();
    try {
      await waitFor(element(by.id('MultisigCoordinationSetupText')))
        .toExist()
        .withTimeout(60_000);
      const setup = await extractTextFromElementById('MultisigCoordinationSetupText');
      for (const key of keys) {
        assert.ok(setup.toUpperCase().includes(key.xfp), `coordination setup lacks fingerprint ${key.xfp}`);
      }
      assert.ok(setup.includes(NATIVE_SEGWIT_PATH), 'coordination setup lacks the derivation path');
      await device.pressBack();
    } finally {
      await device.enableSynchronization();
    }

    await waitForId('WalletDetailsScroll');
    await waitFor(element(by.id('ViewEditCosigners')))
      .toBeVisible()
      .whileElement(by.id('WalletDetailsScroll'))
      .scroll(150, 'down');
    await element(by.id('ViewEditCosigners')).tap();
    for (const number of [1, 2, 3]) {
      await waitFor(element(by.text(`Vault Key ${number}`)))
        .toExist()
        .withTimeout(30_000);
    }
  });

  it('signs its share of a PSBT another cosigner already signed, completing the 2-of-3 quorum', async () => {
    const [ownKey, otherKey] = keys;
    const psbt = psbtSignedBy(keys, otherKey);

    await device.launchApp({ newInstance: true });
    await waitForId('HomeScanButton');
    await element(by.id('HomeScanButton')).tap();
    await scanText(psbt.toBase64());
    await waitForId('PsbtMultisigSignButton', 60_000);
    const before = bitcoin.Psbt.fromHex((await extractTextFromElementById('PsbtMultisigHex')).trim());
    assert.strictEqual(before.data.inputs[0].partialSig.length, 1, "the PSBT should arrive with only the other cosigner's signature");
    await element(by.id('PsbtMultisigSignButton')).tap();

    // A complete quorum is finalized right away: the signatures move from partialSig into the final witness.
    let signed;
    for (let attempt = 0; attempt < 30 && !signed; attempt++) {
      const candidate = bitcoin.Psbt.fromHex((await extractTextFromElementById('PsbtMultisigHex')).trim());
      if (candidate.data.inputs[0].finalScriptWitness) signed = candidate;
      else await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.ok(signed, "the PSBT was never finalized with the vault's signature");
    const confirm = await element(by.id('PsbtMultisigConfirmButton')).getAttributes();
    assert.strictEqual(confirm.enabled, true, 'Send now must be enabled once the quorum is complete');

    const tx = signed.extractTransaction();
    const vault = expectedVault(keys);
    // P2WSH multisig witness: empty item for CHECKMULTISIG, the signatures, then the witness script.
    const witness = tx.ins[0].witness;
    assert.strictEqual(Buffer.from(witness[witness.length - 1]).toString('hex'), vault.redeem.output.toString('hex'));
    const signatures = witness.slice(1, -1).map(item => bitcoin.script.signature.decode(Buffer.from(item)));
    assert.strictEqual(signatures.length, 2);
    const signingPubkeys = signatures.map(({ signature, hashType }) => {
      const hash = tx.hashForWitnessV0(0, vault.redeem.output, 100_000, hashType);
      return keys.find(key => ecc.verify(hash, key.receivePubkey, signature));
    });
    assert.ok(signingPubkeys.includes(ownKey), "no valid signature from the vault's own key");
    assert.ok(signingPubkeys.includes(otherKey), 'no valid signature from the other cosigner');

    assert.strictEqual(tx.outs.length, 1);
    assert.strictEqual(bitcoin.address.fromOutputScript(tx.outs[0].script), DESTINATION);
    assert.strictEqual(Number(tx.outs[0].value), 90_000);
  });
});
