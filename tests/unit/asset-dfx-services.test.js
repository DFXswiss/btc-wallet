import React from 'react';
import { ActivityIndicator, FlatList, Platform, I18nManager } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockReactFlags = { startLoading: false };
jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return {
    ...actual,
    useState: init => {
      if (mockReactFlags.startLoading && init === false) {
        mockReactFlags.startLoading = false;
        return actual.useState(true);
      }
      return actual.useState(init);
    },
  };
});

jest.mock('../../blue_modules/BlueElectrum', () => ({ connectMain: jest.fn() }));
jest.mock('../../blue_modules/currency', () => ({
  init: jest.fn(),
  preferredFiatCurrency: { endPointKey: 'USD' },
  BitcoinUnit: { BTC: 'BTC', SATS: 'sats' },
  satoshiToLocalCurrency: () => '0',
  satoshiToBTC: v => String(v),
}));
jest.mock('react-native-haptic-feedback', () => ({ trigger: jest.fn() }));
jest.mock('../../components/TransactionsNavigationHeader', () => {
  const RN = require('react');
  const { View, TouchableOpacity } = require('react-native');
  function TransactionsNavigationHeader({ onWalletChange, rightHeaderComponent }) {
    return RN.createElement(
      View,
      { testID: 'TransactionsNavigationHeader' },
      rightHeaderComponent || null,
      RN.createElement(TouchableOpacity, {
        testID: 'HeaderWalletChange',
        accessibilityRole: 'button',
        onPress: () =>
          onWalletChange &&
          onWalletChange({
            getPreferredBalanceUnit: () => 'sats',
            preferredBalanceUnit: 'sats',
            hideBalance: true,
          }),
      }),
    );
  }
  TransactionsNavigationHeader.propTypes = {
    onWalletChange: require('prop-types').func,
    rightHeaderComponent: require('prop-types').node,
  };
  return TransactionsNavigationHeader;
});
jest.mock('../../components/TransactionListItem', () => {
  const RN = require('react');
  const { Text } = require('react-native');
  function TransactionListItem({ item, itemPriceUnit }) {
    return RN.createElement(Text, { testID: `tx-${item.hash}` }, `${item.hash}:${itemPriceUnit}`);
  }
  TransactionListItem.propTypes = { item: require('prop-types').any, itemPriceUnit: require('prop-types').string };
  return { TransactionListItem };
});
jest.mock('../../components/FloatButtons', () => {
  const RN = require('react');
  const { View, TouchableOpacity, Text } = require('react-native');
  const FContainer = RN.forwardRef((props, ref) => {
    RN.useImperativeHandle(ref, () => ({
      measure: (...args) => {
        const onMeasure = args[0];
        const x = 0;
        const y = 0;
        const width = 120;
        const height = 48;
        onMeasure(x, y, width, height);
      },
      _nativeTag: 1,
    }));
    return RN.createElement(View, { testID: 'FContainer' }, props.children);
  });
  FContainer.displayName = 'FContainer';
  FContainer.propTypes = { children: require('prop-types').node };
  function FButton({ text, onPress, onLongPress, testID }) {
    return RN.createElement(
      TouchableOpacity,
      { accessibilityRole: 'button', onPress, onLongPress, testID: testID || `FButton-${text}` },
      RN.createElement(Text, null, text),
    );
  }
  FButton.propTypes = {
    text: require('prop-types').string,
    onPress: require('prop-types').func,
    onLongPress: require('prop-types').func,
    testID: require('prop-types').string,
  };
  return { FContainer, FButton };
});

const mockScanQr = jest.fn().mockResolvedValue('');
jest.mock('../../helpers/scan-qr', () => (...args) => mockScanQr(...args));

const mockIsBoltcard = jest.fn(() => false);
jest.mock('../../class/boltcard', () => ({
  isPossiblyBoltcardTapDetails: (...args) => mockIsBoltcard(...args),
}));

const mockIsPsbt = jest.fn(() => false);
const mockIsBoth = jest.fn(() => false);
const mockIsLnUrl = jest.fn(() => false);
const mockNavigationRouteFor = jest.fn();
const mockBothOnSelect = jest.fn(() => ['SendDetailsRoot', { screen: 'SendDetails' }]);
jest.mock('../../class/deeplink-schema-match', () => ({
  isPossiblyPSBTString: (...args) => mockIsPsbt(...args),
  isBothBitcoinAndLightning: (...args) => mockIsBoth(...args),
  isLnUrl: (...args) => mockIsLnUrl(...args),
  navigationRouteFor: (...args) => mockNavigationRouteFor(...args),
  isBothBitcoinAndLightningOnWalletSelect: (...args) => mockBothOnSelect(...args),
}));

const mockGetClipboardContent = jest.fn().mockResolvedValue('');
jest.mock('../../blue_modules/clipboard', () => () => ({
  getClipboardContent: (...args) => mockGetClipboardContent(...args),
}));

const mockShowImagePicker = jest.fn().mockResolvedValue('photo-payload');
jest.mock('../../blue_modules/fs', () => ({
  showImagePickerAndReadImage: (...args) => mockShowImagePicker(...args),
}));

const mockShowActionSheet = jest.fn();
jest.mock('../../screen/ActionSheet', () => ({
  showActionSheetWithOptions: (...args) => mockShowActionSheet(...args),
}));

