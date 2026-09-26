import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockNavigate = jest.fn();
const mockPop = jest.fn();
const mockLoadSuccessfulPayment = jest.fn();
const mockGetDisposable = jest.fn();
const mockGetDescription = jest.fn();
const mockGetLnurl = jest.fn();
const mockAnimation = { reset: jest.fn(), play: jest.fn() };
const mockRouteParams = { amount: 0.001, fee: 120, invoiceDescription: 'invoice memo' };

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, getParent: () => ({ pop: mockPop }) }),
    useRoute: () => ({ params: mockRouteParams }),
    useTheme: () => require('../../components/themes').BlueDarkTheme,
  };
});
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../class/lnurl', () =>
  jest.fn(function Lnurl() {
    this.loadSuccessfulPayment = mockLoadSuccessfulPayment;
    this.getDisposable = mockGetDisposable;
    this.getDescription = mockGetDescription;
    this.getLnurl = mockGetLnurl;
  }),
);
jest.mock('lottie-react-native', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  return ReactModule.forwardRef((_props, ref) => {
    ReactModule.useImperativeHandle(ref, () => mockAnimation);
    return <View testID="SuccessAnimation" />;
  });
});
jest.mock('../../components/icons/TransactionIncomingIcon', () => {
  const { View } = require('react-native');
  return () => <View testID="IncomingIcon" />;
});
jest.mock('../../components/icons/TransactionOutgoingIcon', () => {
  const { View } = require('react-native');
  return () => <View testID="OutgoingIcon" />;
});

const SuccessModule = require('../../screen/send/success');
const Success = SuccessModule.default;
const { SuccessView } = SuccessModule;
const loc = require('../../loc').default;
const { BitcoinUnit } = require('../../models/bitcoinUnits');

const renderSuccessView = props => render(<SuccessView {...props} />);

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  Object.assign(mockRouteParams, { amount: 0.001, fee: 120, invoiceDescription: 'invoice memo' });
  mockLoadSuccessfulPayment.mockResolvedValue(false);
  mockGetDisposable.mockReturnValue(false);
  mockGetDescription.mockReturnValue('loaded description');
  mockGetLnurl.mockReturnValue('lnurl-code');
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('Success screen and view', () => {
  it('pops its parent navigation stack when Done is pressed', () => {
    const screen = render(<Success />);

    fireEvent.press(screen.getByRole('button', { name: loc.send.success_done }));

    expect(mockPop).toHaveBeenCalledTimes(1);
  });

  it('uses the route defaults when amount unit and memo are omitted', () => {
    delete mockRouteParams.amountUnit;
    delete mockRouteParams.invoiceDescription;
    const screen = render(<Success />);

    expect(screen.getByText(' BTC')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: loc.send.success_done }));
    expect(mockPop).toHaveBeenCalledTimes(1);
  });

  it('renders a positive amount, invoice memo, incoming direction, and absolute fee', () => {
    const screen = renderSuccessView({
      amount: 0.001,
      amountUnit: 'BTC',
      fee: -42,
      invoiceDescription: 'invoice memo',
      shouldAnimate: false,
    });

    expect(screen.getByText('0.001')).toBeTruthy();
    expect(screen.getByText(' BTC')).toBeTruthy();
    expect(screen.getByText('invoice memo')).toBeTruthy();
    expect(screen.getByText(`${loc.send.create_fee.toLowerCase()}: 42 ${loc.units[BitcoinUnit.SATS]}`)).toBeTruthy();
    expect(screen.getByTestId('IncomingIcon')).toBeTruthy();
    expect(screen.queryByTestId('OutgoingIcon')).toBeNull();
  });

  it('renders an outgoing zero-or-negative amount without a fee when fee is absent', () => {
    const negative = renderSuccessView({ amount: -1, amountUnit: 'BTC', invoiceDescription: '', shouldAnimate: false });

    expect(negative.getByText('-1')).toBeTruthy();
    expect(negative.getByTestId('OutgoingIcon')).toBeTruthy();
    expect(negative.queryByText(new RegExp(loc.send.create_fee.toLowerCase()))).toBeNull();

    const empty = renderSuccessView({ amount: undefined, amountUnit: 'BTC', invoiceDescription: '', shouldAnimate: false });
    expect(empty.queryByTestId('OutgoingIcon')).toBeTruthy();
  });

  it('plays the animation and reveals the outgoing icon after completion', async () => {
    const screen = renderSuccessView({ amount: -0.001, amountUnit: 'BTC', shouldAnimate: true });

    expect(screen.queryByTestId('OutgoingIcon')).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(100);
      jest.advanceTimersByTime(1900);
      await Promise.resolve();
    });

    expect(mockAnimation.reset).toHaveBeenCalledTimes(1);
    expect(mockAnimation.play).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('OutgoingIcon')).toBeTruthy();
  });

  it('loads a repeatable LNURL payment and navigates to repeat it', async () => {
    mockLoadSuccessfulPayment.mockResolvedValue(true);
    mockGetDisposable.mockReturnValue(false);
    const screen = renderSuccessView({
      amount: 1,
      amountUnit: 'BTC',
      paymentHash: 'payment-hash',
      walletID: 'wallet-id',
      shouldAnimate: false,
    });

    await waitFor(() => expect(screen.getByRole('button', { name: loc._.repeat })).toBeTruthy());
    expect(mockLoadSuccessfulPayment).toHaveBeenCalledWith('payment-hash');
    expect(screen.getByText('loaded description')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: loc._.repeat }));

    expect(mockNavigate).toHaveBeenCalledWith('SendDetailsRoot', {
      screen: 'LnurlPay',
      params: { lnurl: 'lnurl-code', walletID: 'wallet-id' },
    });
  });

  it('converts object payment hashes and hides repeat for disposable payments', async () => {
    mockLoadSuccessfulPayment.mockResolvedValue(true);
    mockGetDisposable.mockReturnValue(true);
    const screen = renderSuccessView({ amount: 1, amountUnit: 'BTC', paymentHash: { data: [1, 2, 255] }, shouldAnimate: false });

    await waitFor(() => expect(mockLoadSuccessfulPayment).toHaveBeenCalledWith('0102ff'));
    expect(screen.queryByRole('button', { name: loc._.repeat })).toBeNull();
    expect(screen.getByText('loaded description')).toBeTruthy();
  });

  it('keeps the success view usable when LNURL loading fails', async () => {
    mockLoadSuccessfulPayment.mockRejectedValue(new Error('offline'));
    const screen = renderSuccessView({ amount: 1, amountUnit: 'BTC', paymentHash: 'payment-hash', shouldAnimate: false });

    await waitFor(() => expect(mockLoadSuccessfulPayment).toHaveBeenCalledWith('payment-hash'));
    expect(screen.queryByRole('button', { name: loc._.repeat })).toBeNull();
    expect(screen.getByText('1')).toBeTruthy();
  });
});
