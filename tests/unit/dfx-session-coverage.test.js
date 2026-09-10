import React from 'react';
import { Linking } from 'react-native';
import { act, renderHook, waitFor } from '@testing-library/react-native';

const mockAuth = jest.fn();
const mockGetSignMessage = jest.fn();
const mockGetOwnershipProof = jest.fn();
const mockCall = jest.fn();
const mockSet = jest.fn();
const mockRemove = jest.fn();
const mockReportError = jest.fn();
const mockGetLnurlFromAddress = jest.fn();
const mockDfxConnectAtInit = jest.fn();
const mockAvailability = jest.fn();
const mockLanguageState = { value: 'en' };
const mockWalletState = { walletID: 'main-wallet', address: 'main-address' };

jest.mock('../../api/dfx/hooks/auth.hook', () => ({ useAuth: () => ({ auth: mockAuth, getSignMessage: mockGetSignMessage }) }));
jest.mock('../../api/dfx/hooks/api.hook', () => ({ useApi: () => ({ call: mockCall }) }));
jest.mock('../../hooks/store.hook', () => ({ useStore: () => ({ dfxSession: { set: mockSet, remove: mockRemove } }) }));
jest.mock('../../contexts/wallet.context', () => ({
  useWalletContext: () => ({
    walletID: mockWalletState.walletID,
    address: mockWalletState.address,
    signMessage: jest.fn(),
    getOwnershipProof: mockGetOwnershipProof,
  }),
}));
jest.mock('../../blue_modules/storage-context', () => {
  const ReactModule = require('react');
  return { BlueStorageContext: ReactModule.createContext({ wallets: [] }) };
});
jest.mock('../../api/dfx/contexts/language.context', () => ({ useLanguageContext: () => ({ languages: [{ symbol: 'EN', id: 1 }] }) }));
jest.mock('../../api/dfx/dfx-connect-at-init', () => ({
  dfxAvailabilityFromSettled: (...args) => mockAvailability(...args),
  dfxConnectAtInit: (...args) => mockDfxConnectAtInit(...args),
}));
jest.mock('../../class/lnurl', () => ({ __esModule: true, default: { getLnurlFromAddress: mockGetLnurlFromAddress } }));
jest.mock('../../class/wallets/lightning-lds-wallet', () => ({ LightningLdsWallet: { type: 'lightningLdsWallet' } }));
jest.mock('../../class/wallets/taproot-lds-wallet', () => ({ TaprootLdsWallet: { type: 'taprootLdsWallet' } }));
jest.mock('../../class/wallets/spark-wallet', () => ({ SparkWallet: { type: 'sparkWallet' } }));
jest.mock('../../helpers/errors', () => ({ reportError: (...args) => mockReportError(...args) }));
jest.mock('react-native-config', () => ({ REACT_APP_SRV_URL: 'https://dfx.test' }));
jest.mock('../../loc', () => ({
  __esModule: true,
  default: {
    getLanguage: () => mockLanguageState.value,
    wallets: { lightning_spark_address_unavailable: 'Spark address unavailable' },
  },
}));

const { BlueStorageContext } = require('../../blue_modules/storage-context');
const { DfxSessionContextProvider, useDfxSessionContext, DfxService } = require('../../api/dfx/contexts/session.context');
const { SparkWallet } = require('../../class/wallets/spark-wallet');
const { LightningLdsWallet } = require('../../class/wallets/lightning-lds-wallet');
const { TaprootLdsWallet } = require('../../class/wallets/taproot-lds-wallet');