const mockEnvState = { isDesktop: false };
jest.mock('../../blue_modules/environment', () => ({
  get isDesktop() {
    return mockEnvState.isDesktop;
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../api/dfx/contexts/session.context', () => ({
  DfxService: { BUY: 'buy', SELL: 'sell', SWAP: 'swap' },
  useDfxSessionContext: () => ({ isAvailable: true, openServices: jest.fn() }),
}));
jest.mock('../../contexts/wallet.context', () => ({
  useWalletContext: () => ({ wallet: null }),
}));
jest.mock('../../api/spark/spark-sdk', () => ({
  isSparkSdkConnected: () => false,
  SparkSessionStaleError: class SparkSessionStaleError extends Error {
    constructor() {
      super('Spark session is no longer the one this call started with');
      this.name = 'SparkSessionStaleError';
    }
  },
  acquireSparkSessionLease: () => ({
    identity: null,
    requireSdk: () => ({}),
  }),
}));
jest.mock('react-native-config', () => ({
  REACT_APP_LDS_DEV_URL: 'https://lds-dev.test/',
}));

const mockNavigate = jest.fn();
const mockSetParams = jest.fn();
const mockSetOptions = jest.fn();
const mockGoBack = jest.fn();
const mockRoute = { name: 'WalletTransactions', params: { walletID: '' } };
jest.mock('@react-navigation/native', () => {
  const RN = require('react');
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useRoute: () => mockRoute,
    useNavigation: () => ({
      navigate: mockNavigate,
      setParams: mockSetParams,
      setOptions: mockSetOptions,
      goBack: mockGoBack,
    }),
    useTheme: () => require('../../components/themes').BlueDarkTheme,
    useFocusEffect: cb => {
      RN.useEffect(() => {
        const cleanup = cb();
        return typeof cleanup === 'function' ? cleanup : undefined;
      }, [cb]);
    },
  };
});

const Asset = require('../../screen/wallets/asset').default;
const { BlueStorageContext } = require('../../blue_modules/storage-context');
const { SparkWallet } = require('../../class/wallets/spark-wallet');
const { LightningLdsWallet } = require('../../class/wallets/lightning-lds-wallet');
const loc = require('../../loc').default;
const Haptic = require('react-native-haptic-feedback');
const { BlueDarkTheme } = require('../../components/themes');

function makeSpark(id) {
  const wallet = SparkWallet.create('pk-asset-dfx');
  wallet.getID = () => id;
  wallet.setLabel('Spark');
  return wallet;
}

function makeLds(id) {
  const wallet = LightningLdsWallet.create('lds@test', 'proof');
  wallet.getID = () => id;
  wallet.setLabel('Lightning');
  return wallet;
}

function makeWallet(overrides = {}) {
  const id = overrides.id || 'wallet-1';
  const txs = overrides.txs || [];
  const wallet = {
    getID: () => id,
    type: 'HDsegwitBech32',
    chain: 'ONCHAIN',
    getPreferredBalanceUnit: () => 'BTC',
    getTransactions: n => (typeof n === 'number' ? txs.slice(0, n) : txs),
    allowReceive: () => true,
    allowSend: () => true,
    getBaseURI: () => '',
    isPosMode: false,
    getBoltcards: () => [],
    isHd: () => false,
    getBalance: () => 0,
  };
  Object.assign(wallet, overrides);
  if (!overrides.getID) wallet.getID = () => id;
  if (!overrides.getTransactions) {
    wallet.getTransactions = n => (typeof n === 'number' ? txs.slice(0, n) : txs);
  }
  return wallet;
}

async function longPressSend(screen) {
  const send = screen.getByTestId('SendButton');
  await act(async () => {
    if (typeof send.props.onLongPress === 'function') {
      await send.props.onLongPress();
    } else {
      fireEvent(send, 'onLongPress');
    }
  });
}

function lastActionSheetCall() {
  expect(mockShowActionSheet.mock.calls.length).toBeGreaterThan(0);
  const call = mockShowActionSheet.mock.calls[0];
  expect(Array.isArray(call)).toBe(true);
  return { opts: call[0], callback: call[1] };
}

function pressSheetIndex(handler, index) {
  const selectedIndex = index;
  handler(selectedIndex);
}

function renderAsset(wallet, extraWallets = [], contextExtras = {}) {
  mockRoute.params = { walletID: wallet.getID() };
  mockRoute.name = 'WalletTransactions';
  const saveToDisk = contextExtras.saveToDisk || jest.fn();
  const setSelectedWallet = contextExtras.setSelectedWallet || jest.fn();
  const revalidateBalancesInterval = contextExtras.revalidateBalancesInterval || jest.fn();
  return render(
    <BlueStorageContext.Provider
      value={{
        wallets: [wallet, ...extraWallets],
        saveToDisk,
        setSelectedWallet,
        walletTransactionUpdateStatus: '',
        revalidateBalancesInterval,
        isDfxPos: false,
        isDfxSwap: false,
        txMetadata: {},
        preferredFiatCurrency: { endPointKey: 'USD' },
        language: 'en',
        ...contextExtras,
      }}
    >
      <Asset navigation={{ navigate: mockNavigate }} />
    </BlueStorageContext.Provider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockScanQr.mockResolvedValue('');
  mockIsBoltcard.mockReturnValue(false);
  mockIsPsbt.mockReturnValue(false);
  mockIsBoth.mockReturnValue(false);
  mockIsLnUrl.mockReturnValue(false);
  mockNavigationRouteFor.mockReset();
  mockBothOnSelect.mockReturnValue(['SendDetailsRoot', { screen: 'SendDetails' }]);
  mockGetClipboardContent.mockResolvedValue('');
  mockShowImagePicker.mockResolvedValue('photo-payload');
  mockShowActionSheet.mockReset();
  mockReactFlags.startLoading = false;
  mockEnvState.isDesktop = false;
  Platform.OS = 'ios';
  I18nManager.isRTL = false;
  mockRoute.name = 'WalletTransactions';
  mockRoute.params = { walletID: '' };
});

