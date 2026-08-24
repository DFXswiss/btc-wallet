import React from 'react';
import { ActivityIndicator, Alert, I18nManager, InteractionManager, Keyboard, Switch, TouchableWithoutFeedback } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockReactFlags = { bip47Backdoor: false, zeroCount: 0 };
jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return {
    ...actual,
    useState: init => {
      if (mockReactFlags.bip47Backdoor && init === 0) {
        mockReactFlags.zeroCount += 1;
        if (mockReactFlags.zeroCount === 2) {
          return actual.useState(10);
        }
      }
      return actual.useState(init);
    },
  };
});

jest.mock('../../blue_modules/BlueElectrum', () => ({ connectMain: jest.fn() }));
jest.mock('../../blue_modules/currency', () => ({
  init: jest.fn(),
  satoshiToLocalCurrency: () => '0',
  satoshiToBTC: v => String(v),
  preferredFiatCurrency: { endPointKey: 'USD' },
}));
jest.mock('react-native-haptic-feedback', () => ({ trigger: jest.fn() }));
jest.mock('../../class/biometrics', () => ({
  isBiometricUseCapableAndEnabled: jest.fn().mockResolvedValue(false),
  unlockWithBiometrics: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../blue_modules/notifications', () => ({ unsubscribe: jest.fn() }));
jest.mock('../../blue_modules/fs', () => ({ writeFileAndExport: jest.fn() }));
jest.mock('../../components/Alert', () => jest.fn());
jest.mock('../../helpers/prompt', () => jest.fn());
jest.mock('@react-native-clipboard/clipboard', () => ({ setString: jest.fn() }));
jest.mock('../../api/dfx/contexts/session.context', () => ({
  useDfxSessionContext: () => ({ reset: mockReset }),
}));
jest.mock('../../api/spark/spark-sdk', () => ({
  isSparkSdkConnected: () => false,
}));
jest.mock('../../components/navigationStyle', () => {
  return (_opts, formatter) => theme => deps => {
    const options = { ..._opts };
    return formatter ? formatter(options, { theme, ...deps }) : options;
  };
});

jest.mock('../../class', () => ({
  HDSegwitBech32Wallet: { type: 'HDsegwitBech32' },
  SegwitP2SHWallet: { type: 'segwitP2SH' },
  LegacyWallet: { type: 'legacy' },
  SegwitBech32Wallet: { type: 'segwitBech32' },
  WatchOnlyWallet: { type: 'watchOnly' },
  MultisigHDWallet: { type: 'HDmultisig' },
  HDAezeedWallet: { type: 'HDAezeedWallet' },
}));
jest.mock('../../class/wallets/lightning-custodian-wallet', () => ({
  LightningCustodianWallet: { type: 'lightningCustodianWallet' },
}));
jest.mock('../../class/wallets/lightning-lds-wallet', () => ({
  LightningLdsWallet: { type: 'lightningLdsWallet' },
}));
jest.mock('../../class/wallets/spark-wallet', () => ({
  SparkWallet: { type: 'sparkWallet' },
}));
jest.mock('../../class/wallets/abstract-hd-electrum-wallet', () => ({
  AbstractHDElectrumWallet: class AbstractHDElectrumWallet {},
}));
jest.mock('../../blue_modules/storage-context', () => {
  const RN = require('react');
  return { BlueStorageContext: RN.createContext({}) };
});

const mockReset = jest.fn();
const mockNavigate = jest.fn();
const mockDispatch = jest.fn();
const mockRoute = { params: { walletID: '' } };
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useRoute: () => mockRoute,
    useNavigation: () => ({
      navigate: mockNavigate,
      dispatch: mockDispatch,
    }),
    useTheme: () => require('../../components/themes').BlueDarkTheme,
  };
});

const mockWalletContext = {
  walletID: 'main-onchain',
  getOwnershipProof: jest.fn().mockResolvedValue('fresh-proof'),
};
jest.mock('../../contexts/wallet.context', () => ({
  useWalletContext: () => mockWalletContext,
}));

const WalletDetails = require('../../screen/wallets/details').default;
const { BlueStorageContext } = require('../../blue_modules/storage-context');
const { AbstractHDElectrumWallet } = require('../../class/wallets/abstract-hd-electrum-wallet');
const loc = require('../../loc').default;
const Haptic = require('react-native-haptic-feedback');
const Biometric = require('../../class/biometrics');
const prompt = require('../../helpers/prompt');
const alertFn = require('../../components/Alert');
const { writeFileAndExport } = require('../../blue_modules/fs');
const { unsubscribe } = require('../../blue_modules/notifications');
const Clipboard = require('@react-native-clipboard/clipboard');
const { StackActions } = require('@react-navigation/native');
const { BlueDarkTheme } = require('../../components/themes');

function makeWallet(type, extras = {}) {
  return {
    type,
    typeReadable: type,
    getID: () => extras.id || type,
    useWithHardwareWalletEnabled: () => false,
    isBIP47Enabled: () => false,
    getHideTransactionsInWalletsList: () => false,
    getTransactions: () => [],
    getDerivationPath: () => {
      throw new Error('none');
    },
    addressOwnershipProof: extras.proof,
    allowMasterFingerprint: () => false,
    getBaseURI: () => 'lndhub',
    isPosMode: false,
    allowBIP47: () => false,
    allowXpub: () => false,
    allowSignVerifyMessage: () => false,
    allowSend: () => true,
    chain: extras.chain || 'OFFCHAIN',
    getBoltcard: () => undefined,
    getLabel: () => 'w',
    label: 'test-wallet',
    getBalance: () => 0,
    getAddress: () => 'addr-placeholder',
    getAllExternalAddresses: () => [],
    isHd: () => false,
    ...extras,
  };
}

