import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';

const mockAuth = jest.fn();
const mockGetSignMessage = jest.fn();
const mockGetLnurlFromAddress = jest.fn();
const mockSessionSet = jest.fn();

jest.mock('../../api/dfx/hooks/auth.hook', () => ({
  useAuth: () => ({ auth: mockAuth, getSignMessage: mockGetSignMessage }),
}));

jest.mock('../../api/dfx/hooks/api.hook', () => ({
  useApi: () => ({ call: jest.fn() }),
}));

jest.mock('../../hooks/store.hook', () => ({
  useStore: () => ({
    dfxSession: { set: mockSessionSet, remove: jest.fn() },
  }),
}));

jest.mock('../../contexts/wallet.context', () => ({
  useWalletContext: () => ({
    walletID: 'main-wallet-id',
    address: 'main-wallet-address',
    signMessage: jest.fn(),
    getOwnershipProof: jest.fn(),
  }),
}));

jest.mock('../../blue_modules/storage-context', () => {
  const ReactModule = require('react');
  return { BlueStorageContext: ReactModule.createContext({ wallets: [] }) };
});

jest.mock('../../api/dfx/contexts/language.context', () => ({
  useLanguageContext: () => ({ languages: [] }),
}));

jest.mock('../../class/lnurl', () => ({
  __esModule: true,
  default: { getLnurlFromAddress: mockGetLnurlFromAddress },
}));

// Avoid pulling the full wallet class graph (circular imports under Jest).
jest.mock('../../class/wallets/lightning-lds-wallet', () => ({
  LightningLdsWallet: { type: 'lightningLdsWallet' },
}));
jest.mock('../../class/wallets/taproot-lds-wallet', () => ({
  TaprootLdsWallet: { type: 'taprootLdsWallet' },
}));
jest.mock('../../class/wallets/spark-wallet', () => ({
  SparkWallet: { type: 'sparkWallet' },
}));

jest.mock('../../loc', () => ({
  __esModule: true,
  default: {
    getLanguage: () => 'en',
    wallets: { lightning_spark_address_unavailable: 'Spark Lightning address is unavailable' },
  },
}));

const { BlueStorageContext } = require('../../blue_modules/storage-context');
const { DfxSessionContextProvider, useDfxSessionContext } = require('../../api/dfx/contexts/session.context');
const { LightningLdsWallet } = require('../../class/wallets/lightning-lds-wallet');
const { TaprootLdsWallet } = require('../../class/wallets/taproot-lds-wallet');
const { SparkWallet } = require('../../class/wallets/spark-wallet');
const { Linking } = require('react-native');

function renderSession(wallets) {
  let currentWallets = wallets;
  const wrapper = ({ children }) => (
    <BlueStorageContext.Provider value={{ wallets: currentWallets }}>
      <DfxSessionContextProvider>{children}</DfxSessionContextProvider>
    </BlueStorageContext.Provider>
  );

  const rendered = renderHook(() => useDfxSessionContext(), { wrapper });
  return {
    ...rendered,
    updateWallets(nextWallets) {
      currentWallets = nextWallets;
      rendered.rerender();
    },
  };
}

async function getAccessToken(result, walletId) {
  let token;
  await act(async () => {
    token = await result.current.getAccessToken(walletId);
  });
  return token;
}