describe('wallet asset DFX services', () => {
  it('shows External services for an LNDHub wallet and hides them for Spark', () => {
    const sparkScreen = renderAsset(makeSpark('spark-asset-1'));
    expect(sparkScreen.queryByText(loc.wallets.external_services)).toBeNull();
    sparkScreen.unmount();

    const ldsScreen = renderAsset(makeLds('lds-asset-1'));
    expect(ldsScreen.getByText(loc.wallets.external_services)).toBeTruthy();
  });
});

describe('wallet asset missing wallet', () => {
  it('renders nothing when the route wallet id is not in storage', () => {
    mockRoute.params = { walletID: 'missing-id' };
    const screen = render(
      <BlueStorageContext.Provider
        value={{
          wallets: [makeWallet({ id: 'other-id' })],
          saveToDisk: jest.fn(),
          setSelectedWallet: jest.fn(),
          walletTransactionUpdateStatus: '',
          revalidateBalancesInterval: jest.fn(),
        }}
      >
        <Asset navigation={{ navigate: mockNavigate }} />
      </BlueStorageContext.Provider>,
    );
    expect(screen.queryByTestId('TransactionsNavigationHeader')).toBeNull();
    expect(screen.queryByTestId('ReceiveButton')).toBeNull();
    expect(screen.toJSON()).toBeNull();
  });

  it('keeps the transaction list empty instead of throwing when the wallet is removed while mounted', () => {
    const wallet = makeWallet({
      id: 'mounted-1',
      txs: [{ hash: 'stay', received: '2024-01-01T00:00:00.000Z' }],
    });
    mockRoute.params = { walletID: 'mounted-1' };
    const base = {
      saveToDisk: jest.fn(),
      setSelectedWallet: jest.fn(),
      walletTransactionUpdateStatus: '',
      revalidateBalancesInterval: jest.fn(),
      isDfxPos: false,
      isDfxSwap: false,
    };
    const screen = render(
      <BlueStorageContext.Provider value={{ ...base, wallets: [wallet] }}>
        <Asset navigation={{ navigate: mockNavigate }} />
      </BlueStorageContext.Provider>,
    );
    expect(screen.getByTestId('TransactionsNavigationHeader')).toBeTruthy();
    expect(() => {
      screen.rerender(
        <BlueStorageContext.Provider value={{ ...base, wallets: [] }}>
          <Asset navigation={{ navigate: mockNavigate }} />
        </BlueStorageContext.Provider>,
      );
    }).not.toThrow();
    expect(screen.toJSON()).toBeNull();
    expect(screen.queryByTestId('tx-stay')).toBeNull();
  });

  it('keeps the transaction list empty and does not throw when getTransactionsSliced runs without a matching wallet', async () => {
    const foreign = makeWallet({
      id: 'foreign-1',
      txs: [{ hash: 'foreign-tx', received: '2024-01-01T00:00:00.000Z' }],
    });
    mockRoute.params = { walletID: 'absent-wallet' };
    const base = {
      saveToDisk: jest.fn(),
      setSelectedWallet: jest.fn(),
      walletTransactionUpdateStatus: '',
      revalidateBalancesInterval: jest.fn(),
      isDfxPos: false,
      isDfxSwap: false,
    };
    let screen;
    expect(() => {
      screen = render(
        <BlueStorageContext.Provider value={{ ...base, wallets: [foreign] }}>
          <Asset navigation={{ navigate: mockNavigate }} />
        </BlueStorageContext.Provider>,
      );
    }).not.toThrow();
    await act(async () => {
      screen.rerender(
        <BlueStorageContext.Provider value={{ ...base, wallets: [foreign, makeWallet({ id: 'another-foreign' })] }}>
          <Asset navigation={{ navigate: mockNavigate }} />
        </BlueStorageContext.Provider>,
      );
    });
    expect(screen.queryByTestId('tx-foreign-tx')).toBeNull();
    expect(screen.toJSON()).toBeNull();
  });
});

describe('wallet asset empty list copy', () => {
  it('shows the on-chain empty copy when the wallet has no transactions', () => {
    const screen = renderAsset(makeWallet({ chain: 'ONCHAIN', txs: [] }));
    expect(screen.getByText(loc.wallets.list_empty_txs1)).toBeTruthy();
    expect(screen.queryByText(loc.wallets.list_empty_txs1_lightning)).toBeNull();
  });

  it('shows the lightning empty copy when an off-chain wallet has no transactions', () => {
    const screen = renderAsset(makeWallet({ id: 'ln-empty', type: 'lightningLdsWallet', chain: 'OFFCHAIN', txs: [] }));
    expect(screen.getByText(loc.wallets.list_empty_txs1_lightning)).toBeTruthy();
    expect(screen.queryByText(loc.wallets.list_empty_txs1)).toBeNull();
  });
});

