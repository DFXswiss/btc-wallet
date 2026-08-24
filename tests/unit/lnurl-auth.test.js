import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { Chain } from '../../models/bitcoinUnits';
import loc from '../../loc';
import LnurlAuth from '../../screen/lnd/lnurlAuth';
import Lnurl from '../../class/lnurl';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import { BlueDarkTheme } from '../../components/themes';

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

jest.mock('../../screen/send/success', () => {
  const RN = require('react');
  const { Text } = require('react-native');
  return {
    SuccessView: () => RN.createElement(Text, { testID: 'SuccessView' }, 'success'),
  };
});

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

function makeOffchainWallet(overrides = {}) {
  return {
    getID: () => 'ln-1',
    chain: Chain.OFFCHAIN,
    lnAddress: 'user@example.com',
    addressOwnershipProof: 'proof',
    authenticate: jest.fn(() => Promise.resolve()),
    ...overrides,
  };
}

const DFX_LOGIN_LNURL = Lnurl.encode('https://api.dfx.swiss/lnurl?tag=login&k1=00&action=login');
const HOSTLESS_LNURL = Lnurl.encode('not-a-url');

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
    mockWallets = [makeOffchainWallet()];
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

  it('goes back and alerts when the named wallet is on-chain and no Lightning wallet exists', () => {
    mockParams = { walletID: 'onchain-1', lnurl: SAMPLE_LNURL };
    mockWallets = [{ getID: () => 'onchain-1', chain: Chain.ONCHAIN }];
    renderScreen();

    expect(mockGoBack).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(Alert.alert).toHaveBeenCalledWith(expect.any(String), loc.wallets.add_ln_wallet_first);
  });

  it('falls back to a Lightning wallet when the named wallet is on-chain', () => {
    const lightning = makeOffchainWallet({ getID: () => 'ln-fallback' });
    mockParams = { walletID: 'onchain-1', lnurl: SAMPLE_LNURL };
    mockWallets = [{ getID: () => 'onchain-1', chain: Chain.ONCHAIN }, lightning];
    const screen = renderScreen();

    expect(mockGoBack).not.toHaveBeenCalled();
    expect(screen.getByText(loc.lnurl_auth.authenticate)).toBeTruthy();
  });

  it('uses the named Lightning wallet when its id matches', () => {
    const named = makeOffchainWallet({ getID: () => 'ln-named' });
    const other = makeOffchainWallet({ getID: () => 'ln-other', authenticate: jest.fn() });
    mockParams = { walletID: 'ln-named', lnurl: SAMPLE_LNURL };
    mockWallets = [other, named];
    const screen = renderScreen();

    fireEvent.press(screen.getByText(loc.lnurl_auth.authenticate));
    expect(named.authenticate).toHaveBeenCalledTimes(1);
    expect(other.authenticate).not.toHaveBeenCalled();
  });

  it('still goes back when lnurl is missing and no Lightning wallet is available', () => {
    mockParams = { walletID: undefined, lnurl: '' };
    mockWallets = [];
    const screen = renderScreen();

    expect(screen.getByTestId('BlueLoading')).toBeTruthy();
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});

