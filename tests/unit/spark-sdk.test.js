import assert from 'assert';
import Config from 'react-native-config';
import {
  acquireSparkSessionLease,
  connectSparkSdk,
  disconnectSparkSdk,
  isSparkSdkConnected,
  SparkSessionStaleError,
  SparkLifecycleHungError,
  syncSparkWallet,
  __resetSparkSdkForTests,
  __setLifecycleTimeoutMsForTests,
  BREEZ_API_KEY_MISSING,
} from '../../api/spark/spark-sdk';

const breez = require('@breeztech/breez-sdk-spark-react-native');

function makeSdkInstance(id = '1') {
  return {
    addEventListener: jest.fn().mockResolvedValue(`listener-${id}`),
    removeEventListener: jest.fn().mockResolvedValue(true),
    disconnect: jest.fn().mockResolvedValue(undefined),
    syncWallet: jest.fn().mockResolvedValue({}),
    getInfo: jest.fn().mockResolvedValue({ identityPubkey: `identity-${id}`, balanceSats: 0n }),
  };
}

const mockInstance = makeSdkInstance('1');

beforeEach(() => {
  jest.clearAllMocks();
  __resetSparkSdkForTests();
  Config.BREEZ_API_KEY = 'test-api-key';
  mockInstance.addEventListener.mockReset().mockResolvedValue('listener-1');
  mockInstance.removeEventListener.mockReset().mockResolvedValue(true);
  mockInstance.disconnect.mockReset().mockResolvedValue(undefined);
  mockInstance.syncWallet.mockReset().mockResolvedValue({});
  mockInstance.getInfo.mockReset().mockResolvedValue({ identityPubkey: 'identity-1', balanceSats: 0n });
  breez.defaultConfig.mockReturnValue({ apiKey: undefined, network: breez.Network.Mainnet, lnurlDomain: undefined });
  breez.connect.mockReset();
  breez.connect.mockResolvedValue(mockInstance);
});

