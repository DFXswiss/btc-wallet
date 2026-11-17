import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import loc from '../../loc';
import TappedCardDetails from '../../screen/wallets/tappedCardDetails';
import { BlueStorageContext } from '../../blue_modules/storage-context';

// Match LightningLdsWallet.type without importing the class (circular deps under jest).
const LIGHTNING_LDS_TYPE = 'lightningLdsWallet';

let mockWallets = [];

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: jest.fn(),
      replace: jest.fn(),
      goBack: jest.fn(),
    }),
    useRoute: () => ({
      params: {
        tappedCardDetails: {
          uid: 'AABBCCDD',
          lnurlw_base: '',
          k0Version: '00',
          k1Version: '00',
          k2Version: '00',
          k3Version: '00',
          k4Version: '00',
        },
      },
    }),
    useTheme: () => ({
      colors: {
        feeText: '#888888',
        background: '#000000',
        elevated: '#111111',
        buttonBlueBackgroundColor: '#0070ff',
        buttonTextColor: '#ffffff',
        buttonDisabledBackgroundColor: '#333333',
        buttonDisabledTextColor: '#999999',
      },
    }),
  };
});

jest.mock('../../blue_modules/storage-context', () => {
  const RN = require('react');
  return { BlueStorageContext: RN.createContext({ wallets: [], saveToDisk: jest.fn() }) };
});

jest.mock('../../components/navigationStyle', () => () => options => options);

jest.mock('../../components/Alert', () => jest.fn());

jest.mock('../../components/QRCodeComponent', () => () => null);

jest.mock('../../components/HoldCardModal', () => ({
  HoldCardModal: () => null,
}));

jest.mock('../../api/boltcards/hooks/bolcards.hook', () => () => ({
  getBoltcards: jest.fn(() => Promise.resolve([])),
  deleteBoltcard: jest.fn(),
}));

jest.mock('../../api/boltcards/hooks/ntag424.hook', () => ({
  useNtag424: () => ({
    wipeCard: jest.fn(),
    stopNfcSession: jest.fn(),
  }),
}));

jest.mock('../../class/boltcard', () => ({
  __esModule: true,
  default: {
    queryWidthdrawDetails: jest.fn(),
    queryPayDetails: jest.fn(),
  },
}));

jest.mock('../../helpers/errors', () => ({
  reportError: jest.fn(),
}));

jest.mock('../../class/wallets/lightning-lds-wallet', () => ({
  LightningLdsWallet: { type: 'lightningLdsWallet' },
}));

jest.mock('../../class', () => ({
  AbstractWallet: class AbstractWallet {},
}));

jest.mock('../../BlueComponents', () => {
  const RN = require('react');
  const { Text, View, TouchableOpacity } = require('react-native');
  return {
    BlueCard: props => RN.createElement(View, null, props.children),
    BlueLoading: () => RN.createElement(Text, { testID: 'BlueLoading' }, 'loading'),
    BlueSpacing20: () => null,
    BlueText: props => RN.createElement(Text, null, props.children),
    SecondButton: props =>
      RN.createElement(
        TouchableOpacity,
        { accessibilityRole: 'button', onPress: props.onPress },
        RN.createElement(Text, null, props.title),
      ),
  };
});

const renderScreen = () =>
  render(
    React.createElement(
      BlueStorageContext.Provider,
      { value: { wallets: mockWallets, saveToDisk: jest.fn() } },
      React.createElement(TappedCardDetails),
    ),
  );

describe('TappedCardDetails create button gate', () => {
  beforeEach(() => {
    mockWallets = [];
  });

  it('hides the create button when no Lightning wallet is available', async () => {
    const screen = renderScreen();

    await waitFor(() => {
      expect(screen.queryByTestId('BlueLoading')).toBeNull();
    });

    expect(screen.queryByText(loc.boltcard.title_create)).toBeNull();
  });

  it('shows the create button when a Lightning wallet is available', async () => {
    mockWallets = [{ type: LIGHTNING_LDS_TYPE, getID: () => 'ln-1' }];
    const screen = renderScreen();

    await waitFor(() => {
      expect(screen.queryByTestId('BlueLoading')).toBeNull();
    });

    expect(screen.getByText(loc.boltcard.title_create)).toBeTruthy();
  });
});
