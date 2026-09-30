import assert from 'assert';
import { bech32m } from 'bech32';
import AsyncStorage from '@react-native-async-storage/async-storage';
import '../../class';
import { lightningDepositPayParams, sparkMaxDepositSats } from '../../helpers/dfxLightningDeposit';
import { SparkWallet } from '../../class/wallets/spark-wallet';
import { LightningLdsWallet } from '../../class/wallets/lightning-lds-wallet';
import { DfxService } from '../../api/dfx/contexts/session.context';
import { DfxMaxAmount } from '../../helpers/dfxMaxAmount';

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

  it('adds isMax to an LNURL deposit when paying the Spark max', () => {
    assert.deepStrictEqual(lightningDepositPayParams(wallet(SparkWallet.type, 'spark-1'), LNURL, 1000, '7', true), {
      lnurl: LNURL,
      walletID: 'spark-1',
      amountSat: 1000,
      isMax: true,
    });
  });

  it('never adds isMax to a Spark address deposit', () => {
    assert.deepStrictEqual(lightningDepositPayParams(wallet(SparkWallet.type, 'spark-1'), SPARK_ADDRESS, 1000, '7', true), {
      sparkAddress: SPARK_ADDRESS,
      walletID: 'spark-1',
      amountSat: 1000,
      routeId: '7',
    });
  });
});

describe('sparkMaxDepositSats', () => {
  afterEach(async () => {
    await AsyncStorage.clear();
  });

  function makeSpark(balance) {
    return {
      type: SparkWallet.type,
      getID: () => 'spark-1',
      getBalance: jest.fn(() => balance),
      fetchBalance: jest.fn().mockResolvedValue(undefined),
    };
  }

  it('returns the whole Spark balance when the confirmed amount is the remembered max', async () => {
    const w = makeSpark(123456);
    await DfxMaxAmount.remember('spark-1', DfxService.SELL, 123456, 123456);
    const result = await sparkMaxDepositSats(w, DfxService.SELL, '0.0012345');
    assert.strictEqual(result, 123456);
    assert.strictEqual(w.fetchBalance.mock.calls.length, 1);
  });

  it('returns undefined for a smaller typed amount', async () => {
    const w = makeSpark(123456);
    await DfxMaxAmount.remember('spark-1', DfxService.SELL, 123456, 123456);
    const result = await sparkMaxDepositSats(w, DfxService.SELL, '0.0005');
    assert.strictEqual(result, undefined);
  });

  it('returns undefined when the balance changed after remember', async () => {
    const w = makeSpark(200000);
    await DfxMaxAmount.remember('spark-1', DfxService.SELL, 123456, 123456);
    const result = await sparkMaxDepositSats(w, DfxService.SELL, '0.0012345');
    assert.strictEqual(result, undefined);
  });

  it('returns undefined when remembered for a different service', async () => {
    const w = makeSpark(123456);
    await DfxMaxAmount.remember('spark-1', DfxService.SELL, 123456, 123456);
    const result = await sparkMaxDepositSats(w, DfxService.SWAP, '0.0012345');
    assert.strictEqual(result, undefined);
  });

  it('returns undefined for an LNbits wallet without consulting balance', async () => {
    await DfxMaxAmount.remember('lds-1', DfxService.SELL, 123456, 123456);
    const fetchBalance = jest.fn();
    const getBalance = jest.fn();
    const w = {
      type: LightningLdsWallet.type,
      getID: () => 'lds-1',
      getBalance,
      fetchBalance,
    };
    const result = await sparkMaxDepositSats(w, DfxService.SELL, '0.0012345');
    assert.strictEqual(result, undefined);
    assert.strictEqual(fetchBalance.mock.calls.length, 0);
    assert.strictEqual(getBalance.mock.calls.length, 0);
  });
});
