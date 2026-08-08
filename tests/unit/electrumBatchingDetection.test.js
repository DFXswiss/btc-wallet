/**
 * Evidence tests for the electrs banner mis-detection in _initConnection().
 *
 * electrs has reported its server.version banner as "electrs/x.y.z" (slash, no
 * space) for years, but the batching re-enable logic parses the banner with
 * split(' ') - so the `case 'electrs'` can never match, no version is ever
 * compared against 0.9.0, and disableBatching stays true for every modern
 * electrs (the implementation Umbrel and RaspiBlitz ship). electrs >= 0.9
 * answers batched blockchain.scripthash.listunspent calls just fine; treating
 * it as non-batching starves fetchUtxo() of data and - combined with the
 * non-batching guard - can lock a funded wallet out of on-chain sending.
 *
 * The electrs case below asserts the CORRECT behaviour and therefore FAILS on
 * the current code; it goes green with the detection fix. The
 * ElectrumPersonalServer and Fulcrum cases are controls documenting behaviour
 * that must not change: EPS genuinely cannot batch, and Fulcrum's space-format
 * banner proves the existing parse works for everything except the slash form.
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
    assert.strictEqual(BlueElectrum.isBatchingDisabled(), false, 'the space-format parse works; only the slash form is broken');
  });
});
