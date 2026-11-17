import { renderHook, act } from '@testing-library/react-native';
import useInputAmount from '../../hooks/useInputAmount';
import { BitcoinUnit } from '../../models/bitcoinUnits';

jest.mock('../../blue_modules/currency', () => ({
  mostRecentFetchedRate: jest.fn(() => Promise.resolve({})),
  fiatToBTC: jest.fn(() => 0),
  satoshiToBTC: jest.fn(() => 0),
  getCurrencySymbol: jest.fn(() => '$'),
}));

// resetInput is what the receive screen calls on wallet switch (PR #200) to
// clear the custom amount. It must wipe the typed amount, the sats value and
// restore the initial unit.
describe('useInputAmount resetInput', () => {
  it('clears amount + sats and restores the initial unit', () => {
    const { result } = renderHook(() => useInputAmount(BitcoinUnit.BTC));

    act(() => result.current.inputProps.onChangeText('1'));
    act(() => result.current.changeToNextUnit()); // BTC -> SATS

    expect(result.current.amountSats).toBe(100000000);
    expect(result.current.unit).toBe(BitcoinUnit.SATS);

    act(() => result.current.resetInput());

    expect(result.current.inputAmount).toBe('');
    expect(result.current.amountSats).toBe(0);
    expect(result.current.unit).toBe(BitcoinUnit.BTC);
  });
});