describe('DFX wallet session identity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ accessToken: 'access-token' });
    mockGetSignMessage.mockImplementation(address => `sign:${address}`);
    mockGetLnurlFromAddress.mockReturnValue('lnurl1sparkaddress');
    jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('defers Spark authentication while exposing services for the existing on-demand flow', async () => {
    const sparkAddress = 'spark1abcdefghijklmnopqrstuvwxyz';
    const signCompactMessage = jest.fn().mockResolvedValue('compact-signature');
    const getSparkAddress = jest.fn().mockResolvedValue(sparkAddress);
    const wallet = {
      type: SparkWallet.type,
      getID: () => 'spark-wallet-id',
      lnAddress: 'alice@example.com',
      getSparkAddress,
      signCompactMessage,
    };
    const { result } = renderSession([wallet]);

    await waitFor(() => expect(result.current.isAvailable).toBe(true));
    expect(result.current.isAvailable).toBe(true);
    expect(result.current.isUnavailable).toBe(false);
    expect(mockAuth).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.openServices('spark-wallet-id', '1', 'buy');
    });
    expect(mockAuth).toHaveBeenCalledWith(sparkAddress, 'compact-signature');
    expect(Linking.openURL).toHaveBeenCalledWith(expect.stringContaining('session=access-token'));
  });

  it('keeps a multisig-only wallet unavailable without throwing an empty-startup reason', async () => {
    const wallet = { type: 'HDmultisig', getID: () => 'multisig-wallet-id' };
    const { result } = renderSession([wallet]);

    expect(result.current.isInitialized).toBe(false);
    expect(result.current.isAvailable).toBe(false);
    expect(result.current.isUnavailable).toBe(false);
    expect(mockAuth).not.toHaveBeenCalled();
  });

  it('keeps a nonempty network failure fail-closed', async () => {
    mockAuth.mockRejectedValue(new Error('network unavailable'));
    const wallet = {
      type: LightningLdsWallet.type,
      getID: () => 'lds-wallet-id',
      lnAddress: 'bob@example.com',
      addressOwnershipProof: 'lds-ownership-proof',
    };
    const { result } = renderSession([wallet]);

    await waitFor(() => expect(result.current.isUnavailable).toBe(true));
    expect(result.current.isAvailable).toBe(false);
    expect(result.current.isInitialized).toBe(false);
  });

  it('treats an all-403 nonempty startup as forbidden without enabling services', async () => {
    mockAuth.mockRejectedValue(Object.assign(new Error('forbidden'), { statusCode: 403 }));
    const wallet = {
      type: LightningLdsWallet.type,
      getID: () => 'lds-wallet-id',
      lnAddress: 'bob@example.com',
      addressOwnershipProof: 'lds-ownership-proof',
    };
    const { result } = renderSession([wallet]);

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    expect(result.current.isAvailable).toBe(false);
    expect(result.current.isUnavailable).toBe(false);
  });

  it('authenticates an eligible wallet added after deferred Spark startup', async () => {
    mockGetLnurlFromAddress.mockImplementation(address => (address === 'bob@example.com' ? 'lnurl1ldsaddress' : 'lnurl1sparkaddress'));
    const sparkWallet = {
      type: SparkWallet.type,
      getID: () => 'spark-wallet-id',
      lnAddress: 'alice@example.com',
      signCompactMessage: jest.fn().mockResolvedValue('spark-signature'),
    };
    const ldsWallet = {
      type: LightningLdsWallet.type,
      getID: () => 'lds-wallet-id',
      lnAddress: 'bob@example.com',
      addressOwnershipProof: 'lds-ownership-proof',
    };
    const session = renderSession([sparkWallet]);

    await waitFor(() => expect(session.result.current.isAvailable).toBe(true));
    expect(mockAuth).not.toHaveBeenCalled();

    await act(async () => session.updateWallets([sparkWallet, ldsWallet]));
    await waitFor(() => expect(mockAuth).toHaveBeenCalledWith('LNURL1LDSADDRESS', 'lds-ownership-proof'));
    expect(session.result.current.isAvailable).toBe(true);
  });

  it('authenticates the eligible Taproot wallet in a mixed Spark startup', async () => {
    const taprootWallet = {
      type: TaprootLdsWallet.type,
      getID: () => 'taproot-wallet-id',
      lnAddress: 'bob@example.com',
      addressOwnershipProof: 'taproot-ownership-proof',
    };
    const sparkWallet = {
      type: SparkWallet.type,
      getID: () => 'spark-wallet-id',
      lnAddress: 'alice@example.com',
      signCompactMessage: jest.fn().mockResolvedValue('spark-signature'),
    };
    mockGetLnurlFromAddress.mockReturnValue('lnurl1taprootaddress');
    const session = renderSession([sparkWallet, taprootWallet]);

    await waitFor(() => expect(session.result.current.isAvailable).toBe(true));
    expect(mockAuth).toHaveBeenCalledWith('LNURL1TAPROOTADDRESS', 'taproot-ownership-proof');
    expect(sparkWallet.signCompactMessage).not.toHaveBeenCalled();
  });

  it('keeps Spark available when the eligible wallet is removed, then hides services when Spark is removed too', async () => {
    const ldsWallet = {
      type: LightningLdsWallet.type,
      getID: () => 'lds-wallet-id',
      lnAddress: 'bob@example.com',
      addressOwnershipProof: 'lds-ownership-proof',
    };
    const sparkWallet = {
      type: SparkWallet.type,
      getID: () => 'spark-wallet-id',
      lnAddress: 'alice@example.com',
      signCompactMessage: jest.fn().mockResolvedValue('spark-signature'),
    };
    const session = renderSession([ldsWallet, sparkWallet]);

    await waitFor(() => expect(mockAuth).toHaveBeenCalled());
    await act(async () => session.updateWallets([sparkWallet]));
    await waitFor(() => expect(session.result.current.isAvailable).toBe(true));

    await act(async () => session.updateWallets([]));
    await waitFor(() => expect(session.result.current.isAvailable).toBe(false));
    expect(mockAuth).toHaveBeenCalledTimes(1);
  });

  it('authenticates a Spark wallet with its Spark address without uppercasing or an identity key', async () => {
    const sparkAddress = 'spark1abcdefghijklmnopqrstuvwxyz';
    const getSparkAddress = jest.fn().mockResolvedValue(sparkAddress);
    const signCompactMessage = jest.fn().mockResolvedValue('compact-signature');
    const wallet = {
      type: SparkWallet.type,
      getID: () => 'spark-wallet-id',
      getSparkAddress,
      lnAddress: 'alice@example.com',
      identityPubkey: '02identity-public-key',
      signCompactMessage,
    };
    const { result } = renderSession([wallet]);

    await expect(getAccessToken(result, 'spark-wallet-id')).resolves.toBe('access-token');

    expect(getSparkAddress).toHaveBeenCalled();
    expect(mockGetLnurlFromAddress).not.toHaveBeenCalled();
    expect(mockGetSignMessage).toHaveBeenCalledWith(sparkAddress);
    expect(mockGetSignMessage).not.toHaveBeenCalledWith(sparkAddress.toUpperCase());
    expect(signCompactMessage).toHaveBeenCalledWith(`sign:${sparkAddress}`);
    expect(mockAuth).toHaveBeenCalledWith(sparkAddress, 'compact-signature');
    const [address, signature, ...additionalArguments] = mockAuth.mock.calls[0];
    expect(address).toBe(sparkAddress);
    expect(address).not.toBe(sparkAddress.toUpperCase());
    const body = {
      address,
      signature,
      ...(additionalArguments.length ? { key: additionalArguments[0] } : {}),
    };
    expect('key' in body).toBe(false);
  });

  it('authenticates a Spark wallet from its Spark address even when Lightning address is missing', async () => {
    const sparkAddress = 'spark1abcdefghijklmnopqrstuvwxyz';
    const getSparkAddress = jest.fn().mockResolvedValue(sparkAddress);
    const signCompactMessage = jest.fn().mockResolvedValue('compact-signature');
    const wallet = {
      type: SparkWallet.type,
      getID: () => 'spark-wallet-id',
      getSparkAddress,
      identityPubkey: '02identity-public-key',
      signCompactMessage,
    };
    const { result } = renderSession([wallet]);

    await expect(getAccessToken(result, 'spark-wallet-id')).resolves.toBe('access-token');

    expect(getSparkAddress).toHaveBeenCalled();
    expect(mockGetLnurlFromAddress).not.toHaveBeenCalled();
    expect(mockGetSignMessage).toHaveBeenCalledWith(sparkAddress);
    expect(signCompactMessage).toHaveBeenCalledWith(`sign:${sparkAddress}`);
    expect(mockAuth).toHaveBeenCalledWith(sparkAddress, 'compact-signature');
  });

  it('rejects a Spark wallet without its Spark address instead of falling back to Lightning', async () => {
    const getSparkAddress = jest.fn().mockResolvedValue('');
    const signCompactMessage = jest.fn();
    const wallet = {
      type: SparkWallet.type,
      getID: () => 'spark-wallet-id',
      getSparkAddress,
      lnAddress: 'alice@example.com',
      identityPubkey: '02identity-public-key',
      signCompactMessage,
    };
    const { result } = renderSession([wallet]);

    await expect(getAccessToken(result, 'spark-wallet-id')).rejects.toThrow('Spark Lightning address is unavailable');

    expect(getSparkAddress).toHaveBeenCalled();
    expect(mockAuth).not.toHaveBeenCalled();
    expect(signCompactMessage).not.toHaveBeenCalled();
    expect(mockGetLnurlFromAddress).not.toHaveBeenCalled();
  });

  it('keeps LDS authentication on its uppercase Lightning LNURL without a key', async () => {
    mockGetLnurlFromAddress.mockReturnValue('lnurl1ldsaddress');
    const wallet = {
      type: LightningLdsWallet.type,
      getID: () => 'lds-wallet-id',
      lnAddress: 'bob@example.com',
      addressOwnershipProof: 'lds-ownership-proof',
    };
    const { result } = renderSession([wallet]);

    await expect(getAccessToken(result, 'lds-wallet-id')).resolves.toBe('access-token');

    expect(mockGetLnurlFromAddress).toHaveBeenCalledWith('bob@example.com');
    expect(mockAuth.mock.calls[0].slice(0, 2)).toEqual(['LNURL1LDSADDRESS', 'lds-ownership-proof']);
    expect(mockAuth.mock.calls[0][2]).toBeUndefined();
  });
});
