import React from 'react';
import assert from 'assert';
import { Alert, AppState, Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import { PaymentDetails_Tags, PaymentStatus, PaymentType, SdkEvent_Tags } from '@breeztech/breez-sdk-spark-react-native';

const mockConnect = jest.fn();
const mockDisconnect = jest.fn(() => Promise.resolve());
const mockSync = jest.fn(() => Promise.resolve());
const mockIsConnected = jest.fn(() => false);
const mockRequireSdk = jest.fn();
const mockGetSessionIdentity = jest.fn(() => 'pk-1');

jest.mock('../../api/spark/spark-sdk', () => {
  class SparkSessionStaleError extends Error {
    constructor() {
      super('Spark session is no longer the one this call started with');
      this.name = 'SparkSessionStaleError';
    }
  }
  return {
    connectSparkSdk: (...args) => mockConnect(...args),
    disconnectSparkSdk: (...args) => mockDisconnect(...args),
    syncSparkWallet: (...args) => mockSync(...args),
    isSparkSdkConnected: (...args) => mockIsConnected(...args),
    SparkSessionStaleError,
    acquireSparkSessionLease: () => {
      const identity = mockGetSessionIdentity();
      return {
        identity,
        requireSdk() {
          if (mockGetSessionIdentity() !== identity) {
            throw new SparkSessionStaleError();
          }
          return mockRequireSdk();
        },
      };
    },
    BREEZ_API_KEY_MISSING: 'BREEZ_API_KEY is not configured...',
  };
});

jest.mock('../../class', () => ({
  HDSegwitBech32Wallet: { type: 'HDsegwitBech32' },
}));

const { SparkWallet } = require('../../class/wallets/spark-wallet');
const { BlueStorageContext } = require('../../blue_modules/storage-context');
const { SparkContextProvider, useSparkContext } = require('../../api/spark/contexts/spark.context');
const { beginOutgoingPayment, __resetOutgoingPaymentForTests } = require('../../api/spark/outgoing-payment');
const loc = require('../../loc').default;

function expectedUserFacingError(e) {
  const kind = e instanceof Error ? e.name : typeof e;
  return loc.formatString(loc.wallets.lightning_spark_generic_error, { kind });
}

let latestCtx;

const Probe = () => {
  const ctx = useSparkContext();
  React.useEffect(() => {
    latestCtx = ctx;
  }, [ctx]);
  return <Text testID="probe">{ctx.isCreating ? 'creating' : ctx.isConnected ? 'connected' : 'idle'}</Text>;
};

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const MNEMONIC_B = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

const hdWallet = {
  type: 'HDsegwitBech32',
  getSecret: () => MNEMONIC,
  getID: () => 'hd-default',
  getLabel: () => 'On-chain Wallet',
};

const createHash = require('create-hash');

const mockSdk = {
  getInfo: jest.fn().mockResolvedValue({ identityPubkey: 'pk-1', balanceSats: 0n }),
  getLightningAddress: jest.fn().mockResolvedValue({ lightningAddress: 'user@breez.blitz' }),
  checkLightningAddressAvailable: jest.fn().mockResolvedValue(true),
  registerLightningAddress: jest.fn().mockResolvedValue({ lightningAddress: 'reg@breez.blitz', username: 'reg', description: '' }),
  listPayments: jest.fn().mockResolvedValue({ payments: [] }),
};

function expectedUsername(identityPubkey, attempt = 0) {
  const base = createHash('sha256').update(identityPubkey).digest().toString('hex').slice(0, 16);
  return attempt === 0 ? base : `${base}${attempt + 1}`;
}

const addAndSaveWallet = jest.fn().mockResolvedValue(undefined);
const saveToDisk = jest.fn().mockResolvedValue(undefined);
const deleteWallet = jest.fn();

function renderWith(wallets, walletsInitialized = true) {
  latestCtx = null;
  return render(
    <BlueStorageContext.Provider value={{ wallets, walletsInitialized, addAndSaveWallet, saveToDisk, deleteWallet }}>
      <SparkContextProvider>
        <Probe />
      </SparkContextProvider>
    </BlueStorageContext.Provider>,
  );
}

function stubSparkMethods(wallet) {
  wallet.fetchBalance = jest.fn().mockResolvedValue(undefined);
  wallet.fetchTransactions = jest.fn().mockResolvedValue(undefined);
  wallet.fetchUserInvoices = jest.fn().mockResolvedValue(undefined);
  mockGetSessionIdentity.mockReturnValue(wallet.identityPubkey);
  return wallet;
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetOutgoingPaymentForTests();
  mockIsConnected.mockReturnValue(false);
  mockConnect.mockImplementation(async (_mnemonic, onEvent) => {
    mockIsConnected.mockReturnValue(true);
    // stash listener for event tests
    mockConnect.lastOnEvent = onEvent;
    return mockSdk;
  });
  mockRequireSdk.mockReturnValue(mockSdk);
  mockSdk.getInfo.mockResolvedValue({ identityPubkey: 'pk-1', balanceSats: 0n });
  mockSdk.getLightningAddress.mockResolvedValue({ lightningAddress: 'user@breez.blitz' });
  mockSdk.checkLightningAddressAvailable.mockResolvedValue(true);
  mockSdk.registerLightningAddress.mockResolvedValue({
    lightningAddress: 'reg@breez.blitz',
    username: 'reg',
    description: loc.wallets.lightning_spark_wallet_label,
  });
  mockSdk.listPayments.mockResolvedValue({ payments: [] });
  mockSync.mockResolvedValue(undefined);
  mockDisconnect.mockResolvedValue(undefined);
  mockGetSessionIdentity.mockReturnValue('pk-1');
});

describe('useSparkContext', () => {
  it('throws when used outside SparkContextProvider', () => {
    const Outside = () => {
      useSparkContext();
      return null;
    };
    assert.throws(() => {
      render(<Outside />);
    }, /must be used within SparkContextProvider/);
  });
});

