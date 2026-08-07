import AsyncStorage from '@react-native-async-storage/async-storage';
import { DfxService } from '../../api/dfx/contexts/session.context';
import { DfxMaxAmount } from '../../helpers/dfxMaxAmount';

const assert = require('assert');

describe('helpers/dfxMaxAmount DfxMaxAmount', () => {
  afterEach(async () => {
    await AsyncStorage.clear();
  });

  it('returns false when nothing was remembered for this wallet/service', async () => {
    const confirmed = await DfxMaxAmount.wasConfirmed('wallet-1', DfxService.SELL, '0.5', 50000000);
    assert.strictEqual(confirmed, false);
  });

  it('confirms when the amount and wallet balance both match what was remembered', async () => {
    await DfxMaxAmount.remember('wallet-1', DfxService.SELL, 99990000, 100000000);
    const confirmed = await DfxMaxAmount.wasConfirmed('wallet-1', DfxService.SELL, '0.9999', 100000000);
    assert.strictEqual(confirmed, true);
  });

  it('tolerates a 1-satoshi rounding difference in the confirmed amount', async () => {
    await DfxMaxAmount.remember('wallet-1', DfxService.SELL, 99990000, 100000000);
    const confirmed = await DfxMaxAmount.wasConfirmed('wallet-1', DfxService.SELL, '0.99990001', 100000000);
    assert.strictEqual(confirmed, true);
  });

  it('rejects when the confirmed amount is not the remembered max', async () => {
    await DfxMaxAmount.remember('wallet-1', DfxService.SELL, 99990000, 100000000);
    const confirmed = await DfxMaxAmount.wasConfirmed('wallet-1', DfxService.SELL, '0.5', 100000000);
    assert.strictEqual(confirmed, false);
  });

  // This is the whole point of tracking the balance alongside the amount: an unrelated pay-in
  // landing while the user is still in the widget must not turn into a sweep of funds they
  // never saw quoted there.
  it('rejects when the wallet balance changed since the amount was proposed', async () => {
    await DfxMaxAmount.remember('wallet-1', DfxService.SELL, 99990000, 100000000);
    const confirmed = await DfxMaxAmount.wasConfirmed('wallet-1', DfxService.SELL, '0.9999', 120000000);
    assert.strictEqual(confirmed, false);
  });

  it('keeps Sell and Swap remembered amounts for the same wallet independent', async () => {
    await DfxMaxAmount.remember('wallet-1', DfxService.SELL, 99990000, 100000000);
    const confirmed = await DfxMaxAmount.wasConfirmed('wallet-1', DfxService.SWAP, '0.9999', 100000000);
    assert.strictEqual(confirmed, false);
  });

  // A remembered value is single-use, so a later, unrelated confirm can't coincidentally match it.
  it('consumes the remembered value on read, so a second check no longer matches', async () => {
    await DfxMaxAmount.remember('wallet-1', DfxService.SELL, 99990000, 100000000);
    const first = await DfxMaxAmount.wasConfirmed('wallet-1', DfxService.SELL, '0.9999', 100000000);
    const second = await DfxMaxAmount.wasConfirmed('wallet-1', DfxService.SELL, '0.9999', 100000000);
    assert.strictEqual(first, true);
    assert.strictEqual(second, false);
  });
});