describe('wallet asset testnet banner', () => {
  it('shows Testnet when an off-chain wallet is connected to the LDS dev url', () => {
    const screen = renderAsset(
      makeWallet({
        id: 'ln-dev',
        type: 'lightningLdsWallet',
        chain: 'OFFCHAIN',
        getBaseURI: () => 'https://lds-dev.test/hub',
      }),
    );
    expect(screen.getByText('Testnet')).toBeTruthy();
  });

  it('hides Testnet when the off-chain base URI is not the LDS dev url', () => {
    const screen = renderAsset(
      makeWallet({
        id: 'ln-prod',
        type: 'lightningLdsWallet',
        chain: 'OFFCHAIN',
        getBaseURI: () => 'https://lds.example/hub',
      }),
    );
    expect(screen.queryByText('Testnet')).toBeNull();
  });
});

describe('wallet asset transactions list', () => {
  it('sorts transactions newest first after wallets refresh', async () => {
    const txs = [
      { hash: 'older-tx', received: '2020-01-01T00:00:00.000Z' },
      { hash: 'newer-tx', received: '2024-06-01T00:00:00.000Z' },
    ];
    const screen = renderAsset(makeWallet({ txs }));
    await waitFor(() => {
      const list = screen.UNSAFE_getByType(FlatList);
      expect(list.props.data.map(tx => tx.hash)).toEqual(['newer-tx', 'older-tx']);
    });
  });

  it('appends the next page when the list still has unrendered transactions', async () => {
    const txs = Array.from({ length: 20 }, (_, i) => ({
      hash: `tx-${String(i).padStart(2, '0')}`,
      received: new Date(2024, 0, i + 1).toISOString(),
    }));
    const screen = renderAsset(makeWallet({ txs }));
    await waitFor(() => {
      const list = screen.UNSAFE_getByType(FlatList);
      expect(list.props.data).toHaveLength(15);
      expect(list.props.data.some(tx => tx.hash === 'tx-00')).toBe(false);
    });
    const list = screen.UNSAFE_getByType(FlatList);
    await act(async () => {
      await list.props.onEndReached();
    });
    await waitFor(() => {
      const paged = screen.UNSAFE_getByType(FlatList);
      expect(paged.props.data).toHaveLength(20);
      expect(paged.props.data.some(tx => tx.hash === 'tx-00')).toBe(true);
    });
  });

  it('does not grow the list when every transaction is already rendered', async () => {
    const txs = [
      { hash: 'only-a', received: '2024-01-02T00:00:00.000Z' },
      { hash: 'only-b', received: '2024-01-01T00:00:00.000Z' },
    ];
    const screen = renderAsset(makeWallet({ txs }));
    await waitFor(() => expect(screen.getByTestId('tx-only-a')).toBeTruthy());
    const list = screen.UNSAFE_getByType(FlatList);
    await act(async () => {
      await list.props.onEndReached();
    });
    expect(screen.getByTestId('tx-only-a')).toBeTruthy();
    expect(screen.getByTestId('tx-only-b')).toBeTruthy();
    expect(screen.queryByTestId('tx-only-c')).toBeNull();
  });

  it('shows a footer spinner while more transactions remain unrendered', async () => {
    const txs = Array.from({ length: 20 }, (_, i) => ({
      hash: `spin-${i}`,
      received: new Date(2024, 0, i + 1).toISOString(),
    }));
    const screen = renderAsset(makeWallet({ txs }));
    await waitFor(() => expect(screen.getByTestId('tx-spin-19')).toBeTruthy());
    expect(screen.UNSAFE_queryAllByType(ActivityIndicator).length).toBeGreaterThan(0);
  });

  it('returns a 64-point layout for a given row index', () => {
    const screen = renderAsset(makeWallet());
    const list = screen.UNSAFE_getByType(FlatList);
    expect(list.props.getItemLayout(null, 3)).toEqual({ length: 64, offset: 192, index: 3 });
    expect(list.props.keyExtractor({ hash: 'x' }, 4)).toBe('4');
  });
});

describe('wallet asset receive and send', () => {
  it('opens ReceiveDetails for an on-chain wallet', () => {
    const screen = renderAsset(makeWallet({ id: 'onchain-recv' }));
    fireEvent.press(screen.getByTestId('ReceiveButton'));
    expect(mockNavigate).toHaveBeenCalledWith('ReceiveDetailsRoot', {
      screen: 'ReceiveDetails',
      params: { walletID: 'onchain-recv' },
    });
  });

  it('opens LNDReceive for an off-chain wallet that is not in POS mode', () => {
    const screen = renderAsset(
      makeWallet({ id: 'ln-recv', type: 'lightningLdsWallet', chain: 'OFFCHAIN', isPosMode: false }),
    );
    fireEvent.press(screen.getByTestId('ReceiveButton'));
    expect(mockNavigate).toHaveBeenCalledWith('ReceiveDetailsRoot', {
      screen: 'LNDReceive',
      params: { walletID: 'ln-recv' },
    });
  });

  it('opens PosReceive for an off-chain wallet in POS mode', () => {
    const screen = renderAsset(
      makeWallet({ id: 'ln-pos', type: 'lightningLdsWallet', chain: 'OFFCHAIN', isPosMode: true }),
    );
    fireEvent.press(screen.getByTestId('ReceiveButton'));
    expect(mockNavigate).toHaveBeenCalledWith('ReceiveDetailsRoot', {
      screen: 'PosReceive',
      params: { walletID: 'ln-pos' },
    });
  });

  it('opens ScanCodeSend from the send button', () => {
    const screen = renderAsset(makeWallet({ id: 'onchain-send' }));
    fireEvent.press(screen.getByTestId('SendButton'));
    expect(mockNavigate).toHaveBeenCalledWith('ScanCodeSendRoot', {
      screen: 'ScanCodeSend',
      params: { walletID: 'onchain-send' },
    });
  });

  it('hides the receive button when the wallet does not allow receive', () => {
    const screen = renderAsset(makeWallet({ allowReceive: () => false }));
    expect(screen.queryByTestId('ReceiveButton')).toBeNull();
  });

  it('hides the send button when the wallet cannot send and is not a watch-only HD wallet', () => {
    const screen = renderAsset(makeWallet({ allowSend: () => false, type: 'HDsegwitBech32', isHd: () => false }));
    expect(screen.queryByTestId('SendButton')).toBeNull();
  });

  it('shows the send button for a watch-only HD wallet even when allowSend is false', () => {
    const screen = renderAsset(makeWallet({ id: 'wo-hd', type: 'watchOnly', allowSend: () => false, isHd: () => true }));
    expect(screen.getByTestId('SendButton')).toBeTruthy();
  });
});

