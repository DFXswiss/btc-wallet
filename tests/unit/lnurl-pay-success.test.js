import React from 'react';
import { ActivityIndicator } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('../../blue_modules/BlueElectrum', () => ({ connectMain: jest.fn() }));
jest.mock('../../components/Alert', () => jest.fn());
jest.mock('../../helpers/errors', () => ({ reportError: jest.fn() }));
jest.mock('../../screen/send/success', () => {
  const RN = require('react');
  const { Text } = require('react-native');
  return {
    SuccessView: () => RN.createElement(Text, { testID: 'SuccessView' }, 'paid'),
  };
});

const mockPopToTop = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: jest.fn(),
      getParent: () => ({ popToTop: mockPopToTop }),
    }),
    useTheme: () => require('../../components/themes').BlueDarkTheme,
  };
});

const LnurlPaySuccess = require('../../screen/lnd/lnurlPaySuccess').default;
const Lnurl = require('../../class/lnurl').default;
const loc = require('../../loc').default;
const alert = require('../../components/Alert');
const { reportError } = require('../../helpers/errors');

function renderSuccess(extraParams = {}) {
  return render(
    <LnurlPaySuccess
      navigation={{
        navigate: jest.fn(),
        pop: jest.fn(),
        getParent: () => ({ popToTop: mockPopToTop }),
      }}
      route={{
        name: 'LnurlPaySuccess',
        params: {
          paymentHash: 'hash-1',
          fromWalletID: 'wallet-1',
          fee: 2,
          justPaid: true,
          ...extraParams,
        },
      }}
    />,
  );
}

describe('LnurlPaySuccess', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('leaves the loading state and shows the paid result when loading the stored payment rejects', async () => {
    const loadError = new Error('storage unavailable');
    jest.spyOn(Lnurl.prototype, 'loadSuccessfulPayment').mockRejectedValue(loadError);
    const screen = renderSuccess();

    await waitFor(() => expect(alert).toHaveBeenCalledWith('storage unavailable'));
    expect(reportError).toHaveBeenCalledWith('lnurlPaySuccess: failed to load successful payment', loadError);
    expect(screen.getByTestId('SuccessView')).toBeTruthy();
    expect(screen.getByText(loc.send.success_done)).toBeTruthy();
    expect(screen.UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);

    fireEvent.press(screen.getByText(loc.send.success_done));
    expect(mockPopToTop).toHaveBeenCalledTimes(1);
  });
});
