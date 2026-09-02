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
const { lnurlPaySuccessDisplay } = require('../../screen/lnd/lnurlPaySuccess');
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

  it('uses the passed LNURL pay display object when storage has no successful payment', async () => {
    jest.spyOn(Lnurl.prototype, 'loadSuccessfulPayment').mockResolvedValue(false);
    const screen = renderSuccess({
      lnurlPay: {
        domain: 'merchant.example',
        description: 'tea for two',
        preamble: 'your code',
        message: '1234',
        repeatable: false,
      },
    });

    await waitFor(() => expect(screen.getByText('merchant.example')).toBeTruthy());
    expect(Lnurl.prototype.loadSuccessfulPayment).toHaveBeenCalledWith('hash-1');
    expect(screen.getByText('tea for two')).toBeTruthy();
    expect(screen.getByText('your code')).toBeTruthy();
    expect(screen.getByText('1234')).toBeTruthy();
    expect(screen.getByTestId('SuccessView')).toBeTruthy();
    expect(screen.UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
  });

  it('does not put the preimage on the fallback LNURL payload', () => {
    const preimage = 'bf62911aa53c017c27ba34391f694bc8bf8aaf59b4ebfd9020e66ac0412e189b';
    const lnurlPay = new Lnurl('LNURL1TEST');
    lnurlPay._lnurlPayServicePayload = {
      domain: 'merchant.example',
      description: 'tea for two',
    };
    lnurlPay._lnurlPayServiceBolt11Payload = {
      successAction: {
        tag: 'aes',
        ciphertext: 'vCWn4TMhIKubUc5+aBVfvw==',
        iv: 'eTGduB45hWTOxHj1dR+LJw==',
        description: 'your code',
      },
      disposable: true,
    };
    lnurlPay._preimage = preimage;
    lnurlPay._AsyncStorage = function fakeStorage() {};

    const payload = lnurlPaySuccessDisplay(lnurlPay);

    expect(payload).not.toBeInstanceOf(Lnurl);
    expect(payload).not.toHaveProperty('_preimage');
    expect(payload).not.toHaveProperty('preimage');
    expect(payload).not.toHaveProperty('_AsyncStorage');
    expect(JSON.stringify(payload)).not.toContain(preimage);
    expect(payload).toEqual({
      domain: 'merchant.example',
      description: 'tea for two',
      lnurl: 'LNURL1TEST',
      repeatable: false,
      preamble: 'your code',
      message: '1234',
    });
  });
});
