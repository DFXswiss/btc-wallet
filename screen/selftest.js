import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { ScrollView, View, StyleSheet, Linking, Platform } from 'react-native';
import wif from 'wif';
import bip38 from 'bip38';
import BIP32Factory from 'bip32';

import loc from '../loc';
import { BlueSpacing20, SafeBlueArea, BlueCard, BlueText, BlueLoading, BlueButton } from '../BlueComponents';
import navigationStyle from '../components/navigationStyle';
import {
  SegwitP2SHWallet,
  LegacyWallet,
  HDSegwitP2SHWallet,
  HDSegwitBech32Wallet,
  HDAezeedWallet,
  SLIP39LegacyP2PKHWallet,
  MultisigHDWallet,
} from '../class';
import { findCosignerIndexForSeed } from '../class/multisig-cosigner-match';
import ecc from '../blue_modules/noble_ecc';
const bitcoin = require('bitcoinjs-lib');
const BlueCrypto = require('react-native-blue-crypto');
const encryption = require('../blue_modules/encryption');
const BlueElectrum = require('../blue_modules/BlueElectrum');
const bip32 = BIP32Factory(ecc);
const fs = require('../blue_modules/fs');

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
  },
  logsContainer: {
    marginTop: 12,
    padding: 10,
    borderRadius: 6,
    backgroundColor: '#111',
    maxHeight: 320,
  },
  logLine: {
    color: '#ddd',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    lineHeight: 15,
  },
});

export default class Selftest extends Component {
  constructor(props) {
    super(props);
    this.state = {
      started: false,
      isLoading: false,
      logs: [],
    };
  }

  onPressSaveToStorage = () => {
    fs.writeFileAndExport('bluewallet-storagesave-test.txt', 'Success');
  };

  appendLog = line => {
    console.log(line);
    this.setState(prev => ({ logs: [...prev.logs, line] }));
  };

