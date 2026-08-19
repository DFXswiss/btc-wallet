import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

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
  useDfxSessionContext: () => ({ reset: jest.fn() }),
}));
jest.mock('../../api/spark/spark-sdk', () => ({
  isSparkSdkConnected: () => false,
}));
jest.mock('../../components/navigationStyle', () => () => options => options);

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

const mockRoute = { params: { walletID: '' } };
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useRoute: () => mockRoute,
    useNavigation: () => ({
      navigate: jest.fn(),
      dispatch: jest.fn(),
    }),
    useTheme: () => require('../../components/themes').BlueDarkTheme,
  };
});

jest.mock('../../contexts/wallet.context', () => ({
  useWalletContext: () => ({
    walletID: 'main-onchain',
    getOwnershipProof: jest.fn().mockResolvedValue('fresh-proof'),
  }),
}));

const WalletDetails = require('../../screen/wallets/details').default;
const { BlueStorageContext } = require('../../blue_modules/storage-context');
const loc = require('../../loc').default;

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
    chain: extras.chain || 'OFFCHAIN',
    getBoltcard: () => undefined,
    getLabel: () => 'w',
    ...extras,
  };
}

function renderDetails(wallet) {
  mockRoute.params = { walletID: wallet.getID() };
  return render(
    <BlueStorageContext.Provider
      value={{
        wallets: [wallet],
        deleteWallet: jest.fn(),
        setSelectedWallet: jest.fn(),
        txMetadata: {},
        isPosMode: false,
        saveToDisk: jest.fn().mockResolvedValue(undefined),
        isAdvancedModeEnabled: jest.fn().mockResolvedValue(false),
      }}
    >
      <WalletDetails />
    </BlueStorageContext.Provider>,
  );
}

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
});