function token(exp) {
  return `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.x`;
}
function tokenWithoutExpiry() {
  return `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ sub: 'session' })).toString('base64url')}.x`;
}
function renderSession(wallets) {
  const wrapper = ({ children }) => (
    <BlueStorageContext.Provider value={{ wallets }}>
      <DfxSessionContextProvider>{children}</DfxSessionContextProvider>
    </BlueStorageContext.Provider>
  );
  return renderHook(() => useDfxSessionContext(), { wrapper });
}
async function invoke(result, fn) {
  let output;
  await act(async () => {
    output = await fn(result.current);
  });
  return output;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockReset();
  mockGetSignMessage.mockReset();
  mockGetOwnershipProof.mockReset();
  mockCall.mockReset();
  mockSet.mockReset();
  mockRemove.mockReset();
  mockReportError.mockReset();
  mockGetLnurlFromAddress.mockReset();
  mockDfxConnectAtInit.mockReset();
  mockAvailability.mockReset();
  mockAuth.mockResolvedValue({ accessToken: token(Math.floor(Date.now() / 1000) + 3600) });
  mockGetSignMessage.mockImplementation(address => `sign:${address}`);
  mockGetOwnershipProof.mockResolvedValue('main-proof');
  mockCall.mockResolvedValue(undefined);
  mockGetLnurlFromAddress.mockReturnValue('lnurl1address');
  mockDfxConnectAtInit.mockReturnValue(false);
  mockAvailability.mockReturnValue('available');
  mockLanguageState.value = 'en';
  mockWalletState.walletID = 'main-wallet';
  mockWalletState.address = 'main-address';
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('DFX session lifecycle and failure boundaries', () => {
  it('creates main-wallet auth, updates language, caches valid sessions, and resets them', async () => {
    const { result } = renderSession([]);
    await expect(invoke(result, current => current.getAccessToken('main-wallet'))).resolves.toBeTruthy();
    expect(mockGetOwnershipProof).toHaveBeenCalled();
    expect(mockAuth).toHaveBeenCalledWith('main-address', 'main-proof');
    expect(mockCall).toHaveBeenCalledWith({ url: 'user', method: 'PUT', data: { language: { symbol: 'EN', id: 1 } } }, expect.any(String));
    const calls = mockAuth.mock.calls.length;
    await expect(invoke(result, current => current.getAccessToken('main-wallet'))).resolves.toBeTruthy();
    expect(mockAuth).toHaveBeenCalledTimes(calls);
    await act(async () => {
      await result.current.resetAccessToken('main-wallet');
    });
    await expect(invoke(result, current => current.getAccessToken('main-wallet'))).resolves.toBeTruthy();
    expect(mockAuth).toHaveBeenCalledTimes(calls + 1);
    await act(async () => {
      await result.current.reset();
    });
    expect(mockRemove).toHaveBeenCalled();
  });

  it('reports language-update failures but keeps the authenticated token', async () => {
    mockCall.mockRejectedValueOnce(new Error('language failed'));
    const { result } = renderSession([]);
    await expect(invoke(result, current => current.getAccessToken('main-wallet'))).resolves.toBeTruthy();
    expect(mockReportError).toHaveBeenCalledWith('Failed to update language', expect.any(Error));
  });

  it('rejects main-wallet authentication when its address is missing and LDS conversion is missing', async () => {
    mockWalletState.address = undefined;
    const main = renderSession([]);
    await expect(invoke(main.result, current => current.getAccessToken('main-wallet'))).rejects.toThrow('Address is not defined');
    mockWalletState.address = 'main-address';
    mockGetLnurlFromAddress.mockReturnValue(undefined);
    const lds = { type: LightningLdsWallet.type, getID: () => 'lds', lnAddress: 'lds@example.com', addressOwnershipProof: 'proof' };
    const session = renderSession([lds]);
    await expect(invoke(session.result, current => current.getAccessToken('lds'))).rejects.toThrow('Address is not defined');
  });

  it('handles malformed, expired, and explicitly non-expiring cached tokens', async () => {
    const { result } = renderSession([]);
    await act(async () => {
      await result.current.getAccessToken('main-wallet');
    });
    expect(mockAuth).toHaveBeenCalledTimes(1);
    mockAuth.mockClear();
    await act(async () => {
      await result.current.getAccessToken('main-wallet');
    });
    expect(mockAuth).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.resetAccessToken('main-wallet');
    });
    mockAuth.mockResolvedValueOnce({ accessToken: tokenWithoutExpiry() });
    await expect(invoke(result, current => current.getAccessToken('main-wallet'))).resolves.toBe(tokenWithoutExpiry());
    expect(mockAuth).toHaveBeenCalledTimes(1);
    mockAuth.mockClear();
    await expect(invoke(result, current => current.getAccessToken('main-wallet'))).resolves.toBe(tokenWithoutExpiry());
    expect(mockAuth).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.resetAccessToken('main-wallet');
    });
    mockAuth.mockResolvedValueOnce({ accessToken: token(Math.floor(Date.now() / 1000) - 1) });
    await expect(invoke(result, current => current.getAccessToken('main-wallet'))).resolves.toBeTruthy();
    expect(mockAuth).toHaveBeenCalledTimes(1);
    mockAuth.mockClear();
    await expect(invoke(result, current => current.getAccessToken('main-wallet'))).resolves.toBeTruthy();
    expect(mockAuth).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.resetAccessToken('main-wallet');
    });
    mockAuth.mockResolvedValueOnce({ accessToken: '%%%invalid%%%' });
    await expect(invoke(result, current => current.getAccessToken('main-wallet'))).resolves.toBeTruthy();
    mockAuth.mockClear();
    await expect(invoke(result, current => current.getAccessToken('main-wallet'))).resolves.toBeTruthy();
    expect(mockAuth).toHaveBeenCalled();
  });

  it('authenticates LDS, Taproot LDS, Spark, and rejects unsupported identities', async () => {
    const lds = { type: LightningLdsWallet.type, getID: () => 'lds', lnAddress: 'lds@example.com', addressOwnershipProof: 'lds-proof' };
    const taproot = {
      type: TaprootLdsWallet.type,
      getID: () => 'taproot',
      lnAddress: 'tap@example.com',
      addressOwnershipProof: 'tap-proof',
    };
    const sparkAddress = 'spark1abcdefghijklmnopqrstuvwxyz';
    const spark = {
      type: SparkWallet.type,
      getID: () => 'spark',
      getSparkAddress: jest.fn().mockResolvedValue(sparkAddress),
      signCompactMessage: jest.fn().mockResolvedValue('spark-proof'),
    };
    const unsupported = { type: 'unsupported', getID: () => 'unsupported' };
    const { result } = renderSession([lds, taproot, spark, unsupported]);
    await expect(invoke(result, current => current.getAccessToken('lds'))).resolves.toBeTruthy();
    await expect(invoke(result, current => current.getAccessToken('taproot'))).resolves.toBeTruthy();
    mockGetSignMessage.mockClear();
    mockGetLnurlFromAddress.mockClear();
    await expect(invoke(result, current => current.getAccessToken('spark'))).resolves.toBeTruthy();
    expect(mockGetLnurlFromAddress).not.toHaveBeenCalled();
    expect(mockGetSignMessage).toHaveBeenCalledTimes(1);
    expect(mockGetSignMessage).toHaveBeenCalledWith(sparkAddress);
    expect(mockGetSignMessage).not.toHaveBeenCalledWith(sparkAddress.toUpperCase());
    expect(spark.signCompactMessage).toHaveBeenCalledTimes(1);
    expect(spark.signCompactMessage).toHaveBeenCalledWith(`sign:${sparkAddress}`);
    expect(mockAuth).toHaveBeenCalledTimes(3);
    expect(mockAuth).toHaveBeenCalledWith(sparkAddress, 'spark-proof');
    expect(mockAuth.mock.calls.some(call => call[0] === sparkAddress.toUpperCase())).toBe(false);
    await expect(invoke(result, current => current.getAccessToken('unsupported'))).rejects.toThrow('TODO');
    expect(mockAuth.mock.calls).toEqual(
      expect.arrayContaining([
        ['LNURL1ADDRESS', 'lds-proof'],
        ['LNURL1ADDRESS', 'tap-proof'],
        [sparkAddress, expect.any(String)],
      ]),
    );
  });

  it('rejects a Spark wallet without a Spark address without calling auth', async () => {
    const spark = {
      type: SparkWallet.type,
      getID: () => 'spark',
      getSparkAddress: jest.fn().mockResolvedValue(''),
      signCompactMessage: jest.fn(),
    };
    const { result } = renderSession([spark]);
    await expect(invoke(result, current => current.getAccessToken('spark'))).rejects.toThrow('Spark address unavailable');
    expect(mockAuth).not.toHaveBeenCalled();
    expect(spark.signCompactMessage).not.toHaveBeenCalled();
    expect(spark.getSparkAddress).toHaveBeenCalled();
    expect(mockGetLnurlFromAddress).not.toHaveBeenCalled();
  });

  it('opens services with encoded parameters, blocks unavailable sessions, and reports URL failures', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const { result } = renderSession([]);
    await act(async () => {
      await result.current.openServices('wallet/id', '0.1', DfxService.SELL);
    });
    expect(openURL).not.toHaveBeenCalled();
    mockDfxConnectAtInit.mockReturnValue(true);
    mockAvailability.mockReturnValue('available');
    const wallet = {
      type: SparkWallet.type,
      getID: () => 'wallet/id',
      getSparkAddress: jest.fn().mockResolvedValue('spark1abcdefghijklmnopqrstuvwxyz'),
      signCompactMessage: jest.fn().mockResolvedValue('proof'),
    };
    const connected = renderSession([wallet]);
    await waitFor(() => expect(connected.result.current.isAvailable).toBe(true));
    expect(mockGetLnurlFromAddress).not.toHaveBeenCalled();
    await expect(invoke(connected.result, current => current.openServices('wallet/id', '0.1', DfxService.SELL))).resolves.toBeUndefined();
    expect(mockGetLnurlFromAddress).not.toHaveBeenCalled();
    expect(openURL).toHaveBeenCalledWith(expect.stringContaining('https://dfx.test/sell?session='));
    expect(openURL).toHaveBeenCalledWith(expect.stringContaining('redirect-uri=dfxtaro%3A%2F%2F%3Fwallet-id%3Dwallet%2Fid'));
    openURL.mockClear();
    openURL.mockRejectedValueOnce(new Error('native failure'));
    await expect(invoke(connected.result, current => current.openServices('wallet/id', '0.1', DfxService.SELL))).rejects.toThrow(
      'openURL rejected',
    );
    expect(mockReportError).toHaveBeenCalledWith('Failed to open services', expect.any(Error));
    openURL.mockRestore();
  });

  it('initializes connectable wallets and records forbidden versus rejected states', async () => {
    mockDfxConnectAtInit.mockReturnValue(true);
    mockAvailability.mockReturnValue('forbidden');
    const wallet = { type: 'connectable', getID: () => 'connectable' };
    const { result } = renderSession([wallet]);
    await act(async () => {});
    expect(result.current.isInitialized).toBe(true);
    expect(result.current.isAvailable).toBe(false);

    mockAvailability.mockReturnValue('error');
    const second = renderSession([wallet]);
    await act(async () => {});
    expect(mockReportError).toHaveBeenCalledWith('DFX session init failed', expect.anything());
    expect(second.result.current.isUnavailable).toBe(true);
  });
});