function renderDetails(wallet, extras = {}) {
  mockRoute.params = { walletID: extras.walletID || wallet.getID() };
  const wallets = extras.wallets || [wallet];
  return render(
    <BlueStorageContext.Provider
      value={{
        wallets,
        deleteWallet: extras.deleteWallet || jest.fn(),
        setSelectedWallet: extras.setSelectedWallet || jest.fn(),
        txMetadata: extras.txMetadata || {},
        isPosMode: extras.isPosMode || false,
        saveToDisk: extras.saveToDisk || jest.fn().mockResolvedValue(undefined),
        isAdvancedModeEnabled: extras.isAdvancedModeEnabled || jest.fn().mockResolvedValue(false),
      }}
    >
      <WalletDetails />
    </BlueStorageContext.Provider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockReactFlags.bip47Backdoor = false;
  mockReactFlags.zeroCount = 0;
  mockWalletContext.walletID = 'main-onchain';
  mockWalletContext.getOwnershipProof = jest.fn().mockResolvedValue('fresh-proof');
  Biometric.isBiometricUseCapableAndEnabled.mockResolvedValue(false);
  Biometric.unlockWithBiometrics.mockResolvedValue(true);
  prompt.mockReset();
  writeFileAndExport.mockReset();
  I18nManager.isRTL = false;
});

describe('WalletDetails Spark vs LNDHub blocks', () => {
  it('shows ownership proof and export for an LNDHub wallet', async () => {
    const wallet = makeWallet('lightningLdsWallet', { id: 'lds-details-1', proof: 'ownership-proof-lds' });
    const screen = renderDetails(wallet);
    await waitFor(() => expect(screen.getByText(loc.wallets.details_type)).toBeTruthy());
    expect(screen.getByText(loc.wallets.ownership_proof)).toBeTruthy();
    expect(screen.getByText('ownership-proof-lds')).toBeTruthy();
    expect(screen.getByTestId('WalletExport')).toBeTruthy();
    expect(screen.getByText(loc.wallets.details_export_backup)).toBeTruthy();
  });

  it('hides ownership proof and export for a Spark wallet', async () => {
    const wallet = makeWallet('sparkWallet', { id: 'spark-details-1' });
    const screen = renderDetails(wallet);
    await waitFor(() => expect(screen.getByText(loc.wallets.details_type)).toBeTruthy());
    expect(screen.queryByText(loc.wallets.ownership_proof)).toBeNull();
    expect(screen.queryByTestId('WalletExport')).toBeNull();
    expect(screen.queryByText(loc.wallets.details_export_backup)).toBeNull();
  });

  it('shows POS toggle, cashier station and boltcard backup for an LNDHub wallet', async () => {
    const wallet = makeWallet('lightningLdsWallet', {
      id: 'lds-details-pos-bolt',
      isPosMode: true,
      getBoltcard: () => ({ uid: 'card-1' }),
    });
    const screen = renderDetails(wallet);
    await waitFor(() => expect(screen.getByText(loc.wallets.details_type)).toBeTruthy());
    expect(screen.getByText('Activate POS mode')).toBeTruthy();
    expect(screen.getByText('Go to cashier station')).toBeTruthy();
    expect(screen.getByText('Backup Pay Card Details')).toBeTruthy();
  });

  it('hides POS toggle, cashier station and boltcard backup for a Spark wallet', async () => {
    const wallet = makeWallet('sparkWallet', {
      id: 'spark-details-pos-bolt',
      isPosMode: true,
      getBoltcard: () => ({ uid: 'card-1' }),
    });
    const screen = renderDetails(wallet);
    await waitFor(() => expect(screen.getByText(loc.wallets.details_type)).toBeTruthy());
    expect(screen.queryByText('Activate POS mode')).toBeNull();
    expect(screen.queryByText('Go to cashier station')).toBeNull();
    expect(screen.queryByText('Backup Pay Card Details')).toBeNull();
  });
});

describe('WalletDetails connected-to block', () => {
  it('shows the connected-to block for a Spark wallet', async () => {
    const wallet = makeWallet('sparkWallet', { id: 'spark-details-connected', getBaseURI: () => 'Breez Spark' });
    const screen = renderDetails(wallet);
    await waitFor(() => expect(screen.getByText(loc.wallets.details_type)).toBeTruthy());
    expect(screen.getByText(loc.wallets.details_connected_to)).toBeTruthy();
    expect(screen.getByText('Breez Spark')).toBeTruthy();
  });

  it('hides the connected-to block for an on-chain wallet', async () => {
    const wallet = makeWallet('HDsegwitBech32', { id: 'onchain-details-connected', chain: 'ONCHAIN' });
    const screen = renderDetails(wallet);
    await waitFor(() => expect(screen.getByText(loc.wallets.details_type)).toBeTruthy());
    expect(screen.queryByText(loc.wallets.details_connected_to)).toBeNull();
  });

  it('hides ownership proof for a multisig wallet', async () => {
    const wallet = makeWallet('HDmultisig', {
      id: 'msig-proof',
      chain: 'ONCHAIN',
      proof: 'should-not-show',
      getM: () => 2,
      getN: () => 3,
      howManySignaturesCanWeMake: () => 1,
      isNativeSegwit: () => true,
      isWrappedSegwit: () => false,
    });
    const screen = renderDetails(wallet);
    await waitFor(() => expect(screen.getByText(loc.wallets.details_type)).toBeTruthy());
    expect(screen.queryByText(loc.wallets.ownership_proof)).toBeNull();
    expect(screen.queryByText('should-not-show')).toBeNull();
  });

  it('shows the connected-to block for a lightning custodian wallet', async () => {
    const wallet = makeWallet('lightningCustodianWallet', { id: 'lndhub-connected', getBaseURI: () => 'lndhub://example' });
    const screen = renderDetails(wallet);
    await waitFor(() => expect(screen.getByText('lndhub://example')).toBeTruthy());
    expect(screen.getByText(loc.wallets.details_connected_to)).toBeTruthy();
  });
});

