import React from 'react';
import { TouchableWithoutFeedback } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import AmountInput from '../../components/AmountInput';
import { BitcoinUnit } from '../../models/bitcoinUnits';

const mockFocus = jest.fn();

jest.mock('../../blue_modules/currency', () => ({
  mostRecentFetchedRate: jest.fn(() => Promise.resolve({})),
  isRateOutdated: jest.fn(() => Promise.resolve(false)),
  updateExchangeRate: jest.fn(() => Promise.resolve()),
  fiatToBTC: jest.fn(() => '0'),
  satoshiToBTC: jest.fn(() => '0'),
  satoshiToLocalCurrency: jest.fn(() => '$0.00'),
  getCurrencySymbol: jest.fn(() => '$'),
}));

// The wrapper reads colors from the navigation theme; provide one so the
// component can render outside a NavigationContainer.
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useTheme: () => ({
      colors: {
        alternativeTextColor2: '#0070ff',
        buttonDisabledTextColor: '#999999',
        buttonAlternativeTextColor: '#ffffff',
        mainColor: '#ff0000',
      },
    }),
  };
});

// Expose a focus() on the TextInput's ref so we can assert the press path
// (this.textInput.current?.focus()) actually reaches the input. react-test-renderer
// gives composite refs a no-op focus, which is why a plain "does not throw" assertion
// would stay green even if the #200 ref fix were reverted.
jest.mock('react-native/Libraries/Components/TextInput/TextInput', () => {
  const react = require('react');
  const TextInputMock = react.forwardRef((props, ref) => {
    react.useImperativeHandle(ref, () => ({ focus: mockFocus }));
    return react.createElement('TextInput', { testID: props.testID });
  });
  return { __esModule: true, default: TextInputMock };
});

describe('AmountInput focus (ref fix, PR #200)', () => {
  beforeEach(() => mockFocus.mockClear());

  it('renders the amount input', async () => {
    const screen = render(<AmountInput unit={BitcoinUnit.BTC} amount="0" onChangeText={jest.fn()} onAmountUnitChange={jest.fn()} />);
    await act(async () => {}); // flush the async rate fetch started in componentDidMount
    expect(screen.getByTestId('BitcoinAmountInput')).toBeTruthy();
  });

  it('focuses the amount input when the surrounding press target is tapped', async () => {
    const screen = render(<AmountInput unit={BitcoinUnit.BTC} amount="0" onChangeText={jest.fn()} onAmountUnitChange={jest.fn()} />);
    await act(async () => {});

    // outer TouchableWithoutFeedback onPress -> this.textInput.current?.focus()
    // (the createRef object #200 switched to)
    fireEvent.press(screen.UNSAFE_getAllByType(TouchableWithoutFeedback)[0]);
    expect(mockFocus).toHaveBeenCalledTimes(1);
  });
});
