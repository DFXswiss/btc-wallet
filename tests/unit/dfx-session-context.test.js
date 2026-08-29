import React from 'react';
import { act, renderHook } from '@testing-library/react-native';

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

jest.mock('../../api/dfx/dfx-connect-at-init', () => ({
  dfxAvailabilityFromSettled: () => 'available',
  dfxConnectAtInit: () => false,
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
const {
  DfxSessionContextProvider,
  useDfxSessionContext,
} = require('../../api/dfx/contexts/session.context');
const { LightningLdsWallet } = require('../../class/wallets/lightning-lds-wallet');
const { SparkWallet } = require('../../class/wallets/spark-wallet');

function renderSession(wallets) {
  const wrapper = ({ children }) => (
    <BlueStorageContext.Provider value={{ wallets }}>
      <DfxSessionContextProvider>{children}</DfxSessionContextProvider>
    </BlueStorageContext.Provider>
  );

  return renderHook(() => useDfxSessionContext(), { wrapper });
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
  });

  it('authenticates a Spark wallet with its uppercase Lightning LNURL and identity key', async () => {
    const getSparkAddress = jest.fn();
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

    expect(mockGetLnurlFromAddress).toHaveBeenCalledWith('alice@example.com');
    expect(mockGetSignMessage).toHaveBeenCalledWith('LNURL1SPARKADDRESS');
    expect(signCompactMessage).toHaveBeenCalledWith('sign:LNURL1SPARKADDRESS');
    expect(mockAuth).toHaveBeenCalledWith(
      'LNURL1SPARKADDRESS',
      'compact-signature',
      '02identity-public-key',
    );
    expect(getSparkAddress).not.toHaveBeenCalled();
  });

  it.each([
    ['Lightning address', { lnAddress: undefined, identityPubkey: '02identity-public-key' }],
    ['identity public key', { lnAddress: 'alice@example.com', identityPubkey: undefined }],
  ])(
    'rejects a Spark wallet without its %s instead of falling back to its Spark address',
    async (_label, identity) => {
      const getSparkAddress = jest.fn().mockResolvedValue('spark-fallback-address');
      const signCompactMessage = jest.fn();
      const wallet = {
        type: SparkWallet.type,
        getID: () => 'spark-wallet-id',
        getSparkAddress,
        signCompactMessage,
        ...identity,
      };
      const { result } = renderSession([wallet]);

      await expect(getAccessToken(result, 'spark-wallet-id')).rejects.toThrow(
        'Spark Lightning address is unavailable',
      );

      expect(mockAuth).not.toHaveBeenCalled();
      expect(signCompactMessage).not.toHaveBeenCalled();
      expect(getSparkAddress).not.toHaveBeenCalled();
    },
  );

  it('rejects a Spark wallet when its Lightning address cannot be converted to an LNURL', async () => {
    mockGetLnurlFromAddress.mockReturnValue(undefined);
    const getSparkAddress = jest.fn().mockResolvedValue('spark-fallback-address');
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

    await expect(getAccessToken(result, 'spark-wallet-id')).rejects.toThrow(
      'Spark Lightning address is unavailable',
    );

    expect(mockAuth).not.toHaveBeenCalled();
    expect(signCompactMessage).not.toHaveBeenCalled();
    expect(getSparkAddress).not.toHaveBeenCalled();
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