describe('WalletDetails address and type-specific rows', () => {
  it.each([
    ['legacy', 'legacy-addr-placeholder'],
    ['segwitBech32', 'segwit-bech32-addr-placeholder'],
    ['segwitP2SH', 'segwit-p2sh-addr-placeholder'],
  ])('shows the address for a %s wallet', async (type, address) => {
    const wallet = makeWallet(type, { id: `${type}-addr`, chain: 'ONCHAIN', getAddress: () => address });
    const screen = renderDetails(wallet);
    await waitFor(() => expect(screen.getByText(loc.wallets.details_address)).toBeTruthy());
    expect(screen.getByText(address)).toBeTruthy();
  });

  it('shows the address for a non-HD watch-only wallet', async () => {
    const wallet = makeWallet('watchOnly', {
      id: 'wo-single',
      chain: 'ONCHAIN',
      isHd: () => false,
      getAddress: () => 'watch-only-addr-placeholder',
    });
    const screen = renderDetails(wallet);
    await waitFor(() => expect(screen.getByText('watch-only-addr-placeholder')).toBeTruthy());
    expect(screen.getByText(loc.wallets.details_address)).toBeTruthy();
  });

  it('hides the single-address row for an HD watch-only wallet and shows the hardware-wallet switch', async () => {
    const wallet = makeWallet('watchOnly', {
      id: 'wo-hd',
      chain: 'ONCHAIN',
      isHd: () => true,
      getAddress: () => 'should-not-show',
    });
    const screen = renderDetails(wallet);
    await waitFor(() => expect(screen.getByText(loc.wallets.details_use_with_hardware_wallet)).toBeTruthy());
    expect(screen.queryByText('should-not-show')).toBeNull();
    expect(screen.queryByText(loc.wallets.details_address)).toBeNull();
    fireEvent(screen.UNSAFE_getByType(Switch), 'valueChange', true);
    expect(screen.getByText(loc.wallets.details_use_with_hardware_wallet)).toBeTruthy();
  });

  it.each([
    ['native segwit', { isNativeSegwit: () => true, isWrappedSegwit: () => false }],
    ['wrapped segwit', { isNativeSegwit: () => false, isWrappedSegwit: () => true }],
    ['legacy', { isNativeSegwit: () => false, isWrappedSegwit: () => false }],
  ])('shows the %s multisig script type', async (label, segwit) => {
    const wallet = makeWallet('HDmultisig', {
      id: `msig-${label}`,
      chain: 'ONCHAIN',
      getM: () => 2,
      getN: () => 3,
      howManySignaturesCanWeMake: () => 1,
      ...segwit,
    });
    const screen = renderDetails(wallet);
    await waitFor(() => expect(screen.getByText(loc.wallets.details_multisig_type)).toBeTruthy());
    expect(screen.getByText(`2 / 3 (${label})`)).toBeTruthy();
    expect(screen.getByText(loc.multisig.how_many_signatures_can_bluewallet_make)).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('shows the aezeed identity pubkey', async () => {
    const wallet = makeWallet('HDAezeedWallet', {
      id: 'aezeed-1',
      chain: 'ONCHAIN',
      getIdentityPubkey: () => 'identity-placeholder',
    });
    const screen = renderDetails(wallet);
    await waitFor(() => expect(screen.getByText('identity-placeholder')).toBeTruthy());
    expect(screen.getByText(loc.wallets.identity_pubkey)).toBeTruthy();
  });
});

describe('WalletDetails advanced derivation', () => {
  afterEach(() => {
    if (InteractionManager.runAfterInteractions.mockRestore) {
      InteractionManager.runAfterInteractions.mockRestore();
    }
  });

  it('shows a spinner for the master fingerprint until InteractionManager runs', async () => {
    jest.spyOn(InteractionManager, 'runAfterInteractions').mockImplementation(() => ({ cancel: jest.fn() }));
    const wallet = makeWallet('HDsegwitBech32', {
      id: 'fp-spin',
      chain: 'ONCHAIN',
      allowMasterFingerprint: () => true,
      getMasterFingerprintHex: () => 'abcd1234',
      getDerivationPath: () => "m/84'/0'/0'",
    });
    const screen = renderDetails(wallet, { isAdvancedModeEnabled: jest.fn().mockResolvedValue(true) });
    await waitFor(() => expect(screen.getByText(loc.wallets.details_master_fingerprint)).toBeTruthy());
    expect(screen.queryByText('abcd1234')).toBeNull();
    expect(screen.UNSAFE_queryAllByType(ActivityIndicator).length).toBeGreaterThan(0);
  });

  it('shows the derivation path and master fingerprint when advanced mode is on', async () => {
    jest.spyOn(InteractionManager, 'runAfterInteractions').mockImplementation(cb => {
      cb();
      return { then: fn => fn(), done: jest.fn(), cancel: jest.fn() };
    });
    const wallet = makeWallet('HDsegwitBech32', {
      id: 'adv-1',
      chain: 'ONCHAIN',
      allowMasterFingerprint: () => true,
      getMasterFingerprintHex: () => 'deadbeef',
      getDerivationPath: () => "m/84'/0'/0'",
    });
    const screen = renderDetails(wallet, { isAdvancedModeEnabled: jest.fn().mockResolvedValue(true) });
    await waitFor(() => expect(screen.getByTestId('DerivationPath')).toBeTruthy());
    expect(screen.getByText("m/84'/0'/0'")).toBeTruthy();
    await waitFor(() => expect(screen.getByText('deadbeef')).toBeTruthy());
    expect(screen.getByText(loc.wallets.details_master_fingerprint)).toBeTruthy();
  });

  it('hides the derivation path when getDerivationPath returns an empty string', async () => {
    const wallet = makeWallet('HDsegwitBech32', {
      id: 'adv-empty',
      chain: 'ONCHAIN',
      getDerivationPath: () => '',
    });
    const screen = renderDetails(wallet, { isAdvancedModeEnabled: jest.fn().mockResolvedValue(true) });
    await waitFor(() => expect(screen.getByText(loc.wallets.details_type)).toBeTruthy());
    expect(screen.queryByTestId('DerivationPath')).toBeNull();
  });
});

describe('WalletDetails BIP47 backdoor', () => {
  it('shows the BIP47 payment-code switch when the backdoor counter is already at ten and the wallet allows BIP47', async () => {
    mockReactFlags.bip47Backdoor = true;
    mockReactFlags.zeroCount = 0;
    const wallet = makeWallet('HDsegwitBech32', {
      id: 'bip47-1',
      chain: 'ONCHAIN',
      allowBIP47: () => true,
      isBIP47Enabled: () => true,
    });
    const screen = renderDetails(wallet);
    await waitFor(() => expect(screen.getByText(loc.bip47.payment_code)).toBeTruthy());
    expect(screen.getByText(loc.bip47.purpose)).toBeTruthy();
    fireEvent(screen.UNSAFE_getByType(Switch), 'valueChange', false);
    expect(screen.getByText(loc.bip47.payment_code)).toBeTruthy();
  });
});

describe('WalletDetails navigation targets', () => {
  it('opens export, xpub, sign/verify and payment codes from their buttons', async () => {
    const wallet = makeWallet('HDsegwitBech32', {
      id: 'nav-1',
      chain: 'ONCHAIN',
      allowXpub: () => true,
      allowSignVerifyMessage: () => true,
      allowBIP47: () => true,
      isBIP47Enabled: () => true,
      getAllExternalAddresses: () => ['addr-placeholder'],
    });
    const screen = renderDetails(wallet);
    await waitFor(() => expect(screen.getByTestId('WalletExport')).toBeTruthy());
    fireEvent.press(screen.getByTestId('WalletExport'));
    expect(mockNavigate).toHaveBeenCalledWith('WalletExportRoot', {
      screen: 'WalletExport',
      params: { walletID: 'nav-1' },
    });
    fireEvent.press(screen.getByTestId('XPub'));
    expect(mockNavigate).toHaveBeenCalledWith('WalletXpubRoot', {
      screen: 'WalletXpub',
      params: { walletID: 'nav-1' },
    });
    fireEvent.press(screen.getByTestId('SignVerify'));
    expect(mockNavigate).toHaveBeenCalledWith('SignVerifyRoot', {
      screen: 'SignVerify',
      params: { walletID: 'nav-1', address: 'addr-placeholder' },
    });
    fireEvent.press(screen.getByText('Show payment codes'));
    expect(mockNavigate).toHaveBeenCalledWith('PaymentCodeRoot', {
      screen: 'PaymentCodesList',
      params: { walletID: 'nav-1' },
    });
  });

  it('opens the address list for an HD electrum wallet instance', async () => {
    const wallet = Object.assign(new AbstractHDElectrumWallet(), makeWallet('HDsegwitBech32', { id: 'hd-inst', chain: 'ONCHAIN' }));
    wallet.getID = () => 'hd-inst';
    const screen = renderDetails(wallet);
    await waitFor(() => expect(screen.getByText(loc.wallets.details_show_addresses)).toBeTruthy());
    fireEvent.press(screen.getByText(loc.wallets.details_show_addresses));
    expect(mockNavigate).toHaveBeenCalledWith('WalletAddresses', { walletID: 'hd-inst' });
  });

  it('opens the address list for an HD watch-only wallet', async () => {
    const wallet = makeWallet('watchOnly', { id: 'wo-addr', chain: 'ONCHAIN', isHd: () => true });
    const screen = renderDetails(wallet);
    await waitFor(() => expect(screen.getByText(loc.wallets.details_show_addresses)).toBeTruthy());
    fireEvent.press(screen.getByText(loc.wallets.details_show_addresses));
    expect(mockNavigate).toHaveBeenCalledWith('WalletAddresses', { walletID: 'wo-addr' });
  });

  it('opens multisig coordination setup and cosigner edit', async () => {
    const wallet = makeWallet('HDmultisig', {
      id: 'msig-nav',
      chain: 'ONCHAIN',
      getM: () => 2,
      getN: () => 3,
      howManySignaturesCanWeMake: () => 1,
      isNativeSegwit: () => true,
      isWrappedSegwit: () => false,
    });
    const screen = renderDetails(wallet);
    await waitFor(() => expect(screen.getByTestId('MultisigCoordinationSetup')).toBeTruthy());
    fireEvent.press(screen.getByTestId('MultisigCoordinationSetup'));
    expect(mockNavigate).toHaveBeenCalledWith('ExportMultisigCoordinationSetupRoot', {
      screen: 'ExportMultisigCoordinationSetup',
      params: { walletId: 'msig-nav' },
    });
    fireEvent.press(screen.getByTestId('ViewEditCosigners'));
    expect(mockNavigate).toHaveBeenCalledWith('ViewEditMultisigCosignersRoot', {
      screen: 'ViewEditMultisigCosigners',
      params: { walletId: 'msig-nav' },
    });
  });

  it('opens cashier POS and boltcard backup from an LNDHub wallet', async () => {
    const wallet = makeWallet('lightningLdsWallet', {
      id: 'lds-nav',
      isPosMode: true,
      getBoltcard: () => ({ uid: 'card-1' }),
    });
    const screen = renderDetails(wallet);
    await waitFor(() => expect(screen.getByText('Go to cashier station')).toBeTruthy());
    fireEvent.press(screen.getByText('Go to cashier station'));
    expect(mockNavigate).toHaveBeenCalledWith('ReceiveDetailsRoot', {
      screen: 'CashierPos',
      params: { walletID: 'lds-nav' },
    });
    fireEvent.press(screen.getByText('Backup Pay Card Details'));
    expect(mockNavigate).toHaveBeenCalledWith('BackupBoltcard', { walletID: 'lds-nav' });
  });
});

describe('WalletDetails POS toggle', () => {
  it('clears the LNURL pay amount when POS mode is turned off', async () => {
    const adjustLnurlPayAmount = jest.fn();
    const saveToDisk = jest.fn().mockResolvedValue(undefined);
    const wallet = makeWallet('lightningLdsWallet', {
      id: 'lds-pos-off',
      isPosMode: true,
      adjustLnurlPayAmount,
    });
    const screen = renderDetails(wallet, { saveToDisk });
    await waitFor(() => expect(screen.getByText('Activate POS mode')).toBeTruthy());
    await act(async () => {
      fireEvent(screen.getByLabelText('Activate POS mode'), 'valueChange', false);
    });
    expect(wallet.isPosMode).toBe(false);
    expect(adjustLnurlPayAmount).toHaveBeenCalledWith(1, 1 * 100 * 1000 * 1000);
    expect(saveToDisk).toHaveBeenCalled();
  });

  it('does not clear the LNURL pay amount when POS mode is turned on', async () => {
    const adjustLnurlPayAmount = jest.fn();
    const saveToDisk = jest.fn().mockResolvedValue(undefined);
    const wallet = makeWallet('lightningLdsWallet', {
      id: 'lds-pos-on',
      isPosMode: false,
      adjustLnurlPayAmount,
    });
    const screen = renderDetails(wallet, { saveToDisk, isPosMode: true });
    await waitFor(() => expect(screen.getByText('Activate POS mode')).toBeTruthy());
    await act(async () => {
      fireEvent(screen.getByLabelText('Activate POS mode'), 'valueChange', true);
    });
    expect(wallet.isPosMode).toBe(true);
    expect(adjustLnurlPayAmount).not.toHaveBeenCalled();
    expect(saveToDisk).toHaveBeenCalled();
  });
});

describe('WalletDetails ownership proof copy', () => {
  it('copies the proof and then restores the proof text after two seconds', async () => {
    jest.useFakeTimers();
    try {
      const wallet = makeWallet('lightningLdsWallet', { id: 'copy-1', proof: 'proof-placeholder' });
      const screen = renderDetails(wallet);
      expect(screen.getByText('proof-placeholder')).toBeTruthy();
      fireEvent.press(screen.getByText('proof-placeholder'));
      expect(Clipboard.setString).toHaveBeenCalledWith('proof-placeholder');
      expect(screen.getByText(loc.wallets.xpub_copiedToClipboard)).toBeTruthy();
      await act(async () => {
        jest.advanceTimersByTime(2000);
      });
      expect(screen.getByText('proof-placeholder')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('shows a spinner when the main wallet has no proof yet and then fills the fetched proof', async () => {
    mockWalletContext.walletID = 'main-onchain';
    mockWalletContext.getOwnershipProof = jest.fn().mockResolvedValue('fresh-proof');
    const wallet = makeWallet('HDsegwitBech32', { id: 'main-onchain', chain: 'ONCHAIN' });
    const screen = renderDetails(wallet);
    expect(screen.UNSAFE_queryAllByType(ActivityIndicator).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText('fresh-proof')).toBeTruthy());
  });

  it('logs when fetching the ownership proof fails', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockWalletContext.walletID = 'main-onchain';
    mockWalletContext.getOwnershipProof = jest.fn().mockRejectedValue(new Error('proof-unavailable'));
    const wallet = makeWallet('HDsegwitBech32', { id: 'main-onchain', chain: 'ONCHAIN' });
    renderDetails(wallet);
    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
    expect(String(errorSpy.mock.calls[0][0])).toContain('walletDetails: failed to obtain ownership proof');
    errorSpy.mockRestore();
  });
});

describe('WalletDetails export history', () => {
  it('writes an on-chain CSV using txid, metadata memo and the wallet label', async () => {
    const wallet = makeWallet('HDsegwitBech32', {
      id: 'csv-on',
      chain: 'ONCHAIN',
      label: 'test wallet',
      getTransactions: () => [{ hash: 'txid-placeholder', value: 0, received: '2024-01-01T00:00:00.000Z' }],
    });
    const screen = renderDetails(wallet, { txMetadata: { 'txid-placeholder': { memo: '  note-placeholder  ' } } });
    await waitFor(() => expect(screen.getByText(loc.wallets.details_export_history)).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByText(loc.wallets.details_export_history));
    });
    expect(writeFileAndExport).toHaveBeenCalledTimes(1);
    const [filename, csv] = writeFileAndExport.mock.calls[0];
    expect(filename).toBe('test-wallet-history.csv');
    expect(csv).toContain('txid-placeholder');
    expect(csv).toContain('note-placeholder');
  });

  it('writes an off-chain CSV from payment_hash and description, hexing Buffer hashes', async () => {
    const wallet = makeWallet('lightningLdsWallet', {
      id: 'csv-off',
      chain: 'OFFCHAIN',
      label: 'ln-wallet',
      getTransactions: () => [
        {
          payment_hash: { type: 'Buffer', data: [1, 2, 255] },
          description: 'ln-memo-placeholder',
          value: 0,
          received: '2024-02-01T00:00:00.000Z',
        },
      ],
    });
    const screen = renderDetails(wallet);
    await waitFor(() => expect(screen.getByText(loc.wallets.details_export_history)).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByText(loc.wallets.details_export_history));
    });
    const [, csv] = writeFileAndExport.mock.calls[0];
    expect(csv).toContain(Buffer.from([1, 2, 255]).toString('hex'));
    expect(csv).toContain('ln-memo-placeholder');
  });

  it('writes an off-chain CSV using a string payment_hash as-is', async () => {
    const wallet = makeWallet('lightningLdsWallet', {
      id: 'csv-off-str',
      chain: 'OFFCHAIN',
      label: 'ln-wallet',
      getTransactions: () => [
        {
          payment_hash: 'hash-placeholder',
          description: 'desc-placeholder',
          value: 0,
          received: '2024-02-01T00:00:00.000Z',
        },
      ],
    });
    const screen = renderDetails(wallet);
    await waitFor(() => expect(screen.getByText(loc.wallets.details_export_history)).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByText(loc.wallets.details_export_history));
    });
    const [, csv] = writeFileAndExport.mock.calls[0];
    expect(csv).toContain('hash-placeholder');
    expect(csv).toContain('desc-placeholder');
  });
});

