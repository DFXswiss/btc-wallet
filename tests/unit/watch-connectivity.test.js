import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import {
  updateApplicationContext,
  watchEvents,
  useReachability,
  useInstalled,
  usePaired,
  transferCurrentComplicationUserInfo,
} from 'react-native-watch-connectivity';
import { isNotificationsEnabled, majorTomToGroundControl } from '../../blue_modules/notifications';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import { Chain, BitcoinUnit } from '../../models/bitcoinUnits';
import { FiatUnit } from '../../models/fiatUnit';
import { MultisigHDWallet } from '../../class';
import loc, { formatBalance, transactionTimeToReadable } from '../../loc';
import WatchConnectivity from '../../WatchConnectivity.ios.js';

jest.mock('../../blue_modules/notifications', () => ({
  isNotificationsEnabled: jest.fn(async () => false),
  majorTomToGroundControl: jest.fn(),
}));

jest.mock('../../blue_modules/BlueElectrum', () => ({ connectMain: jest.fn() }));

jest.mock('../../blue_modules/storage-context', () => {
  const RN = require('react');
  return { BlueStorageContext: RN.createContext({}) };
});

const FIXED_NOW = new Date('2020-01-01T00:00:00.000Z');
const FIXED_NOW_SEC = 1577836800;
const RANDOM_ID = 5;

let onMessage;
let unsubscribe;

function pairWatch({ paired = true, installed = true, reachable = true } = {}) {
  usePaired.mockReturnValue(paired);
  useInstalled.mockReturnValue(installed);
  useReachability.mockReturnValue(reachable);
}

function storage(overrides = {}) {
  return {
    walletsInitialized: true,
    wallets: [],
    fetchWalletTransactions: jest.fn().mockResolvedValue(undefined),
    saveToDisk: jest.fn().mockResolvedValue(undefined),
    txMetadata: {},
    preferredFiatCurrency: JSON.stringify({ endPointKey: FiatUnit.USD.endPointKey }),
    ...overrides,
  };
}

function provider(value) {
  return (
    <BlueStorageContext.Provider value={value}>
      <WatchConnectivity />
    </BlueStorageContext.Provider>
  );
}

function renderWatch(value) {
  return render(provider(value));
}

function makeOnchain(overrides = {}) {
  return {
    chain: Chain.ONCHAIN,
    type: 'HDsegwitBech32',
    hideBalance: false,
    next_free_address_index: 3,
    getLabel: () => 'Onchain',
    getBalance: () => 0,
    getPreferredBalanceUnit: () => BitcoinUnit.BTC,
    getTransactions: () => [],
    getAddressAsync: jest.fn().mockResolvedValue('bc1qrecv'),
    _getExternalAddressByIndex: jest.fn(index => `bc1qfallback-${index}`),
    getXpub: jest.fn(() => 'xpub123'),
    getSecret: jest.fn(() => 'secret123'),
    allowReceive: () => false,
    ...overrides,
  };
}

function makeOffchain(overrides = {}) {
  return {
    chain: Chain.OFFCHAIN,
    type: 'lightningCustodianWallet',
    hideBalance: false,
    getLabel: () => 'Lightning',
    getBalance: () => 0,
    getPreferredBalanceUnit: () => BitcoinUnit.BTC,
    getTransactions: () => [],
    getAddressAsync: jest.fn().mockResolvedValue(undefined),
    getAddress: jest.fn(() => 'lnbc1recv'),
    allowReceive: () => true,
    addInvoice: jest.fn().mockResolvedValue('lnbc1invoice'),
    decodeInvoice: jest.fn().mockResolvedValue({ payment_hash: 'payhash' }),
    ...overrides,
  };
}

function formatted(value) {
  return formatBalance(value, BitcoinUnit.BTC, true).toString();
}

function walletsCalls() {
  return updateApplicationContext.mock.calls.filter(call => call[0] && Array.isArray(call[0].wallets)).map(call => call[0]);
}

async function lastWalletsPayload() {
  await waitFor(() => {
    expect(walletsCalls().length).toBeGreaterThan(0);
  });
  const calls = walletsCalls();
  return calls[calls.length - 1];
}

