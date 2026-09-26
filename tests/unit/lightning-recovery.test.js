import React from 'react';
import { act, render } from '@testing-library/react-native';

const mockFindUser = jest.fn();
const mockRecoverSparkWallet = jest.fn();
const mockCreateSparkWallet = jest.fn();
const mockOpenLightningLdsWallet = jest.fn();
const mockReportError = jest.fn();

jest.mock('../../api/lds/hooks/lds.hook', () => ({ useLds: () => ({ findUser: mockFindUser }) }));
jest.mock('../../api/spark/contexts/spark.context', () => ({
  useSparkContext: () => ({ recoverSparkWallet: mockRecoverSparkWallet, createSparkWallet: mockCreateSparkWallet }),
}));
jest.mock('../../api/lds/lightning-lds-wallet-factory', () => ({
  openLightningLdsWallet: (...args) => mockOpenLightningLdsWallet(...args),
}));
jest.mock('../../helpers/errors', () => ({ reportError: (...args) => mockReportError(...args) }));
jest.mock('../../blue_modules/storage-context', () => {
  const ReactModule = require('react');
  return { BlueStorageContext: ReactModule.createContext({}) };
});
jest.mock('../../class', () => {
  const makeClass = (type, prefix) => {
    function FakeHd() {
      this.type = type;
    }
    FakeHd.type = type;
    FakeHd.prototype.setSecret = function (secret) {
      this.secret = secret;
    };
    FakeHd.prototype.setPassphrase = function (passphrase) {
      this.passphrase = passphrase;
    };
    FakeHd.prototype._getExternalAddressByIndex = function () {
      return `${prefix}-${this.secret}-${this.passphrase || ''}`;
    };
    FakeHd.prototype.signMessage = function (message, address) {
      return `sig(${address})`;
    };
    return FakeHd;
  };
  return {
    HDSegwitBech32Wallet: makeClass('HDsegwitBech32', 'bc1'),
    HDSegwitP2SHWallet: makeClass('HDsegwitP2SH', '3'),
    HDLegacyP2PKHWallet: makeClass('HDlegacyP2PKH', '1'),
    HDLegacyBreadwalletWallet: makeClass('HDLegacyBreadwallet', 'brd'),
  };
});

const { BlueStorageContext } = require('../../blue_modules/storage-context');
const { useLightningRecovery, LIGHTNING_RECOVERY_MAX_WAIT_MS } = require('../../hooks/lightningRecovery.hook');

const addAndSaveWallet = jest.fn().mockResolvedValue(undefined);

function importedWallet(type = 'HDsegwitBech32', prefix = 'bc1') {
  return {
    type,
    getSecret: () => 'seed words',
    getPassphrase: () => 'pass',
    getID: () => 'imported',
    getLabel: () => 'On-chain',
    _getExternalAddressByIndex: () => `${prefix}-seed words-pass`,
    signMessage: (message, address) => `sig(${address})`,
  };
}

const ldsUser = (wallets = [{ asset: { name: 'BTC' }, lndhubAdminUrl: 'secret@https://lndhub.example' }]) => ({
  address: 'bc1-seed words-pass',
  lightning: { address: 'user@lightning.space', addressLnurl: 'LNURL', addressOwnershipProof: 'proof', wallets },
});

function mountHook() {
  let hook;
  const Probe = () => {
    hook = useLightningRecovery();
    return null;
  };
  render(
    <BlueStorageContext.Provider value={{ addAndSaveWallet }}>
      <Probe />
    </BlueStorageContext.Provider>,
  );
  return hook;
}

