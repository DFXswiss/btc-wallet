import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

const mockRouteParams = { hash: 'txid', walletID: 'wallet' };

jest.mock('../../blue_modules/storage-context', () => {
  const ReactModule = require('react');
  return { BlueStorageContext: ReactModule.createContext({}) };
});
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: jest.fn(), setOptions: jest.fn(), goBack: jest.fn() }),
    useRoute: () => ({ params: mockRouteParams }),
    useTheme: () => require('../../components/themes').BlueDarkTheme,
  };
});
jest.mock('../../blue_modules/BlueElectrum', () => ({
  multiGetTransactionByTxid: jest.fn(),
  getMempoolTransactionsByAddress: jest.fn(),
}));

const TransactionStatus = require('../../screen/transactions/transactionStatus').default;
const { BlueStorageContext } = require('../../blue_modules/storage-context');
const loc = require('../../loc').default;

const RECIPIENT = 'bc1q063ctu6jhe5k4v8ka99qac8rcm2tzjjnuktyrl';

const outgoingTx = firstOutput => ({
  hash: 'txid',
  value: -20000,
  confirmations: 10,
  inputs: [{ value: 0.0002 }],
  outputs: [{ value: 0.00019, ...firstOutput }],
});

const renderStatus = tx => {
  const wallet = {
    getID: () => 'wallet',
    getTransactions: () => [tx],
    allowRBF: () => false,
    preferredBalanceUnit: 'BTC',
  };
  return render(
    <BlueStorageContext.Provider value={{ wallets: [wallet], txMetadata: {}, setSelectedWallet: jest.fn() }}>
      <TransactionStatus />
    </BlueStorageContext.Provider>,
  );
};

describe('TransactionStatus recipient', () => {
  it('renders an outgoing transaction whose first output has no address without a recipient', async () => {
    const screen = renderStatus(outgoingTx({ scriptPubKey: { hex: '6a0474657374', type: 'nulldata' } }));

    await waitFor(() => expect(screen.getByText('6+ confirmations')).toBeTruthy());
    expect(screen.queryByText(loc.send.create_to)).toBeNull();
  });

  it('shows the address of the first output as the recipient', async () => {
    const screen = renderStatus(outgoingTx({ scriptPubKey: { addresses: [RECIPIENT] } }));

    await waitFor(() => expect(screen.getByText('6+ confirmations')).toBeTruthy());
    expect(screen.getByText(loc.send.create_to)).toBeTruthy();
    expect(screen.getByText(RECIPIENT)).toBeTruthy();
  });
});