beforeEach(() => {
  jest.useFakeTimers({
    now: FIXED_NOW,
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
  jest.spyOn(Math, 'random').mockReturnValue(0.5);
  onMessage = undefined;
  unsubscribe = jest.fn();
  pairWatch({ paired: false, installed: false, reachable: false });
  updateApplicationContext.mockClear();
  transferCurrentComplicationUserInfo.mockReset();
  transferCurrentComplicationUserInfo.mockImplementation(() => {});
  watchEvents.addListener.mockReset();
  watchEvents.addListener.mockImplementation((_event, handler) => {
    onMessage = handler;
    return unsubscribe;
  });
  isNotificationsEnabled.mockReset();
  isNotificationsEnabled.mockResolvedValue(false);
  majorTomToGroundControl.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('WatchConnectivity', () => {
  it('renders nothing', () => {
    const screen = renderWatch(storage({ walletsInitialized: false }));
    expect(screen.toJSON()).toBeNull();
  });

  it.each([
    ['unpaired', { paired: false, installed: true, reachable: true }],
    ['the watch app is not installed', { paired: true, installed: false, reachable: true }],
    ['the watch is not reachable', { paired: true, installed: true, reachable: false }],
  ])('does not register a message listener or send wallets when %s', async (_name, flags) => {
    pairWatch(flags);
    renderWatch(storage({ wallets: [makeOnchain()] }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(watchEvents.addListener).not.toHaveBeenCalled();
    expect(walletsCalls()).toHaveLength(0);
  });

  it('does not register a message listener or send wallets when wallets are not initialized', async () => {
    pairWatch();
    renderWatch(storage({ walletsInitialized: false, wallets: [makeOnchain()] }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(watchEvents.addListener).not.toHaveBeenCalled();
    expect(walletsCalls()).toHaveLength(0);
    expect(updateApplicationContext).toHaveBeenCalledWith({ isWalletsInitialized: false, randomID: RANDOM_ID });
  });

  it('registers a message listener, sends wallets, and unsubscribes on unmount when paired, installed, reachable and initialized', async () => {
    pairWatch();
    const wallet = makeOnchain();
    const screen = renderWatch(storage({ wallets: [wallet] }));
    expect(watchEvents.addListener).toHaveBeenCalledWith('message', expect.any(Function));
    const payload = await lastWalletsPayload();
    expect(payload).toEqual({
      wallets: [
        {
          label: 'Onchain',
          balance: formatted(0),
          type: 'HDsegwitBech32',
          preferredBalanceUnit: BitcoinUnit.BTC,
          receiveAddress: 'bc1qrecv',
          transactions: [],
          hideBalance: false,
          xpub: 'xpub123',
        },
      ],
      randomID: RANDOM_ID,
    });
    expect(wallet._getExternalAddressByIndex).not.toHaveBeenCalled();
    expect(updateApplicationContext).toHaveBeenCalledWith({ isWalletsInitialized: true, randomID: RANDOM_ID });
    screen.unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('does not register a message listener when the listener ref is already active', () => {
    pairWatch();
    const listenerActive = { current: true };
    const currencyRef = { current: FiatUnit.USD.endPointKey };
    const spy = jest.spyOn(React, 'useRef').mockImplementation(initial => {
      if (initial === false) return listenerActive;
      if (initial === FiatUnit.USD.endPointKey) return currencyRef;
      return { current: initial };
    });
    try {
      renderWatch(storage());
      expect(watchEvents.addListener).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('unsubscribes the previous listener and does not send wallets after the watch becomes unpaired', async () => {
    pairWatch();
    const ctx = storage({ wallets: [makeOnchain()] });
    const { rerender } = renderWatch(ctx);
    await lastWalletsPayload();
    const listenerCalls = watchEvents.addListener.mock.calls.length;
    expect(listenerCalls).toBeGreaterThan(0);
    pairWatch({ paired: false, installed: true, reachable: true });
    rerender(provider(ctx));
    expect(unsubscribe).toHaveBeenCalled();
    const sentBefore = walletsCalls().length;
    await act(async () => {
      await Promise.resolve();
    });
    expect(watchEvents.addListener).toHaveBeenCalledTimes(listenerCalls);
    expect(walletsCalls()).toHaveLength(sentBefore);
  });

  it('does not transfer complication info when the preferred fiat currency is unchanged', () => {
    pairWatch();
    renderWatch(storage());
    expect(transferCurrentComplicationUserInfo).not.toHaveBeenCalled();
  });

  it.each([
    ['the watch app is not installed', { paired: true, installed: false, reachable: true }],
    ['the watch is not reachable', { paired: true, installed: true, reachable: false }],
  ])('does not transfer complication info when %s', (_name, flags) => {
    pairWatch(flags);
    renderWatch(storage({ preferredFiatCurrency: JSON.stringify({ endPointKey: 'EUR' }) }));
    expect(transferCurrentComplicationUserInfo).not.toHaveBeenCalled();
  });

  it('does not transfer complication info when wallets are not initialized', () => {
    pairWatch();
    renderWatch(storage({ walletsInitialized: false, preferredFiatCurrency: JSON.stringify({ endPointKey: 'EUR' }) }));
    expect(transferCurrentComplicationUserInfo).not.toHaveBeenCalled();
  });

  it('does not transfer complication info when preferredFiatCurrency is missing', () => {
    pairWatch();
    renderWatch(storage({ preferredFiatCurrency: undefined }));
    expect(transferCurrentComplicationUserInfo).not.toHaveBeenCalled();
  });

  it('transfers complication info when the preferred fiat currency changes', () => {
    pairWatch();
    renderWatch(storage({ preferredFiatCurrency: JSON.stringify({ endPointKey: 'EUR' }) }));
    expect(transferCurrentComplicationUserInfo).toHaveBeenCalledWith({ preferredFiatCurrency: 'EUR' });
  });

  it('swallows an error thrown by transferCurrentComplicationUserInfo', () => {
    pairWatch();
    transferCurrentComplicationUserInfo.mockImplementation(() => {
      throw new Error('watch not ready');
    });
    const screen = renderWatch(storage({ preferredFiatCurrency: JSON.stringify({ endPointKey: 'EUR' }) }));
    expect(transferCurrentComplicationUserInfo).toHaveBeenCalledWith({ preferredFiatCurrency: 'EUR' });
    expect(screen.toJSON()).toBeNull();
  });

  it('replies with the invoice and notifies Ground Control when createInvoice succeeds and notifications are enabled', async () => {
    pairWatch();
    const wallet = makeOffchain();
    isNotificationsEnabled.mockResolvedValue(true);
    renderWatch(storage({ wallets: [wallet] }));
    const reply = jest.fn();
    await act(async () => {
      onMessage({ request: 'createInvoice', walletIndex: 0, amount: 12, description: 'coffee' }, reply);
    });
    await waitFor(() => expect(reply).toHaveBeenCalledWith({ invoicePaymentRequest: 'lnbc1invoice' }));
    expect(wallet.addInvoice).toHaveBeenCalledWith(12, 'coffee');
    expect(wallet.decodeInvoice).toHaveBeenCalledWith('lnbc1invoice');
    expect(majorTomToGroundControl).toHaveBeenCalledWith([], ['payhash'], []);
  });

  it('passes the loc placeholder description to addInvoice when createInvoice omits description', async () => {
    pairWatch();
    const wallet = makeOffchain();
    renderWatch(storage({ wallets: [wallet] }));
    const reply = jest.fn();
    await act(async () => {
      onMessage({ request: 'createInvoice', walletIndex: 0, amount: 3 }, reply);
    });
    await waitFor(() => expect(wallet.addInvoice).toHaveBeenCalledWith(3, loc.lnd.placeholder));
    expect(reply).toHaveBeenCalledWith({ invoicePaymentRequest: 'lnbc1invoice' });
  });

  it('skips Ground Control when notifications are disabled', async () => {
    pairWatch();
    const wallet = makeOffchain();
    isNotificationsEnabled.mockResolvedValue(false);
    renderWatch(storage({ wallets: [wallet] }));
    const reply = jest.fn();
    await act(async () => {
      onMessage({ request: 'createInvoice', walletIndex: 0, amount: 1, description: 'x' }, reply);
    });
    await waitFor(() => expect(reply).toHaveBeenCalledWith({ invoicePaymentRequest: 'lnbc1invoice' }));
    expect(wallet.decodeInvoice).not.toHaveBeenCalled();
    expect(majorTomToGroundControl).not.toHaveBeenCalled();
  });

  it('still replies with the invoice when notification setup throws', async () => {
    pairWatch();
    const wallet = makeOffchain();
    isNotificationsEnabled.mockRejectedValue(new Error('notifications unavailable'));
    renderWatch(storage({ wallets: [wallet] }));
    const reply = jest.fn();
    await act(async () => {
      onMessage({ request: 'createInvoice', walletIndex: 0, amount: 1, description: 'x' }, reply);
    });
    await waitFor(() => expect(reply).toHaveBeenCalledWith({ invoicePaymentRequest: 'lnbc1invoice' }));
    expect(majorTomToGroundControl).not.toHaveBeenCalled();
  });

  it('still replies with the invoice when decodeInvoice throws', async () => {
    pairWatch();
    const wallet = makeOffchain({
      decodeInvoice: jest.fn().mockRejectedValue(new Error('bad invoice')),
    });
    isNotificationsEnabled.mockResolvedValue(true);
    renderWatch(storage({ wallets: [wallet] }));
    const reply = jest.fn();
    await act(async () => {
      onMessage({ request: 'createInvoice', walletIndex: 0, amount: 1, description: 'x' }, reply);
    });
    await waitFor(() => expect(reply).toHaveBeenCalledWith({ invoicePaymentRequest: 'lnbc1invoice' }));
    expect(majorTomToGroundControl).not.toHaveBeenCalled();
  });

  it('replies with an empty object when addInvoice throws', async () => {
    pairWatch();
    const invoiceError = new Error('invoice failed');
    const wallet = makeOffchain({
      addInvoice: jest.fn().mockRejectedValue(invoiceError),
    });
    renderWatch(storage({ wallets: [wallet] }));
    const reply = jest.fn();
    await act(async () => {
      onMessage({ request: 'createInvoice', walletIndex: 0, amount: 1, description: 'x' }, reply);
    });
    await waitFor(() => expect(reply).toHaveBeenCalledWith({}));
  });

  it('replies with an empty object when createInvoice reads a missing wallet', async () => {
    pairWatch();
    renderWatch(storage({ wallets: [] }));
    const reply = jest.fn();
    await act(async () => {
      onMessage({ request: 'createInvoice', walletIndex: 0, amount: 1, description: 'x' }, reply);
    });
    await waitFor(() => expect(reply).toHaveBeenCalledWith({}));
  });

  it('does not call addInvoice when the wallet does not allow receive', async () => {
    pairWatch();
    const wallet = makeOffchain({ allowReceive: () => false });
    renderWatch(storage({ wallets: [wallet] }));
    const reply = jest.fn();
    await act(async () => {
      onMessage({ request: 'createInvoice', walletIndex: 0, amount: 1, description: 'x' }, reply);
    });
    await waitFor(() => expect(reply).toHaveBeenCalledWith({ invoicePaymentRequest: undefined }));
    expect(wallet.addInvoice).not.toHaveBeenCalled();
  });

  it('does not call addInvoice when the invoice amount is not greater than 0', async () => {
    pairWatch();
    const wallet = makeOffchain();
    renderWatch(storage({ wallets: [wallet] }));
    const reply = jest.fn();
    await act(async () => {
      onMessage({ request: 'createInvoice', walletIndex: 0, amount: 0, description: 'x' }, reply);
    });
    await waitFor(() => expect(reply).toHaveBeenCalledWith({ invoicePaymentRequest: undefined }));
    expect(wallet.addInvoice).not.toHaveBeenCalled();
  });

  it('sends wallets and replies with an empty object on sendApplicationContext', async () => {
    pairWatch();
    renderWatch(storage({ wallets: [makeOnchain()] }));
    await lastWalletsPayload();
    const reply = jest.fn();
    const sentBefore = walletsCalls().length;
    onMessage({ message: 'sendApplicationContext' }, reply);
    expect(reply).toHaveBeenCalledWith({});
    await waitFor(() => expect(walletsCalls().length).toBeGreaterThan(sentBefore));
  });

  it('saves to disk and replies after fetchTransactions succeeds', async () => {
    pairWatch();
    const fetchWalletTransactions = jest.fn().mockResolvedValue(undefined);
    const saveToDisk = jest.fn().mockResolvedValue(undefined);
    renderWatch(storage({ fetchWalletTransactions, saveToDisk }));
    const reply = jest.fn();
    await act(async () => {
      onMessage({ message: 'fetchTransactions' }, reply);
    });
    await waitFor(() => expect(reply).toHaveBeenCalledWith({}));
    expect(fetchWalletTransactions).toHaveBeenCalledTimes(1);
    expect(saveToDisk).toHaveBeenCalledTimes(1);
  });

  it('replies with an empty object when fetchTransactions fails and does not save', async () => {
    pairWatch();
    const fetchWalletTransactions = jest.fn().mockRejectedValue(new Error('electrum down'));
    const saveToDisk = jest.fn().mockResolvedValue(undefined);
    renderWatch(storage({ fetchWalletTransactions, saveToDisk }));
    const reply = jest.fn();
    await act(async () => {
      onMessage({ message: 'fetchTransactions' }, reply);
    });
    await waitFor(() => expect(reply).toHaveBeenCalledWith({}));
    expect(saveToDisk).not.toHaveBeenCalled();
  });

  it('replies with an empty object when saveToDisk fails after fetchTransactions', async () => {
    pairWatch();
    const fetchWalletTransactions = jest.fn().mockResolvedValue(undefined);
    const saveToDisk = jest.fn().mockRejectedValue(new Error('disk full'));
    renderWatch(storage({ fetchWalletTransactions, saveToDisk }));
    const reply = jest.fn();
    await act(async () => {
      onMessage({ message: 'fetchTransactions' }, reply);
    });
    await waitFor(() => expect(reply).toHaveBeenCalledWith({}));
  });

  it('writes hideBalance onto the wallet, saves, and replies', async () => {
    pairWatch();
    const wallet = makeOnchain({ hideBalance: false });
    const saveToDisk = jest.fn().mockResolvedValue(undefined);
    renderWatch(storage({ wallets: [wallet], saveToDisk }));
    const reply = jest.fn();
    await act(async () => {
      onMessage({ message: 'hideBalance', walletIndex: 0, hideBalance: true }, reply);
    });
    await waitFor(() => expect(reply).toHaveBeenCalledWith({}));
    expect(wallet.hideBalance).toBe(true);
    expect(saveToDisk).toHaveBeenCalledTimes(1);
  });

  it('replies with an empty object when hideBalance saveToDisk fails', async () => {
    pairWatch();
    const wallet = makeOnchain();
    // hideBalance does saveToDisk().finally(...) and drops the chain; catch the rethrow the caller discards.
    const saveToDisk = jest.fn().mockImplementation(() => {
      const failed = Promise.reject(new Error('disk full'));
      failed.finally = onFinally => Promise.prototype.finally.call(failed, onFinally).catch(() => {});
      return failed;
    });
    renderWatch(storage({ wallets: [wallet], saveToDisk }));
    const reply = jest.fn();
    await act(async () => {
      onMessage({ message: 'hideBalance', walletIndex: 0, hideBalance: true }, reply);
    });
    await waitFor(() => expect(reply).toHaveBeenCalledWith({}));
    expect(wallet.hideBalance).toBe(true);
  });

  it('does not reply to a watch message that matches no request', async () => {
    pairWatch();
    renderWatch(storage());
    const reply = jest.fn();
    const callsBefore = updateApplicationContext.mock.calls.length;
    onMessage({ message: 'unknown' }, reply);
    await act(async () => {
      await Promise.resolve();
    });
    expect(reply).not.toHaveBeenCalled();
    expect(updateApplicationContext.mock.calls).toHaveLength(callsBefore);
  });

  it('does not write wallets to the watch when wallets is not an array', async () => {
    pairWatch();
    renderWatch(storage({ wallets: null }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(walletsCalls()).toHaveLength(0);
  });

  it('falls back to _getExternalAddressByIndex when on-chain getAddressAsync throws', async () => {
    pairWatch();
    const wallet = makeOnchain({
      getAddressAsync: jest.fn().mockRejectedValue(new Error('sleep expired')),
    });
    renderWatch(storage({ wallets: [wallet] }));
    const payload = await lastWalletsPayload();
    expect(payload.wallets[0].receiveAddress).toBe('bc1qfallback-3');
    expect(wallet._getExternalAddressByIndex).toHaveBeenCalledWith(3);
  });

  it('falls back to _getExternalAddressByIndex when on-chain getAddressAsync returns an empty address', async () => {
    pairWatch();
    const wallet = makeOnchain({
      getAddressAsync: jest.fn().mockResolvedValue(''),
    });
    renderWatch(storage({ wallets: [wallet] }));
    const payload = await lastWalletsPayload();
    expect(payload.wallets[0].receiveAddress).toBe('bc1qfallback-3');
  });

  it('uses getAddress after getAddressAsync for an off-chain wallet', async () => {
    pairWatch();
    const wallet = makeOffchain({
      getAddressAsync: jest.fn().mockResolvedValue('ignored'),
      getAddress: jest.fn(() => 'lnbc1from-getAddress'),
    });
    renderWatch(storage({ wallets: [wallet] }));
    const payload = await lastWalletsPayload();
    expect(payload.wallets[0].receiveAddress).toBe('lnbc1from-getAddress');
    expect(payload.wallets[0]).not.toHaveProperty('xpub');
  });

  it('falls back to getAddress when off-chain getAddressAsync throws', async () => {
    pairWatch();
    const wallet = makeOffchain({
      getAddressAsync: jest.fn().mockRejectedValue(new Error('sleep expired')),
      getAddress: jest.fn(() => 'lnbc1fallback'),
    });
    renderWatch(storage({ wallets: [wallet] }));
    const payload = await lastWalletsPayload();
    expect(payload.wallets[0].receiveAddress).toBe('lnbc1fallback');
  });

  it('sends an off-chain wallet without receiveAddress when getAddress throws', async () => {
    pairWatch();
    const wallet = makeOffchain({
      getAddressAsync: jest.fn().mockRejectedValue(new Error('sleep expired')),
      getAddress: jest.fn(() => {
        throw new Error('not implemented');
      }),
    });
    renderWatch(storage({ wallets: [wallet] }));
    const payload = await lastWalletsPayload();
    expect(payload.wallets[0].label).toBe('Lightning');
    expect(payload.wallets[0].receiveAddress).toBeUndefined();
  });

  it('uses the second getAddress call when the first off-chain address is empty', async () => {
    pairWatch();
    const wallet = makeOffchain({
      getAddressAsync: jest.fn().mockResolvedValue(undefined),
      getAddress: jest.fn().mockReturnValueOnce('').mockReturnValueOnce('lnbc1second'),
    });
    renderWatch(storage({ wallets: [wallet] }));
    const payload = await lastWalletsPayload();
    expect(payload.wallets[0].receiveAddress).toBe('lnbc1second');
  });

  it('sends a wallet that is neither on-chain nor off-chain without a receiveAddress', async () => {
    pairWatch();
    const wallet = makeOnchain({
      chain: 'UNKNOWN',
      getAddressAsync: jest.fn(),
    });
    renderWatch(storage({ wallets: [wallet] }));
    const payload = await lastWalletsPayload();
    expect(payload.wallets[0].receiveAddress).toBeUndefined();
    expect(wallet.getAddressAsync).not.toHaveBeenCalled();
    expect(payload.wallets[0]).not.toHaveProperty('xpub');
  });

  it('writes getSecret as xpub when on-chain getXpub is empty', async () => {
    pairWatch();
    const wallet = makeOnchain({
      getXpub: jest.fn(() => ''),
      getSecret: jest.fn(() => 'secret-only'),
    });
    renderWatch(storage({ wallets: [wallet] }));
    const payload = await lastWalletsPayload();
    expect(payload.wallets[0].xpub).toBe('secret-only');
  });

  it('omits xpub for an on-chain multisig wallet', async () => {
    pairWatch();
    const wallet = makeOnchain({
      type: MultisigHDWallet.type,
      getXpub: jest.fn(() => 'xpub-should-not-appear'),
    });
    renderWatch(storage({ wallets: [wallet] }));
    const payload = await lastWalletsPayload();
    expect(payload.wallets[0].type).toBe(MultisigHDWallet.type);
    expect(payload.wallets[0]).not.toHaveProperty('xpub');
  });

  it('maps on-chain, invoice and payment-request transactions onto watch type, amount and memo', async () => {
    pairWatch();
    const received = FIXED_NOW.getTime();
    const readable = transactionTimeToReadable(received);
    const wallet = makeOnchain({
      hideBalance: true,
      getBalance: () => 150000000,
      getTransactions: () => [
        { confirmations: 0, value: 1000, hash: 'unconfirmed', received },
        {
          type: 'user_invoice',
          value: 2000,
          hash: 'inv-future',
          timestamp: FIXED_NOW_SEC,
          expire_time: 60,
          received,
        },
        {
          type: 'user_invoice',
          value: 3000,
          hash: 'inv-paid',
          timestamp: FIXED_NOW_SEC - 120,
          expire_time: 60,
          ispaid: true,
          received,
        },
        {
          type: 'user_invoice',
          value: 4000,
          hash: 'inv-expired',
          timestamp: FIXED_NOW_SEC - 120,
          expire_time: 60,
          ispaid: false,
          received,
        },
        {
          type: 'user_invoice',
          value: 5000,
          hash: 'inv-equal',
          timestamp: FIXED_NOW_SEC,
          expire_time: 0,
          received,
        },
        {
          type: 'payment_request',
          value: 6000,
          hash: 'pay-future',
          timestamp: FIXED_NOW_SEC,
          expire_time: 60,
          received,
        },
        { value: -100000000, hash: 'sent-onchain', received, memo: 'from-tx' },
        { confirmations: 3, value: 7000, hash: 'recv-onchain', received },
        { confirmations: 1, value: 8000, hash: 'meta-memo', received },
        { confirmations: 1, value: 9000, hash: 'empty-meta', received, memo: 'fallback-memo' },
        { confirmations: 1, value: 11000, hash: 'no-memo', received },
      ],
    });
    renderWatch(
      storage({
        wallets: [wallet],
        txMetadata: {
          'meta-memo': { memo: 'from-metadata' },
          'empty-meta': { memo: '' },
        },
      }),
    );
    const payload = await lastWalletsPayload();
    expect(payload.wallets[0].hideBalance).toBe(true);
    expect(payload.wallets[0].balance).toBe(formatted(150000000));
    expect(payload.wallets[0].transactions).toEqual([
      { type: 'pendingConfirmation', amount: formatted(1000), memo: '', time: readable },
      { type: 'pendingConfirmation', amount: formatted(2000), memo: '', time: readable },
      { type: 'received', amount: formatted(3000), memo: '', time: readable },
      { type: 'sent', amount: loc.lnd.expired, memo: '', time: readable },
      { type: 'pendingConfirmation', amount: formatted(5000), memo: '', time: readable },
      { type: 'pendingConfirmation', amount: formatted(6000), memo: '', time: readable },
      { type: 'sent', amount: formatted(-100000000), memo: 'from-tx', time: readable },
      { type: 'received', amount: formatted(7000), memo: '', time: readable },
      { type: 'received', amount: formatted(8000), memo: 'from-metadata', time: readable },
      { type: 'received', amount: formatted(9000), memo: 'fallback-memo', time: readable },
      { type: 'received', amount: formatted(11000), memo: '', time: readable },
    ]);
  });

  it('maps an unpaid expired payment_request to sent and loc.lnd.expired', async () => {
    pairWatch();
    const received = FIXED_NOW.getTime();
    const wallet = makeOffchain({
      getTransactions: () => [
        {
          type: 'payment_request',
          value: 1234,
          hash: 'pay-expired',
          timestamp: FIXED_NOW_SEC - 120,
          expire_time: 60,
          ispaid: false,
          received,
        },
      ],
    });
    renderWatch(storage({ wallets: [wallet] }));
    const payload = await lastWalletsPayload();
    expect(payload.wallets[0].transactions).toEqual([
      { type: 'sent', amount: loc.lnd.expired, memo: '', time: transactionTimeToReadable(received) },
    ]);
  });

  it('maps a paid unexpired user_invoice to received', async () => {
    pairWatch();
    const received = FIXED_NOW.getTime();
    const wallet = makeOffchain({
      getTransactions: () => [
        {
          type: 'user_invoice',
          value: 3333,
          hash: 'inv-paid-live',
          timestamp: FIXED_NOW_SEC,
          expire_time: 60,
          ispaid: true,
          received,
        },
      ],
    });
    renderWatch(storage({ wallets: [wallet] }));
    const payload = await lastWalletsPayload();
    expect(payload.wallets[0].transactions[0]).toEqual({
      type: 'received',
      amount: formatted(3333),
      memo: '',
      time: transactionTimeToReadable(received),
    });
  });

  it('maps a paid expired payment_request to received with a formatted amount', async () => {
    pairWatch();
    const received = FIXED_NOW.getTime();
    const wallet = makeOffchain({
      getTransactions: () => [
        {
          type: 'payment_request',
          value: 2222,
          hash: 'pay-paid',
          timestamp: FIXED_NOW_SEC - 120,
          expire_time: 60,
          ispaid: true,
          received,
        },
      ],
    });
    renderWatch(storage({ wallets: [wallet] }));
    const payload = await lastWalletsPayload();
    expect(payload.wallets[0].transactions[0]).toEqual({
      type: 'received',
      amount: formatted(2222),
      memo: '',
      time: transactionTimeToReadable(received),
    });
  });

  it('sends the remaining wallets to the watch when one wallet throws during sync', async () => {
    pairWatch();
    const throwing = makeOnchain({
      type: 'brokenWallet',
      getLabel: () => 'Broken',
      getTransactions: () => {
        throw new Error('sync failed');
      },
    });
    const healthy = makeOnchain({
      getLabel: () => 'Healthy',
      getAddressAsync: jest.fn().mockResolvedValue('bc1qhealthy'),
    });
    renderWatch(storage({ wallets: [throwing, healthy] }));
    const payload = await lastWalletsPayload();
    expect(payload.wallets.map(wallet => wallet.label)).toEqual(['Healthy']);
    expect(payload.wallets[0].receiveAddress).toBe('bc1qhealthy');
  });

  it('warns with the skipped wallet type when watch sync skips a wallet', async () => {
    pairWatch();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const err = new Error('sync failed');
    err.name = 'WatchSyncError';
    const throwing = makeOnchain({
      type: 'sparkWallet',
      getTransactions: () => {
        throw err;
      },
    });
    renderWatch(storage({ wallets: [throwing] }));
    await waitFor(() => {
      expect(warn).toHaveBeenCalledWith('WatchConnectivity: skipped wallet for watch sync', 'sparkWallet', 'WatchSyncError');
    });
    const payload = await lastWalletsPayload();
    expect(payload.wallets).toEqual([]);
  });

  it('warns with the thrown value type when the skipped wallet did not throw an Error', async () => {
    pairWatch();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const throwing = makeOnchain({
      type: 'legacy',
      getTransactions: () => {
        const reason = 'nope';
        throw reason;
      },
    });
    renderWatch(storage({ wallets: [throwing] }));
    await waitFor(() => {
      expect(warn).toHaveBeenCalledWith('WatchConnectivity: skipped wallet for watch sync', 'legacy', 'string');
    });
  });
});
