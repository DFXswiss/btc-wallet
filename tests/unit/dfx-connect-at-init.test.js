import assert from 'assert';
import { dfxConnectAtInit, dfxAvailabilityFromSettled } from '../../api/dfx/dfx-connect-at-init';

describe('dfxConnectAtInit', () => {
  it('keeps HD and LDS in the start-up connect list', () => {
    assert.strictEqual(dfxConnectAtInit('HDsegwitBech32'), true);
    assert.strictEqual(dfxConnectAtInit('lightningLdsWallet'), true);
  });

  it('skips Spark and multisig so a disconnected Spark SDK cannot hide Buy/Sell', () => {
    assert.strictEqual(dfxConnectAtInit('sparkWallet'), false);
    assert.strictEqual(dfxConnectAtInit('HDmultisig'), false);
  });
});

describe('dfxAvailabilityFromSettled', () => {
  it('is available when any wallet session succeeds', () => {
    const results = [
      { status: 'fulfilled', value: 'tok' },
      { status: 'rejected', reason: new Error('Spark SDK is not connected') },
    ];
    assert.strictEqual(dfxAvailabilityFromSettled(results), 'available');
  });

  it('is forbidden only when every wallet is 403', () => {
    const results = [
      { status: 'rejected', reason: { statusCode: 403 } },
      { status: 'rejected', reason: { statusCode: 403 } },
    ];
    assert.strictEqual(dfxAvailabilityFromSettled(results), 'forbidden');
  });

  it('throws when nothing succeeded and the failure is not 403', () => {
    const results = [{ status: 'rejected', reason: new Error('network') }];
    assert.strictEqual(dfxAvailabilityFromSettled(results), 'throw');
  });
});