describe('WalletDetails transaction purge backdoor', () => {
  async function pressTransactionsCount(screen, times) {
    for (let i = 0; i < times; i++) {
      await act(async () => {
        fireEvent.press(screen.getByText(loc.transactions.transactions_count));
      });
    }
  }

  it('does not purge on the first nine presses of the transactions-count label', async () => {
    const wallet = makeWallet('HDsegwitBech32', {
      id: 'purge-early',
      chain: 'ONCHAIN',
      _txs_by_external_index: { 0: [{ hash: 'keep-me' }] },
      _txs_by_internal_index: { 0: [{ hash: 'keep-me-int' }] },
    });
    const screen = renderDetails(wallet);
    await waitFor(() => expect(screen.getByText(loc.transactions.transactions_count)).toBeTruthy());
    await pressTransactionsCount(screen, 9);
    expect(wallet._txs_by_external_index[0]).toEqual([{ hash: 'keep-me' }]);
    expect(alertFn).not.toHaveBeenCalled();
  });

  it('clears HD SegWit tx maps after eleven presses of the transactions-count label', async () => {
    const wallet = makeWallet('HDsegwitBech32', {
      id: 'purge-hd',
      chain: 'ONCHAIN',
      _txs_by_external_index: { 0: [{ hash: 'gone' }] },
      _txs_by_internal_index: { 0: [{ hash: 'gone-int' }] },
    });
    const screen = renderDetails(wallet);
    await waitFor(() => expect(screen.getByText(loc.transactions.transactions_count)).toBeTruthy());
    await pressTransactionsCount(screen, 11);
    expect(wallet._txs_by_external_index).toEqual({});
    expect(wallet._txs_by_internal_index).toEqual({});
    expect(alertFn).toHaveBeenCalledWith('Transactions purged. Pls go to main screen and back to rerender screen');
  });

  it('does not purge maps for a wallet that is neither HD SegWit nor wrapping an HD instance', async () => {
    const wallet = makeWallet('legacy', { id: 'purge-none', chain: 'ONCHAIN' });
    const screen = renderDetails(wallet);
    await waitFor(() => expect(screen.getByText(loc.transactions.transactions_count)).toBeTruthy());
    await pressTransactionsCount(screen, 11);
    expect(alertFn).not.toHaveBeenCalled();
  });

  it('clears the nested HD instance tx maps after eleven presses of the transactions-count label', async () => {
    const wallet = makeWallet('watchOnly', {
      id: 'purge-nested',
      chain: 'ONCHAIN',
      isHd: () => true,
      _hdWalletInstance: {
        _txs_by_external_index: { 0: [{ hash: 'nested' }] },
        _txs_by_internal_index: { 0: [{ hash: 'nested-int' }] },
      },
    });
    const screen = renderDetails(wallet);
    await waitFor(() => expect(screen.getByText(loc.transactions.transactions_count)).toBeTruthy());
    await pressTransactionsCount(screen, 11);
    expect(wallet._hdWalletInstance._txs_by_external_index).toEqual({});
    expect(wallet._hdWalletInstance._txs_by_internal_index).toEqual({});
    expect(alertFn).toHaveBeenCalledWith('Transactions purged. Pls go to main screen and back to rerender screen');
  });
});