  runSelfTest = async () => {
    this.setState({
      started: true,
      isLoading: true,
      isOk: undefined,
      errorMessage: '',
      logs: [],
    });

    let errorMessage = '';
    let isOk = true;

    const isRN = typeof navigator !== 'undefined' && navigator.product === 'ReactNative';
    const log = this.appendLog;
    const step = async (name, fn) => {
      const t0 = Date.now();
      log(`→ ${name}`);
      try {
        const result = await fn();
        log(`✓ ${name} (${Date.now() - t0}ms)`);
        return result;
      } catch (e) {
        log(`✗ ${name} (${Date.now() - t0}ms): ${e?.message || e}`);
        throw e;
      }
    };

    log('starting');
    const tStart = Date.now();

    try {
      if (isRN) {
        await step('SegwitP2SHWallet.generate x1000 (unique secrets)', async () => {
          const uniqs = {};
          const w = new SegwitP2SHWallet();
          for (let c = 0; c < 1000; c++) {
            await w.generate();
            if (uniqs[w.getSecret()]) {
              throw new Error('failed to generate unique private key');
            }
            uniqs[w.getSecret()] = 1;
          }
        });
      } else {
        log('- SegwitP2SHWallet.generate: skipped (not RN)');
      }

      if (isRN) {
        await step('BlueElectrum connect + balance/txs', async () => {
          await BlueElectrum.ping();
          await BlueElectrum.waitTillConnected();
          const addr4elect = '3GCvDBAktgQQtsbN6x5DYiQCMmgZ9Yk8BK';
          const electrumBalance = await BlueElectrum.getBalanceByAddress(addr4elect);
          if (electrumBalance.confirmed !== 51432)
            throw new Error('BlueElectrum getBalanceByAddress failure, got ' + JSON.stringify(electrumBalance));

          const electrumTxs = await BlueElectrum.getTransactionsByAddress(addr4elect);
          if (electrumTxs.length !== 1)
            throw new Error('BlueElectrum getTransactionsByAddress failure, got ' + JSON.stringify(electrumTxs));
        });
      } else {
        log('- BlueElectrum: skipped (not RN)');
      }

      if (isRN) {
        await step('HDAezeedWallet validate + derive', async () => {
          const aezeed = new HDAezeedWallet();
          aezeed.setSecret(
            'abstract rhythm weird food attract treat mosquito sight royal actor surround ride strike remove guilt catch filter summer mushroom protect poverty cruel chaos pattern',
          );
          assertStrictEqual(await aezeed.validateMnemonicAsync(), true, 'Aezeed failed');
          assertStrictEqual(aezeed._getExternalAddressByIndex(0), 'bc1qdjj7lhj9lnjye7xq3dzv3r4z0cta294xy78txn', 'Aezeed failed');
        });
      } else {
        log('- HDAezeedWallet: skipped (not RN)');
      }

      await step('LegacyWallet create + sign tx', async () => {
        const l = new LegacyWallet();
        l.setSecret('L4ccWrPMmFDZw4kzAKFqJNxgHANjdy6b7YKNXMwB4xac4FLF3Tov');
        assertStrictEqual(l.getAddress(), '14YZ6iymQtBVQJk6gKnLCk49UScJK7SH4M');
        const utxos = [
          {
            txid: 'cc44e933a094296d9fe424ad7306f16916253a3d154d52e4f1a757c18242cec4',
            vout: 0,
            value: 100000,
            txhex:
              '0200000000010161890cd52770c150da4d7d190920f43b9f88e7660c565a5a5ad141abb6de09de00000000000000008002a0860100000000001976a91426e01119d265aa980390c49eece923976c218f1588ac3e17000000000000160014c1af8c9dd85e0e55a532a952282604f820746fcd02473044022072b3f28808943c6aa588dd7a4e8f29fad7357a2814e05d6c5d767eb6b307b4e6022067bc6a8df2dbee43c87b8ce9ddd9fe678e00e0f7ae6690d5cb81eca6170c47e8012102e8fba5643e15ab70ec79528833a2c51338c1114c4eebc348a235b1a3e13ab07100000000',
          },
        ];

        const txNew = l.createTransaction(utxos, [{ value: 90000, address: '1GX36PGBUrF8XahZEGQqHqnJGW2vCZteoB' }], 1, l.getAddress());
        const txBitcoin = bitcoin.Transaction.fromHex(txNew.tx.toHex());
        assertStrictEqual(
          txNew.tx.toHex(),
          '0200000001c4ce4282c157a7f1e4524d153d3a251669f10673ad24e49f6d2994a033e944cc000000006b48304502210091e58bd2021f2eeea8d39d7f7b053c9ccc52a747b60f1c3584ba33285e2d150602205b2d35a2536cbe157015e8c54a26f5fc350cc7c72b5ca80b9e548917993f652201210337c09b3cb889801638078fd4e6998218b28c92d338ea2602720a88847aedceb3ffffffff02905f0100000000001976a914aa381cd428a4e91327fd4434aa0a08ff131f1a5a88ac2e260000000000001976a91426e01119d265aa980390c49eece923976c218f1588ac00000000',
        );
        assertStrictEqual(txBitcoin.ins.length, 1);
        assertStrictEqual(txBitcoin.outs.length, 2);
        assertStrictEqual('1GX36PGBUrF8XahZEGQqHqnJGW2vCZteoB', bitcoin.address.fromOutputScript(txBitcoin.outs[0].script));
        assertStrictEqual(l.getAddress(), bitcoin.address.fromOutputScript(txBitcoin.outs[1].script));
      });

      await step('SegwitP2SHWallet WIF → address', async () => {
        const l = new SegwitP2SHWallet();
        l.setSecret('Kxr9tQED9H44gCmp6HAdmemAzU3n84H3dGkuWTKvE23JgHMW8gct');
        if (l.getAddress() !== '34AgLJhwXrvmkZS1o5TrcdeevMt22Nar53') {
          throw new Error('failed to generate segwit P2SH address from WIF');
        }
      });

      await step('SegwitP2SHWallet create + sign tx', async () => {
        const wallet = new SegwitP2SHWallet();
        wallet.setSecret('Ky1vhqYGCiCbPd8nmbUeGfwLdXB1h5aGwxHwpXrzYRfY5cTZPDo4');
        assertStrictEqual(wallet.getAddress(), '3CKN8HTCews4rYJYsyub5hjAVm5g5VFdQJ');

        const utxos2 = [
          {
            txid: 'a56b44080cb606c0bd90e77fcd4fb34c863e68e5562e75b4386e611390eb860c',
            vout: 0,
            value: 300000,
          },
        ];

        const txNew2 = wallet.createTransaction(
          utxos2,
          [{ value: 90000, address: '1GX36PGBUrF8XahZEGQqHqnJGW2vCZteoB' }],
          1,
          wallet.getAddress(),
        );
        const tx = bitcoin.Transaction.fromHex(txNew2.tx.toHex());
        assertStrictEqual(
          txNew2.tx.toHex(),
          '020000000001010c86eb9013616e38b4752e56e5683e864cb34fcd7fe790bdc006b60c08446ba50000000017160014139dc70d73097f9d775f8a3280ba3e3435515641ffffffff02905f0100000000001976a914aa381cd428a4e91327fd4434aa0a08ff131f1a5a88aca73303000000000017a914749118baa93fb4b88c28909c8bf0a8202a0484f4870248304502210080545d30e3d30dff272ab11c91fd6150170b603239b48c3d56a3fa66bf240085022003762404e1b45975adc89f61ec1569fa19d6d4a8d405e060897754c489ebeade012103a5de146762f84055db3202c1316cd9008f16047f4f408c1482fdb108217eda0800000000',
        );
        assertStrictEqual(tx.ins.length, 1);
        assertStrictEqual(tx.outs.length, 2);
        assertStrictEqual('1GX36PGBUrF8XahZEGQqHqnJGW2vCZteoB', bitcoin.address.fromOutputScript(tx.outs[0].script));
        assertStrictEqual(bitcoin.address.fromOutputScript(tx.outs[1].script), wallet.getAddress());
      });

      await step('encryption encrypt/decrypt round-trip', async () => {
        const data2encrypt = 'really long data string';
        const crypted = encryption.encrypt(data2encrypt, 'password');
        const decrypted = encryption.decrypt(crypted, 'password');
        if (decrypted !== data2encrypt) {
          throw new Error('encryption lib is not ok');
        }
      });

      await step('bip39 + bip32 → bip49 address', async () => {
        const bip39 = require('bip39');
        const mnemonic =
          'honey risk juice trip orient galaxy win situate shoot anchor bounce remind horse traffic exotic since escape mimic ramp skin judge owner topple erode';
        const seed = bip39.mnemonicToSeedSync(mnemonic);
        const root = bip32.fromSeed(seed);

        const path = "m/49'/0'/0'/0/0";
        const child = root.derivePath(path);
        const address = bitcoin.payments.p2sh({
          redeem: bitcoin.payments.p2wpkh({
            pubkey: child.publicKey,
            network: bitcoin.networks.bitcoin,
          }),
          network: bitcoin.networks.bitcoin,
        }).address;

        if (address !== '3GcKN7q7gZuZ8eHygAhHrvPa5zZbG5Q1rK') {
          throw new Error('bip49 is not ok');
        }
      });

      if (isRN) {
        await step('HDSegwitP2SHWallet.generate x1000 + validate', async () => {
          const hd = new HDSegwitP2SHWallet();
          const hashmap = {};
          for (let c = 0; c < 1000; c++) {
            await hd.generate();
            const secret = hd.getSecret();
            if (hashmap[secret]) {
              throw new Error('Duplicate secret generated!');
            }
            hashmap[secret] = 1;
            if (secret.split(' ').length !== 12 && secret.split(' ').length !== 24) {
              throw new Error('mnemonic phrase not ok');
            }
          }

          const hd2 = new HDSegwitP2SHWallet();
          hd2.setSecret(hd.getSecret());
          if (!hd2.validateMnemonic()) {
            throw new Error('mnemonic phrase validation not ok');
          }
        });

        await step('HDSegwitBech32Wallet fetch balance + txs', async () => {
          const hd4 = new HDSegwitBech32Wallet();
          hd4._xpub = 'zpub6rnbAtzupLPpSrsBKRsHupFvv1h6pwfRnZxX3qs6RL4LiLqKQ6kfBaDckn2apQWfyw1D2TdQMMDCfUDHMwtrcbGoy88xoKBLmADTFK9AhLe';
          await hd4.fetchBalance();
          if (hd4.getBalance() !== 2400) throw new Error('Could not fetch HD Bech32 balance');
          await hd4.fetchTransactions();
          if (hd4.getTransactions().length !== 4) throw new Error('Could not fetch HD Bech32 transactions');
        });
      } else {
        log('- HDSegwit* tests: skipped (not RN)');
      }

      if (isRN) {
        await step('BlueCrypto.scrypt known vector', async () => {
          const hex = await BlueCrypto.scrypt('717765727479', '4749345a22b23cf3', 64, 8, 8, 32);
          if (hex.toUpperCase() !== 'F36AB2DC12377C788D61E6770126D8A01028C8F6D8FE01871CE0489A1F696A90')
            throw new Error('react-native-blue-crypto is not ok');
        });
      } else {
        log('- BlueCrypto.scrypt: skipped (not RN)');
      }

      if (isRN) {
        await step('bip38 decryptAsync (via BlueCrypto)', async () => {
          let callbackWasCalled = false;
          const decryptedKey = await bip38.decryptAsync(
            '6PnU5voARjBBykwSddwCdcn6Eu9EcsK24Gs5zWxbJbPZYW7eiYQP8XgKbN',
            'qwerty',
            () => (callbackWasCalled = true),
          );
          assertStrictEqual(
            wif.encode(0x80, decryptedKey.privateKey, decryptedKey.compressed),
            'KxqRtpd9vFju297ACPKHrGkgXuberTveZPXbRDiQ3MXZycSQYtjc',
            'bip38 failed',
          );
          assertStrictEqual(callbackWasCalled, false, "bip38 doesn't use BlueCrypto");
        });
      } else {
        log('- bip38: skipped (not RN)');
      }

      if (isRN) {
        await step('SLIP39LegacyP2PKHWallet derive', async () => {
          const w = new SLIP39LegacyP2PKHWallet();
          w.setSecret(
            'shadow pistol academic always adequate wildlife fancy gross oasis cylinder mustang wrist rescue view short owner flip making coding armed\n' +
              'shadow pistol academic acid actress prayer class unknown daughter sweater depict flip twice unkind craft early superior advocate guest smoking',
          );
          assertStrictEqual(w._getExternalAddressByIndex(0), '18pvMjy7AJbCDtv4TLYbGPbR7SzGzjqUpj', 'SLIP39 failed');
        });
      } else {
        log('- SLIP39: skipped (not RN)');
      }

      if (isRN) {
        await step('Linking.canOpenURL(https)', async () => {
          assertStrictEqual(await Linking.canOpenURL('https://github.com/BlueWallet/BlueWallet/'), true, 'Linking can not open https url');
        });
      } else {
        log('- Linking: skipped (not RN)');
      }

      await step('MultisigHDWallet P2WSH (native segwit) 2-of-3 create + fully sign tx', async () => {
        const { wallet, address, psbt, tx } = buildSignedMultisig('native');
        assertStrictEqual(address, 'bc1qqxuxfjvqcwyz3anmdptgj3rtas5c0w6h9p0yanqqx2yz0s25ceaqv9m44p', 'multisig native address');
        assertStrictEqual(wallet.calculateHowManySignaturesWeHaveFromPsbt(psbt), 2, 'multisig native sig count');
        assertStrictEqual(!!tx, true, 'multisig native tx not finalized');
        assertStrictEqual(
          tx.toHex(),
          '02000000000101674858a6180c3b8de3ff97c99118a43cc282d18d756b5b53aa8d70d673b52e9300000000000000008002905f0100000000001976a914aa381cd428a4e91327fd4434aa0a08ff131f1a5a88ac582600000000000022002035fa0b090f91f329cd5d96af493d593d0f454a8e8012526f8dcd5887e297ab0a0400483045022100b46ca1f3b336b0dcdd9304dbae7356de12b41ccd362206578e4fcbeb5976a2380220639b2de612084ca4880412452a8652e05070766b5884497e566b86cf85b98cbf0147304402205674ca71e69475a603b0470abd2b6e9b4715c28ddd44c93664adab033a1c49da022047aa6866fb08d6c68035b3e20d9f12453afaddd683ce3a8c72b02fb33801843001695221027ea237a4bcce5a375de67f7a094f5e9ab4fc466390e8f56658ed1c44488f84c82103d28f7015d5091c6a0dd4d84ff85c59eaf6d8d6795559da446eb2602fade078852103dc1953c2756c7c58d4f48ca1bbba767f414fd236bf4d662b67721ac626c514e053ae00000000',
          'multisig native tx hex',
        );
        const parsed = bitcoin.Transaction.fromHex(tx.toHex());
        assertStrictEqual(parsed.ins.length, 1, 'multisig native inputs');
        assertStrictEqual(parsed.outs.length, 2, 'multisig native outputs');
        assertStrictEqual(
          bitcoin.address.fromOutputScript(parsed.outs[0].script),
          '1GX36PGBUrF8XahZEGQqHqnJGW2vCZteoB',
          'multisig native recipient',
        );
      });

      await step('MultisigHDWallet P2SH-P2WSH (wrapped segwit) 2-of-3 create + fully sign tx', async () => {
        const { wallet, address, psbt, tx } = buildSignedMultisig('wrapped');
        assertStrictEqual(address, '3HF9PMvQvRgcjN54XXdLAJf8BF34txtd3t', 'multisig wrapped address');
        assertStrictEqual(wallet.calculateHowManySignaturesWeHaveFromPsbt(psbt), 2, 'multisig wrapped sig count');
        assertStrictEqual(!!tx, true, 'multisig wrapped tx not finalized');
        assertStrictEqual(
          tx.toHex(),
          '02000000000101c1d353f3fd6ae4462a2a577c6a6727569d054d43c39e7ea71e4083d519160ccb00000000232200209ef56844d943322c25447dcfb149070a1b1973b323e75f4f2f386ca54aea5eb50000008002905f0100000000001976a914aa381cd428a4e91327fd4434aa0a08ff131f1a5a88ac352600000000000017a91415d70ea28b1cc1714e0e18731ce85ecd7e4d31cd870400483045022100896c0b63e70d0bfb5892a244cfb9f7d7d20afe6422cc1ed1bca842f0987f8e9a02207298445a94942fb0a78a9d9cb3c7bea782ce86e3c62da3b146d17064cd15eca4014730440220496cddc837802f1a5a2f22094822d1b90ce9d76b3687e8f325451fe8100204340220565c0d2ea63bfb8737e5d9cdbdb38bd331ec57f8ad05c17dc61bd2664f63f7b90169522102b373a8edcc14f4ba3276635e6c9ac782202aa327e8de8a4618f8063f569324152103abe5ccc0a6ddf20e02e27ca4829a4bcf288849f5d137db19559dd2ab23236dbe2103ad59934d6296d1041357fe385a82b0d55d50fbfd8fad4ea6729b583c9294a21253ae00000000',
          'multisig wrapped tx hex',
        );
        const parsed = bitcoin.Transaction.fromHex(tx.toHex());
        assertStrictEqual(parsed.ins.length, 1, 'multisig wrapped inputs');
        assertStrictEqual(parsed.outs.length, 2, 'multisig wrapped outputs');
        assertStrictEqual(
          bitcoin.address.fromOutputScript(parsed.outs[0].script),
          '1GX36PGBUrF8XahZEGQqHqnJGW2vCZteoB',
          'multisig wrapped recipient',
        );
      });

      await step('MultisigHDWallet P2SH (legacy) 2-of-3 create + fully sign tx', async () => {
        const { wallet, address, psbt, tx } = buildSignedMultisig('legacy');
        assertStrictEqual(address, '37xAGrCeryNrNo6hSUxHQM6KqddrpY79vh', 'multisig legacy address');
        assertStrictEqual(wallet.calculateHowManySignaturesWeHaveFromPsbt(psbt), 2, 'multisig legacy sig count');
        assertStrictEqual(!!tx, true, 'multisig legacy tx not finalized');
        assertStrictEqual(
          tx.toHex(),
          '0200000001244e9b60cd50fc2e3d5effa0928928500160eb41439006b7b2a58f7410c9e7b000000000fdfe0000483045022100fe90a753908be0664041f6d097ffae2a06b9fdd857ebc9e8d4265195beecb524022017129a95d83923b8af6554b736b1fd8df45223f31d47f1202541b7f2f483e3550148304502210085970b3703d1f85c1e91ed39040f2a13e9b75c1a3cbadaeaf5891af71dc5b23f022059ae19e8ee187329430664b6be2e69b799ece6cbe87ffe4bc85a2a1450708cf6014c69522102928ce56c258522767df7385d9a5f4beaf599d310f52b510a4cf01c762749bb7a21034c2273445591185bb37ebb08010d53e85c3791e3fa56c1756284fdf17206a0102103bf9331688d29fff59100b437d3bdf4f14a671b1da13ce57d01eb5d109ab5d1c053ae0000008002905f0100000000001976a914aa381cd428a4e91327fd4434aa0a08ff131f1a5a88ac962500000000000017a914d48975225be4992d7cb576744a72e64b7ad6713e8700000000',
          'multisig legacy tx hex',
        );
        const parsed = bitcoin.Transaction.fromHex(tx.toHex());
        assertStrictEqual(parsed.ins.length, 1, 'multisig legacy inputs');
        assertStrictEqual(parsed.outs.length, 2, 'multisig legacy outputs');
        assertStrictEqual(
          bitcoin.address.fromOutputScript(parsed.outs[0].script),
          '1GX36PGBUrF8XahZEGQqHqnJGW2vCZteoB',
          'multisig legacy recipient',
        );
      });

      await step('MultisigHDWallet 2-of-3 single-device partial sign (1 of 2)', async () => {
        // realistic case: this device holds only its own seed; the other two cosigners are xpubs.
        // it can contribute one signature and must hand the PSBT to a second signer to finalize.
        const w = new MultisigHDWallet();
        w.setNativeSegwit();
        w.setDerivationPath(MULTISIG_PATHS.native);
        w.addCosigner(MULTISIG_SEED_1);
        w.addCosigner(
          MultisigHDWallet.seedToXpub(MULTISIG_SEED_2, MULTISIG_PATHS.native),
          MultisigHDWallet.mnemonicToFingerprint(MULTISIG_SEED_2, ''),
        );
        w.addCosigner(
          MultisigHDWallet.seedToXpub(MULTISIG_SEED_3, MULTISIG_PATHS.native),
          MultisigHDWallet.mnemonicToFingerprint(MULTISIG_SEED_3, ''),
        );
        w.setM(2);
        assertStrictEqual(
          w._getExternalAddressByIndex(0),
          'bc1qqxuxfjvqcwyz3anmdptgj3rtas5c0w6h9p0yanqqx2yz0s25ceaqv9m44p',
          'multisig partial address',
        );
        const { psbt, tx } = fundAndSpendMultisig(w);
        assertStrictEqual(w.calculateHowManySignaturesWeHaveFromPsbt(psbt), 1, 'multisig partial sig count');
        assertStrictEqual(psbt.data.inputs[0].partialSig.length, 1, 'multisig partial partialSig');
        assertStrictEqual(!!tx, false, 'multisig partial must not be finalized');
        assertStrictEqual(typeof psbt.toBase64(), 'string', 'multisig partial PSBT serializable');
      });

      await step('MultisigHDWallet export/import round-trip preserves addresses', async () => {
        const { wallet } = buildSignedMultisig('native');
        const imported = new MultisigHDWallet();
        imported.setSecret(wallet.getSecret());
        assertStrictEqual(imported._getExternalAddressByIndex(0), wallet._getExternalAddressByIndex(0), 'multisig round-trip external');
        assertStrictEqual(imported._getInternalAddressByIndex(0), wallet._getInternalAddressByIndex(0), 'multisig round-trip internal');
      });

      await step('MultisigHDWallet 2-of-3 cosigner with BIP39 passphrase -> address', async () => {
        const w = new MultisigHDWallet();
        w.setDerivationPath("m/48'/0'/0'/2'");
        w.addCosigner(
          'salon smoke bubble dolphin powder govern rival sport better arrest certain manual',
          undefined,
          undefined,
          '9WDdFSZX4d6mPxkr',
        );
        w.addCosigner('chaos word void picture gas update shop wave task blossom close inner', undefined, undefined, 'E5jMAzsf464Hgwns');
        w.addCosigner(
          'plate inform scissors pill asset scatter people emotion dose primary together expose',
          undefined,
          undefined,
          'RyBFfLr7weK3nDUG',
        );
        w.setM(2);
        assertStrictEqual(
          w._getExternalAddressByIndex(0),
          'bc1q8rks34ypj5edxx82f7z7yzy4qy6dynfhcftjs9axzr2ml37p4pfs7j4uvm',
          'multisig passphrase address',
        );
      });

      await step('MultisigHDWallet custom per-cosigner derivation paths -> address', async () => {
        const secret =
          '# CoboVault Multisig setup file (created on D37EAD88)\n#\nName: CV_33B5B91A_2-2\nPolicy: 2 of 2\nFormat: P2WSH\n\n' +
          "# derivation: m/47'/0'/0'/1'\n" +
          'D37EAD88: Zpub74ijpfhERJNjhCKXRspTdLJV5eoEmSRZdHqDvp9kVtdVEyiXk7pXxRbfZzQvsDFpfDHEHVtVpx4Dz9DGUWGn2Xk5zG5u45QTMsYS2vjohNQ\n\n' +
          "# derivation: m/46'/0'/0'/1'\n" +
          '168DD603: Zpub75mAE8EjyxSzoyPmGnd5E6MyD7ALGNndruWv52xpzimZQKukwvEfXTHqmH8nbbc6ccP5t2aM3mws3pKYSnKpKMMytdbNEZFUxKzztYFM8Pn\n';
        const w = new MultisigHDWallet();
        w.setSecret(secret);
        assertStrictEqual(w.getCustomDerivationPathForCosigner(1), "m/47'/0'/0'/1'", 'multisig custom path 1');
        assertStrictEqual(w.getCustomDerivationPathForCosigner(2), "m/46'/0'/0'/1'", 'multisig custom path 2');
        assertStrictEqual(
          w._getExternalAddressByIndex(0),
          'bc1qxzrzh4caw7e3genwtldtxntzj0ktfl7mhf2lh4fj8h7hnkvtvc4salvp85',
          'multisig custom-path address',
        );
      });

      await step('Multisig cosigner match: own seed recognised in xpub-only config', async () => {
        const source = buildSignedMultisig('native').wallet;
        const config = new MultisigHDWallet();
        config.setSecret(source.getXpub()); // public coordination setup, no private keys
        assertStrictEqual(findCosignerIndexForSeed(config, MULTISIG_SEED_1), 1, 'cosigner match seed 1');
        assertStrictEqual(findCosignerIndexForSeed(config, MULTISIG_SEED_2), 2, 'cosigner match seed 2');
        assertStrictEqual(findCosignerIndexForSeed(config, MULTISIG_SEED_3), 3, 'cosigner match seed 3');
        assertStrictEqual(
          findCosignerIndexForSeed(config, 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art'),
          -1,
          'cosigner match rejects stranger',
        );
      });

      await step('Multisig real wallet: import coordination setup + reconstruct & sign the actual on-chain withdrawal', async () => {
        const w = new MultisigHDWallet();
        w.setSecret(REAL_MULTISIG_COORD);
        assertStrictEqual(w.getM() + '/' + w.getN(), '2/3', 'real multisig policy');
        // the throwaway seed is cosigner 3 of this vault
        assertStrictEqual(findCosignerIndexForSeed(w, REAL_MULTISIG_SEED), 3, 'real wallet cosigner index');
        assertStrictEqual(w.getFingerprint(3), '3D0C4290', 'real wallet cosigner fingerprint');
        // the wallet derives the address the deposit actually paid to
        assertStrictEqual(w._getExternalAddressByIndex(0), REAL_DEPOSIT.address, 'real wallet deposit address');

        // load our seed and rebuild the exact withdrawal that was broadcast
        w.replaceCosignerXpubWithSeed(3, REAL_MULTISIG_SEED, '');
        const { psbt } = w.createTransaction(
          [REAL_DEPOSIT],
          [{ address: REAL_WITHDRAW_DEST, value: 43662 }],
          2,
          w._getInternalAddressByIndex(0),
          0xffffffff,
          true, // skip signing; we cosign below
        );
        const unsigned = bitcoin.Transaction.fromBuffer(psbt.data.globalMap.unsignedTx.toBuffer());
        assertStrictEqual(unsigned.getId(), REAL_WITHDRAW_TXID, 'reconstructed withdrawal must match the broadcast txid');

        // sign as cosigner 3 and confirm it reproduces the real on-chain signature
        w.cosignPsbt(psbt);
        const partialSig = psbt.data.inputs[0].partialSig || [];
        assertStrictEqual(partialSig.length, 1, 'one signature (2-of-3, single device)');
        assertStrictEqual(partialSig[0].signature.toString('hex'), REAL_WITHDRAW_SIG, 'reproduces the real cosigner-3 signature');
      });

      if (isRN && __DEV__) {
        await step('Multisig real wallet: Electrum sees the on-chain withdrawal', async () => {
          await BlueElectrum.waitTillConnected();
          // confirmed tx -> stays in history forever even though the wallet is now empty (drift-proof)
          const txs = await BlueElectrum.getTransactionsByAddress(REAL_DEPOSIT.address);
          const found = txs.some(t => t.tx_hash === REAL_WITHDRAW_TXID);
          if (!found) throw new Error('withdrawal tx not found in multisig address history');
        });
      } else {
        log('- Multisig Electrum history: skipped (live-network, __DEV__ only)');
      }

      log(`all tests passed in ${Date.now() - tStart}ms`);
    } catch (Err) {
      errorMessage += Err;
      isOk = false;
      log(`stopped after ${Date.now() - tStart}ms: ${Err?.message || Err}`);
    }

    this.setState({
      isLoading: false,
      isOk,
      errorMessage,
    });
  };

  renderResult() {
    if (!this.state.started) return null;
    if (this.state.isLoading) return <BlueLoading />;
    if (this.state.isOk) {
      return (
        <View style={styles.center}>
          <BlueText testID="SelfTestOk" h4>
            OK
          </BlueText>
          <BlueSpacing20 />
          <BlueText>{loc.settings.about_selftest_ok}</BlueText>
        </View>
      );
    }
    return (
      <View style={styles.center}>
        <BlueText h4 numberOfLines={0}>
          {this.state.errorMessage}
        </BlueText>
      </View>
    );
  }

  renderLogs() {
    const { logs } = this.state;
    if (!logs || logs.length === 0) return null;
    return (
      <ScrollView
        ref={ref => (this._logsScrollRef = ref)}
        onContentSizeChange={() => this._logsScrollRef?.scrollToEnd({ animated: false })}
        style={styles.logsContainer}
      >
        {logs.map((line, idx) => (
          <BlueText key={idx} style={styles.logLine}>
            {line}
          </BlueText>
        ))}
      </ScrollView>
    );
  }

  render() {
    return (
      <SafeBlueArea>
        <BlueCard>
          <ScrollView>
            <BlueSpacing20 />
            {this.renderResult()}
            {this.renderLogs()}
            {!this.state.isLoading && (
              <>
                <BlueSpacing20 />
                <BlueButton
                  title={this.state.started ? 'Run self-test again' : 'Run self-test'}
                  onPress={this.runSelfTest}
                  testID="SelfTestLoading"
                />
                {Platform.OS === 'android' && (
                  <>
                    <BlueSpacing20 />
                    <BlueButton title="Test Save to Storage" onPress={this.onPressSaveToStorage} />
                  </>
                )}
              </>
            )}
          </ScrollView>
        </BlueCard>
      </SafeBlueArea>
    );
  }
}

const MULTISIG_SEED_1 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const MULTISIG_SEED_2 = 'chaos word void picture gas update shop wave task blossom close inner';
const MULTISIG_SEED_3 = 'plate inform scissors pill asset scatter people emotion dose primary together expose';
const MULTISIG_PATHS = { native: "m/48'/0'/0'/2'", wrapped: "m/48'/0'/0'/1'", legacy: "m/45'" };

// --- Real (throwaway) multisig used by the on-chain diagnostics below. ---
// These keys are committed ON PURPOSE: the wallet is a 2-of-3 burner that was funded once,
// emptied, and must NEVER be funded again. Do not treat the seed below as a real secret.
const REAL_MULTISIG_SEED = 'sand tone actor sell tone rough install divert decrease assist erode rice'; // cosigner 3 (fp 3D0C4290)
const REAL_MULTISIG_COORD =
  "# BlueWallet Multisig setup file\n# this file contains only public keys and is safe to\n# distribute among cosigners\n#\nName: Multisig Vault\nPolicy: 2 of 3\nDerivation: m/48'/0'/0'/2'\nFormat: P2WSH\n\nC20EF17C: xpub6EddsFof5PpmSjPrUkSBGPFD8JdFcLL5jV9J2TgRzHtdTFR47eZn4bAKUQviqZv2RqBKPyYX78zLXrWWE8UkGmL8UyZJS7rn2CGqViMjQQi\n\n426222B6: Zpub74dh4k2u2m27KG5x7Dw3KCJen7f1NRa4ikofK13u8k8Sos7pru1aZSkZSr7TyYQBHn6orV4cqvLbcQ7BQdFUJEKTsCYmoeb6uFc4sTeFgUY\n\n3D0C4290: Zpub74s3GBiqviXUzq2WFueBSVgWPLHNNvTbeed8rzwZMewpcvmUtAPNv84gMJPgGStCL3pyLGqoaH1CpbS4MhXNLNwTgEWPhgmryF1NQg3CJBn\n\n";
const REAL_DEPOSIT = {
  txId: 'a817cc0da4c0edce6c4fcdd7d94acf741aaa439dc5b54d1c84099c4ec0d9e1e9',
  txid: 'a817cc0da4c0edce6c4fcdd7d94acf741aaa439dc5b54d1c84099c4ec0d9e1e9',
  vout: 0,
  value: 44112,
  address: 'bc1qgv72gjdadr9rmf5fxwdagpqczxv089a8ykjy9tuuq40kc4x94w6s7d73am', // external[0]
  txhex:
    '02000000000101993fc3a83e6597b6c032ecc86e81d2c5edaec2d803b86c0fdbadc57e2341c6e20100000000fdffffff0150ac000000000000220020433ca449bd68ca3da689339bd404181198f397a725a442af9c055f6c54c5abb50140fb95c93998aeb9e85c86802d509799bac1fddf03f19c85d262a3883b2f61688b9b11e849f3410c324f96ad17f2195657dd66fae876fc76cb6bc471db0d1f70f900000000',
};
const REAL_WITHDRAW_DEST = 'bc1q00etgmkyxp4tvw7hham0hzh80hex2hyl2f5nv88hmffd0qx7lkjspm8aln';
const REAL_WITHDRAW_TXID = '441f7d6d3c9dd71d5c005ccdf5bad272cd858bff63057b2f7985be3faf756575';
// cosigner 3's real signature in the broadcast witness for the input above
const REAL_WITHDRAW_SIG =
  '3045022100f815bee168ad1407a7ec03bbcde53bbfbb0e92cc4b9f1fffb173266ebddd1da2022052f9fcd687dd71a234553bf20a287c263ce0ff9e1e957fc05a9374ee70d8fa5401';

function setMultisigFormat(w, kind) {
  if (kind === 'native') w.setNativeSegwit();
  else if (kind === 'wrapped') w.setWrappedSegwit();
  else w.setLegacy();
}

// funds a multisig wallet with a synthetic prev-tx and spends it (so signing needs no network)
function fundAndSpendMultisig(w) {
  const address = w._getExternalAddressByIndex(0);
  const funding = new bitcoin.Transaction();
  funding.addInput(Buffer.from('00'.repeat(32), 'hex'), 0);
  funding.addOutput(bitcoin.address.toOutputScript(address, bitcoin.networks.bitcoin), 100000);
  const utxos = [{ txId: funding.getId(), txid: funding.getId(), vout: 0, value: 100000, address, txhex: funding.toHex() }];
  const { psbt, tx } = w.createTransaction(
    utxos,
    [{ address: '1GX36PGBUrF8XahZEGQqHqnJGW2vCZteoB', value: 90000 }],
    1,
    w._getInternalAddressByIndex(0),
    false,
    false,
  );
  return { address, psbt, tx };
}

// 2-of-3 (the wallet's default policy) holding 2 seeds + 1 watch-only cosigner -> fully signs
function buildSignedMultisig(kind) {
  const w = new MultisigHDWallet();
  setMultisigFormat(w, kind);
  w.setDerivationPath(MULTISIG_PATHS[kind]); // must precede addCosigner() for seed cosigners
  w.addCosigner(MULTISIG_SEED_1);
  w.addCosigner(MULTISIG_SEED_2);
  w.addCosigner(
    MultisigHDWallet.seedToXpub(MULTISIG_SEED_3, MULTISIG_PATHS[kind]),
    MultisigHDWallet.mnemonicToFingerprint(MULTISIG_SEED_3, ''),
  );
  w.setM(2);
  return { wallet: w, ...fundAndSpendMultisig(w) };
}

function assertStrictEqual(actual, expected, message) {
  if (expected !== actual) {
    if (message) throw new Error(message);
    throw new Error('Assertion failed that ' + JSON.stringify(expected) + ' equals ' + JSON.stringify(actual));
  }
}

Selftest.propTypes = {
  navigation: PropTypes.shape({
    navigate: PropTypes.func,
    goBack: PropTypes.func,
  }),
};

Selftest.navigationOptions = navigationStyle({
  title: loc.settings.selfTest,
});
