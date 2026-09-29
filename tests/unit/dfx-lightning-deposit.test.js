import assert from 'assert';
import { bech32m } from 'bech32';
import '../../class';
import { lightningDepositPayParams } from '../../helpers/dfxLightningDeposit';
import { SparkWallet } from '../../class/wallets/spark-wallet';
import { LightningLdsWallet } from '../../class/wallets/lightning-lds-wallet';

const SPARK_ADDRESS = bech32m.encode('spark', bech32m.toWords(Buffer.from('spark-address-identity-key-32')), 10000);
const LNURL = 'LNURL1DP68GURN8GHJ7MRWW4EXCTNXD9SHG6NPVCHXXMMD9AKXUATJDSKHQCTE8AEK2UMND9HKU0TZXSCKXCTRVDJKXDMZ';

const wallet = (type, id) => ({ type, getID: () => id });

describe('lightningDepositPayParams', () => {
  it('pays a Spark deposit address directly from a Spark wallet, tied to the route', () => {
    assert.deepStrictEqual(lightningDepositPayParams(wallet(SparkWallet.type, 'spark-1'), SPARK_ADDRESS, 1000, '7'), {
      sparkAddress: SPARK_ADDRESS,
      walletID: 'spark-1',
      amountSat: 1000,
      routeId: '7',
    });
  });

  it('pays a Spark invoice deposit directly, unwrapped from its spark: URI', () => {
    const invoice = bech32m.encode('spark', bech32m.toWords(Buffer.from('reusable sats invoice')), 10000);
    assert.deepStrictEqual(lightningDepositPayParams(wallet(SparkWallet.type, 'spark-1'), `spark:${invoice}?amount=0.00001`, 1000, '7'), {
      sparkInvoice: invoice,
      walletID: 'spark-1',
      amountSat: 1000,
      routeId: '7',
    });
  });

  it('pays an LNURL deposit from a Spark wallet like any Lightning wallet', () => {
    assert.deepStrictEqual(lightningDepositPayParams(wallet(SparkWallet.type, 'spark-1'), LNURL, 1000, '7'), {
      lnurl: LNURL,
      walletID: 'spark-1',
      amountSat: 1000,
    });
  });

  it('never takes the Spark path for a lightning.space wallet', () => {
    assert.deepStrictEqual(lightningDepositPayParams(wallet(LightningLdsWallet.type, 'lds-1'), SPARK_ADDRESS, 1000, '7'), {
      lnurl: SPARK_ADDRESS,
      walletID: 'lds-1',
      amountSat: 1000,
    });
  });
});