describe('WalletDetails delete', () => {
  function pressDelete(screen) {
    fireEvent.press(screen.getByTestId('DeleteButton'));
    return Alert.alert.mock.calls[Alert.alert.mock.calls.length - 1][2];
  }

  beforeEach(() => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    Alert.alert.mockRestore();
  });

  it('does nothing when the cancel button is pressed', async () => {
    const deleteWallet = jest.fn();
    const wallet = makeWallet('HDsegwitBech32', { id: 'del-cancel', chain: 'ONCHAIN' });
    const screen = renderDetails(wallet, { deleteWallet });
    await waitFor(() => expect(screen.getByTestId('DeleteButton')).toBeTruthy());
    const buttons = pressDelete(screen);
    expect(Alert.alert.mock.calls[0][1]).toBe(loc.wallets.details_are_you_sure);
    await act(async () => {
      buttons[1].onPress();
    });
    expect(deleteWallet).not.toHaveBeenCalled();
  });

  it('stops when biometrics are enabled and unlock fails', async () => {
    Biometric.isBiometricUseCapableAndEnabled.mockResolvedValue(true);
    Biometric.unlockWithBiometrics.mockResolvedValue(false);
    const deleteWallet = jest.fn();
    const wallet = makeWallet('HDsegwitBech32', { id: 'del-bio-fail', chain: 'ONCHAIN' });
    const screen = renderDetails(wallet, { deleteWallet });
    await waitFor(() => expect(screen.getByTestId('DeleteButton')).toBeTruthy());
    const buttons = pressDelete(screen);
    await act(async () => {
      await buttons[0].onPress();
    });
    expect(Biometric.unlockWithBiometrics).toHaveBeenCalled();
    expect(deleteWallet).not.toHaveBeenCalled();
  });

  it('deletes a wallet with no balance after a successful biometric unlock', async () => {
    Biometric.isBiometricUseCapableAndEnabled.mockResolvedValue(true);
    Biometric.unlockWithBiometrics.mockResolvedValue(true);
    const deleteWallet = jest.fn();
    const saveToDisk = jest.fn().mockResolvedValue(undefined);
    const wallet = makeWallet('HDsegwitBech32', {
      id: 'del-bio-ok',
      chain: 'ONCHAIN',
      getBalance: () => 0,
      getAllExternalAddresses: () => ['addr-placeholder'],
    });
    const screen = renderDetails(wallet, { deleteWallet, saveToDisk });
    await waitFor(() => expect(screen.getByTestId('DeleteButton')).toBeTruthy());
    const buttons = pressDelete(screen);
    await act(async () => {
      await buttons[0].onPress();
    });
    expect(unsubscribe).toHaveBeenCalledWith(['addr-placeholder'], [], []);
    expect(deleteWallet).toHaveBeenCalledWith(wallet);
    await waitFor(() => expect(saveToDisk).toHaveBeenCalled());
    expect(mockDispatch).toHaveBeenCalledWith(StackActions.popToTop());
    expect(Haptic.trigger).toHaveBeenCalledWith('notificationSuccess', { ignoreAndroidSystemSettings: false });
    expect(screen.UNSAFE_queryAllByType(ActivityIndicator).length).toBeGreaterThan(0);
  });

  it('unsubscribes with an empty list when getAllExternalAddresses throws', async () => {
    const deleteWallet = jest.fn();
    const saveToDisk = jest.fn().mockResolvedValue(undefined);
    const wallet = makeWallet('HDsegwitBech32', {
      id: 'del-throw-addr',
      chain: 'ONCHAIN',
      getBalance: () => 0,
      getAllExternalAddresses: () => {
        throw new Error('no addresses');
      },
    });
    const screen = renderDetails(wallet, { deleteWallet, saveToDisk });
    await waitFor(() => expect(screen.getByTestId('DeleteButton')).toBeTruthy());
    const buttons = pressDelete(screen);
    await act(async () => {
      await buttons[0].onPress();
    });
    expect(unsubscribe).toHaveBeenCalledWith([], [], []);
    expect(deleteWallet).toHaveBeenCalledWith(wallet);
  });

  it('deletes immediately when the wallet has a balance but does not allow send', async () => {
    const deleteWallet = jest.fn();
    const saveToDisk = jest.fn().mockResolvedValue(undefined);
    const wallet = makeWallet('watchOnly', {
      id: 'del-no-send',
      chain: 'ONCHAIN',
      getBalance: () => 50,
      allowSend: () => false,
    });
    const screen = renderDetails(wallet, { deleteWallet, saveToDisk });
    await waitFor(() => expect(screen.getByTestId('DeleteButton')).toBeTruthy());
    const buttons = pressDelete(screen);
    await act(async () => {
      await buttons[0].onPress();
    });
    expect(prompt).not.toHaveBeenCalled();
    expect(deleteWallet).toHaveBeenCalledWith(wallet);
  });

  it('rejects a balance confirmation that does not match', async () => {
    prompt.mockResolvedValue('1');
    const deleteWallet = jest.fn();
    const wallet = makeWallet('HDsegwitBech32', {
      id: 'del-wrong-bal',
      chain: 'ONCHAIN',
      getBalance: () => 50,
      allowSend: () => true,
    });
    const screen = renderDetails(wallet, { deleteWallet });
    await waitFor(() => expect(screen.getByTestId('DeleteButton')).toBeTruthy());
    const buttons = pressDelete(screen);
    await act(async () => {
      await buttons[0].onPress();
    });
    expect(prompt).toHaveBeenCalled();
    expect(deleteWallet).not.toHaveBeenCalled();
    expect(Haptic.trigger).toHaveBeenCalledWith('notificationError', { ignoreAndroidSystemSettings: false });
    expect(alertFn).toHaveBeenCalledWith(loc.wallets.details_del_wb_err);
  });

  it('deletes after a matching balance confirmation', async () => {
    prompt.mockResolvedValue('50');
    const deleteWallet = jest.fn();
    const saveToDisk = jest.fn().mockResolvedValue(undefined);
    const wallet = makeWallet('HDsegwitBech32', {
      id: 'del-match-bal',
      chain: 'ONCHAIN',
      getBalance: () => 50,
      allowSend: () => true,
    });
    const screen = renderDetails(wallet, { deleteWallet, saveToDisk });
    await waitFor(() => expect(screen.getByTestId('DeleteButton')).toBeTruthy());
    const buttons = pressDelete(screen);
    await act(async () => {
      await buttons[0].onPress();
    });
    expect(deleteWallet).toHaveBeenCalledWith(wallet);
    await waitFor(() => expect(saveToDisk).toHaveBeenCalled());
    expect(mockDispatch).toHaveBeenCalledWith(StackActions.popToTop());
  });

  it('leaves the wallet in place when the balance prompt is cancelled', async () => {
    prompt.mockRejectedValue(new Error('cancelled'));
    const deleteWallet = jest.fn();
    const wallet = makeWallet('HDsegwitBech32', {
      id: 'del-prompt-cancel',
      chain: 'ONCHAIN',
      getBalance: () => 50,
      allowSend: () => true,
    });
    const screen = renderDetails(wallet, { deleteWallet });
    await waitFor(() => expect(screen.getByTestId('DeleteButton')).toBeTruthy());
    const buttons = pressDelete(screen);
    await act(async () => {
      await buttons[0].onPress();
    });
    expect(deleteWallet).not.toHaveBeenCalled();
    expect(alertFn).not.toHaveBeenCalledWith(loc.wallets.details_del_wb_err);
  });

  it('deletes every wallet and resets the session when the main wallet is removed', async () => {
    mockWalletContext.walletID = 'main-onchain';
    const deleteWallet = jest.fn();
    const saveToDisk = jest.fn().mockResolvedValue(undefined);
    const main = makeWallet('HDsegwitBech32', { id: 'main-onchain', chain: 'ONCHAIN', getBalance: () => 0 });
    const extra = makeWallet('sparkWallet', { id: 'spark-extra' });
    const screen = renderDetails(main, { deleteWallet, saveToDisk, wallets: [main, extra] });
    await waitFor(() => expect(screen.getByTestId('DeleteButton')).toBeTruthy());
    const buttons = pressDelete(screen);
    expect(Alert.alert.mock.calls[0][1]).toBe(loc.wallets.details_are_you_sure_main_wallet);
    await act(async () => {
      await buttons[0].onPress();
    });
    expect(mockDispatch).toHaveBeenCalledWith(StackActions.replace('AddWalletRoot'));
    expect(deleteWallet).toHaveBeenCalledWith(main);
    expect(deleteWallet).toHaveBeenCalledWith(extra);
    expect(saveToDisk).toHaveBeenCalledWith(true);
    expect(mockReset).toHaveBeenCalled();
  });

  it('sums every wallet balance when confirming deletion of the main wallet', async () => {
    mockWalletContext.walletID = 'main-onchain';
    prompt.mockResolvedValue('70');
    const deleteWallet = jest.fn();
    const saveToDisk = jest.fn().mockResolvedValue(undefined);
    const main = makeWallet('HDsegwitBech32', { id: 'main-onchain', chain: 'ONCHAIN', getBalance: () => 20, allowSend: () => true });
    const extra = makeWallet('sparkWallet', { id: 'spark-bal', getBalance: () => 50, allowSend: () => true });
    const screen = renderDetails(main, { deleteWallet, saveToDisk, wallets: [main, extra] });
    await waitFor(() => expect(screen.getByTestId('DeleteButton')).toBeTruthy());
    const buttons = pressDelete(screen);
    await act(async () => {
      await buttons[0].onPress();
    });
    expect(prompt).toHaveBeenCalled();
    const promptMessage = prompt.mock.calls[0][1];
    expect(String(promptMessage)).toContain('70');
    expect(deleteWallet).toHaveBeenCalledWith(main);
    expect(deleteWallet).toHaveBeenCalledWith(extra);
  });
});