describe('wallet asset scan and barcode', () => {
  it('does not navigate when the scan helper returns an empty value', async () => {
    mockScanQr.mockResolvedValue('');
    const screen = renderAsset(makeWallet());
    await act(async () => {
      fireEvent.press(screen.getByText(loc.send.details_scan));
    });
    expect(mockScanQr).toHaveBeenCalledWith(mockNavigate, expect.any(Function), false);
    expect(mockNavigate).not.toHaveBeenCalledWith('TappedCardDetails', expect.anything());
    expect(mockNavigate).not.toHaveBeenCalledWith('SendDetailsRoot', expect.anything());
  });

  it('navigates back to the asset route when the scan helper asks to return', async () => {
    mockScanQr.mockImplementation((nav, back) => {
      back();
      return Promise.resolve('');
    });
    const screen = renderAsset(makeWallet({ id: 'scan-back' }));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.send.details_scan));
    });
    expect(mockNavigate).toHaveBeenCalledWith('WalletTransactions', expect.objectContaining({ walletID: 'scan-back' }));
  });

  it('opens TappedCardDetails when the payload looks like boltcard tap details', async () => {
    mockIsBoltcard.mockReturnValue(true);
    mockScanQr.mockResolvedValue('boltcard-payload');
    const screen = renderAsset(makeWallet());
    await act(async () => {
      fireEvent.press(screen.getByText(loc.send.details_scan));
    });
    expect(mockNavigate).toHaveBeenCalledWith('TappedCardDetails', { tappedCardDetails: 'boltcard-payload' });
  });

  it('imports a PSBT into the multisig signer when that wallet can sign', async () => {
    mockIsPsbt.mockReturnValue(true);
    mockScanQr.mockResolvedValue('psbt-base64');
    const multisig = makeWallet({
      id: 'msig-1',
      type: 'HDmultisig',
      howManySignaturesCanWeMake: () => 2,
    });
    const screen = renderAsset(makeWallet({ id: 'onchain-psbt' }), [multisig]);
    await act(async () => {
      fireEvent.press(screen.getByText(loc.send.details_scan));
    });
    expect(mockNavigate).toHaveBeenCalledWith('SendDetailsRoot', {
      screen: 'PsbtMultisig',
      params: { psbtBase64: 'psbt-base64', walletID: 'msig-1' },
    });
  });

  it('does not import a PSBT when no multisig wallet exists', async () => {
    mockIsPsbt.mockReturnValue(true);
    mockScanQr.mockResolvedValue('psbt-base64');
    const screen = renderAsset(makeWallet({ id: 'no-msig' }));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.send.details_scan));
    });
    expect(mockNavigate).not.toHaveBeenCalledWith('SendDetailsRoot', expect.objectContaining({ screen: 'PsbtMultisig' }));
  });

  it('does not import a PSBT when the multisig wallet cannot produce a signature', async () => {
    mockIsPsbt.mockReturnValue(true);
    mockScanQr.mockResolvedValue('psbt-base64');
    const multisig = makeWallet({
      id: 'msig-zero',
      type: 'HDmultisig',
      howManySignaturesCanWeMake: () => 0,
    });
    const screen = renderAsset(makeWallet({ id: 'onchain-psbt-zero' }), [multisig]);
    await act(async () => {
      fireEvent.press(screen.getByText(loc.send.details_scan));
    });
    expect(mockNavigate).not.toHaveBeenCalledWith('SendDetailsRoot', expect.objectContaining({ screen: 'PsbtMultisig' }));
  });

  it('swallows a throw from howManySignaturesCanWeMake while importing a PSBT', async () => {
    mockIsPsbt.mockReturnValue(true);
    mockScanQr.mockResolvedValue('psbt-base64');
    const multisig = makeWallet({
      id: 'msig-throw',
      type: 'HDmultisig',
      howManySignaturesCanWeMake: () => {
        throw new Error('cosigner unavailable');
      },
    });
    const screen = renderAsset(makeWallet({ id: 'onchain-psbt-throw' }), [multisig]);
    await act(async () => {
      fireEvent.press(screen.getByText(loc.send.details_scan));
    });
    expect(mockNavigate).not.toHaveBeenCalledWith('SendDetailsRoot', expect.objectContaining({ screen: 'PsbtMultisig' }));
  });

  it('routes a combined bitcoin+lightning payload through the selected wallet', async () => {
    mockIsBoth.mockReturnValue({ bitcoin: 'bitcoin:addr', lndInvoice: 'lnbc1' });
    mockBothOnSelect.mockReturnValue(['SendDetailsRoot', { screen: 'SendDetails', params: { uri: 'bitcoin:addr' } }]);
    mockScanQr.mockResolvedValue('bitcoin:addr&lightning=lnbc1');
    const screen = renderAsset(makeWallet({ id: 'both-1' }));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.send.details_scan));
    });
    expect(mockBothOnSelect).toHaveBeenCalled();
    expect(Haptic.trigger).toHaveBeenCalledWith('impactLight', { ignoreAndroidSystemSettings: false });
    expect(mockNavigate).toHaveBeenCalledWith('SendDetailsRoot', { screen: 'SendDetails', params: { uri: 'bitcoin:addr' } });
  });

  it('forwards an LNURL to LnurlNavigationForwarder with the current wallet id', async () => {
    mockIsLnUrl.mockReturnValue(true);
    mockScanQr.mockResolvedValue('LNURL1TEST');
    const screen = renderAsset(makeWallet({ id: 'lnurl-1' }));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.send.details_scan));
    });
    expect(mockNavigate).toHaveBeenCalledWith('SendDetailsRoot', {
      screen: 'LnurlNavigationForwarder',
      params: { lnurl: 'LNURL1TEST', walletID: 'lnurl-1' },
    });
  });

  it('hands an unmatched payload to navigationRouteFor and navigates with the completion route', async () => {
    mockNavigationRouteFor.mockImplementation((_event, completion) => {
      completion(['SendDetailsRoot', { screen: 'SendDetails', params: { uri: 'bc1qtest' } }]);
    });
    mockScanQr.mockResolvedValue('bc1qtest');
    const screen = renderAsset(makeWallet({ id: 'fallback-1' }));
    await act(async () => {
      fireEvent.press(screen.getByText(loc.send.details_scan));
    });
    expect(mockNavigationRouteFor).toHaveBeenCalledWith({ url: 'bc1qtest' }, expect.any(Function), {
      walletID: 'fallback-1',
      wallets: expect.any(Array),
    });
    expect(Haptic.trigger).toHaveBeenCalledWith('impactLight', { ignoreAndroidSystemSettings: false });
    expect(mockNavigate).toHaveBeenCalledWith('SendDetailsRoot', { screen: 'SendDetails', params: { uri: 'bc1qtest' } });
  });
});