describe('LnurlAuth authenticate', () => {
  beforeEach(() => {
    mockGoBack.mockClear();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockParams = { walletID: 'ln-1', lnurl: SAMPLE_LNURL };
  });

  afterEach(() => {
    Alert.alert.mockRestore();
  });

  it('shows the success view after authenticate resolves', async () => {
    const wallet = makeOffchainWallet();
    mockWallets = [wallet];
    const screen = renderScreen();

    fireEvent.press(screen.getByText(loc.lnurl_auth.authenticate));

    await waitFor(() => screen.getByTestId('SuccessView'));
    expect(
      screen.getByText(loc.formatString(loc.lnurl_auth.auth_answer, { hostname: 'lntxbot.bigsun.xyz' })),
    ).toBeTruthy();
    expect(screen.queryByText(loc.lnurl_auth.authenticate)).toBeNull();
    expect(wallet.authenticate).toHaveBeenCalledWith(expect.any(Lnurl), undefined);
  });

  it('shows the login question and sends DFX extra params when the LNURL host is dfx.swiss', async () => {
    const wallet = makeOffchainWallet();
    mockParams = { walletID: 'ln-1', lnurl: DFX_LOGIN_LNURL };
    mockWallets = [wallet];
    const screen = renderScreen();

    expect(screen.getByText(loc.lnurl_auth.login_question_part_1)).toBeTruthy();
    expect(screen.getByText('api.dfx.swiss')).toBeTruthy();
    expect(screen.getByText(loc.lnurl_auth.login_question_part_2)).toBeTruthy();

    fireEvent.press(screen.getByText(loc.lnurl_auth.authenticate));

    await waitFor(() => screen.getByTestId('SuccessView'));
    const expectedAddress = Lnurl.getLnurlFromAddress(wallet.lnAddress).toUpperCase();
    expect(wallet.authenticate).toHaveBeenCalledWith(expect.any(Lnurl), {
      address: expectedAddress,
      signature: 'proof',
      wallet: 'DFX Bitcoin',
    });
    expect(
      screen.getByText(loc.formatString(loc.lnurl_auth.login_answer, { hostname: 'api.dfx.swiss' })),
    ).toBeTruthy();
  });

  it('omits DFX extra params when the Lightning address is missing', async () => {
    const wallet = makeOffchainWallet({ lnAddress: '' });
    mockParams = { walletID: 'ln-1', lnurl: DFX_LOGIN_LNURL };
    mockWallets = [wallet];
    const screen = renderScreen();

    fireEvent.press(screen.getByText(loc.lnurl_auth.authenticate));

    await waitFor(() => screen.getByTestId('SuccessView'));
    expect(wallet.authenticate).toHaveBeenCalledWith(expect.any(Lnurl), undefined);
  });

  it('omits DFX extra params when the ownership proof is missing', async () => {
    const wallet = makeOffchainWallet({ addressOwnershipProof: undefined });
    mockParams = { walletID: 'ln-1', lnurl: DFX_LOGIN_LNURL };
    mockWallets = [wallet];
    const screen = renderScreen();

    fireEvent.press(screen.getByText(loc.lnurl_auth.authenticate));

    await waitFor(() => screen.getByTestId('SuccessView'));
    expect(wallet.authenticate).toHaveBeenCalledWith(expect.any(Lnurl), undefined);
  });

  it('omits DFX extra params when the LNURL has no hostname', async () => {
    const wallet = makeOffchainWallet();
    mockParams = { walletID: 'ln-1', lnurl: HOSTLESS_LNURL };
    mockWallets = [wallet];
    const screen = renderScreen();

    fireEvent.press(screen.getByText(loc.lnurl_auth.authenticate));

    await waitFor(() => screen.getByTestId('SuccessView'));
    expect(wallet.authenticate).toHaveBeenCalledWith(expect.any(Lnurl), undefined);
  });

  it('shows the Error message when authenticate rejects with an Error', async () => {
    const wallet = makeOffchainWallet();
    wallet.authenticate.mockRejectedValue(new Error('auth denied'));
    mockWallets = [wallet];
    const screen = renderScreen();

    fireEvent.press(screen.getByText(loc.lnurl_auth.authenticate));

    await waitFor(() => screen.getByText('auth denied'));
    expect(
      screen.getByText(loc.formatString(loc.lnurl_auth.could_not_auth, { hostname: 'lntxbot.bigsun.xyz' })),
    ).toBeTruthy();
    expect(screen.queryByText(loc.lnurl_auth.authenticate)).toBeNull();
  });

  it('falls back to the stringified Error when authenticate rejects with an Error that has no message', async () => {
    const wallet = makeOffchainWallet();
    const err = new Error('hidden');
    err.message = undefined;
    wallet.authenticate.mockRejectedValue(err);
    mockWallets = [wallet];
    const screen = renderScreen();

    fireEvent.press(screen.getByText(loc.lnurl_auth.authenticate));

    await waitFor(() => screen.getByText(`${err}`));
    expect(
      screen.getByText(loc.formatString(loc.lnurl_auth.could_not_auth, { hostname: 'lntxbot.bigsun.xyz' })),
    ).toBeTruthy();
  });

  it('stringifies a non-Error rejection from authenticate', async () => {
    const wallet = makeOffchainWallet();
    wallet.authenticate.mockRejectedValue(42);
    mockWallets = [wallet];
    const screen = renderScreen();

    fireEvent.press(screen.getByText(loc.lnurl_auth.authenticate));

    await waitFor(() => screen.getByText('42'));
    expect(
      screen.getByText(loc.formatString(loc.lnurl_auth.could_not_auth, { hostname: 'lntxbot.bigsun.xyz' })),
    ).toBeTruthy();
  });

  it('pops to the top of the parent stack from the close button', () => {
    const popToTop = jest.fn();
    const options = LnurlAuth.navigationOptions(BlueDarkTheme)({
      navigation: { getParent: () => ({ popToTop }) },
      route: {},
    });
    const close = render(options.headerRight());
    fireEvent.press(close.getByTestId('NavigationCloseButton'));
    expect(popToTop).toHaveBeenCalledTimes(1);
    close.unmount();
  });
});
