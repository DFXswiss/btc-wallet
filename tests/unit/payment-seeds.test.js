import assert from 'assert';

const STORAGE_KEY = 'sparkUnresolvedPaymentSeeds';

let seeds;
let tracker;
let AsyncStorage;

// The store keeps its state at module level, so every test starts from a fresh copy of it and its storage.
function load() {
  jest.resetModules();
  AsyncStorage = require('@react-native-async-storage/async-storage').default;
  tracker = require('../../api/spark/outgoing-payment');
  seeds = require('../../api/spark/payment-seeds');
}

beforeEach(async () => {
  load();
  await AsyncStorage.clear();
});

describe('Spark payment seeds', () => {
  it('reuses the seed of an unresolved payment and stores it', async () => {
    const first = await seeds.createSparkPaymentSeed({}, 'spark1dest', 1000, 'op-1');
    await seeds.keepUnresolvedSparkSeed({ current: first }, 'pid-1', 'hash-1');

    const again = await seeds.createSparkPaymentSeed({}, 'spark1dest', 1000, 'op-1');

    assert.strictEqual(again, first);
    assert.ok((await AsyncStorage.getItem(STORAGE_KEY)).includes(first));
  });

  it('gives a new seed once the previous one was forgotten, and clears the storage', async () => {
    const ref = {};
    const first = await seeds.createSparkPaymentSeed(ref, 'spark1dest', 1000, 'op-1');
    await seeds.forgetSparkPaymentSeed(ref);

    const next = await seeds.createSparkPaymentSeed({}, 'spark1dest', 1000, 'op-1');

    assert.notStrictEqual(next, first);
    assert.strictEqual(ref.current, undefined);
    await seeds.forgetSparkPaymentSeed({ current: next });
    assert.strictEqual(await AsyncStorage.getItem(STORAGE_KEY), null);
  });

  it('keeps an unresolved seed across an app restart', async () => {
    const first = await seeds.createSparkPaymentSeed({}, 'spark1dest', 1000, 'op-1');
    await seeds.keepUnresolvedSparkSeed({ current: first }, 'pid-1', 'hash-1');
    const stored = await AsyncStorage.getItem(STORAGE_KEY);

    load();
    await AsyncStorage.setItem(STORAGE_KEY, stored);

    assert.strictEqual(await seeds.createSparkPaymentSeed({}, 'spark1dest', 1000, 'op-1'), first);
  });

  it('drops the seed when its payment settles after the screen closed', async () => {
    const first = await seeds.createSparkPaymentSeed({}, 'spark1dest', 1000, 'op-1');
    await seeds.keepUnresolvedSparkSeed({ current: first }, 'pid-1', 'hash-1');

    tracker.beginOutgoingPayment({ paymentHash: 'hash-1', paymentId: 'pid-1' });
    tracker.settleOutgoingPayment({ status: 'completed', paymentHash: 'hash-1', paymentId: 'pid-1' });

    assert.notStrictEqual(await seeds.createSparkPaymentSeed({}, 'spark1dest', 1000, 'op-1'), first);
  });

  it('reuses the seed the screen still holds after the settlement dropped it from the store', async () => {
    // A tap between the settlement and the screen handling it must resend with the same key, or it pays twice.
    const ref = {};
    const first = await seeds.createSparkPaymentSeed(ref, 'spark1dest', 1000, 'op-1');
    await seeds.keepUnresolvedSparkSeed(ref, 'pid-1', 'hash-1');
    tracker.beginOutgoingPayment({ paymentHash: 'hash-1', paymentId: 'pid-1' });
    tracker.settleOutgoingPayment({ status: 'completed', paymentHash: 'hash-1', paymentId: 'pid-1' });

    assert.strictEqual(await seeds.createSparkPaymentSeed(ref, 'spark1dest', 1000, 'op-1'), first);
  });

  it('keeps the seed while the payment is still pending', async () => {
    const first = await seeds.createSparkPaymentSeed({}, 'spark1dest', 1000, 'op-1');
    await seeds.keepUnresolvedSparkSeed({ current: first }, 'pid-1', 'hash-1');

    tracker.beginOutgoingPayment({ paymentHash: 'hash-1', paymentId: 'pid-1' });

    assert.strictEqual(tracker.getOutgoingPayment().status, 'pending');
    assert.strictEqual(await seeds.createSparkPaymentSeed({}, 'spark1dest', 1000, 'op-1'), first);
  });

  it('mints no seed while the stored seeds cannot be read, and reads them again on the next attempt', async () => {
    const first = await seeds.createSparkPaymentSeed({}, 'spark1dest', 1000, 'op-1');
    await seeds.keepUnresolvedSparkSeed({ current: first }, 'pid-1', 'hash-1');
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    load();
    await AsyncStorage.setItem(STORAGE_KEY, stored);
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('storage down'));
    const ref = {};

    await assert.rejects(seeds.createSparkPaymentSeed(ref, 'spark1dest', 1000, 'op-1'), /storage down/);
    assert.strictEqual(ref.current, undefined);

    assert.strictEqual(await seeds.createSparkPaymentSeed(ref, 'spark1dest', 1000, 'op-1'), first);
  });

  it('gives two concurrent attempts at the same new payment one seed', async () => {
    const [first, second] = await Promise.all([
      seeds.createSparkPaymentSeed({}, 'spark1dest', 1000, 'op-1'),
      seeds.createSparkPaymentSeed({}, 'spark1dest', 1000, 'op-1'),
    ]);

    assert.strictEqual(second, first);
  });

  it('lets a second attempt share the outcome while the first seed is still being saved', async () => {
    let failSave;
    const saveStarted = new Promise(resolve => {
      jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            failSave = reject;
            resolve();
          }),
      );
    });
    const first = seeds.createSparkPaymentSeed({}, 'spark1dest', 1000, 'op-1');
    await saveStarted;
    const second = seeds.createSparkPaymentSeed({}, 'spark1dest', 1000, 'op-1');
    await new Promise(resolve => setImmediate(resolve));

    failSave(new Error('storage full'));

    await assert.rejects(first, /storage full/);
    await assert.rejects(second, /storage full/);
    assert.strictEqual(seeds.isUnsentSparkSeed(await seeds.createSparkPaymentSeed({}, 'spark1dest', 1000, 'op-1')), true);
    assert.ok((await AsyncStorage.getItem(STORAGE_KEY)).length > 0);
  });

  it('tells whether a seed was never handed to the SDK', async () => {
    const ref = {};
    const seed = await seeds.createSparkPaymentSeed(ref, 'spark1dest', 1000, 'op-1');
    assert.strictEqual(seeds.isUnsentSparkSeed(seed), true);

    await seeds.keepUnresolvedSparkSeed(ref);

    assert.strictEqual(seeds.isUnsentSparkSeed(seed), false);
    assert.strictEqual(seeds.isUnsentSparkSeed(undefined), false);
  });
});
