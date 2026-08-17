import React from 'react';
import assert from 'assert';
import { fireEvent, render, act } from '@testing-library/react-native';
import { PaymentDetails_Tags, PaymentStatus, PaymentType } from '@breeztech/breez-sdk-spark-react-native';

jest.mock('../../blue_modules/BlueElectrum', () => ({ connectMain: jest.fn() }));
jest.mock('../../blue_modules/currency', () => ({
  init: jest.fn(),
  mostRecentFetchedRate: jest.fn(() => Promise.resolve({})),
  fiatToBTC: jest.fn(() => 0),
  satoshiToBTC: jest.fn(() => 0),
  getCurrencySymbol: jest.fn(() => '$'),
  satoshiToLocalCurrency: () => '0',
  preferredFiatCurrency: { endPointKey: 'USD' },
}));
jest.mock('../../blue_modules/notifications', () => ({
  majorTomToGroundControl: jest.fn(),
  tryToObtainPermissions: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../hooks/nfc.hook', () => ({
  useNFC: () => ({
    isNfcActive: false,
    startReading: jest.fn(),
    stopReading: jest.fn(),
  }),
}));
jest.mock('../../components/QRCodeComponent', () => {
  const RN = require('react');
  const { View } = require('react-native');
  return function QRCodeComponent() {
    return RN.createElement(View, { testID: 'QRCode' });
  };
});
jest.mock('../../screen/send/success', () => {
  const RN = require('react');
  const { Text } = require('react-native');
  return {
    SuccessView: () => RN.createElement(Text, { testID: 'SuccessView' }, 'paid'),
  };
});
jest.mock('../../components/navigationStyle', () => () => options => options);

const mockSetParams = jest.fn();
const mockGetParent = jest.fn(() => ({ popToTop: jest.fn() }));
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useRoute: () => ({ params: { walletID: 'spark-receive-1' } }),
    useNavigation: () => ({
      setParams: mockSetParams,
      getParent: mockGetParent,
      navigate: jest.fn(),
    }),
    useTheme: () => require('../../components/themes').BlueDarkTheme,
  };
});

const mockSdk = {
  getInfo: jest.fn(),
  listPayments: jest.fn(),
  receivePayment: jest.fn(),
  prepareSendPayment: jest.fn(),
  sendPayment: jest.fn(),
  getLightningAddress: jest.fn(),
};

jest.mock('../../api/spark/spark-sdk', () => ({
  requireSparkSdk: () => mockSdk,
  getSparkSdk: () => mockSdk,
  isSparkSdkConnected: () => true,
}));

const SAMPLE_INVOICE =
  'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp';

const LNDReceive = require('../../screen/lnd/lndReceive').default;
const { SparkWallet } = require('../../class/wallets/spark-wallet');
const { BlueStorageContext } = require('../../blue_modules/storage-context');
const loc = require('../../loc').default;

function paidPayment() {
  return {
    id: 'recv-1',
    paymentType: PaymentType.Receive,
    status: PaymentStatus.Completed,
    amount: 1000n,
    fees: 0n,
    timestamp: 1700000000n,
    method: {},
    details: {
      tag: PaymentDetails_Tags.Lightning,
      inner: { description: 'coffee', invoice: SAMPLE_INVOICE, destinationPubkey: 'x', htlcDetails: {} },
    },
  };
}

describe('LNDReceive with SparkWallet', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockSdk.receivePayment.mockResolvedValue({ paymentRequest: SAMPLE_INVOICE, fee: 0n });
    mockSdk.listPayments.mockResolvedValue({ payments: [] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts invoice polling after creating a Spark invoice and marks it paid', async () => {
    const wallet = SparkWallet.create('pk-receive-1');
    wallet.getID = () => 'spark-receive-1';
    wallet.lnAddress = 'spark@test';
    wallet.setLabel('Spark');

    const saveToDisk = jest.fn().mockResolvedValue(undefined);
    const fetchAndSaveWalletTransactions = jest.fn();
    const setSelectedWallet = jest.fn();

    const screen = render(
      <BlueStorageContext.Provider
        value={{
          wallets: [wallet],
          saveToDisk,
          setSelectedWallet,
          fetchAndSaveWalletTransactions,
        }}
      >
        <LNDReceive />
      </BlueStorageContext.Provider>,
    );

    fireEvent.changeText(screen.getByPlaceholderText('Amount (optional)'), '1000');
    fireEvent(screen.getByPlaceholderText('Amount (optional)'), 'blur');

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockSdk.receivePayment).toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(mockSdk.listPayments).toHaveBeenCalled();

    mockSdk.listPayments.mockResolvedValue({ payments: [paidPayment()] });

    await act(async () => {
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    expect(screen.getByTestId('SuccessView')).toBeTruthy();
    expect(screen.getByText(loc.send.success_done)).toBeTruthy();
    expect(fetchAndSaveWalletTransactions).toHaveBeenCalledWith('spark-receive-1');
    assert.ok(typeof wallet.getUserInvoices === 'function');
  });
});
