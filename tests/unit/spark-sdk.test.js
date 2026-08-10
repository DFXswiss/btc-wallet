import assert from 'assert';
import Config from 'react-native-config';
import {
  connectSparkSdk,
  disconnectSparkSdk,
  getSparkSdk,
  isSparkSdkConnected,
  requireSparkSdk,
  syncSparkWallet,
  __resetSparkSdkForTests,
  BREEZ_API_KEY_MISSING,
} from '../../api/spark/spark-sdk';

const breez = require('@breeztech/breez-sdk-spark-react-native');

const mockInstance = {
  addEventListener: jest.fn().mockResolvedValue('listener-1'),
  removeEventListener: jest.fn().mockResolvedValue(true),
  disconnect: jest.fn().mockResolvedValue(undefined),
  syncWallet: jest.fn().mockResolvedValue({}),
};

beforeEach(() => {
  jest.clearAllMocks();
  __resetSparkSdkForTests();
  Config.BREEZ_API_KEY = 'test-api-key';
  breez.defaultConfig.mockReturnValue({ apiKey: undefined, network: breez.Network.Mainnet, lnurlDomain: undefined });
  breez.connect.mockResolvedValue(mockInstance);
});

afterEach(async () => {
  await disconnectSparkSdk();
  __resetSparkSdkForTests();
});

describe('spark-sdk', () => {
  it('connects once with mnemonic seed, mainnet config and Breez API key', async () => {
    const onEvent = jest.fn();
    const instance = await connectSparkSdk('word '.repeat(11) + 'about', onEvent);

    assert.strictEqual(instance, mockInstance);
    expect(breez.defaultConfig).toHaveBeenCalledWith(breez.Network.Mainnet);
    expect(breez.connect).toHaveBeenCalledTimes(1);
    const request = breez.connect.mock.calls[0][0];
    assert.strictEqual(request.config.apiKey, 'test-api-key');
    assert.ok(String(request.storageDir).includes('breezSdkSpark'));
    assert.ok(request.seed);
    // Must not set a custom LNURL domain.
    assert.strictEqual(request.config.lnurlDomain, undefined);
    expect(mockInstance.addEventListener).toHaveBeenCalled();
    assert.strictEqual(isSparkSdkConnected(), true);
    assert.strictEqual(getSparkSdk(), mockInstance);
    assert.strictEqual(requireSparkSdk(), mockInstance);
  });

  it('reuses the same connection on a second call', async () => {
    await connectSparkSdk('one two three four five six seven eight nine ten eleven about');
    await connectSparkSdk('one two three four five six seven eight nine ten eleven about');
    expect(breez.connect).toHaveBeenCalledTimes(1);
  });

  it('fails loudly when BREEZ_API_KEY is missing', async () => {
    delete Config.BREEZ_API_KEY;
    await assert.rejects(
      () => connectSparkSdk('one two three four five six seven eight nine ten eleven about'),
      err => {
        assert.ok(String(err.message).includes('BREEZ_API_KEY'));
        assert.strictEqual(err.message, BREEZ_API_KEY_MISSING);
        return true;
      },
    );
    assert.strictEqual(isSparkSdkConnected(), false);
  });

  it('requireSparkSdk throws when not connected', () => {
    assert.throws(() => requireSparkSdk(), /not connected/);
  });

  it('disconnect clears the session', async () => {
    await connectSparkSdk('one two three four five six seven eight nine ten eleven about', async () => {});
    await disconnectSparkSdk();
    assert.strictEqual(isSparkSdkConnected(), false);
    expect(mockInstance.disconnect).toHaveBeenCalled();
    expect(mockInstance.removeEventListener).toHaveBeenCalledWith('listener-1');
  });

  it('logs and swallows teardown failures instead of throwing', async () => {
    mockInstance.removeEventListener.mockRejectedValueOnce(new Error('listener gone'));
    mockInstance.disconnect.mockRejectedValueOnce(new Error('native down'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await connectSparkSdk('one two three four five six seven eight nine ten eleven about', async () => {});
    await disconnectSparkSdk();
    assert.strictEqual(isSparkSdkConnected(), false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('syncSparkWallet is a no-op when disconnected and calls sync when connected', async () => {
    await syncSparkWallet();
    expect(mockInstance.syncWallet).not.toHaveBeenCalled();
    await connectSparkSdk('one two three four five six seven eight nine ten eleven about');
    await syncSparkWallet();
    expect(mockInstance.syncWallet).toHaveBeenCalledWith({});
  });

  it('clears state when connect fails', async () => {
    breez.connect.mockRejectedValueOnce(new Error('network down'));
    await assert.rejects(() => connectSparkSdk('one two three four five six seven eight nine ten eleven about'), /network down/);
    assert.strictEqual(isSparkSdkConnected(), false);
    assert.throws(() => requireSparkSdk(), /not connected/);
  });

  it('shares an in-flight connect promise between concurrent callers', async () => {
    let resolveConnect;
    breez.connect.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveConnect = resolve;
        }),
    );
    const a = connectSparkSdk('one two three four five six seven eight nine ten eleven about');
    const b = connectSparkSdk('one two three four five six seven eight nine ten eleven about');
    resolveConnect(mockInstance);
    const [ia, ib] = await Promise.all([a, b]);
    assert.strictEqual(ia, ib);
    expect(breez.connect).toHaveBeenCalledTimes(1);
  });

  it('disconnect is safe when never connected', async () => {
    await disconnectSparkSdk();
    assert.strictEqual(isSparkSdkConnected(), false);
  });

  it('connects without an event listener when none is provided', async () => {
    await connectSparkSdk('one two three four five six seven eight nine ten eleven about');
    expect(mockInstance.addEventListener).not.toHaveBeenCalled();
  });
});
