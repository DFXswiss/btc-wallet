import React from 'react';
import { AppState, InteractionManager } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';

const mockRoute = { params: { walletID: 'spark-export' } };
const mockGoBack = jest.fn();
jest.mock('../../api/spark/spark-seed', () => ({ deriveSparkMnemonic: jest.fn(() => 'spark child phrase words here') }));
jest.mock('../../blue_modules/Privacy', () => ({ enableBlur: jest.fn(), disableBlur: jest.fn() }));
jest.mock('../../class/biometrics', () => ({
  isBiometricUseCapableAndEnabled: jest.fn().mockResolvedValue(false),
  unlockWithBiometrics: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../class', () => ({
  HDLegacyBreadwalletWallet: { type: 'HDlegacyBreadwallet' },
  HDLegacyP2PKHWallet: { type: 'HDlegacyP2PKH' },
  HDSegwitBech32Wallet: { type: 'HDsegwitBech32' },
  HDSegwitP2SHWallet: { type: 'HDsegwitP2SH' },
  LegacyWallet: { type: 'legacy' },
  MultisigHDWallet: { type: 'HDmultisig' },
  SegwitBech32Wallet: { type: 'segwitBech32' },
  SegwitP2SHWallet: { type: 'segwitP2SH' },
}));
jest.mock('../../class/wallets/spark-wallet', () => ({ SparkWallet: { type: 'sparkWallet' } }));
jest.mock('../../components/QRCodeComponent', () => () => null);
jest.mock('../../components/navigationStyle', () => (_options, format) => {
  return theme => deps => (format ? format(_options, { theme, ...deps }) : _options);
});
jest.mock('../../blue_modules/storage-context', () => {
  const ReactModule = require('react');
  return { BlueStorageContext: ReactModule.createContext({}) };
});
jest.mock('../../BlueComponents', () => {
  const ReactModule = require('react');
  const { Text: RNText, View: RNView } = require('react-native');
  return {
    BlueSpacing20: () => ReactModule.createElement(RNView),
    SafeBlueArea: ({ children }) => ReactModule.createElement(RNView, null, children),
    BlueText: ({ children, ...props }) => ReactModule.createElement(RNText, props, children),
    BlueCard: ({ children }) => ReactModule.createElement(RNView, null, children),
  };
});
jest.mock('@react-navigation/native', () => {
  const ReactModule = require('react');
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useRoute: () => mockRoute,
    useNavigation: () => ({ goBack: mockGoBack }),
    useTheme: () => require('../../components/themes').BlueDarkTheme,
    useFocusEffect: callback => ReactModule.useEffect(() => callback(), [callback]),
  };
});

const WalletExport = require('../../screen/wallets/export').default;
const { BlueStorageContext } = require('../../blue_modules/storage-context');
const { deriveSparkMnemonic } = require('../../api/spark/spark-seed');
const Privacy = require('../../blue_modules/Privacy');
const Biometric = require('../../class/biometrics');
const originalAppStateDescriptor = Object.getOwnPropertyDescriptor(AppState, 'currentState');

function makeSparkWallet(sourceWalletId = 'source-hd') {
  return {
    type: 'sparkWallet',
    typeReadable: 'Lightning (Spark)',
    sourceWalletId,
    getID: () => 'spark-export',
    getUserHasSavedExport: jest.fn(() => false),
    setUserHasSavedExport: jest.fn(),
  };
}

function makeSource(id, secret = 'on-chain mnemonic', passphrase = 'source passphrase') {
  return {
    type: 'HDsegwitBech32',
    getID: () => id,
    getSecret: jest.fn(() => secret),
    getPassphrase: jest.fn(() => passphrase),
  };
}

function renderExport(wallets, saveToDisk = jest.fn()) {
  mockRoute.params = { walletID: 'spark-export' };
  return render(
    <BlueStorageContext.Provider value={{ wallets, saveToDisk }}>
      <WalletExport />
    </BlueStorageContext.Provider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  jest.spyOn(InteractionManager, 'runAfterInteractions').mockImplementation(callback => {
    callback();
    return { cancel: jest.fn() };
  });
  Biometric.isBiometricUseCapableAndEnabled.mockResolvedValue(false);
  Biometric.unlockWithBiometrics.mockResolvedValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
  if (originalAppStateDescriptor) {
    Object.defineProperty(AppState, 'currentState', originalAppStateDescriptor);
  } else {
    delete AppState.currentState;
  }
});

it('reveals the derived Spark phrase from only the exact bound on-chain wallet', async () => {
  const spark = makeSparkWallet('bound-source');
  const unrelated = makeSource('unrelated-source', 'wrong on-chain mnemonic');
  const bound = makeSource('bound-source', 'bound on-chain mnemonic', 'bound passphrase');
  const saveToDisk = jest.fn();
  const screen = renderExport([spark, unrelated, bound], saveToDisk);

  await waitFor(() => expect(screen.getByText(/1\. spark/)).toBeTruthy());
  expect(deriveSparkMnemonic).toHaveBeenCalledWith('bound on-chain mnemonic', 'bound passphrase');
  expect(screen.queryByTestId('QRCode')).toBeNull();
  expect(saveToDisk).not.toHaveBeenCalled();
  expect(spark.setUserHasSavedExport).not.toHaveBeenCalled();
  expect(Privacy.enableBlur).toHaveBeenCalled();
});

it('fails closed when the bound source wallet is missing and never chooses another HD wallet', async () => {
  const spark = makeSparkWallet('missing-source');
  const unrelated = makeSource('other-source');
  const screen = renderExport([spark, unrelated]);

  await waitFor(() => expect(screen.getByText(require('../../loc').default.wallets.lightning_spark_recovery_unavailable)).toBeTruthy());
  expect(screen.queryByText(/1\. spark/)).toBeNull();
  expect(deriveSparkMnemonic).not.toHaveBeenCalled();
  expect(spark.setUserHasSavedExport).not.toHaveBeenCalled();
});

it('fails closed when the Spark source binding is absent', async () => {
  const spark = makeSparkWallet('');
  const source = makeSource('some-hd');
  const screen = renderExport([spark, source]);

  await waitFor(() => expect(screen.getByText(require('../../loc').default.wallets.lightning_spark_recovery_unavailable)).toBeTruthy());
  expect(deriveSparkMnemonic).not.toHaveBeenCalled();
  expect(spark.setUserHasSavedExport).not.toHaveBeenCalled();
});

it('does not reveal after the app becomes inactive during biometric unlock', async () => {
  let resolveUnlock;
  let onAppStateChange;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    onAppStateChange = callback;
    return { remove: jest.fn() };
  });
  Biometric.isBiometricUseCapableAndEnabled.mockResolvedValue(true);
  Biometric.unlockWithBiometrics.mockImplementation(
    () =>
      new Promise(resolve => {
        resolveUnlock = resolve;
      }),
  );
  const spark = makeSparkWallet('bound-source');
  const source = makeSource('bound-source');
  const screen = renderExport([spark, source]);

  await waitFor(() => expect(Biometric.unlockWithBiometrics).toHaveBeenCalled());
  await act(async () => onAppStateChange('inactive'));
  await act(async () => resolveUnlock(true));
  await act(async () => onAppStateChange('active'));

  expect(screen.queryByText(/1\. spark/)).toBeNull();
  expect(deriveSparkMnemonic).not.toHaveBeenCalled();
  expect(mockGoBack).toHaveBeenCalled();
});
