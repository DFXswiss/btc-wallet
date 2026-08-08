/**
 * Server-banner batching detection in _initConnection().
 *
 * electrs reports its server.version banner as "electrs/x.y.z" (slash, no
 * space), Fulcrum as "Fulcrum x.y.z" - the detection must parse both forms,
 * because mis-classifying a batching-capable server as non-batching starves
 * fetchUtxo() of data and - combined with the non-batching guard - can lock a
 * funded wallet out of on-chain sending. ElectrumPersonalServer genuinely
 * cannot batch and must stay disabled. The flag is re-derived on every
 * connection, so a batching-capable server reached after a non-batching one
 * (the reconnect logic rotates servers mid-session) is not stuck disabled.
 *
 * Only the network client is mocked - connectMain()/_initConnection() and the
 * detection logic under test run for real.
 */
import assert from 'assert';
import AsyncStorage from '@react-native-async-storage/async-storage';

let mockNextBanner = '';

jest.mock('electrum-client', () =>
  jest.fn().mockImplementation(function () {
    this.status = 1;
    this.timeLastCall = 1;
    this.initElectrum = async () => [mockNextBanner, '1.4'];
    this.blockchainHeaders_subscribe = async () => ({ height: 1, hex: '00' });
    this.close = () => {
      this.status = 0;
    };
  }),
);

const BlueElectrum = require('../../blue_modules/BlueElectrum');

beforeAll(async () => {
  // pin a saved peer so the mocked connection never consults the hardcoded list
  await AsyncStorage.setItem(BlueElectrum.ELECTRUM_HOST, 'server.local');
  await AsyncStorage.setItem(BlueElectrum.ELECTRUM_TCP_PORT, '50001');
  // keep the 30-minute peer-rotation timer and the 10s connect race virtual,
  // so this suite leaves no live timers behind
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
});

afterAll(() => {
  jest.useRealTimers();
});

afterEach(() => {
  BlueElectrum.forceDisconnect();
});

async function connectAndSettle() {
  const kickoff = BlueElectrum.connectMain();
  await kickoff;
  // connectMain() doesn't await its own _initConnection(); a second call
  // returns the in-flight connection promise, so awaiting it waits for the
  // whole connect + banner-detection sequence to finish
  await BlueElectrum.connectMain();
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

describe('_initConnection() server banner batching detection', () => {
  it('recognises modern electrs (slash-format banner) as batching-capable', async () => {
    mockNextBanner = 'electrs/0.10.9';
    await connectAndSettle();
    assert.strictEqual((await BlueElectrum.getConfig()).serverName, 'electrs/0.10.9');
    assert.strictEqual(
      BlueElectrum.isBatchingDisabled(),
      false,
      'electrs >= 0.9 supports batched listunspent, but the split(" ") parse of its "electrs/x.y.z" banner ' +
        'never matches the re-enable case, so it is wrongly treated as non-batching',
    );
  });

  it('control: keeps batching disabled for ElectrumPersonalServer', async () => {
    mockNextBanner = 'ElectrumPersonalServer 0.2.4';
    await connectAndSettle();
    assert.strictEqual(BlueElectrum.isBatchingDisabled(), true, 'EPS genuinely does not support batched listunspent');
  });

  it('control: recognises Fulcrum >= 1.9 (space-format banner) as batching-capable', async () => {
    mockNextBanner = 'Fulcrum 1.9.1';
    await connectAndSettle();
    assert.strictEqual(BlueElectrum.isBatchingDisabled(), false, 'the space-format parse must keep working');
  });

  it('re-derives the flag per connection - a batching-capable server after EPS is not stuck disabled', async () => {
    mockNextBanner = 'ElectrumPersonalServer 0.2.4';
    await connectAndSettle();
    assert.strictEqual(BlueElectrum.isBatchingDisabled(), true);

    BlueElectrum.forceDisconnect();
    mockNextBanner = 'ElectrumX 1.16.0';
    await connectAndSettle();
    assert.strictEqual(
      BlueElectrum.isBatchingDisabled(),
      false,
      'an in-session reconnect to a batching-capable server must clear the flag, or the fetchUtxo() guard blocks sending until app restart',
    );
  });
});