describe('SparkContextProvider', () => {
  it('creates a Spark wallet from the on-chain seed without storing the phrase', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    renderWith([hdWallet]);
    await waitFor(() => assert.ok(latestCtx));

    let created;
    await act(async () => {
      created = await latestCtx.createSparkWallet();
    });

    assert.ok(created);
    assert.strictEqual(created.type, SparkWallet.type);
    assert.strictEqual(created.getSecret(), '');
    assert.strictEqual(created.identityPubkey, 'pk-1');
    assert.strictEqual(created.lnAddress, 'user@breez.blitz');
    assert.strictEqual(created.sourceWalletId, 'hd-default');
    assert.strictEqual(created.sourceWalletLabel, 'On-chain Wallet');
    assert.notStrictEqual(created.sourceWalletId, MNEMONIC);
    assert.ok(!String(created.sourceWalletId).includes('abandon'));
    expect(addAndSaveWallet).toHaveBeenCalledWith(created);
    expect(mockConnect).toHaveBeenCalled();
    expect(mockSdk.registerLightningAddress).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('registers a Lightning address on create when none exists yet', async () => {
    mockSdk.getLightningAddress.mockResolvedValue(undefined);
    renderWith([hdWallet]);
    await waitFor(() => assert.ok(latestCtx));

    let created;
    await act(async () => {
      created = await latestCtx.createSparkWallet();
    });

    assert.ok(created);
    assert.strictEqual(created.lnAddress, 'reg@breez.blitz');
    expect(mockSdk.checkLightningAddressAvailable).toHaveBeenCalledWith({ username: expectedUsername('pk-1') });
    expect(mockSdk.registerLightningAddress).toHaveBeenCalledWith({
      username: expectedUsername('pk-1'),
      description: loc.wallets.lightning_spark_wallet_label,
    });
    expect(addAndSaveWallet).toHaveBeenCalledWith(created);
  });

  it('registers a suffix username when the derived name is taken', async () => {
    mockSdk.getLightningAddress.mockResolvedValue(undefined);
    mockSdk.checkLightningAddressAvailable.mockImplementation(async ({ username }) => username !== expectedUsername('pk-1'));
    mockSdk.registerLightningAddress.mockResolvedValue({
      lightningAddress: 'suffix@breez.blitz',
      username: expectedUsername('pk-1', 1),
      description: loc.wallets.lightning_spark_wallet_label,
    });
    renderWith([hdWallet]);
    await waitFor(() => assert.ok(latestCtx));

    let created;
    await act(async () => {
      created = await latestCtx.createSparkWallet();
    });

    assert.ok(created);
    assert.strictEqual(created.lnAddress, 'suffix@breez.blitz');
    expect(mockSdk.checkLightningAddressAvailable).toHaveBeenCalledWith({ username: expectedUsername('pk-1') });
    expect(mockSdk.checkLightningAddressAvailable).toHaveBeenCalledWith({ username: expectedUsername('pk-1', 1) });
    expect(mockSdk.registerLightningAddress).toHaveBeenCalledTimes(1);
    expect(mockSdk.registerLightningAddress).toHaveBeenCalledWith({
      username: expectedUsername('pk-1', 1),
      description: loc.wallets.lightning_spark_wallet_label,
    });
  });

  it('tries the next Lightning address candidate when register fails for an available name', async () => {
    mockSdk.getLightningAddress.mockResolvedValue(undefined);
    mockSdk.registerLightningAddress.mockRejectedValueOnce(new Error('name taken')).mockResolvedValue({
      lightningAddress: 'second@breez.blitz',
      username: expectedUsername('pk-1', 1),
      description: loc.wallets.lightning_spark_wallet_label,
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    renderWith([hdWallet]);
    await waitFor(() => assert.ok(latestCtx));

    let created;
    await act(async () => {
      created = await latestCtx.createSparkWallet();
    });

    assert.ok(created);
    assert.strictEqual(created.lnAddress, 'second@breez.blitz');
    expect(mockSdk.registerLightningAddress).toHaveBeenCalledTimes(2);
    expect(mockSdk.registerLightningAddress).toHaveBeenCalledWith({
      username: expectedUsername('pk-1'),
      description: loc.wallets.lightning_spark_wallet_label,
    });
    expect(mockSdk.registerLightningAddress).toHaveBeenCalledWith({
      username: expectedUsername('pk-1', 1),
      description: loc.wallets.lightning_spark_wallet_label,
    });
    expect(warn.mock.calls.some(c => c[0] === 'SparkContext: registerLightningAddress failed' && c[1] === 'Error')).toBe(true);
    for (const args of warn.mock.calls) {
      if (args[0] === 'SparkContext: registerLightningAddress failed') {
        assert.ok(!String(args[1]).includes('name taken'));
      }
    }
    warn.mockRestore();
  });

  it('still creates the wallet when Lightning address registration fails', async () => {
    mockSdk.getLightningAddress.mockResolvedValue(undefined);
    mockSdk.registerLightningAddress.mockRejectedValue(new Error('register down'));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    renderWith([hdWallet]);
    await waitFor(() => assert.ok(latestCtx));

    let created;
    await act(async () => {
      created = await latestCtx.createSparkWallet();
    });

    assert.ok(created);
    assert.strictEqual(created.lnAddress, undefined);
    expect(addAndSaveWallet).toHaveBeenCalledWith(created);
    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
    warn.mockRestore();
  });

  it('gives up registration after the named attempt budget and still creates the wallet', async () => {
    mockSdk.getLightningAddress.mockResolvedValue(undefined);
    mockSdk.checkLightningAddressAvailable.mockResolvedValue(false);
    renderWith([hdWallet]);
    await waitFor(() => assert.ok(latestCtx));

    let created;
    await act(async () => {
      created = await latestCtx.createSparkWallet();
    });

    assert.ok(created);
    assert.strictEqual(created.lnAddress, undefined);
    expect(mockSdk.checkLightningAddressAvailable).toHaveBeenCalledTimes(5);
    expect(mockSdk.registerLightningAddress).not.toHaveBeenCalled();
    expect(addAndSaveWallet).toHaveBeenCalledWith(created);
  });

  it('retries Lightning address registration once for an existing wallet without an address', async () => {
    mockSdk.getLightningAddress.mockResolvedValue(undefined);
    const existing = stubSparkMethods(SparkWallet.create('stored-pk'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    renderWith([hdWallet, existing]);
    await waitFor(() => expect(mockSdk.registerLightningAddress).toHaveBeenCalledTimes(1));
    assert.strictEqual(existing.lnAddress, 'reg@breez.blitz');
    expect(saveToDisk).toHaveBeenCalled();

    const onEvent = mockConnect.lastOnEvent;
    mockSdk.registerLightningAddress.mockClear();
    await act(async () => {
      await onEvent({ tag: SdkEvent_Tags.Synced });
      await onEvent({ tag: SdkEvent_Tags.PaymentSucceeded });
    });
    expect(mockSdk.registerLightningAddress).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('retries Lightning address registration after a stale session on the same wallet', async () => {
    const { SparkSessionStaleError } = require('../../api/spark/spark-sdk');
    mockSdk.getLightningAddress.mockResolvedValue(undefined);
    mockSdk.registerLightningAddress.mockRejectedValueOnce(new SparkSessionStaleError());
    const existing = stubSparkMethods(SparkWallet.create('stale-pk'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    renderWith([hdWallet, existing]);
    await waitFor(() => expect(mockSdk.registerLightningAddress).toHaveBeenCalledTimes(1));
    assert.strictEqual(existing.lnAddress, undefined);

    mockSdk.registerLightningAddress.mockClear();
    mockSdk.registerLightningAddress.mockResolvedValue({ lightningAddress: 'late@breez.blitz' });
    const onEvent = mockConnect.lastOnEvent;
    await act(async () => {
      await onEvent({ tag: SdkEvent_Tags.Synced });
    });
    await waitFor(() => expect(mockSdk.registerLightningAddress).toHaveBeenCalledTimes(1));
    assert.strictEqual(existing.lnAddress, 'late@breez.blitz');
    expect(saveToDisk).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not retry registration on later refreshes when the first retry failed', async () => {
    mockSdk.getLightningAddress.mockResolvedValue(undefined);
    mockSdk.registerLightningAddress.mockRejectedValue(new Error('register down'));
    const existing = stubSparkMethods(SparkWallet.create('retry-pk'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    renderWith([hdWallet, existing]);
    await waitFor(() => expect(mockSdk.registerLightningAddress).toHaveBeenCalledTimes(5));
    assert.strictEqual(existing.lnAddress, undefined);

    mockSdk.registerLightningAddress.mockClear();
    mockSdk.registerLightningAddress.mockResolvedValue({ lightningAddress: 'late@breez.blitz' });
    const onEvent = mockConnect.lastOnEvent;
    await act(async () => {
      await onEvent({ tag: SdkEvent_Tags.Synced });
    });
    expect(mockSdk.registerLightningAddress).not.toHaveBeenCalled();
    assert.strictEqual(existing.lnAddress, undefined);
    warn.mockRestore();
  });

  it('alerts with a retry option when connect fails and does not persist', async () => {
    mockConnect.mockRejectedValue(new Error('boom'));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    renderWith([hdWallet]);
    await waitFor(() => assert.ok(latestCtx));

    let result;
    await act(async () => {
      result = await latestCtx.createSparkWallet();
    });

    assert.strictEqual(result, null);
    expect(addAndSaveWallet).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalled();
    const buttons = alert.mock.calls[0][2];
    assert.ok(Array.isArray(buttons) && buttons.length >= 2);
    expect(mockDisconnect).toHaveBeenCalled();
    alert.mockRestore();
  });

  it('alerts when getInfo fails after connect and does not persist', async () => {
    mockSdk.getInfo.mockRejectedValue(new Error('getInfo failed'));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    renderWith([hdWallet]);
    await waitFor(() => assert.ok(latestCtx));

    let result;
    await act(async () => {
      result = await latestCtx.createSparkWallet();
    });

    assert.strictEqual(result, null);
    expect(addAndSaveWallet).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalled();
    expect(String(alert.mock.calls[0][1])).toBe(expectedUserFacingError(new Error('getInfo failed')));
    expect(String(alert.mock.calls[0][1])).not.toMatch(/getInfo failed/);
    alert.mockRestore();
  });

  it('does not persist a wallet when the session changes after a swallowed Lightning address error', async () => {
    mockSdk.getLightningAddress.mockImplementation(async () => {
      mockGetSessionIdentity.mockReturnValue('other-session');
      throw new Error('lnaddr down');
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    renderWith([hdWallet]);
    await waitFor(() => assert.ok(latestCtx));

    let result;
    await act(async () => {
      result = await latestCtx.createSparkWallet();
    });

    assert.strictEqual(result, null);
    expect(addAndSaveWallet).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalled();
    alert.mockRestore();
    warn.mockRestore();
  });

  it('does not persist a wallet when the session goes stale during Lightning address lookup', async () => {
    mockSdk.getLightningAddress.mockImplementation(async () => {
      mockGetSessionIdentity.mockReturnValue('other-session');
      return { lightningAddress: 'stolen@breez.blitz' };
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    renderWith([hdWallet]);
    await waitFor(() => assert.ok(latestCtx));

    let result;
    await act(async () => {
      result = await latestCtx.createSparkWallet();
    });

    assert.strictEqual(result, null);
    expect(addAndSaveWallet).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalled();
    alert.mockRestore();
  });

  it('does not persist a wallet when the session changes during Lightning address registration', async () => {
    mockSdk.getLightningAddress.mockResolvedValue(undefined);
    mockSdk.checkLightningAddressAvailable.mockImplementation(async () => {
      mockGetSessionIdentity.mockReturnValue('other-session');
      return true;
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    renderWith([hdWallet]);
    await waitFor(() => assert.ok(latestCtx));

    let result;
    await act(async () => {
      result = await latestCtx.createSparkWallet();
    });

    assert.strictEqual(result, null);
    expect(addAndSaveWallet).not.toHaveBeenCalled();
    expect(mockSdk.registerLightningAddress).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalled();
    alert.mockRestore();
  });

  it('does not treat a session change during register as a name conflict', async () => {
    const { SparkSessionStaleError } = require('../../api/spark/spark-sdk');
    mockSdk.getLightningAddress.mockResolvedValue(undefined);
    mockSdk.registerLightningAddress.mockRejectedValue(new SparkSessionStaleError());
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    renderWith([hdWallet]);
    await waitFor(() => assert.ok(latestCtx));

    let result;
    await act(async () => {
      result = await latestCtx.createSparkWallet();
    });

    assert.strictEqual(result, null);
    expect(addAndSaveWallet).not.toHaveBeenCalled();
    expect(mockSdk.registerLightningAddress).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalled();
    expect(warn.mock.calls.some(c => c[0] === 'SparkContext: registerLightningAddress failed')).toBe(false);
    alert.mockRestore();
    warn.mockRestore();
  });

  it('still creates the wallet when the availability check throws', async () => {
    mockSdk.getLightningAddress.mockResolvedValue(undefined);
    mockSdk.checkLightningAddressAvailable.mockRejectedValue(new Error('lookup down'));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    renderWith([hdWallet]);
    await waitFor(() => assert.ok(latestCtx));

    let created;
    await act(async () => {
      created = await latestCtx.createSparkWallet();
    });

    assert.ok(created);
    assert.strictEqual(created.lnAddress, undefined);
    expect(addAndSaveWallet).toHaveBeenCalledWith(created);
    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
    warn.mockRestore();
  });

  it('still creates a usable wallet when getLightningAddress fails', async () => {
    mockSdk.getLightningAddress.mockRejectedValue(new Error('lnaddr down API_KEY=secret'));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    renderWith([hdWallet]);
    await waitFor(() => assert.ok(latestCtx));

    let created;
    await act(async () => {
      created = await latestCtx.createSparkWallet();
    });

    assert.ok(created);
    assert.strictEqual(created.identityPubkey, 'pk-1');
    assert.strictEqual(created.lnAddress, undefined);
    expect(addAndSaveWallet).toHaveBeenCalledWith(created);
    expect(alert).not.toHaveBeenCalled();
    const lnCalls = warn.mock.calls.filter(c => String(c[0]).includes('getLightningAddress failed'));
    assert.strictEqual(lnCalls.length, 1);
    for (const args of lnCalls) {
      assert.strictEqual(args[1], 'Error');
      assert.ok(!String(args[1]).includes('lnaddr down'));
      assert.ok(!String(args[1]).includes('API_KEY'));
      assert.ok(!String(args[1]).includes('secret'));
    }
    alert.mockRestore();
    warn.mockRestore();
  });

  it('returns an existing Spark wallet without creating another', async () => {
    const existing = stubSparkMethods(SparkWallet.create('existing-pk'));
    renderWith([hdWallet, existing]);
    await waitFor(() => assert.ok(latestCtx));

    let result;
    await act(async () => {
      result = await latestCtx.createSparkWallet();
    });
    assert.strictEqual(result, existing);
    expect(addAndSaveWallet).not.toHaveBeenCalled();
  });

  it('connects when a Spark wallet is already stored', async () => {
    const existing = stubSparkMethods(SparkWallet.create('stored-pk'));
    renderWith([hdWallet, existing]);
    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    expect(existing.fetchBalance).toHaveBeenCalled();
  });

  it('alerts loudly when existing Spark wallet cannot connect', async () => {
    mockConnect.mockRejectedValue(new Error('BREEZ_API_KEY missing'));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const existing = stubSparkMethods(SparkWallet.create('stored-pk'));
    renderWith([hdWallet, existing]);
    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(String(alert.mock.calls[0][1])).toBe(expectedUserFacingError(new Error('BREEZ_API_KEY missing')));
    expect(String(alert.mock.calls[0][1])).not.toMatch(/BREEZ_API_KEY/);
    alert.mockRestore();
  });

  it('repeated retry on an existing-wallet alert eventually reconnects and refreshes that wallet', async () => {
    mockConnect.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('still offline'));
    let retryPress;
    let alertCount = 0;
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      alertCount += 1;
      retryPress = buttons && buttons[1] && buttons[1].onPress;
    });
    const existing = stubSparkMethods(SparkWallet.create('retry-existing-pk'));
    renderWith([hdWallet, existing]);
    await waitFor(() => assert.ok(typeof retryPress === 'function'));

    await act(async () => {
      retryPress();
    });
    await waitFor(() => assert.strictEqual(alertCount, 2));

    await act(async () => {
      retryPress();
    });

    await waitFor(() => expect(mockConnect).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(existing.fetchBalance).toHaveBeenCalled());
    assert.strictEqual(latestCtx.isConnected, true);
    alert.mockRestore();
  });

  it('swallows a rejected initial retry when reporting that retry failure also throws', async () => {
    mockConnect.mockRejectedValue(new Error('offline'));
    let retryPress;
    let alertCount = 0;
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      alertCount += 1;
      if (alertCount === 1) {
        retryPress = buttons && buttons[1] && buttons[1].onPress;
        return;
      }
      throw new Error('native alert unavailable');
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const existing = stubSparkMethods(SparkWallet.create('initial-retry-rejection-pk'));
    renderWith([hdWallet, existing]);
    await waitFor(() => assert.ok(typeof retryPress === 'function'));

    await act(async () => {
      retryPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(mockConnect).toHaveBeenCalledTimes(2));
    expect(alert).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
    alert.mockRestore();
  });

  it('swallows a rejected repeated retry when reporting that retry failure also throws', async () => {
    mockConnect.mockRejectedValue(new Error('offline'));
    let retryPress;
    let alertCount = 0;
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      alertCount += 1;
      if (alertCount < 3) {
        retryPress = buttons && buttons[1] && buttons[1].onPress;
        return;
      }
      throw new Error('native alert unavailable');
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const existing = stubSparkMethods(SparkWallet.create('repeated-retry-rejection-pk'));
    renderWith([hdWallet, existing]);
    await waitFor(() => assert.ok(typeof retryPress === 'function'));

    await act(async () => {
      retryPress();
    });
    await waitFor(() => assert.strictEqual(alertCount, 2));

    await act(async () => {
      retryPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(mockConnect).toHaveBeenCalledTimes(3));
    expect(alert).toHaveBeenCalledTimes(3);
    errorSpy.mockRestore();
    alert.mockRestore();
  });

  it('a stale retry becomes a no-op after the Spark wallet was removed', async () => {
    mockConnect.mockRejectedValueOnce(new Error('offline'));
    let retryPress;
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      retryPress = buttons && buttons[1] && buttons[1].onPress;
    });
    const existing = stubSparkMethods(SparkWallet.create('removed-before-retry-pk'));
    const setWalletsRef = { current: null };
    function Harness() {
      const [wallets, setWallets] = React.useState([hdWallet, existing]);
      React.useEffect(() => {
        setWalletsRef.current = setWallets;
      }, [setWallets]);
      return (
        <BlueStorageContext.Provider value={{ wallets, walletsInitialized: true, addAndSaveWallet, saveToDisk, deleteWallet }}>
          <SparkContextProvider>
            <Probe />
          </SparkContextProvider>
        </BlueStorageContext.Provider>
      );
    }

    render(<Harness />);
    await waitFor(() => assert.ok(typeof retryPress === 'function'));
    await act(async () => {
      setWalletsRef.current([hdWallet]);
    });
    await waitFor(() => expect(mockDisconnect).toHaveBeenCalled());

    await act(async () => {
      retryPress();
    });

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledTimes(1);
    alert.mockRestore();
  });

  it('does not put SDK error messages (seed markers) into console.error for Sentry', async () => {
    // connectSparkSdk sees the mnemonic; if the SDK echoed it into Error.message we must not
    // ship that via captureConsoleIntegration({ levels: ['error'] }) in App.js.
    const seedMarker = 'abandon abandon abandon';
    mockConnect.mockRejectedValue(new Error(`invalid mnemonic: ${seedMarker}`));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const existing = stubSparkMethods(SparkWallet.create('stored-pk'));
    renderWith([hdWallet, existing]);

    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
    for (const args of errorSpy.mock.calls) {
      for (const arg of args) {
        assert.ok(!String(arg).includes(seedMarker), `console.error must not contain seed material: ${arg}`);
      }
    }
    expect(alert).toHaveBeenCalled();
    expect(String(alert.mock.calls[0][1])).toBe(expectedUserFacingError(new Error(`invalid mnemonic: ${seedMarker}`)));
    expect(String(alert.mock.calls[0][1])).not.toContain(seedMarker);
    // Fixed tag + Error name only.
    expect(errorSpy.mock.calls.some(c => c[0] === 'SparkContext: failed to connect' && c[1] === 'Error')).toBe(true);

    alert.mockRestore();
    errorSpy.mockRestore();
  });

  it('does not alert when an initial connect fails after the provider was unmounted', async () => {
    let rejectConnect;
    mockConnect.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectConnect = reject;
        }),
    );
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const existing = stubSparkMethods(SparkWallet.create('cancelled-pk'));
    const screen = renderWith([hdWallet, existing]);
    await waitFor(() => expect(mockConnect).toHaveBeenCalled());

    screen.unmount();
    await act(async () => {
      rejectConnect(new Error('late failure'));
    });

    expect(alert).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    alert.mockRestore();
    errorSpy.mockRestore();
  });

  it('does not connect when wallets are not initialized', async () => {
    const existing = stubSparkMethods(SparkWallet.create('stored-pk'));
    renderWith([hdWallet, existing], false);
    // give effects a tick
    await act(async () => {});
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('rejects create when on-chain mnemonic is missing', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    renderWith([{ type: 'HDsegwitBech32', getSecret: () => '' }]);
    await waitFor(() => assert.ok(latestCtx));

    let result;
    await act(async () => {
      result = await latestCtx.createSparkWallet();
    });
    assert.strictEqual(result, null);
    expect(addAndSaveWallet).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalled();
    expect(String(alert.mock.calls[0][1])).toBe(expectedUserFacingError(new Error('On-chain recovery phrase is not available')));
    expect(String(alert.mock.calls[0][1])).not.toMatch(/recovery phrase|not available/i);
    alert.mockRestore();
  });

  it('rejects create when no wallets exist', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    renderWith([]);
    await waitFor(() => assert.ok(latestCtx));

    let result;
    await act(async () => {
      result = await latestCtx.createSparkWallet();
    });
    assert.strictEqual(result, null);
    expect(addAndSaveWallet).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalled();
    alert.mockRestore();
  });

  it.each([
    ['has no getID method', { type: 'HDsegwitBech32', getSecret: () => MNEMONIC }],
    ['returns an empty id', { type: 'HDsegwitBech32', getSecret: () => MNEMONIC, getID: () => '' }],
    [
      'throws while deriving its id',
      {
        type: 'HDsegwitBech32',
        getSecret: () => MNEMONIC,
        getID: () => {
          throw new Error('id unavailable');
        },
      },
    ],
  ])('does not create an unbound Spark wallet when the source %s', async (_case, source) => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    renderWith([source]);
    await waitFor(() => assert.ok(latestCtx));

    let result;
    await act(async () => {
      result = await latestCtx.createSparkWallet();
    });

    assert.strictEqual(result, null);
    expect(mockConnect).not.toHaveBeenCalled();
    expect(addAndSaveWallet).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalled();
    alert.mockRestore();
  });

  it('falls back to wallets[0] when no HD type is present', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const other = { type: 'legacy', getSecret: () => MNEMONIC, getID: () => 'legacy-1' };
    renderWith([other]);
    await waitFor(() => assert.ok(latestCtx));

    let created;
    await act(async () => {
      created = await latestCtx.createSparkWallet();
    });
    assert.ok(created);
    expect(mockConnect).toHaveBeenCalled();
    alert.mockRestore();
  });

  it('skips a second create while the first is in flight', async () => {
    let resolveConnect;
    mockConnect.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveConnect = () => {
            mockIsConnected.mockReturnValue(true);
            resolve(mockSdk);
          };
        }),
    );
    renderWith([hdWallet]);
    await waitFor(() => assert.ok(latestCtx));

    let first;
    let second;
    await act(async () => {
      first = latestCtx.createSparkWallet();
      second = latestCtx.createSparkWallet();
    });
    // second should short-circuit with null while first is creating
    const secondResult = await second;
    assert.strictEqual(secondResult, null);

    await act(async () => {
      resolveConnect();
    });
    const firstResult = await first;
    assert.ok(firstResult);
  });

  it('still calls connectSparkSdk when a session is already live', async () => {
    mockIsConnected.mockReturnValue(true);
    renderWith([hdWallet]);
    await waitFor(() => assert.ok(latestCtx));

    await act(async () => {
      await latestCtx.createSparkWallet();
    });
    expect(mockConnect).toHaveBeenCalledWith(MNEMONIC, expect.any(Function), undefined);
    expect(addAndSaveWallet).toHaveBeenCalled();
  });

  it('retries Lightning address registration after the Spark identity changes', async () => {
    mockSdk.getLightningAddress.mockResolvedValue(undefined);
    const first = stubSparkMethods(SparkWallet.create('pk-a'));
    const second = SparkWallet.create('pk-b');
    second.fetchBalance = jest.fn().mockResolvedValue(undefined);
    second.fetchTransactions = jest.fn().mockResolvedValue(undefined);
    second.fetchUserInvoices = jest.fn().mockResolvedValue(undefined);
    const setWalletsRef = { current: null };
    function Harness() {
      const [wallets, setWallets] = React.useState([hdWallet, first]);
      React.useEffect(() => {
        setWalletsRef.current = setWallets;
      }, [setWallets]);
      return (
        <BlueStorageContext.Provider value={{ wallets, walletsInitialized: true, addAndSaveWallet, saveToDisk }}>
          <SparkContextProvider>
            <Probe />
          </SparkContextProvider>
        </BlueStorageContext.Provider>
      );
    }

    render(<Harness />);
    await waitFor(() => expect(mockSdk.registerLightningAddress).toHaveBeenCalledTimes(1));
    assert.strictEqual(first.lnAddress, 'reg@breez.blitz');

    mockSdk.registerLightningAddress.mockClear();
    await act(async () => {
      stubSparkMethods(second);
      setWalletsRef.current([hdWallet, second]);
    });
    await waitFor(() => expect(mockSdk.registerLightningAddress).toHaveBeenCalledTimes(1));
    assert.strictEqual(second.lnAddress, 'reg@breez.blitz');
  });

  it('reconnects when the stored Spark wallet identity changes', async () => {
    const seedB = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
    const hdB = { type: 'HDsegwitBech32', getSecret: () => seedB };
    const first = stubSparkMethods(SparkWallet.create('pk-a'));
    const second = stubSparkMethods(SparkWallet.create('pk-b'));
    const setWalletsRef = { current: null };
    function Harness() {
      const [wallets, setWallets] = React.useState([hdWallet, first]);
      React.useEffect(() => {
        setWalletsRef.current = setWallets;
      }, [setWallets]);
      return (
        <BlueStorageContext.Provider value={{ wallets, walletsInitialized: true, addAndSaveWallet, saveToDisk }}>
          <SparkContextProvider>
            <Probe />
          </SparkContextProvider>
        </BlueStorageContext.Provider>
      );
    }

    render(<Harness />);
    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    expect(mockConnect.mock.calls[0][0]).toBe(MNEMONIC);

    mockConnect.mockClear();
    await act(async () => {
      setWalletsRef.current([hdB, second]);
    });
    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    expect(mockConnect.mock.calls[0][0]).toBe(seedB);
  });

  it('hands a new on-chain seed to connectSparkSdk while a session is already live', async () => {
    const seedB = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
    const hdB = { type: 'HDsegwitBech32', getSecret: () => seedB };
    const existing = stubSparkMethods(SparkWallet.create('switch-pk'));
    mockIsConnected.mockReturnValue(true);

    const setInitRef = { current: null };
    const setWalletsRef = { current: null };
    function Harness() {
      const [initialized, setInit] = React.useState(true);
      const [wallets, setWallets] = React.useState([hdWallet, existing]);
      React.useEffect(() => {
        setInitRef.current = setInit;
        setWalletsRef.current = setWallets;
      }, [setInit, setWallets]);
      return (
        <BlueStorageContext.Provider value={{ wallets, walletsInitialized: initialized, addAndSaveWallet, saveToDisk }}>
          <SparkContextProvider>
            <Probe />
          </SparkContextProvider>
        </BlueStorageContext.Provider>
      );
    }

    render(<Harness />);
    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    expect(mockConnect.mock.calls[0][0]).toBe(MNEMONIC);

    mockConnect.mockClear();
    await act(async () => {
      setWalletsRef.current([hdB, existing]);
      setInitRef.current(false);
    });
    await act(async () => {
      setInitRef.current(true);
    });

    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    expect(mockConnect.mock.calls[0][0]).toBe(seedB);
  });

  it('resolves a pending outgoing payment from a PaymentSucceeded event, not from a wait loop', async () => {
    const existing = stubSparkMethods(SparkWallet.create('out-pk'));
    renderWith([hdWallet, existing]);
    await waitFor(() => expect(mockConnect).toHaveBeenCalled());

    await act(async () => {
      beginOutgoingPayment({ paymentHash: 'h-out', paymentId: 'p-out' });
    });
    await waitFor(() => assert.strictEqual(latestCtx.outgoingPayment && latestCtx.outgoingPayment.status, 'pending'));

    const onEvent = mockConnect.lastOnEvent;
    await act(async () => {
      await onEvent({
        tag: SdkEvent_Tags.PaymentSucceeded,
        inner: {
          payment: {
            id: 'p-out',
            paymentType: PaymentType.Send,
            status: PaymentStatus.Completed,
            details: {
              tag: PaymentDetails_Tags.Lightning,
              inner: {
                invoice: 'inv-out',
                description: '',
                destinationPubkey: 'x',
                htlcDetails: { paymentHash: 'h-out', preimage: 'pre-out' },
              },
            },
          },
        },
      });
    });

    assert.strictEqual(latestCtx.outgoingPayment.status, 'completed');
    assert.strictEqual(latestCtx.outgoingPayment.preimage, 'pre-out');
    assert.notStrictEqual(latestCtx.outgoingPayment.status, 'pending');
    assert.notStrictEqual(latestCtx.outgoingPayment.status, 'failed');
  });

  it('refreshes on relevant SDK events and ignores others', async () => {
    const existing = stubSparkMethods(SparkWallet.create('ev-pk'));
    renderWith([hdWallet, existing]);
    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    existing.fetchBalance.mockClear();

    const onEvent = mockConnect.lastOnEvent;
    assert.ok(onEvent);

    await act(async () => {
      await onEvent({ tag: SdkEvent_Tags.Synced });
      await onEvent({ tag: SdkEvent_Tags.PaymentSucceeded });
      await onEvent({ tag: SdkEvent_Tags.PaymentPending });
      await onEvent({ tag: SdkEvent_Tags.PaymentFailed });
      await onEvent({ tag: SdkEvent_Tags.LightningAddressChanged });
      await onEvent({ tag: SdkEvent_Tags.NewDeposits });
      await onEvent({ tag: SdkEvent_Tags.ClaimedDeposits });
      await onEvent({ tag: SdkEvent_Tags.UnclaimedDeposits });
      await onEvent({ tag: 'SomeOtherEvent' });
    });

    // 8 relevant events → refresh each time
    expect(existing.fetchBalance.mock.calls.length).toBe(8);
  });

  it('warns with a fixed tag when deposits stay unclaimed', async () => {
    const existing = stubSparkMethods(SparkWallet.create('unclaimed-pk'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    renderWith([hdWallet, existing]);
    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    warn.mockClear();
    existing.fetchBalance.mockClear();

    const onEvent = mockConnect.lastOnEvent;
    await act(async () => {
      await onEvent({ tag: SdkEvent_Tags.UnclaimedDeposits });
    });

    expect(existing.fetchBalance).toHaveBeenCalled();
    expect(warn.mock.calls.some(c => c[0] === 'SparkContext: unclaimed deposits remain' && c.length === 1)).toBe(true);
    warn.mockRestore();
  });

  it('refresh fetch failure warns with the error class only', async () => {
    const existing = stubSparkMethods(SparkWallet.create('rf-pk'));
    existing.fetchBalance.mockRejectedValueOnce(new Error('balance fail SEED_MARKER'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    renderWith([hdWallet, existing]);
    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    const refreshCalls = warn.mock.calls.filter(c => c[0] === 'SparkContext: refresh failed');
    assert.strictEqual(refreshCalls.length, 1);
    for (const args of refreshCalls) {
      assert.strictEqual(args.length, 2);
      assert.strictEqual(args[0], 'SparkContext: refresh failed');
      assert.strictEqual(args[1], 'Error');
      assert.ok(args.every(a => !String(a).includes('balance fail')));
      assert.ok(args.every(a => !String(a).includes('SEED_MARKER')));
    }
    warn.mockRestore();
  });

  it('refresh sets lnAddress from the SDK when available', async () => {
    const existing = stubSparkMethods(SparkWallet.create('ln-pk'));
    mockSdk.getLightningAddress.mockResolvedValue({ lightningAddress: 'fresh@breez.blitz' });
    renderWith([hdWallet, existing]);
    await waitFor(() => expect(existing.lnAddress).toBe('fresh@breez.blitz'));
    expect(saveToDisk).toHaveBeenCalled();
  });

  it('syncs on foreground AppState active', async () => {
    const listeners = [];
    const orig = AppState.addEventListener;
    AppState.addEventListener = (event, cb) => {
      listeners.push(cb);
      return { remove: jest.fn() };
    };

    mockIsConnected.mockReturnValue(true);
    const existing = stubSparkMethods(SparkWallet.create('fg-pk'));
    // already connected → ensureConnected no-ops connect
    mockConnect.mockImplementation(async () => mockSdk);
    renderWith([hdWallet, existing]);
    await waitFor(() => assert.ok(latestCtx));

    const activeState = 'active';
    await act(async () => {
      for (const listener of listeners) {
        await listener(activeState);
      }
    });
    expect(mockSync).toHaveBeenCalled();

    AppState.addEventListener = orig;
  });

  it('does nothing for a non-active AppState transition', async () => {
    const listeners = [];
    const orig = AppState.addEventListener;
    AppState.addEventListener = (event, cb) => {
      listeners.push(cb);
      return { remove: jest.fn() };
    };
    const existing = stubSparkMethods(SparkWallet.create('background-pk'));
    renderWith([hdWallet, existing]);
    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    mockSync.mockClear();
    mockConnect.mockClear();
    existing.fetchBalance.mockClear();

    await act(async () => {
      for (const listener of listeners) {
        await listener('background');
      }
    });

    expect(mockSync).not.toHaveBeenCalled();
    expect(mockConnect).not.toHaveBeenCalled();
    expect(existing.fetchBalance).not.toHaveBeenCalled();
    AppState.addEventListener = orig;
  });

  it('foreground sync failure is swallowed', async () => {
    const listeners = [];
    const orig = AppState.addEventListener;
    AppState.addEventListener = (event, cb) => {
      listeners.push(cb);
      return { remove: jest.fn() };
    };
    mockIsConnected.mockReturnValue(true);
    mockSync.mockRejectedValue(new Error('sync fail SEED_MARKER'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    renderWith([hdWallet]);
    await waitFor(() => assert.ok(latestCtx));

    await act(async () => {
      for (const listener of listeners) {
        await listener('active');
      }
    });
    const syncCalls = warn.mock.calls.filter(c => c[0] === 'SparkContext: foreground sync failed');
    assert.strictEqual(syncCalls.length, 1);
    for (const args of syncCalls) {
      assert.strictEqual(args[1], 'Error');
      assert.ok(!String(args[1]).includes('sync fail'));
      assert.ok(!String(args[1]).includes('SEED_MARKER'));
    }
    warn.mockRestore();
    AppState.addEventListener = orig;
  });

  it('does not sync on foreground when SDK is disconnected', async () => {
    const listeners = [];
    const orig = AppState.addEventListener;
    AppState.addEventListener = (event, cb) => {
      listeners.push(cb);
      return { remove: jest.fn() };
    };
    mockIsConnected.mockReturnValue(false);
    renderWith([hdWallet]);
    await waitFor(() => assert.ok(latestCtx));

    await act(async () => {
      for (const listener of listeners) {
        await listener('active');
      }
    });
    expect(mockSync).not.toHaveBeenCalled();
    AppState.addEventListener = orig;
  });

  it('logs only the error class when foreground reconnect fails', async () => {
    const listeners = [];
    const orig = AppState.addEventListener;
    AppState.addEventListener = (event, cb) => {
      listeners.push(cb);
      return { remove: jest.fn() };
    };
    const existing = stubSparkMethods(SparkWallet.create('foreground-reconnect-pk'));
    renderWith([hdWallet, existing]);
    await waitFor(() => expect(mockConnect).toHaveBeenCalled());

    mockIsConnected.mockReturnValue(false);
    mockConnect.mockRejectedValueOnce(new Error('offline SEED_MARKER'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await act(async () => {
      for (const listener of listeners) {
        await listener('active');
      }
    });

    const reconnectCalls = warn.mock.calls.filter(c => c[0] === 'SparkContext: foreground reconnect failed');
    assert.strictEqual(reconnectCalls.length, 1);
    assert.strictEqual(reconnectCalls[0][1], 'Error');
    assert.ok(!String(reconnectCalls[0][1]).includes('offline'));
    assert.ok(!String(reconnectCalls[0][1]).includes('SEED_MARKER'));
    expect(mockSync).not.toHaveBeenCalled();
    warn.mockRestore();
    AppState.addEventListener = orig;
  });

  it('swallows a disconnect failure when the Spark wallet is removed', async () => {
    const existing = stubSparkMethods(SparkWallet.create('gone-pk'));
    const setWalletsRef = { current: null };
    function Harness() {
      const [wallets, setWallets] = React.useState([hdWallet, existing]);
      React.useEffect(() => {
        setWalletsRef.current = setWallets;
      }, [setWallets]);
      return (
        <BlueStorageContext.Provider value={{ wallets, walletsInitialized: true, addAndSaveWallet, saveToDisk }}>
          <SparkContextProvider>
            <Probe />
          </SparkContextProvider>
        </BlueStorageContext.Provider>
      );
    }

    render(<Harness />);
    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    mockDisconnect.mockClear();
    mockDisconnect.mockRejectedValueOnce(new Error('native session already gone'));

    await act(async () => {
      setWalletsRef.current([hdWallet]);
    });
    await waitFor(() => expect(mockDisconnect).toHaveBeenCalled());
  });

  it('ignores a late SDK event after the Spark wallet was removed', async () => {
    const existing = stubSparkMethods(SparkWallet.create('removed-event-pk'));
    const setWalletsRef = { current: null };
    function Harness() {
      const [wallets, setWallets] = React.useState([hdWallet, existing]);
      React.useEffect(() => {
        setWalletsRef.current = setWallets;
      }, [setWallets]);
      return (
        <BlueStorageContext.Provider value={{ wallets, walletsInitialized: true, addAndSaveWallet, saveToDisk, deleteWallet }}>
          <SparkContextProvider>
            <Probe />
          </SparkContextProvider>
        </BlueStorageContext.Provider>
      );
    }

    render(<Harness />);
    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    const onEvent = mockConnect.lastOnEvent;
    await act(async () => {
      setWalletsRef.current([hdWallet]);
    });
    await waitFor(() => expect(mockDisconnect).toHaveBeenCalled());
    existing.fetchBalance.mockClear();
    saveToDisk.mockClear();

    await act(async () => {
      await onEvent({ tag: SdkEvent_Tags.Synced });
    });

    expect(existing.fetchBalance).not.toHaveBeenCalled();
    expect(saveToDisk).not.toHaveBeenCalled();
  });

  it('does not disconnect when the Spark wallet remains across an effect re-run', async () => {
    const existing = stubSparkMethods(SparkWallet.create('stay-pk'));
    const setInitRef = { current: null };
    function Harness() {
      const [initialized, setInit] = React.useState(true);
      React.useEffect(() => {
        setInitRef.current = setInit;
      }, [setInit]);
      return (
        <BlueStorageContext.Provider
          value={{ wallets: [hdWallet, existing], walletsInitialized: initialized, addAndSaveWallet, saveToDisk }}
        >
          <SparkContextProvider>
            <Probe />
          </SparkContextProvider>
        </BlueStorageContext.Provider>
      );
    }

    render(<Harness />);
    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    mockDisconnect.mockClear();

    await act(async () => {
      setInitRef.current(false);
    });
    await act(async () => {
      setInitRef.current(true);
    });
    expect(mockDisconnect).not.toHaveBeenCalled();
    await waitFor(() => expect(mockConnect).toHaveBeenCalledTimes(2));
  });

  it('disconnects the SDK when the provider unmounts', async () => {
    const screen = renderWith([hdWallet]);
    await waitFor(() => assert.ok(latestCtx));
    screen.unmount();
    await waitFor(() => expect(mockDisconnect).toHaveBeenCalled());
  });

  it('retry button on create failure re-invokes createSparkWallet', async () => {
    mockConnect.mockRejectedValueOnce(new Error('first fail')).mockImplementation(async () => {
      mockIsConnected.mockReturnValue(true);
      return mockSdk;
    });
    let retryPress;
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      retryPress = buttons && buttons[1] && buttons[1].onPress;
    });
    renderWith([hdWallet]);
    await waitFor(() => assert.ok(latestCtx));

    await act(async () => {
      await latestCtx.createSparkWallet();
    });
    expect(addAndSaveWallet).not.toHaveBeenCalled();
    assert.ok(typeof retryPress === 'function');

    await act(async () => {
      retryPress();
    });
    await waitFor(() => expect(addAndSaveWallet).toHaveBeenCalled());
    alert.mockRestore();
  });

  it('stringifies non-Error connect failures for the alert', async () => {
    mockConnect.mockRejectedValue('plain-string-failure');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    renderWith([hdWallet]);
    await waitFor(() => assert.ok(latestCtx));

    await act(async () => {
      await latestCtx.createSparkWallet();
    });
    expect(alert).toHaveBeenCalled();
    expect(String(alert.mock.calls[0][1])).toBe(expectedUserFacingError('plain-string-failure'));
    expect(String(alert.mock.calls[0][1])).not.toMatch(/plain-string-failure/);
    alert.mockRestore();
  });

  it('shows the localized Spark error plus the error class, never the SDK message', async () => {
    const sdkMessage = 'invalid mnemonic: abandon abandon abandon BREEZ_API_KEY=secret';
    mockConnect.mockRejectedValue(new Error(sdkMessage));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const existing = stubSparkMethods(SparkWallet.create('stored-pk'));
    renderWith([hdWallet, existing]);
    await waitFor(() => expect(alert).toHaveBeenCalled());

    const title = alert.mock.calls[0][0];
    const body = String(alert.mock.calls[0][1]);
    assert.strictEqual(title, loc.wallets.lightning_spark_wallet_label);
    assert.strictEqual(body, loc.formatString(loc.wallets.lightning_spark_generic_error, { kind: 'Error' }));
    assert.ok(!body.includes(sdkMessage));
    assert.ok(!body.includes('abandon'));
    assert.ok(!body.includes('BREEZ_API_KEY'));
    assert.ok(!body.includes('secret'));
    assert.ok(body.includes('Error'));
    alert.mockRestore();
  });

  it('creates without lnAddress when getLightningAddress returns undefined and register yields none', async () => {
    mockSdk.getLightningAddress.mockResolvedValue(undefined);
    mockSdk.registerLightningAddress.mockResolvedValue(undefined);
    renderWith([hdWallet]);
    await waitFor(() => assert.ok(latestCtx));

    let created;
    await act(async () => {
      created = await latestCtx.createSparkWallet();
    });
    assert.ok(created);
    assert.strictEqual(created.lnAddress, undefined);
    expect(addAndSaveWallet).toHaveBeenCalled();
  });

  it('createSparkWallet returns the stored wallet without starting another connect', async () => {
    let resolveConnect;
    let connectCalls = 0;
    mockConnect.mockImplementation(
      () =>
        new Promise(resolve => {
          connectCalls += 1;
          resolveConnect = () => {
            mockIsConnected.mockReturnValue(true);
            resolve(mockSdk);
          };
        }),
    );

    const existing = stubSparkMethods(SparkWallet.create('dup-pk'));
    renderWith([hdWallet, existing]);
    await waitFor(() => expect(mockConnect).toHaveBeenCalled());

    await act(async () => {
      const result = await latestCtx.createSparkWallet();
      assert.strictEqual(result, existing);
    });

    await act(async () => {
      resolveConnect();
    });
    assert.strictEqual(connectCalls, 1);
  });

  it('does not register when the session changes after the availability check', async () => {
    mockSdk.getLightningAddress.mockResolvedValue(undefined);
    mockSdk.checkLightningAddressAvailable.mockImplementation(async () => {
      mockGetSessionIdentity.mockReturnValue('other-session');
      return true;
    });
    const existing = stubSparkMethods(SparkWallet.create('stored-pk'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    renderWith([hdWallet, existing]);
    await waitFor(() => expect(mockSdk.checkLightningAddressAvailable).toHaveBeenCalled());
    await act(async () => {});
    expect(mockSdk.registerLightningAddress).not.toHaveBeenCalled();
    assert.strictEqual(existing.lnAddress, undefined);
    warn.mockRestore();
  });

  it('does not register or write when the session identity changes during refresh', async () => {
    mockSdk.getLightningAddress.mockResolvedValue(undefined);
    const existing = stubSparkMethods(SparkWallet.create('stored-pk'));
    let releaseInvoices;
    existing.fetchUserInvoices.mockImplementation(
      () =>
        new Promise(resolve => {
          releaseInvoices = resolve;
        }),
    );

    renderWith([hdWallet, existing]);
    await waitFor(() => expect(existing.fetchUserInvoices).toHaveBeenCalled());
    mockGetSessionIdentity.mockReturnValue('other-session');
    mockSdk.getLightningAddress.mockResolvedValue({ lightningAddress: 'stolen@breez.blitz' });

    await act(async () => {
      releaseInvoices();
    });
    await act(async () => {});

    expect(mockSdk.getLightningAddress).not.toHaveBeenCalled();
    expect(mockSdk.registerLightningAddress).not.toHaveBeenCalled();
    assert.strictEqual(existing.lnAddress, undefined);
  });

  it('does not write a Lightning address when the session changes after getLightningAddress', async () => {
    const existing = stubSparkMethods(SparkWallet.create('ln-switch-pk'));
    let releaseLn;
    mockSdk.getLightningAddress.mockImplementation(
      () =>
        new Promise(resolve => {
          releaseLn = resolve;
        }),
    );

    renderWith([hdWallet, existing]);
    await waitFor(() => expect(mockSdk.getLightningAddress).toHaveBeenCalled());
    mockGetSessionIdentity.mockReturnValue('other-session');

    await act(async () => {
      releaseLn({ lightningAddress: 'stolen@breez.blitz' });
    });
    await act(async () => {});

    expect(mockSdk.registerLightningAddress).not.toHaveBeenCalled();
    assert.strictEqual(existing.lnAddress, undefined);
  });

  it('does not write a registered Lightning address when the session changes during register', async () => {
    mockSdk.getLightningAddress.mockResolvedValue(undefined);
    const existing = stubSparkMethods(SparkWallet.create('reg-switch-pk'));
    let releaseRegister;
    mockSdk.registerLightningAddress.mockImplementation(
      () =>
        new Promise(resolve => {
          releaseRegister = resolve;
        }),
    );

    renderWith([hdWallet, existing]);
    await waitFor(() => expect(mockSdk.registerLightningAddress).toHaveBeenCalled());
    mockGetSessionIdentity.mockReturnValue('other-session');

    await act(async () => {
      releaseRegister({ lightningAddress: 'stolen@breez.blitz' });
    });
    await act(async () => {});

    assert.strictEqual(existing.lnAddress, undefined);
  });

  it('does not save when the session changes during a refresh registration that yields no address', async () => {
    mockSdk.getLightningAddress.mockResolvedValue(undefined);
    let registerCalls = 0;
    mockSdk.registerLightningAddress.mockImplementation(async () => {
      registerCalls += 1;
      if (registerCalls === 5) {
        mockGetSessionIdentity.mockReturnValue('other-session');
      }
      throw new Error('register down');
    });
    const existing = stubSparkMethods(SparkWallet.create('reg-empty-pk'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    renderWith([hdWallet, existing]);
    await waitFor(() => expect(mockSdk.registerLightningAddress).toHaveBeenCalledTimes(5));
    await act(async () => {});
    expect(saveToDisk).not.toHaveBeenCalled();
    assert.strictEqual(existing.lnAddress, undefined);
    warn.mockRestore();
  });

  it('refresh no-ops when the SDK is not connected', async () => {
    const existing = stubSparkMethods(SparkWallet.create('nc-pk'));
    // Connect once to install the event listener, then mark disconnected.
    renderWith([hdWallet, existing]);
    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    const onEvent = mockConnect.lastOnEvent;
    existing.fetchBalance.mockClear();
    mockIsConnected.mockReturnValue(false);

    await act(async () => {
      await onEvent({ tag: SdkEvent_Tags.Synced });
    });
    expect(existing.fetchBalance).not.toHaveBeenCalled();
  });

  it('creates without lnAddress when getLightningAddress is empty and register rejects', async () => {
    mockSdk.getLightningAddress.mockResolvedValue({ lightningAddress: undefined });
    mockSdk.registerLightningAddress.mockRejectedValue(new Error('register down'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    renderWith([hdWallet]);
    await waitFor(() => assert.ok(latestCtx));
    let created;
    await act(async () => {
      created = await latestCtx.createSparkWallet();
    });
    assert.ok(created);
    assert.strictEqual(created.lnAddress, undefined);
    expect(mockSdk.registerLightningAddress).toHaveBeenCalled();
    expect(addAndSaveWallet).toHaveBeenCalledWith(created);
    warn.mockRestore();
  });

  it('lets a second ensureConnected join connectSparkSdk while the first is still running', async () => {
    const resolvers = [];
    mockConnect.mockImplementation(
      () =>
        new Promise(resolve => {
          resolvers.push(() => {
            mockIsConnected.mockReturnValue(true);
            resolve(mockSdk);
          });
        }),
    );
    const existing = stubSparkMethods(SparkWallet.create('connect-dup-pk'));
    const setInitializedRef = { current: null };
    function Harness() {
      const [initialized, setInit] = React.useState(true);
      React.useEffect(() => {
        setInitializedRef.current = setInit;
      }, [setInit]);
      return (
        <BlueStorageContext.Provider
          value={{ wallets: [hdWallet, existing], walletsInitialized: initialized, addAndSaveWallet, saveToDisk }}
        >
          <SparkContextProvider>
            <Probe />
          </SparkContextProvider>
        </BlueStorageContext.Provider>
      );
    }
    render(<Harness />);
    await waitFor(() => expect(mockConnect).toHaveBeenCalledTimes(1));
    await waitFor(() => assert.ok(setInitializedRef.current));

    await act(async () => {
      setInitializedRef.current(false);
    });
    await act(async () => {
      setInitializedRef.current(true);
    });
    expect(mockConnect).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolvers.forEach(resolve => resolve());
    });
  });

  it('swallows disconnect failure when the provider unmounts', async () => {
    mockDisconnect.mockRejectedValue(new Error('already gone'));
    const screen = renderWith([hdWallet]);
    await waitFor(() => assert.ok(latestCtx));
    screen.unmount();
    await waitFor(() => expect(mockDisconnect).toHaveBeenCalled());
  });

  it('swallows disconnect failure after a failed create', async () => {
    mockConnect.mockRejectedValue(new Error('boom'));
    mockDisconnect.mockRejectedValue(new Error('already gone'));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    renderWith([hdWallet]);
    await waitFor(() => assert.ok(latestCtx));
    await act(async () => {
      await latestCtx.createSparkWallet();
    });
    expect(mockDisconnect).toHaveBeenCalled();
    alert.mockRestore();
  });

  it('swallows a retry that rejects after the alert handler runs', async () => {
    mockConnect.mockRejectedValue(new Error('first fail'));
    let retryPress;
    let alertCalls = 0;
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      alertCalls += 1;
      retryPress = buttons && buttons[1] && buttons[1].onPress;
      if (alertCalls > 1) {
        throw new Error('alert cannot open twice');
      }
    });
    renderWith([hdWallet]);
    await waitFor(() => assert.ok(latestCtx));
    await act(async () => {
      await latestCtx.createSparkWallet();
    });
    assert.ok(typeof retryPress === 'function');
    await act(async () => {
      retryPress();
    });
    alert.mockRestore();
  });

  it('hands the on-chain BIP39 passphrase to connectSparkSdk', async () => {
    const hd = {
      type: 'HDsegwitBech32',
      getSecret: () => MNEMONIC,
      getPassphrase: () => 'super secret passphrase',
    };
    const existing = stubSparkMethods(SparkWallet.create('stored-pk'));
    renderWith([hd, existing]);
    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    expect(mockConnect).toHaveBeenCalledWith(MNEMONIC, expect.any(Function), 'super secret passphrase');
  });

  it('creates from an on-chain wallet that has no getPassphrase method', async () => {
    const wallet = { type: 'HDsegwitBech32', getSecret: () => MNEMONIC, getID: () => 'hd-no-pass' };
    assert.strictEqual('getPassphrase' in wallet, false);
    renderWith([wallet]);
    await waitFor(() => assert.ok(latestCtx));

    let created;
    await act(async () => {
      created = await latestCtx.createSparkWallet();
    });
    assert.ok(created);
    expect(mockConnect).toHaveBeenCalledWith(MNEMONIC, expect.any(Function), undefined);
    expect(addAndSaveWallet).toHaveBeenCalledWith(created);
  });

  it('does not treat a missing or empty passphrase as an empty string', async () => {
    const hd = {
      type: 'HDsegwitBech32',
      getSecret: () => MNEMONIC,
      getPassphrase: () => '',
    };
    const existing = stubSparkMethods(SparkWallet.create('stored-pk'));
    renderWith([hd, existing]);
    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    expect(mockConnect).toHaveBeenCalledWith(MNEMONIC, expect.any(Function), undefined);
    assert.notStrictEqual(mockConnect.mock.calls[0][2], '');
  });

  it('does not put the BIP39 passphrase into console.error or the alert', async () => {
    const passphrase = 'unique-passphrase-marker-xyzzy';
    const hd = {
      type: 'HDsegwitBech32',
      getSecret: () => MNEMONIC,
      getPassphrase: () => passphrase,
    };
    mockConnect.mockRejectedValue(new Error(`invalid mnemonic: ${MNEMONIC} passphrase=${passphrase}`));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const existing = stubSparkMethods(SparkWallet.create('stored-pk'));
    renderWith([hd, existing]);

    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
    for (const args of errorSpy.mock.calls) {
      for (const arg of args) {
        assert.ok(!String(arg).includes(passphrase), `console.error must not contain passphrase: ${arg}`);
      }
    }
    expect(alert).toHaveBeenCalled();
    expect(String(alert.mock.calls[0][1])).not.toContain(passphrase);
    expect(errorSpy.mock.calls.some(c => c[0] === 'SparkContext: failed to connect' && c[1] === 'Error')).toBe(true);

    alert.mockRestore();
    errorSpy.mockRestore();
  });

  it('records the source wallet id at create, not the recovery phrase', async () => {
    const hdA = {
      type: 'HDsegwitBech32',
      getSecret: () => MNEMONIC,
      getID: () => 'hd-a',
      getLabel: () => 'Savings',
    };
    const hdB = {
      type: 'HDsegwitBech32',
      getSecret: () => MNEMONIC_B,
      getID: () => 'hd-b',
      getLabel: () => 'Spending',
    };
    renderWith([hdA, hdB]);
    await waitFor(() => assert.ok(latestCtx));

    let created;
    await act(async () => {
      created = await latestCtx.createSparkWallet();
    });

    assert.ok(created);
    assert.strictEqual(created.sourceWalletId, 'hd-a');
    assert.strictEqual(created.sourceWalletLabel, 'Savings');
    assert.notStrictEqual(created.sourceWalletId, MNEMONIC);
    assert.notStrictEqual(created.sourceWalletId, MNEMONIC_B);
    assert.ok(!String(created.sourceWalletId).includes('abandon'));
    assert.ok(!String(created.sourceWalletId).includes('winner'));
    expect(mockConnect).toHaveBeenCalledWith(MNEMONIC, expect.any(Function), undefined);
  });

  it('connects with the bound source wallet after HD wallets are reordered', async () => {
    const hdA = {
      type: 'HDsegwitBech32',
      getSecret: () => MNEMONIC,
      getID: () => 'hd-a',
      getLabel: () => 'Savings',
    };
    const hdB = {
      type: 'HDsegwitBech32',
      getSecret: () => MNEMONIC_B,
      getID: () => 'hd-b',
      getLabel: () => 'Spending',
    };
    const spark = stubSparkMethods(SparkWallet.create('pk-bound'));
    spark.sourceWalletId = 'hd-a';
    renderWith([hdB, hdA, spark]);
    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    expect(mockConnect).toHaveBeenCalledWith(MNEMONIC, expect.any(Function), undefined);
    assert.strictEqual(mockConnect.mock.calls[0][0], MNEMONIC);
    assert.notStrictEqual(mockConnect.mock.calls[0][0], MNEMONIC_B);
  });

  it('does not fall back to another HD wallet when the bound source is missing', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const hdB = {
      type: 'HDsegwitBech32',
      getSecret: () => MNEMONIC_B,
      getID: () => 'hd-b',
      getLabel: () => 'Spending',
    };
    const spark = stubSparkMethods(SparkWallet.create('pk-bound'));
    spark.sourceWalletId = 'hd-deleted';
    spark.sourceWalletLabel = 'Savings';
    renderWith([hdB, spark]);
    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(mockConnect).not.toHaveBeenCalled();
    const body = String(alert.mock.calls[0][1]);
    assert.strictEqual(body, loc.formatString(loc.wallets.lightning_spark_source_missing, { label: 'Savings' }));
    assert.ok(!body.includes('hd-deleted'));
    assert.ok(!body.includes(MNEMONIC_B));
    assert.ok(!body.includes('abandon'));
    alert.mockRestore();
  });

  it('uses the main-wallet label when a missing bound source has no stored label', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const spark = stubSparkMethods(SparkWallet.create('pk-bound-without-label'));
    spark.sourceWalletId = 'hd-deleted';
    renderWith([hdWallet, spark]);

    await waitFor(() => expect(alert).toHaveBeenCalled());

    assert.strictEqual(
      String(alert.mock.calls[0][1]),
      loc.formatString(loc.wallets.lightning_spark_source_missing, { label: loc.wallets.main_wallet_label }),
    );
    expect(mockConnect).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('retries a failed initial connect on the next foreground without restarting', async () => {
    const listeners = [];
    const orig = AppState.addEventListener;
    AppState.addEventListener = (event, cb) => {
      listeners.push(cb);
      return { remove: jest.fn() };
    };
    mockConnect.mockRejectedValueOnce(new Error('offline')).mockImplementation(async () => {
      mockIsConnected.mockReturnValue(true);
      return mockSdk;
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const existing = stubSparkMethods(SparkWallet.create('stored-pk'));
    renderWith([hdWallet, existing]);
    await waitFor(() => {
      expect(alert).toHaveBeenCalled();
      assert.strictEqual(latestCtx.isConnected, false);
    });
    expect(mockConnect).toHaveBeenCalledTimes(1);

    mockIsConnected.mockReturnValue(false);
    await act(async () => {
      for (const listener of listeners) {
        await listener('active');
      }
    });
    await waitFor(() => expect(mockConnect.mock.calls.length).toBeGreaterThanOrEqual(2));
    await waitFor(() => assert.strictEqual(latestCtx.isConnected, true));
    expect(mockConnect.mock.calls[mockConnect.mock.calls.length - 1][0]).toBe(MNEMONIC);

    alert.mockRestore();
    AppState.addEventListener = orig;
  });

  it('rolls back the locally created wallet when saving fails before the store exposes it', async () => {
    addAndSaveWallet.mockRejectedValueOnce(new Error('disk full'));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    renderWith([hdWallet]);
    await waitFor(() => assert.ok(latestCtx));

    let result;
    await act(async () => {
      result = await latestCtx.createSparkWallet();
    });

    assert.strictEqual(result, null);
    expect(deleteWallet).toHaveBeenCalledTimes(1);
    const rolledBack = deleteWallet.mock.calls[0][0];
    assert.ok(rolledBack instanceof SparkWallet);
    assert.strictEqual(rolledBack.identityPubkey, 'pk-1');
    expect(mockDisconnect).toHaveBeenCalled();
    expect(alert).toHaveBeenCalled();
    alert.mockRestore();
  });

  it('removes the in-memory Spark wallet when saving it to disk fails', async () => {
    const hd = {
      type: 'HDsegwitBech32',
      getSecret: () => MNEMONIC,
      getID: () => 'hd-a',
      getLabel: () => 'A',
    };
    const store = [hd];
    const deleteWalletFromStore = jest.fn(w => {
      const id = w.getID();
      const idx = store.findIndex(x => {
        try {
          return x.getID() === id;
        } catch {
          return false;
        }
      });
      if (idx >= 0) store.splice(idx, 1);
    });
    const addAndSaveMutating = jest.fn(async w => {
      store.push(w);
      throw new Error('disk full');
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    latestCtx = null;
    render(
      <BlueStorageContext.Provider
        value={{
          wallets: store,
          walletsInitialized: true,
          addAndSaveWallet: addAndSaveMutating,
          saveToDisk,
          deleteWallet: deleteWalletFromStore,
        }}
      >
        <SparkContextProvider>
          <Probe />
        </SparkContextProvider>
      </BlueStorageContext.Provider>,
    );
    await waitFor(() => assert.ok(latestCtx));

    let result;
    await act(async () => {
      result = await latestCtx.createSparkWallet();
    });

    assert.strictEqual(result, null);
    expect(addAndSaveMutating).toHaveBeenCalled();
    expect(deleteWalletFromStore).toHaveBeenCalled();
    assert.strictEqual(
      store.some(w => w.type === SparkWallet.type),
      false,
    );
    assert.strictEqual(store.length, 1);
    assert.strictEqual(store[0], hd);
    alert.mockRestore();
  });
});