describe('wallet asset send long-press action sheet', () => {
  it('offers choose-photo, scan and clipboard on iOS when the clipboard has content', async () => {
    mockGetClipboardContent.mockResolvedValue('  clipboard-qr  ');
    const screen = renderAsset(makeWallet({ id: 'ios-sheet' }));
    await longPressSend(screen);
    const { opts, callback } = lastActionSheetCall();
    expect(typeof callback).toBe('function');
    expect(opts.options).toEqual([loc._.cancel, loc.wallets.list_long_choose, loc.wallets.list_long_scan, loc.wallets.list_long_clipboard]);
    expect(opts.cancelButtonIndex).toBe(0);

    mockIsBoltcard.mockReturnValue(true);
    mockShowImagePicker.mockResolvedValue('photo-bolt');
    await act(async () => {
      pressSheetIndex(callback, 1);
    });
    expect(mockShowImagePicker).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('TappedCardDetails', { tappedCardDetails: 'photo-bolt' });
    mockIsBoltcard.mockReturnValue(false);

    await act(async () => {
      pressSheetIndex(callback, 2);
    });
    expect(mockNavigate).toHaveBeenCalledWith('ScanQRCodeRoot', {
      screen: 'ScanQRCode',
      params: {
        launchedBy: 'WalletTransactions',
        onBarScanned: expect.any(Function),
        showFileImportButton: false,
      },
    });

    mockIsBoltcard.mockReturnValue(true);
    mockGetClipboardContent.mockResolvedValue('clip-bolt');
    await act(async () => {
      pressSheetIndex(callback, 3);
    });
    expect(mockNavigate).toHaveBeenCalledWith('TappedCardDetails', { tappedCardDetails: 'clip-bolt' });
  });

  it('omits the clipboard row on iOS when the clipboard is empty', async () => {
    mockGetClipboardContent.mockResolvedValue('   ');
    const screen = renderAsset(makeWallet());
    await longPressSend(screen);
    const { opts, callback } = lastActionSheetCall();
    expect(typeof callback).toBe('function');
    expect(opts.options).toEqual([loc._.cancel, loc.wallets.list_long_choose, loc.wallets.list_long_scan]);
    await act(async () => {
      pressSheetIndex(callback, 0);
    });
    expect(mockShowImagePicker).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalledWith('ScanQRCodeRoot', expect.anything());
  });

  it('runs choose, scan, cancel and clipboard from the Android action sheet', async () => {
    Platform.OS = 'android';
    mockGetClipboardContent.mockResolvedValue('android-clip');
    mockIsLnUrl.mockReturnValue(true);
    const screen = renderAsset(makeWallet({ id: 'android-sheet' }));
    await longPressSend(screen);
    const { opts } = lastActionSheetCall();
    expect(opts.buttons.map(b => b.text)).toEqual([
      loc._.cancel,
      loc.wallets.list_long_choose,
      loc.wallets.list_long_scan,
      loc.wallets.list_long_clipboard,
    ]);
    await act(async () => {
      opts.buttons[0].onPress();
    });
    expect(mockShowImagePicker).not.toHaveBeenCalled();
    await act(async () => {
      opts.buttons[1].onPress();
    });
    expect(mockShowImagePicker).toHaveBeenCalled();
    await act(async () => {
      opts.buttons[2].onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('ScanQRCodeRoot', expect.objectContaining({ screen: 'ScanQRCode' }));
    await act(async () => {
      opts.buttons[3].onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('SendDetailsRoot', {
      screen: 'LnurlNavigationForwarder',
      params: { lnurl: 'android-clip', walletID: 'android-sheet' },
    });
  });

  it('omits the clipboard button on Android when the clipboard is empty', async () => {
    Platform.OS = 'android';
    mockGetClipboardContent.mockResolvedValue('');
    const screen = renderAsset(makeWallet());
    await longPressSend(screen);
    const { opts } = lastActionSheetCall();
    expect(opts.buttons.map(b => b.text)).toEqual([loc._.cancel, loc.wallets.list_long_choose, loc.wallets.list_long_scan]);
  });

  it('builds the Android button list including clipboard when the clipboard has content', async () => {
    Platform.OS = 'android';
    mockGetClipboardContent.mockResolvedValue('android-clip');
    const screen = renderAsset(makeWallet({ id: 'android-buttons' }));
    await longPressSend(screen);
    const { opts } = lastActionSheetCall();
    expect(opts.title).toBe('');
    expect(opts.message).toBe('');
    expect(opts.buttons).toHaveLength(4);
    expect(opts.buttons[0]).toEqual(expect.objectContaining({ text: loc._.cancel, style: 'cancel' }));
    expect(opts.buttons[1].text).toBe(loc.wallets.list_long_choose);
    expect(opts.buttons[2].text).toBe(loc.wallets.list_long_scan);
    expect(opts.buttons[3].text).toBe(loc.wallets.list_long_clipboard);
  });

  it('shows the Android send long-press button list with cancel, choose, scan and clipboard', async () => {
    Platform.OS = 'android';
    mockGetClipboardContent.mockResolvedValue('send-long-press-clip');
    const screen = renderAsset(makeWallet({ id: 'android-send-long-press' }));
    await longPressSend(screen);
    const { opts } = lastActionSheetCall();
    expect(opts.buttons.map(b => b.text)).toEqual([
      loc._.cancel,
      loc.wallets.list_long_choose,
      loc.wallets.list_long_scan,
      loc.wallets.list_long_clipboard,
    ]);
  });

  it('does not open an action sheet on send long-press when the platform is neither iOS nor Android', async () => {
    Platform.OS = 'macos';
    mockGetClipboardContent.mockResolvedValue('ignored');
    const screen = renderAsset(makeWallet({ id: 'macos-send-long-press' }));
    await longPressSend(screen);
    expect(mockShowActionSheet).not.toHaveBeenCalled();
  });
});

describe('wallet asset Android chrome', () => {
  it('goes back from the in-page header', () => {
    Platform.OS = 'android';
    const screen = renderAsset(makeWallet());
    fireEvent.press(screen.getByTestId('NavigationGoBack'));
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('opens Settings with the current wallet id', () => {
    Platform.OS = 'android';
    const screen = renderAsset(makeWallet({ id: 'android-settings' }));
    fireEvent.press(screen.getByTestId('Settings'));
    expect(mockNavigate).toHaveBeenCalledWith('Settings', { walletID: 'android-settings' });
  });

  it('does not open Settings when the wallet id is empty', () => {
    Platform.OS = 'android';
    const screen = renderAsset(makeWallet({ getID: () => '' }));
    expect(mockRoute.params.walletID).toBe('');
    fireEvent.press(screen.getByTestId('Settings'));
    expect(mockNavigate).not.toHaveBeenCalledWith('Settings', expect.anything());
  });

  it('shows the updating title when this wallet is the one being refreshed', () => {
    Platform.OS = 'android';
    const screen = renderAsset(makeWallet({ id: 'updating-1' }), [], { walletTransactionUpdateStatus: 'updating-1' });
    expect(screen.getByText(loc.transactions.updating)).toBeTruthy();
    expect(mockSetOptions).toHaveBeenCalledWith({ headerTitle: loc.transactions.updating });
  });

  it('clears the updating title when another wallet is being refreshed', () => {
    Platform.OS = 'android';
    renderAsset(makeWallet({ id: 'idle-1' }), [], { walletTransactionUpdateStatus: 'other-id' });
    expect(mockSetOptions).toHaveBeenCalledWith({ headerTitle: '' });
  });

  it('measures the action-button row and uses twice that height as the empty-list footer', async () => {
    Platform.OS = 'android';
    const screen = renderAsset(makeWallet({ txs: [] }));
    await waitFor(() => {
      const list = screen.UNSAFE_getByType(FlatList);
      const footer = list.props.ListFooterComponent();
      expect(footer.props.style.height).toBe(96);
    });
  });
});

describe('wallet asset lightning pay card header', () => {
  it('opens BoltCardDetails when the LDS wallet already has a card', () => {
    const screen = renderAsset(
      makeWallet({
        id: 'lds-card',
        type: 'lightningLdsWallet',
        chain: 'OFFCHAIN',
        getBoltcards: () => [{ uid: 'card-1' }],
      }),
    );
    fireEvent.press(screen.getByText(loc.boltcard.pay_card));
    expect(mockNavigate).toHaveBeenCalledWith('BoltCardDetails');
  });

  it('opens AddBoltcard when the LDS wallet has no cards', () => {
    const screen = renderAsset(
      makeWallet({
        id: 'lds-nocard',
        type: 'lightningLdsWallet',
        chain: 'OFFCHAIN',
        getBoltcards: () => [],
      }),
    );
    fireEvent.press(screen.getByText(loc.boltcard.pay_card));
    expect(mockNavigate).toHaveBeenCalledWith('AddBoltcard');
  });

  it('does not render the pay-card control for a non-LDS wallet', () => {
    const screen = renderAsset(makeWallet({ type: 'HDsegwitBech32' }));
    expect(screen.queryByText(loc.boltcard.pay_card)).toBeNull();
  });
});

describe('wallet asset header wallet change', () => {
  it('persists the header unit change and re-renders list items in that unit', async () => {
    const saveToDisk = jest.fn();
    const txs = [{ hash: 'unit-tx', received: '2024-01-01T00:00:00.000Z' }];
    const screen = renderAsset(makeWallet({ txs, getPreferredBalanceUnit: () => 'BTC' }), [], { saveToDisk });
    await waitFor(() => expect(screen.getByText('unit-tx:BTC')).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByTestId('HeaderWalletChange'));
    });
    await waitFor(() => expect(saveToDisk).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('unit-tx:sats')).toBeTruthy());
  });
});

describe('wallet asset setParams and DFX gating', () => {
  it('writes walletID and isLoading false into route params when the wallet is present', async () => {
    const revalidateBalancesInterval = jest.fn();
    renderAsset(makeWallet({ id: 'params-1' }), [], { revalidateBalancesInterval });
    await waitFor(() =>
      expect(mockSetParams).toHaveBeenCalledWith({
        walletID: 'params-1',
        isLoading: false,
      }),
    );
    expect(mockSetOptions).toHaveBeenCalledWith({ headerTitle: '' });
    expect(revalidateBalancesInterval).toHaveBeenCalled();
  });

  it('hides External services for a multisig wallet', () => {
    const screen = renderAsset(makeWallet({ id: 'msig-view', type: 'HDmultisig' }));
    expect(screen.queryByText(loc.wallets.external_services)).toBeNull();
  });
});

describe('wallet asset navigationOptions', () => {
  it('hides the native header on Android', () => {
    const previous = Platform.OS;
    Platform.OS = 'android';
    try {
      const options = Asset.navigationOptions(BlueDarkTheme)({
        navigation: { navigate: mockNavigate },
        route: { params: { walletID: 'opt-1' } },
      });
      expect(options.headerShown).toBe(false);
    } finally {
      Platform.OS = previous;
    }
  });

  it('opens Settings from the iOS header when the route has a wallet id', () => {
    Platform.OS = 'ios';
    const options = Asset.navigationOptions(BlueDarkTheme)({
      navigation: { navigate: mockNavigate },
      route: { params: { walletID: 'ios-header' } },
    });
    expect(options.headerTransparent).toBe(true);
    const header = render(options.headerRight());
    fireEvent.press(header.getByTestId('Settings'));
    expect(mockNavigate).toHaveBeenCalledWith('Settings', { walletID: 'ios-header' });
    header.unmount();
  });

  it('does not open Settings from the iOS header when the route has no wallet id', () => {
    Platform.OS = 'ios';
    const options = Asset.navigationOptions(BlueDarkTheme)({
      navigation: { navigate: mockNavigate },
      route: { params: {} },
    });
    const header = render(options.headerRight());
    fireEvent.press(header.getByTestId('Settings'));
    expect(mockNavigate).not.toHaveBeenCalledWith('Settings', expect.anything());
    header.unmount();
  });
});

describe('wallet asset module-level branches', () => {
  it('loads with a window whose width/26 is at most 22', () => {
    let loaded;
    jest.isolateModules(() => {
      const RN = require('react-native');
      const spy = jest.spyOn(RN.Dimensions, 'get').mockReturnValue({ width: 260, height: 800, scale: 1, fontScale: 1 });
      try {
        loaded = require('../../screen/wallets/asset').default;
      } finally {
        spy.mockRestore();
      }
    });
    expect(typeof loaded).toBe('function');
  });

  it('loads with a window whose width/26 is above 22', () => {
    let loaded;
    jest.isolateModules(() => {
      const RN = require('react-native');
      const spy = jest.spyOn(RN.Dimensions, 'get').mockReturnValue({ width: 2000, height: 800, scale: 1, fontScale: 1 });
      try {
        loaded = require('../../screen/wallets/asset').default;
      } finally {
        spy.mockRestore();
      }
    });
    expect(typeof loaded).toBe('function');
  });

  it('loads with RTL writing direction', () => {
    let loaded;
    jest.isolateModules(() => {
      require('react-native').I18nManager.isRTL = true;
      loaded = require('../../screen/wallets/asset').default;
      require('react-native').I18nManager.isRTL = false;
    });
    expect(typeof loaded).toBe('function');
  });

  it('renders the transaction list title on desktop while loading and after load', async () => {
    mockEnvState.isDesktop = true;
    mockReactFlags.startLoading = true;
    try {
      const screen = renderAsset(makeWallet({ id: 'desktop-1' }));
      expect(screen.getByText(loc.transactions.list_title)).toBeTruthy();
      await waitFor(() => expect(screen.getByText(loc.transactions.list_title)).toBeTruthy());
      screen.unmount();
    } finally {
      mockReactFlags.startLoading = false;
      mockEnvState.isDesktop = false;
    }
  });
});
