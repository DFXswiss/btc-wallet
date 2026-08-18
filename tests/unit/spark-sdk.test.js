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
    assert.strictEqual(request.config.maxDepositClaimFee.tag, breez.MaxFee_Tags.Rate);
    assert.strictEqual(request.config.maxDepositClaimFee.inner.satPerVbyte, 10n);
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
    // Class/name only — not full Error.message (seed/key may appear there).
    for (const args of warn.mock.calls) {
      assert.ok(!String(args[1] || '').includes('listener gone'));
      assert.ok(!String(args[1] || '').includes('native down'));
      if (args[0] && String(args[0]).includes('disconnectSparkSdk')) {
        assert.strictEqual(args[1], 'Error');
      }
    }
    warn.mockRestore();
  });

  it('logs only the value kind when teardown rejects with a non-Error', async () => {
    mockInstance.removeEventListener.mockRejectedValueOnce('listener gone');
    mockInstance.disconnect.mockRejectedValueOnce('native down');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await connectSparkSdk('one two three four five six seven eight nine ten eleven about', async () => {});
    await disconnectSparkSdk();
    const kinds = warn.mock.calls.filter(args => String(args[0]).includes('disconnectSparkSdk')).map(args => args[1]);
    assert.ok(kinds.includes('string'));
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

  it('forwards SDK events through the registered listener', async () => {
    const onEvent = jest.fn().mockResolvedValue(undefined);
    await connectSparkSdk('one two three four five six seven eight nine ten eleven about', onEvent);
    const listener = mockInstance.addEventListener.mock.calls[0][0];
    const event = { tag: breez.SdkEvent_Tags.Synced };
    await listener.onEvent(event);
    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it('reuses the connected instance for the same seed without connecting again', async () => {
    const seed = 'one two three four five six seven eight nine ten eleven about';
    const first = await connectSparkSdk(seed);
    const second = await connectSparkSdk(seed);
    assert.strictEqual(first, second);
    expect(breez.connect).toHaveBeenCalledTimes(1);
    expect(mockInstance.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects and reconnects when the seed changes after a live session', async () => {
    const seedA = 'one two three four five six seven eight nine ten eleven about';
    const seedB = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const instanceB = {
      addEventListener: jest.fn().mockResolvedValue('listener-2'),
      removeEventListener: jest.fn().mockResolvedValue(true),
      disconnect: jest.fn().mockResolvedValue(undefined),
      syncWallet: jest.fn().mockResolvedValue({}),
    };
    breez.connect.mockResolvedValueOnce(mockInstance).mockResolvedValueOnce(instanceB);

    const first = await connectSparkSdk(seedA);
    const second = await connectSparkSdk(seedB);

    assert.strictEqual(first, mockInstance);
    assert.strictEqual(second, instanceB);
    expect(mockInstance.disconnect).toHaveBeenCalled();
    expect(breez.connect).toHaveBeenCalledTimes(2);
  });

  it('does not let a late listener registration overwrite the winning session', async () => {
    const seedA = 'one two three four five six seven eight nine ten eleven about';
    const seedB = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    let resolveAddA;
    let markAddAStarted;
    const addAStarted = new Promise(resolve => {
      markAddAStarted = resolve;
    });
    const instanceA = {
      addEventListener: jest.fn(
        () =>
          new Promise(resolve => {
            resolveAddA = resolve;
            markAddAStarted();
          }),
      ),
      removeEventListener: jest.fn().mockResolvedValue(true),
      disconnect: jest.fn().mockResolvedValue(undefined),
      syncWallet: jest.fn().mockResolvedValue({}),
    };
    const instanceB = {
      addEventListener: jest.fn().mockResolvedValue('listener-b'),
      removeEventListener: jest.fn().mockResolvedValue(true),
      disconnect: jest.fn().mockResolvedValue(undefined),
      syncWallet: jest.fn().mockResolvedValue({}),
    };
    breez.connect.mockResolvedValueOnce(instanceA).mockResolvedValueOnce(instanceB);

    const pendingA = connectSparkSdk(seedA, async () => {});
    await addAStarted;

    const resultB = await connectSparkSdk(seedB, async () => {});
    assert.strictEqual(resultB, instanceB);
    assert.strictEqual(getSparkSdk(), instanceB);

    resolveAddA('listener-a');
    await assert.rejects(pendingA, /superseded/);
    assert.strictEqual(getSparkSdk(), instanceB);
    expect(instanceA.removeEventListener).toHaveBeenCalledWith('listener-a');
    expect(instanceA.disconnect).toHaveBeenCalled();
    expect(instanceB.disconnect).not.toHaveBeenCalled();

    const again = await connectSparkSdk(seedB, async () => {});
    assert.strictEqual(again, instanceB);
    expect(breez.connect).toHaveBeenCalledTimes(2);
  });

  it('does not adopt an in-flight connect when a different seed arrives', async () => {
    const seedA = 'one two three four five six seven eight nine ten eleven about';
    const seedB = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const resolvers = [];
    breez.connect.mockImplementation(
      () =>
        new Promise(resolve => {
          resolvers.push(resolve);
        }),
    );
    const instanceA = {
      addEventListener: jest.fn().mockResolvedValue('listener-a'),
      removeEventListener: jest.fn().mockResolvedValue(true),
      disconnect: jest.fn().mockResolvedValue(undefined),
      syncWallet: jest.fn().mockResolvedValue({}),
    };
    const instanceB = {
      addEventListener: jest.fn().mockResolvedValue('listener-b'),
      removeEventListener: jest.fn().mockResolvedValue(true),
      disconnect: jest.fn().mockResolvedValue(undefined),
      syncWallet: jest.fn().mockResolvedValue({}),
    };

    const pendingA = connectSparkSdk(seedA);
    await Promise.resolve();
    assert.strictEqual(resolvers.length, 1);

    const pendingB = connectSparkSdk(seedB);
    await Promise.resolve();
    assert.strictEqual(resolvers.length, 2);

    resolvers[0](instanceA);
    resolvers[1](instanceB);

    const resultB = await pendingB;
    assert.strictEqual(resultB, instanceB);
    await assert.rejects(pendingA, /superseded/);
    expect(instanceA.disconnect).toHaveBeenCalled();
    expect(breez.connect).toHaveBeenCalledTimes(2);
  });

  it('clears a superseded connect without logging the seed fingerprint', async () => {
    const seedA = 'one two three four five six seven eight nine ten eleven about';
    const seedB = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const resolvers = [];
    breez.connect.mockImplementation(
      () =>
        new Promise(resolve => {
          resolvers.push(resolve);
        }),
    );
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    const pendingA = connectSparkSdk(seedA);
    await Promise.resolve();
    const pendingB = connectSparkSdk(seedB);
    await Promise.resolve();
    resolvers[0]({
      addEventListener: jest.fn().mockResolvedValue('a'),
      removeEventListener: jest.fn().mockResolvedValue(true),
      disconnect: jest.fn().mockRejectedValue(new Error('stale native')),
      syncWallet: jest.fn().mockResolvedValue({}),
    });
    resolvers[1](mockInstance);

    await pendingB;
    await assert.rejects(pendingA, /superseded/);
    for (const spy of [warn, error]) {
      for (const args of spy.mock.calls) {
        assert.ok(!String(args.join(' ')).includes(seedA));
        assert.ok(!String(args.join(' ')).includes(seedB));
      }
    }
    warn.mockRestore();
    error.mockRestore();
  });
});