describe('WalletDetails keyboard, selected wallet and options', () => {
  it('dismisses the keyboard from the wrapping touchable', async () => {
    const spy = jest.spyOn(Keyboard, 'dismiss');
    const wallet = makeWallet('HDsegwitBech32', { id: 'kb-1', chain: 'ONCHAIN' });
    const screen = renderDetails(wallet);
    await waitFor(() => expect(screen.getByText(loc.wallets.details_type)).toBeTruthy());
    fireEvent.press(screen.UNSAFE_getByType(TouchableWithoutFeedback));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('selects the wallet when it is still in storage', async () => {
    const setSelectedWallet = jest.fn();
    const wallet = makeWallet('HDsegwitBech32', { id: 'sel-1', chain: 'ONCHAIN' });
    renderDetails(wallet, { setSelectedWallet });
    await waitFor(() => expect(setSelectedWallet).toHaveBeenCalledWith('sel-1'));
  });

  it('does not select a wallet id that is no longer in storage', async () => {
    const setSelectedWallet = jest.fn();
    const wallet = makeWallet('HDsegwitBech32', { id: 'sel-1', chain: 'ONCHAIN' });
    const screen = renderDetails(wallet, { setSelectedWallet });
    await waitFor(() => expect(setSelectedWallet).toHaveBeenCalledWith('sel-1'));
    setSelectedWallet.mockClear();
    mockRoute.params = { walletID: 'gone' };
    screen.rerender(
      <BlueStorageContext.Provider
        value={{
          wallets: [wallet],
          deleteWallet: jest.fn(),
          setSelectedWallet,
          txMetadata: {},
          isPosMode: false,
          saveToDisk: jest.fn().mockResolvedValue(undefined),
          isAdvancedModeEnabled: jest.fn().mockResolvedValue(false),
        }}
      >
        <WalletDetails />
      </BlueStorageContext.Provider>,
    );
    expect(setSelectedWallet).not.toHaveBeenCalled();
  });

  it('titles the navigation header with Wallet', () => {
    const options = WalletDetails.navigationOptions(BlueDarkTheme)({
      navigation: { navigate: mockNavigate },
      route: { params: { walletID: 'opt' } },
    });
    expect(options.headerTitle).toBe(loc.wallets.details_title);
  });

  it('loads details styles under RTL', () => {
    let loaded;
    jest.isolateModules(() => {
      require('react-native').I18nManager.isRTL = true;
      loaded = require('../../screen/wallets/details').default;
      require('react-native').I18nManager.isRTL = false;
    });
    expect(typeof loaded).toBe('function');
  });
});