afterEach(async () => {
  try {
    await Promise.race([disconnectSparkSdk(), new Promise(resolve => setTimeout(resolve, 1000))]);
  } finally {
    __resetSparkSdkForTests();
  }
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
    const lease = acquireSparkSessionLease();
    assert.strictEqual(lease.requireSdk(), mockInstance);
    assert.strictEqual(lease.identity, 'identity-1');
    expect(mockInstance.getInfo).toHaveBeenCalledWith({ ensureSynced: false });
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

  it('disconnect clears the session', async () => {
    await connectSparkSdk('one two three four five six seven eight nine ten eleven about', async () => {});
    await disconnectSparkSdk();
    assert.strictEqual(isSparkSdkConnected(), false);
    assert.throws(() => acquireSparkSessionLease(), /not connected/);
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
    assert.throws(() => acquireSparkSessionLease(), /not connected/);
  });

  it('clears state when getInfo fails after native connect', async () => {
    mockInstance.getInfo.mockRejectedValueOnce(new Error('info down'));
    await assert.rejects(() => connectSparkSdk('one two three four five six seven eight nine ten eleven about'), /info down/);
    assert.strictEqual(isSparkSdkConnected(), false);
    assert.throws(() => acquireSparkSessionLease(), /not connected/);
    expect(mockInstance.disconnect).toHaveBeenCalled();
  });

  it('disconnects the native instance when addEventListener fails after connect', async () => {
    mockInstance.addEventListener.mockRejectedValueOnce(new Error('listener down'));
    await assert.rejects(
      () => connectSparkSdk('one two three four five six seven eight nine ten eleven about', async () => {}),
      /listener down/,
    );
    assert.strictEqual(isSparkSdkConnected(), false);
    expect(mockInstance.disconnect).toHaveBeenCalled();
    expect(mockInstance.removeEventListener).not.toHaveBeenCalled();
  });

  it('rethrows the original error when post-connect teardown also fails', async () => {
    mockInstance.getInfo.mockRejectedValueOnce(new Error('info down'));
    mockInstance.disconnect.mockRejectedValueOnce(new Error('teardown down'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await assert.rejects(() => connectSparkSdk('one two three four five six seven eight nine ten eleven about'), /info down/);
    expect(mockInstance.disconnect).toHaveBeenCalled();
    const connectWarns = warn.mock.calls.filter(args => String(args[0]).includes('connectSparkSdk: disconnect failed'));
    assert.strictEqual(connectWarns.length, 1);
    assert.strictEqual(connectWarns[0][1], 'Error');
    assert.ok(!String(connectWarns[0][1]).includes('teardown down'));
    assert.ok(!String(connectWarns[0][1]).includes('info down'));
    warn.mockRestore();
  });

  it('logs only the value kind when post-connect teardown rejects with a non-Error', async () => {
    mockInstance.getInfo.mockRejectedValueOnce(new Error('info down'));
    mockInstance.disconnect.mockRejectedValueOnce('teardown down');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await assert.rejects(() => connectSparkSdk('one two three four five six seven eight nine ten eleven about'), /info down/);
    const kinds = warn.mock.calls.filter(args => String(args[0]).includes('connectSparkSdk: disconnect failed')).map(args => args[1]);
    assert.ok(kinds.includes('string'));
    warn.mockRestore();
  });

  it('disconnect after a live listener still logs only the class when removeEventListener fails', async () => {
    mockInstance.removeEventListener.mockRejectedValueOnce(new Error('listener gone'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await connectSparkSdk('one two three four five six seven eight nine ten eleven about', async () => {});
    await disconnectSparkSdk();
    expect(mockInstance.removeEventListener).toHaveBeenCalledWith('listener-1');
    const listenerWarns = warn.mock.calls.filter(args => String(args[0]).includes('disconnectSparkSdk: removeEventListener failed'));
    assert.strictEqual(listenerWarns.length, 1);
    assert.strictEqual(listenerWarns[0][1], 'Error');
    warn.mockRestore();
  });

  it('shares an in-flight connect between concurrent callers of the same seed', async () => {
    let resolveConnect;
    let markStarted;
    const started = new Promise(resolve => {
      markStarted = resolve;
    });
    breez.connect.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveConnect = resolve;
          markStarted();
        }),
    );
    const a = connectSparkSdk('one two three four five six seven eight nine ten eleven about');
    const b = connectSparkSdk('one two three four five six seven eight nine ten eleven about');
    await started;
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
    const instanceB = makeSdkInstance('2');
    breez.connect.mockResolvedValueOnce(mockInstance).mockResolvedValueOnce(instanceB);

    const first = await connectSparkSdk(seedA);
    const second = await connectSparkSdk(seedB);

    assert.strictEqual(first, mockInstance);
    assert.strictEqual(second, instanceB);
    expect(mockInstance.disconnect).toHaveBeenCalled();
    expect(breez.connect).toHaveBeenCalledTimes(2);
    assert.strictEqual(acquireSparkSessionLease().identity, 'identity-2');
  });

  it('finishes an in-flight connect before a queued disconnect tears it down', async () => {
    const seedA = 'one two three four five six seven eight nine ten eleven about';
    let resolveConnect;
    let markConnectStarted;
    const connectStarted = new Promise(resolve => {
      markConnectStarted = resolve;
    });
    const instanceA = makeSdkInstance('a');
    breez.connect.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveConnect = resolve;
          markConnectStarted();
        }),
    );

    const pendingA = connectSparkSdk(seedA);
    await connectStarted;
    const pendingDisc = disconnectSparkSdk();
    resolveConnect(instanceA);
    const result = await pendingA;
    await pendingDisc;
    assert.strictEqual(result, instanceA);
    assert.strictEqual(isSparkSdkConnected(), false);
    assert.throws(() => acquireSparkSessionLease(), /not connected/);
    expect(instanceA.disconnect).toHaveBeenCalled();
  });

  it('finishes listener registration before a queued disconnect removes it', async () => {
    const seedA = 'one two three four five six seven eight nine ten eleven about';
    let resolveAddA;
    let markAddAStarted;
    const addAStarted = new Promise(resolve => {
      markAddAStarted = resolve;
    });
    const instanceA = makeSdkInstance('a');
    instanceA.addEventListener.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveAddA = resolve;
          markAddAStarted();
        }),
    );
    breez.connect.mockResolvedValue(instanceA);

    const pendingA = connectSparkSdk(seedA, async () => {});
    await addAStarted;
    const pendingDisc = disconnectSparkSdk();
    resolveAddA('listener-a');
    await pendingA;
    await pendingDisc;
    assert.strictEqual(isSparkSdkConnected(), false);
    assert.throws(() => acquireSparkSessionLease(), /not connected/);
    expect(instanceA.removeEventListener).toHaveBeenCalledWith('listener-a');
    expect(instanceA.disconnect).toHaveBeenCalled();
  });

  it('finishes getInfo before a queued disconnect tears the instance down', async () => {
    const seedA = 'one two three four five six seven eight nine ten eleven about';
    let resolveInfo;
    let markInfoStarted;
    const infoStarted = new Promise(resolve => {
      markInfoStarted = resolve;
    });
    const instanceA = makeSdkInstance('a');
    instanceA.getInfo.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveInfo = resolve;
          markInfoStarted();
        }),
    );
    breez.connect.mockResolvedValue(instanceA);

    const pendingA = connectSparkSdk(seedA);
    await infoStarted;
    const pendingDisc = disconnectSparkSdk();
    resolveInfo({ identityPubkey: 'late', balanceSats: 0n });
    await pendingA;
    await pendingDisc;
    assert.strictEqual(isSparkSdkConnected(), false);
    assert.throws(() => acquireSparkSessionLease(), /not connected/);
    expect(instanceA.disconnect).toHaveBeenCalled();
  });

  it('does not start a native connect while a previous session is still tearing down', async () => {
    const seed = 'one two three four five six seven eight nine ten eleven about';
    const seedB = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    await connectSparkSdk(seed);
    expect(breez.connect).toHaveBeenCalledTimes(1);

    let releaseDisconnect;
    mockInstance.disconnect.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          releaseDisconnect = resolve;
        }),
    );
    const instanceB = makeSdkInstance('b');
    breez.connect.mockResolvedValueOnce(instanceB);

    const pendingDisconnect = disconnectSparkSdk();
    const pendingConnect = connectSparkSdk(seedB);
    await Promise.resolve();
    await Promise.resolve();
    expect(breez.connect).toHaveBeenCalledTimes(1);

    releaseDisconnect();
    await pendingDisconnect;
    const next = await pendingConnect;
    assert.strictEqual(next, instanceB);
    expect(breez.connect).toHaveBeenCalledTimes(2);
  });

  it('starts a different-seed connect only after the in-flight connect finishes and is disconnected', async () => {
    const seedA = 'one two three four five six seven eight nine ten eleven about';
    const seedB = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const instanceA = makeSdkInstance('a');
    const instanceB = makeSdkInstance('b');
    const order = [];
    let resolveConnectA;
    breez.connect.mockImplementation(() => {
      if (breez.connect.mock.calls.length === 1) {
        return new Promise(resolve => {
          resolveConnectA = () => resolve(instanceA);
        });
      }
      order.push('b-started');
      return Promise.resolve(instanceB);
    });
    instanceA.disconnect.mockImplementation(async () => {
      order.push('a-disconnected');
    });

    const pendingA = connectSparkSdk(seedA);
    await Promise.resolve();
    assert.strictEqual(breez.connect.mock.calls.length, 1);

    const pendingB = connectSparkSdk(seedB);
    await Promise.resolve();
    assert.strictEqual(breez.connect.mock.calls.length, 1);

    resolveConnectA();
    const resultA = await pendingA;
    const resultB = await pendingB;
    assert.strictEqual(resultA, instanceA);
    assert.strictEqual(resultB, instanceB);
    expect(breez.connect).toHaveBeenCalledTimes(2);
    expect(instanceA.disconnect).toHaveBeenCalled();
    assert.ok(order.indexOf('a-disconnected') >= 0);
    assert.ok(order.indexOf('b-started') >= 0);
    assert.ok(order.indexOf('a-disconnected') < order.indexOf('b-started'));
    assert.strictEqual(acquireSparkSessionLease().identity, 'identity-b');
  });

  it('replaces a finished session without logging the seed fingerprint', async () => {
    const seedA = 'one two three four five six seven eight nine ten eleven about';
    const seedB = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    let resolveConnectA;
    const instanceA = makeSdkInstance('a');
    instanceA.disconnect.mockRejectedValue(new Error('stale native'));
    breez.connect.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveConnectA = resolve;
        }),
    );
    breez.connect.mockResolvedValueOnce(mockInstance);

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    const pendingA = connectSparkSdk(seedA);
    await Promise.resolve();
    const pendingB = connectSparkSdk(seedB);
    await Promise.resolve();
    expect(breez.connect).toHaveBeenCalledTimes(1);
    resolveConnectA(instanceA);

    await pendingA;
    await assert.rejects(pendingB, /previous session is still open/);
    for (const spy of [warn, error]) {
      for (const args of spy.mock.calls) {
        assert.ok(!String(args.join(' ')).includes(seedA));
        assert.ok(!String(args.join(' ')).includes(seedB));
      }
    }
    warn.mockRestore();
    error.mockRestore();
  });

  it('does not start a second native connect while the first connect is still running', async () => {
    const seed = 'one two three four five six seven eight nine ten eleven about';
    const seedB = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const instanceB = makeSdkInstance('b');
    let releaseConnect;
    breez.connect.mockImplementation(() => {
      if (breez.connect.mock.calls.length === 1) {
        return new Promise(resolve => {
          releaseConnect = () => resolve(mockInstance);
        });
      }
      return Promise.resolve(instanceB);
    });

    const pendingA = connectSparkSdk(seed);
    await Promise.resolve();
    const pendingDisc = disconnectSparkSdk();
    const pendingB = connectSparkSdk(seedB);
    await Promise.resolve();
    expect(breez.connect).toHaveBeenCalledTimes(1);

    releaseConnect();
    await pendingA;
    await pendingDisc;
    await pendingB;
    expect(breez.connect).toHaveBeenCalledTimes(2);
    expect(mockInstance.disconnect).toHaveBeenCalled();
    assert.strictEqual(acquireSparkSessionLease().requireSdk(), instanceB);
  });

  it('keeps only the last of two overlapping connects with different seeds', async () => {
    const seedA = 'one two three four five six seven eight nine ten eleven about';
    const seedB = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const instanceA = makeSdkInstance('a');
    const instanceB = makeSdkInstance('b');
    breez.connect.mockImplementation(() => {
      if (breez.connect.mock.calls.length === 1) {
        return Promise.resolve(instanceA);
      }
      return Promise.resolve(instanceB);
    });

    const pendingA = connectSparkSdk(seedA);
    const pendingB = connectSparkSdk(seedB);
    await Promise.all([pendingA, pendingB]);
    expect(breez.connect).toHaveBeenCalledTimes(2);
    expect(instanceA.disconnect).toHaveBeenCalled();
    const live = acquireSparkSessionLease();
    assert.strictEqual(live.requireSdk(), instanceB);
    assert.strictEqual(live.identity, 'identity-b');
  });

  it('tears down a poisoned session before the next native connect', async () => {
    const seed = 'one two three four five six seven eight nine ten eleven about';
    const seedB = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const instanceA = makeSdkInstance('a');
    const instanceB = makeSdkInstance('b');
    breez.connect.mockResolvedValueOnce(instanceA);
    await connectSparkSdk(seed);

    instanceA.disconnect.mockRejectedValueOnce(new Error('native down'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await disconnectSparkSdk();
    assert.strictEqual(isSparkSdkConnected(), false);
    warn.mockRestore();

    const order = [];
    instanceA.disconnect.mockImplementation(async () => {
      order.push('teardown');
    });
    breez.connect.mockImplementation(() => {
      order.push('connect');
      return Promise.resolve(instanceB);
    });

    const next = await connectSparkSdk(seedB);
    assert.strictEqual(next, instanceB);
    assert.deepStrictEqual(order, ['teardown', 'connect']);
  });

  it('does not open a second session when poisoned teardown fails again', async () => {
    const seed = 'one two three four five six seven eight nine ten eleven about';
    await connectSparkSdk(seed);
    mockInstance.disconnect.mockRejectedValue(new Error('still held'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await disconnectSparkSdk();
    await assert.rejects(() => connectSparkSdk(seed), /previous session is still open/);
    expect(breez.connect).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('retries removeEventListener and disconnect after a poisoned teardown and then connects', async () => {
    const seed = 'one two three four five six seven eight nine ten eleven about';
    const seedB = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    await connectSparkSdk(seed, async () => {});
    mockInstance.removeEventListener.mockRejectedValueOnce(new Error('listener held'));
    mockInstance.disconnect.mockRejectedValueOnce(new Error('native down'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await disconnectSparkSdk();
    assert.strictEqual(isSparkSdkConnected(), false);
    expect(mockInstance.removeEventListener).toHaveBeenCalledWith('listener-1');
    expect(mockInstance.removeEventListener).toHaveBeenCalledTimes(1);
    expect(mockInstance.disconnect).toHaveBeenCalledTimes(1);
    warn.mockRestore();

    const instanceB = makeSdkInstance('b');
    const order = [];
    mockInstance.removeEventListener.mockImplementation(async () => {
      order.push('remove');
    });
    mockInstance.disconnect.mockImplementation(async () => {
      order.push('disconnect');
    });
    breez.connect.mockImplementation(() => {
      order.push('connect');
      return Promise.resolve(instanceB);
    });

    const next = await connectSparkSdk(seedB);
    assert.strictEqual(next, instanceB);
    assert.strictEqual(isSparkSdkConnected(), true);
    assert.deepStrictEqual(order, ['remove', 'disconnect', 'connect']);
    expect(mockInstance.removeEventListener).toHaveBeenCalledWith('listener-1');
    expect(mockInstance.removeEventListener).toHaveBeenCalledTimes(2);
    expect(mockInstance.disconnect).toHaveBeenCalledTimes(2);
  });

  it('tears down a leftover instance after a failed connect before opening another', async () => {
    const seed = 'one two three four five six seven eight nine ten eleven about';
    mockInstance.getInfo.mockRejectedValueOnce(new Error('info down'));
    mockInstance.disconnect.mockRejectedValueOnce(new Error('teardown down'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await assert.rejects(() => connectSparkSdk(seed), /info down/);
    warn.mockRestore();

    const instanceB = makeSdkInstance('b');
    const order = [];
    mockInstance.disconnect.mockImplementation(async () => {
      order.push('teardown');
    });
    breez.connect.mockImplementation(() => {
      order.push('connect');
      return Promise.resolve(instanceB);
    });

    const next = await connectSparkSdk(seed);
    assert.strictEqual(next, instanceB);
    assert.strictEqual(order[0], 'teardown');
    assert.strictEqual(order[1], 'connect');
  });

  it('lets the next connect run after a failed connect', async () => {
    const seed = 'one two three four five six seven eight nine ten eleven about';
    breez.connect.mockRejectedValueOnce(new Error('network down'));
    await assert.rejects(() => connectSparkSdk(seed), /network down/);
    const next = await connectSparkSdk(seed);
    assert.strictEqual(next, mockInstance);
    expect(breez.connect).toHaveBeenCalledTimes(2);
    assert.strictEqual(isSparkSdkConnected(), true);
  });

  it('acquireSparkSessionLease follows the committed instance across awaits', async () => {
    const seed = 'one two three four five six seven eight nine ten eleven about';
    await connectSparkSdk(seed);
    const lease = acquireSparkSessionLease();
    assert.strictEqual(lease.requireSdk(), mockInstance);
    assert.strictEqual(lease.identity, 'identity-1');
    await disconnectSparkSdk();
    assert.throws(
      () => lease.requireSdk(),
      err => err instanceof SparkSessionStaleError,
    );
  });

  it('acquireSparkSessionLease throws when no session is committed', () => {
    assert.throws(() => acquireSparkSessionLease(), /not connected/);
  });

  it('invalidates a lease when the session is replaced', async () => {
    const seedA = 'one two three four five six seven eight nine ten eleven about';
    const seedB = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const instanceB = makeSdkInstance('2');
    breez.connect.mockResolvedValueOnce(mockInstance).mockResolvedValueOnce(instanceB);
    await connectSparkSdk(seedA);
    const lease = acquireSparkSessionLease();
    await connectSparkSdk(seedB);
    assert.throws(
      () => lease.requireSdk(),
      err => err instanceof SparkSessionStaleError,
    );
    assert.strictEqual(acquireSparkSessionLease().requireSdk(), instanceB);
  });

  it('derives a different Spark seed when the same mnemonic has a BIP39 passphrase', async () => {
    const mnemonic = 'one two three four five six seven eight nine ten eleven about';
    const instanceB = makeSdkInstance('2');
    breez.connect.mockResolvedValueOnce(mockInstance).mockResolvedValueOnce(instanceB);

    await connectSparkSdk(mnemonic);
    await connectSparkSdk(mnemonic, undefined, 'super secret passphrase');

    expect(breez.connect).toHaveBeenCalledTimes(2);
    const seedWithout = breez.connect.mock.calls[0][0].seed;
    const seedWith = breez.connect.mock.calls[1][0].seed;
    assert.strictEqual(seedWithout.inner.mnemonic, mnemonic);
    assert.strictEqual(seedWith.inner.mnemonic, mnemonic);
    assert.strictEqual(seedWithout.inner.passphrase, undefined);
    assert.notStrictEqual(seedWithout.inner.passphrase, '');
    assert.strictEqual(seedWith.inner.passphrase, 'super secret passphrase');
    expect(mockInstance.disconnect).toHaveBeenCalled();
    assert.strictEqual(acquireSparkSessionLease().identity, 'identity-2');
  });

  it('builds Seed.Mnemonic with passphrase undefined when none is set', async () => {
    const mnemonic = 'one two three four five six seven eight nine ten eleven about';
    await connectSparkSdk(mnemonic);
    const seed = breez.connect.mock.calls[0][0].seed;
    assert.strictEqual(seed.tag, 'Mnemonic');
    assert.strictEqual(seed.inner.mnemonic, mnemonic);
    assert.strictEqual(seed.inner.passphrase, undefined);
    assert.notStrictEqual(seed.inner.passphrase, '');
  });

  it('treats an empty passphrase as unset so the seed matches a wallet with none', async () => {
    const mnemonic = 'one two three four five six seven eight nine ten eleven about';
    await connectSparkSdk(mnemonic, undefined, '');
    await connectSparkSdk(mnemonic);
    expect(breez.connect).toHaveBeenCalledTimes(1);
    const seed = breez.connect.mock.calls[0][0].seed;
    assert.strictEqual(seed.inner.passphrase, undefined);
    assert.notStrictEqual(seed.inner.passphrase, '');
  });

  it('reuses the session when the same mnemonic and passphrase connect again', async () => {
    const mnemonic = 'one two three four five six seven eight nine ten eleven about';
    await connectSparkSdk(mnemonic, undefined, 'super secret passphrase');
    await connectSparkSdk(mnemonic, undefined, 'super secret passphrase');
    expect(breez.connect).toHaveBeenCalledTimes(1);
    expect(mockInstance.disconnect).not.toHaveBeenCalled();
  });

  it('does not log the BIP39 passphrase when connect fails', async () => {
    const mnemonic = 'one two three four five six seven eight nine ten eleven about';
    const passphrase = 'unique-passphrase-marker-xyzzy';
    breez.connect.mockRejectedValueOnce(new Error(`bad seed ${passphrase}`));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    await assert.rejects(() => connectSparkSdk(mnemonic, undefined, passphrase), /bad seed/);
    for (const spy of [warn, error]) {
      for (const args of spy.mock.calls) {
        assert.ok(!String(args.join(' ')).includes(passphrase));
        assert.ok(!String(args.join(' ')).includes(mnemonic));
      }
    }
    warn.mockRestore();
    error.mockRestore();
  });

  describe('lifecycle timeout', () => {
    const seed = 'one two three four five six seven eight nine ten eleven about';
    const seedB = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

    beforeEach(() => {
      jest.useFakeTimers();
      __setLifecycleTimeoutMsForTests(50);
    });

    afterEach(() => {
      jest.clearAllTimers();
      __setLifecycleTimeoutMsForTests();
      jest.useRealTimers();
    });

    async function expectHungLifecycle(pending) {
      const assertion = assert.rejects(pending, err => err instanceof SparkLifecycleHungError);
      await Promise.resolve();
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(50);
      await assertion;
    }

    async function flush() {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }

    it('unblocks the queue when connect hangs and leaves Lightning in a defined unusable state', async () => {
      breez.connect.mockImplementation(() => new Promise(() => {}));
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const pending = connectSparkSdk(seed);
      await expectHungLifecycle(pending);
      assert.strictEqual(isSparkSdkConnected(), false);
      assert.throws(() => acquireSparkSessionLease(), /not connected/);

      breez.connect.mockResolvedValue(mockInstance);
      await assert.rejects(connectSparkSdk(seed), /previous session is still open/);
      warn.mockRestore();
    });

    it('poisons a hung getInfo instance so the next connect rebuilds instead of waiting forever', async () => {
      const hung = makeSdkInstance('hung');
      let markGetInfoStarted;
      const getInfoStarted = new Promise(resolve => {
        markGetInfoStarted = resolve;
      });
      hung.getInfo.mockImplementation(
        () =>
          new Promise(() => {
            markGetInfoStarted();
          }),
      );
      breez.connect.mockResolvedValueOnce(hung);
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const pending = connectSparkSdk(seed);
      const hungAssertion = assert.rejects(pending, err => err instanceof SparkLifecycleHungError);
      await getInfoStarted;
      await jest.advanceTimersByTimeAsync(50);
      await hungAssertion;
      assert.strictEqual(isSparkSdkConnected(), false);

      const nextInst = makeSdkInstance('next');
      hung.disconnect.mockResolvedValue(undefined);
      breez.connect.mockResolvedValueOnce(nextInst);
      const next = await connectSparkSdk(seed);
      assert.strictEqual(next, nextInst);
      assert.strictEqual(isSparkSdkConnected(), true);
      expect(hung.disconnect).toHaveBeenCalled();
      assert.strictEqual(acquireSparkSessionLease().requireSdk(), nextInst);
      warn.mockRestore();
    });

    it('unblocks a hung disconnect and lets the next connect rebuild from the poisoned instance', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      await connectSparkSdk(seed);
      mockInstance.disconnect.mockImplementation(() => new Promise(() => {}));
      const pending = disconnectSparkSdk();
      await expectHungLifecycle(pending);
      assert.strictEqual(isSparkSdkConnected(), false);

      const nextInst = makeSdkInstance('after-hang');
      mockInstance.disconnect.mockResolvedValue(undefined);
      breez.connect.mockResolvedValueOnce(nextInst);
      const next = await connectSparkSdk(seed);
      assert.strictEqual(next, nextInst);
      assert.strictEqual(isSparkSdkConnected(), true);
      warn.mockRestore();
    });

    it('does not commit a native connect that returns after the transition timed out', async () => {
      let resolveConnect;
      breez.connect.mockImplementation(
        () =>
          new Promise(resolve => {
            resolveConnect = resolve;
          }),
      );
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const pending = connectSparkSdk(seed);
      await expectHungLifecycle(pending);

      const late = makeSdkInstance('late');
      resolveConnect(late);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      assert.strictEqual(isSparkSdkConnected(), false);
      assert.throws(() => acquireSparkSessionLease(), /not connected/);
      expect(late.getInfo).not.toHaveBeenCalled();

      late.disconnect.mockResolvedValue(undefined);
      breez.connect.mockResolvedValueOnce(mockInstance);
      const next = await connectSparkSdk(seed);
      assert.strictEqual(next, mockInstance);
      expect(late.disconnect).toHaveBeenCalled();
      warn.mockRestore();
    });

    describe('epoch guards', () => {
      it('does not open a native connect after a timed-out teardown of the previous session later succeeds', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        await connectSparkSdk(seed);
        expect(breez.connect).toHaveBeenCalledTimes(1);

        let extraConnects = 0;
        breez.connect.mockImplementation(() => {
          extraConnects += 1;
          return Promise.resolve(makeSdkInstance(`extra-${extraConnects}`));
        });

        let releaseDisconnect;
        mockInstance.disconnect.mockImplementationOnce(
          () =>
            new Promise(resolve => {
              releaseDisconnect = resolve;
            }),
        );

        const pendingB = connectSparkSdk(seedB);
        const hungAssertion = assert.rejects(pendingB, err => err instanceof SparkLifecycleHungError);
        await Promise.resolve();
        await Promise.resolve();
        assert.ok(typeof releaseDisconnect === 'function');
        await jest.advanceTimersByTimeAsync(50);
        await hungAssertion;
        assert.strictEqual(extraConnects, 0);

        releaseDisconnect();
        await flush();
        assert.strictEqual(extraConnects, 0);
        assert.strictEqual(isSparkSdkConnected(), false);

        const instanceC = makeSdkInstance('c');
        breez.connect.mockImplementation(() => Promise.resolve(instanceC));
        const next = await connectSparkSdk(seedB);
        assert.strictEqual(next, instanceC);
        assert.strictEqual(isSparkSdkConnected(), true);
        warn.mockRestore();
      });

      it('does not let a getInfo that returns after timeout replace a newer session', async () => {
        const instanceA = makeSdkInstance('a');
        const instanceB = makeSdkInstance('b');
        let resolveInfo;
        let markInfoStarted;
        const infoStarted = new Promise(resolve => {
          markInfoStarted = resolve;
        });
        instanceA.getInfo.mockImplementation(
          () =>
            new Promise(resolve => {
              resolveInfo = resolve;
              markInfoStarted();
            }),
        );
        breez.connect.mockImplementation(async () => {
          if (breez.connect.mock.calls.length === 1) {
            return instanceA;
          }
          return instanceB;
        });

        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const pendingA = connectSparkSdk(seed, async () => {});
        const hungAssertion = assert.rejects(pendingA, err => err instanceof SparkLifecycleHungError);
        await infoStarted;
        await jest.advanceTimersByTimeAsync(50);
        await hungAssertion;

        const resultB = await connectSparkSdk(seedB);
        assert.strictEqual(resultB, instanceB);
        const lease = acquireSparkSessionLease();
        assert.strictEqual(lease.requireSdk(), instanceB);

        resolveInfo({ identityPubkey: 'late-a', balanceSats: 0n });
        await flush();

        assert.strictEqual(lease.requireSdk(), instanceB);
        assert.strictEqual(acquireSparkSessionLease().requireSdk(), instanceB);
        assert.strictEqual(acquireSparkSessionLease().identity, 'identity-b');
        expect(instanceA.addEventListener).not.toHaveBeenCalled();
        expect(instanceB.disconnect).not.toHaveBeenCalled();
        const reused = await connectSparkSdk(seedB);
        assert.strictEqual(reused, instanceB);
        warn.mockRestore();
      });

      it('does not let addEventListener that returns after timeout replace a newer session', async () => {
        const instanceA = makeSdkInstance('a');
        const instanceB = makeSdkInstance('b');
        let resolveAdd;
        let markAddStarted;
        const addStarted = new Promise(resolve => {
          markAddStarted = resolve;
        });
        instanceA.addEventListener.mockImplementation(
          () =>
            new Promise(resolve => {
              resolveAdd = resolve;
              markAddStarted();
            }),
        );
        breez.connect.mockImplementation(async () => {
          if (breez.connect.mock.calls.length === 1) {
            return instanceA;
          }
          return instanceB;
        });

        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const pendingA = connectSparkSdk(seed, async () => {});
        const hungAssertion = assert.rejects(pendingA, err => err instanceof SparkLifecycleHungError);
        await addStarted;
        await jest.advanceTimersByTimeAsync(50);
        await hungAssertion;

        const resultB = await connectSparkSdk(seedB);
        assert.strictEqual(resultB, instanceB);
        const lease = acquireSparkSessionLease();
        assert.strictEqual(lease.requireSdk(), instanceB);

        resolveAdd('listener-late-a');
        await flush();

        assert.strictEqual(lease.requireSdk(), instanceB);
        assert.strictEqual(acquireSparkSessionLease().requireSdk(), instanceB);
        assert.strictEqual(acquireSparkSessionLease().identity, 'identity-b');
        expect(instanceB.disconnect).not.toHaveBeenCalled();
        const reused = await connectSparkSdk(seedB);
        assert.strictEqual(reused, instanceB);
        warn.mockRestore();
      });

      it('leaves a timed-out getInfo failure poisoned for the next connect instead of cleaning it up as a live setup error', async () => {
        const instanceA = makeSdkInstance('a');
        let rejectInfo;
        let markInfoStarted;
        const infoStarted = new Promise(resolve => {
          markInfoStarted = resolve;
        });
        instanceA.getInfo.mockImplementation(
          () =>
            new Promise((_resolve, reject) => {
              rejectInfo = reject;
              markInfoStarted();
            }),
        );
        breez.connect.mockResolvedValueOnce(instanceA);

        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const pendingA = connectSparkSdk(seed);
        const hungAssertion = assert.rejects(pendingA, err => err instanceof SparkLifecycleHungError);
        await infoStarted;
        await jest.advanceTimersByTimeAsync(50);
        await hungAssertion;
        expect(instanceA.disconnect).not.toHaveBeenCalled();

        rejectInfo(new Error('info down'));
        await flush();
        expect(instanceA.disconnect).not.toHaveBeenCalled();
        assert.strictEqual(isSparkSdkConnected(), false);

        const instanceB = makeSdkInstance('b');
        const order = [];
        instanceA.disconnect.mockImplementation(async () => {
          order.push('teardown');
        });
        breez.connect.mockImplementation(() => {
          order.push('connect');
          return Promise.resolve(instanceB);
        });
        const next = await connectSparkSdk(seed);
        assert.strictEqual(next, instanceB);
        assert.deepStrictEqual(order, ['teardown', 'connect']);
        expect(instanceA.disconnect).toHaveBeenCalledTimes(1);
        warn.mockRestore();
      });

      it('does not drop a newer session when disconnect of a discarded stale instance fails', async () => {
        const instanceA = makeSdkInstance('a');
        const instanceB = makeSdkInstance('b');
        let resolveInfo;
        let markInfoStarted;
        const infoStarted = new Promise(resolve => {
          markInfoStarted = resolve;
        });
        instanceA.getInfo.mockImplementation(
          () =>
            new Promise(resolve => {
              resolveInfo = resolve;
              markInfoStarted();
            }),
        );
        let disconnectCalls = 0;
        instanceA.disconnect.mockImplementation(() => {
          disconnectCalls += 1;
          if (disconnectCalls === 1) {
            return Promise.resolve();
          }
          return Promise.reject(new Error('native down'));
        });
        breez.connect.mockImplementation(async () => {
          if (breez.connect.mock.calls.length === 1) {
            return instanceA;
          }
          return instanceB;
        });

        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const pendingA = connectSparkSdk(seed, async () => {});
        const hungAssertion = assert.rejects(pendingA, err => err instanceof SparkLifecycleHungError);
        await infoStarted;
        await jest.advanceTimersByTimeAsync(50);
        await hungAssertion;

        const resultB = await connectSparkSdk(seedB);
        assert.strictEqual(resultB, instanceB);
        const lease = acquireSparkSessionLease();
        assert.strictEqual(lease.requireSdk(), instanceB);

        resolveInfo({ identityPubkey: 'late-a', balanceSats: 0n });
        await flush();

        assert.strictEqual(lease.requireSdk(), instanceB);
        assert.strictEqual(acquireSparkSessionLease().requireSdk(), instanceB);
        expect(instanceB.disconnect).not.toHaveBeenCalled();
        const staleWarns = warn.mock.calls.filter(args => String(args[0]).includes('connectSparkSdk: disconnect failed'));
        assert.ok(staleWarns.length >= 1);
        for (const args of staleWarns) {
          assert.strictEqual(args[1], 'Error');
          assert.ok(!String(args[1]).includes('native down'));
        }
        warn.mockRestore();
      });
    });
  });
});
