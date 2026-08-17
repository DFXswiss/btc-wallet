import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { Chain } from '../../models/bitcoinUnits';
import loc from '../../loc';
import LnurlAuth from '../../screen/lnd/lnurlAuth';
import { BlueStorageContext } from '../../blue_modules/storage-context';

const mockGoBack = jest.fn();
let mockWallets = [];
let mockParams = {};

jest.mock('react-native-haptic-feedback', () => ({
  trigger: jest.fn(),
}));

jest.mock('@react-navigation/native', () => {
  const RN = require('react');
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ goBack: mockGoBack }),
    useRoute: () => ({ params: mockParams }),
    useTheme: () => ({
      colors: {
        background: '#000000',
        elevated: '#111111',
      },
    }),
    useFocusEffect: cb => {
      RN.useEffect(() => {
        const cleanup = cb();
        return typeof cleanup === 'function' ? cleanup : undefined;
      }, [cb]);
    },
  };
});

jest.mock('../../blue_modules/storage-context', () => {
  const RN = require('react');
  return { BlueStorageContext: RN.createContext({ wallets: [] }) };
});

jest.mock('../../components/navigationStyle', () => () => options => options);

jest.mock('../../screen/send/success', () => ({
  SuccessView: () => null,
}));

jest.mock('../../BlueComponents', () => {
  const RN = require('react');
  const { Text, View, TouchableOpacity } = require('react-native');
  return {
    BlueButton: props =>
      RN.createElement(
        TouchableOpacity,
        { accessibilityRole: 'button', onPress: props.onPress },
        RN.createElement(Text, null, props.title),
      ),
    BlueCard: props => RN.createElement(View, null, props.children),
    BlueLoading: () => RN.createElement(Text, { testID: 'BlueLoading' }, 'loading'),
    BlueSpacing20: () => null,
    BlueSpacing40: () => null,
    BlueText: props => RN.createElement(Text, null, props.children),
    SafeBlueArea: props => RN.createElement(View, null, props.children),
  };
});

// Valid LNURL-pay bech32 from the repo's lnurl tests; enough for URL.parse + hostname.
const SAMPLE_LNURL = 'LNURL1DP68GURN8GHJ7MRWW3UXYMM59E3XJEMNW4HZU7RE0GHKCMN4WFKZ7URP0YLH2UM9WF5KG0FHXYCNV9G9W58';

const offchainWallet = {
  getID: () => 'ln-1',
  chain: Chain.OFFCHAIN,
  lnAddress: 'user@example.com',
  addressOwnershipProof: 'proof',
  authenticate: jest.fn(() => Promise.resolve()),
};

const renderScreen = () =>
  render(React.createElement(BlueStorageContext.Provider, { value: { wallets: mockWallets } }, React.createElement(LnurlAuth)));

describe('LnurlAuth without Lightning wallet', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockGoBack.mockClear();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockParams = { walletID: undefined, lnurl: SAMPLE_LNURL };
  });

  afterEach(() => {
    Alert.alert.mockRestore();
    jest.useRealTimers();
  });

  it('goes back and alerts when no Lightning wallet is available', () => {
    mockWallets = [];
    renderScreen();

    expect(mockGoBack).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(Alert.alert).toHaveBeenCalledWith(expect.any(String), loc.wallets.add_ln_wallet_first);
  });

  it('renders the authenticate prompt when a Lightning wallet is present', () => {
    mockWallets = [offchainWallet];
    const screen = renderScreen();

    expect(mockGoBack).not.toHaveBeenCalled();
    expect(screen.getByText(loc.lnurl_auth.authenticate)).toBeTruthy();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('shows a localized error when the wallet cannot authenticate, instead of throwing', () => {
    const sparkLikeWallet = {
      getID: () => 'spark-1',
      chain: Chain.OFFCHAIN,
      lnAddress: 'spark@example.com',
    };
    mockWallets = [sparkLikeWallet];
    const screen = renderScreen();

    expect(() => {
      fireEvent.press(screen.getByText(loc.lnurl_auth.authenticate));
    }).not.toThrow();

    expect(screen.getByText(loc.wallets.lightning_spark_lnurl_auth_unsupported)).toBeTruthy();
    expect(screen.queryByText(loc.lnurl_auth.authenticate)).toBeNull();
  });
});