async function recover(wallet) {
  const hook = mountHook();
  await act(async () => {
    await hook.recoverLightningWallet(wallet);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFindUser.mockResolvedValue(undefined);
  mockRecoverSparkWallet.mockResolvedValue(null);
  mockOpenLightningLdsWallet.mockResolvedValue({ type: 'lightningLdsWallet' });
});

describe('useLightningRecovery', () => {
  it('restores the lightning.space wallet and skips Spark when an account exists', async () => {
    mockFindUser.mockResolvedValueOnce(ldsUser());
    await recover(importedWallet());

    expect(mockOpenLightningLdsWallet).toHaveBeenCalledWith('secret@https://lndhub.example', 'user@lightning.space', 'proof');
    expect(addAndSaveWallet).toHaveBeenCalledWith({ type: 'lightningLdsWallet' });
    expect(mockRecoverSparkWallet).not.toHaveBeenCalled();
  });

  it('signs in with the imported address first and never signs up', async () => {
    await recover(importedWallet());

    const addresses = mockFindUser.mock.calls.map(call => call[0]);
    expect(addresses).toEqual(['bc1-seed words-pass', '3-seed words-pass']);
    await expect(mockFindUser.mock.calls[0][1]('message')).resolves.toBe('sig(bc1-seed words-pass)');
    await expect(mockFindUser.mock.calls[1][1]('message')).resolves.toBe('sig(3-seed words-pass)');
  });

  it('also tries the BIP84 and BIP49 addresses of a legacy import, keeping the passphrase', async () => {
    mockFindUser.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(ldsUser());
    await recover(importedWallet('HDlegacyP2PKH', '1'));

    expect(mockFindUser.mock.calls.map(call => call[0])).toEqual(['1-seed words-pass', 'bc1-seed words-pass', '3-seed words-pass']);
    expect(addAndSaveWallet).toHaveBeenCalledTimes(1);
    expect(mockRecoverSparkWallet).not.toHaveBeenCalled();
  });

  it('restores Spark only when no lightning.space account exists', async () => {
    const wallet = importedWallet();
    await recover(wallet);

    expect(mockFindUser).toHaveBeenCalledTimes(2);
    expect(mockRecoverSparkWallet).toHaveBeenCalledWith(wallet);
    expect(addAndSaveWallet).not.toHaveBeenCalled();
  });

  it('falls back to Spark when the account has no BTC Lightning wallet', async () => {
    mockFindUser.mockResolvedValueOnce(ldsUser([{ asset: { name: 'CHF' }, lndhubAdminUrl: 'secret@https://lndhub.example' }]));
    const wallet = importedWallet();
    await recover(wallet);

    expect(mockOpenLightningLdsWallet).not.toHaveBeenCalled();
    expect(mockRecoverSparkWallet).toHaveBeenCalledWith(wallet);
  });

  it('creates nothing when the lightning.space check fails', async () => {
    mockFindUser.mockRejectedValueOnce({ statusCode: 503, message: 'unavailable' });
    await recover(importedWallet());

    expect(addAndSaveWallet).not.toHaveBeenCalled();
    expect(mockRecoverSparkWallet).not.toHaveBeenCalled();
    expect(mockReportError).toHaveBeenCalledWith('lightningRecovery: recovery check failed', expect.anything());
  });

  it('ignores wallets that cannot derive a Lightning account', async () => {
    await recover({ ...importedWallet(), type: 'watchOnly' });

    expect(mockFindUser).not.toHaveBeenCalled();
    expect(mockRecoverSparkWallet).not.toHaveBeenCalled();
  });
});

describe('useLightningRecovery addLightningWallet', () => {
  it('adds the existing lightning.space wallet instead of creating Spark', async () => {
    mockFindUser.mockResolvedValueOnce(ldsUser());
    const hook = mountHook();
    await act(async () => {
      await hook.addLightningWallet(importedWallet());
    });

    expect(addAndSaveWallet).toHaveBeenCalledWith({ type: 'lightningLdsWallet' });
    expect(mockCreateSparkWallet).not.toHaveBeenCalled();
  });

  it('creates the Spark wallet when the seed has no lightning.space account', async () => {
    const hook = mountHook();
    await act(async () => {
      await hook.addLightningWallet(importedWallet());
    });

    expect(mockFindUser).toHaveBeenCalledTimes(2);
    expect(mockCreateSparkWallet).toHaveBeenCalledTimes(1);
    expect(mockCreateSparkWallet).toHaveBeenCalledWith(expect.objectContaining({ type: importedWallet().type }));
    expect(mockRecoverSparkWallet).not.toHaveBeenCalled();
  });

  it('creates the Spark wallet directly for a wallet that cannot have a lightning.space login', async () => {
    const hook = mountHook();
    await act(async () => {
      await hook.addLightningWallet({ ...importedWallet(), type: 'watchOnly' });
    });

    expect(mockFindUser).not.toHaveBeenCalled();
    expect(mockCreateSparkWallet).toHaveBeenCalledTimes(1);
  });

  it('throws a failed lightning.space check to the caller and creates nothing', async () => {
    mockFindUser.mockRejectedValueOnce({ statusCode: 503 });
    const hook = mountHook();
    await expect(hook.addLightningWallet(importedWallet())).rejects.toEqual({ statusCode: 503 });
    expect(mockCreateSparkWallet).not.toHaveBeenCalled();
    expect(addAndSaveWallet).not.toHaveBeenCalled();
  });
});

describe('useLightningRecovery waitForLightningRecovery', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves once the recovery has finished', async () => {
    mockFindUser.mockResolvedValueOnce(ldsUser());
    const hook = mountHook();
    await act(async () => {
      await hook.waitForLightningRecovery(importedWallet());
    });
    expect(addAndSaveWallet).toHaveBeenCalledWith({ type: 'lightningLdsWallet' });
  });

  it('stops waiting after the cap while the recovery keeps running', async () => {
    jest.useFakeTimers();
    mockFindUser.mockReturnValue(new Promise(() => {}));
    const hook = mountHook();
    let done = false;
    hook.waitForLightningRecovery(importedWallet()).then(() => {
      done = true;
    });
    await act(async () => {
      jest.advanceTimersByTime(LIGHTNING_RECOVERY_MAX_WAIT_MS - 1);
    });
    expect(done).toBe(false);
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(done).toBe(true);
  });
});
