import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { NavigatorScreenParams } from '@react-navigation/native';

// Parameter lists for each nested stack. These mirror upstream BlueWallet's
// `DetailViewStackParamList`, extended with DFX-specific screens present in
// this fork. Types are intentionally loose (`object | undefined`) where the
// underlying screens are untyped JS; they can be tightened progressively.

export type AddWalletStackParamList = {
  AddWallet: { walletLabel?: string; entropy?: string } | undefined;
  ImportWallet: { triggerImport?: boolean; label?: string; words?: string[] } | undefined;
  ImportWalletDiscovery: { importText: string; askPassphrase: boolean; searchAccounts: boolean };
  ScanImport: undefined;
  ImportCustomDerivationPath: { importText: string; password?: string };
  ImportSpeed: { importText: string };
  PleaseBackup: { walletID: string };
  PleaseBackupLNDHub: { wallet: object };
  ProvideEntropy: undefined;
  WalletsAddMultisigHelp: undefined;
  WalletsAddMultisig: { walletLabel?: string } | undefined;
  WalletsAddMultisigStep2: object;
  ImportMultisignature: object;
};

export type SendDetailsStackParamList = {
  SendDetails: { walletID?: string; uri?: string; memo?: string; address?: string } | undefined;
  Confirm: object;
  PsbtWithHardwareWallet: object;
  CreateTransaction: object;
  PsbtMultisig: object;
  PsbtMultisigQRCode: object;
  Success: object;
  SelectWallet: object;
  CoinControl: { walletID: string; onUTXOChoose: (u: unknown) => void };
  ScanLndInvoice: object;
  LnurlPay: object;
  LnurlPaySuccess: object;
  LnurlAuth: { walletID?: string; lnurl: string };
  LnurlNavigationForwarder: object;
  OpenCryptoPayCommitOnchain: object;
};

export type ReceiveDetailsStackParamList = {
  ReceiveDetails: { walletID: string; address?: string };
  LNDCreateInvoice: object;
  LnurlAuth: { walletID?: string; lnurl: string };
  LNDReceive: object;
  PosReceive: object;
  CashierPos: object;
  CashierDfxPos: object;
  ReceiveDfxPos: object;
  SelectWallet: object;
  LNDViewInvoice: object;
  LNDViewAdditionalInvoiceInformation: object;
  LNDViewAdditionalInvoicePreImage: object;
};

export type AztecoRedeemStackParamList = {
  AztecoRedeem: object;
  SelectWallet: object;
};

export type ScanQRCodeStackParamList = {
  ScanQRCode: {
    launchedBy?: string;
    onBarScanned?: (value: string) => void;
    showFileImportButton?: boolean;
    backDisabled?: boolean;
  };
};

export type ScanCodeSendStackParamList = {
  ScanCodeSend: object;
  ManualEnterAddress: object;
};

export type BackupSeedStackParamList = {
  BackupExplanation: object;
  PleaseBackup: { walletID: string };
};

export type DeeplinkStackParamList = {
  Sell: object;
  Swap: object;
  Confirm: object;
  CreateTransaction: object;
  Success: object;
  LnurlPay: object;
  LnurlPaySuccess: object;
};

export type PaymentCodeStackParamList = {
  PaymentCode: { paymentCode: string; walletID: string };
  PaymentCodesList: { walletID: string };
};

export type WalletsStackParamList = {
  // `| undefined` so NavigatorScreenParams accepts `{ screen: 'WalletTransactions' }` without params.
  // Callers that do pass params must still supply walletID.
  WalletTransactions: { walletID: string; walletType?: string; isLoading?: boolean } | undefined;
  WalletAsset: { walletID: string };
  AddLightning: object;
  WalletsAddMultisig: object;
  WalletsAddMultisigStep2: object;
  ImportMultisignature: object;
  AddBoltcard: object;
  BoltCardDetails: object;
  BackupBoltcard: object;
  DeleteBoltcard: object;
  WrittenCardError: object;
  TappedCardDetails: object;
  WalletDetails: { walletID: string };
  TransactionDetails: { hash: string };
  TransactionStatus: { hash: string; walletID: string };
  CPFP: { txid: string; wallet: object };
  RBFBumpFee: { txid: string; wallet: object };
  RBFCancel: { txid: string; wallet: object };
  Settings: undefined;
  SelectWallet: object;
  Currency: undefined;
  About: undefined;
  ReleaseNotes: undefined;
  Selftest: undefined;
  Licensing: undefined;
  DefaultView: undefined;
  Language: undefined;
  EncryptStorage: undefined;
  GeneralSettings: undefined;
  FeatureFlags: undefined;
  NetworkSettings: undefined;
  NotificationSettings: undefined;
  PlausibleDeniability: undefined;
  LightningSettings: undefined;
  ElectrumSettings: undefined;
  SettingsPrivacy: undefined;
  Tools: undefined;
  LNDViewInvoice: object;
  LNDViewAdditionalInvoiceInformation: object;
  LNDViewAdditionalInvoicePreImage: object;
  Broadcast: undefined;
  IsItMyAddress: undefined;
  LnurlPay: object;
  LnurlPaySuccess: object;
  LnurlAuth: { walletID?: string; lnurl: string };
  Success: object;
  WalletAddresses: { walletID: string };
};

export type RootStackParamList = {
  WalletsRoot: NavigatorScreenParams<WalletsStackParamList> | undefined;
  BackupSeedRoot: NavigatorScreenParams<BackupSeedStackParamList> | undefined;
  AddWalletRoot: NavigatorScreenParams<AddWalletStackParamList> | undefined;
  SendDetailsRoot: NavigatorScreenParams<SendDetailsStackParamList> | undefined;
  AztecoRedeemRoot: NavigatorScreenParams<AztecoRedeemStackParamList> | undefined;
  WalletExportRoot: object;
  ExportMultisigCoordinationSetupRoot: object;
  ViewEditMultisigCosignersRoot: object;
  WalletXpubRoot: object;
  SignVerifyRoot: object;
  SelectWallet: object;
  ReceiveDetailsRoot: NavigatorScreenParams<ReceiveDetailsStackParamList> | undefined;
  LappBrowserRoot: object;
  ScanQRCodeRoot: NavigatorScreenParams<ScanQRCodeStackParamList>;
  ScanCodeSendRoot: NavigatorScreenParams<ScanCodeSendStackParamList> | undefined;
  DeeplinkRoot: NavigatorScreenParams<DeeplinkStackParamList> | undefined;
  PaymentCodeRoot: NavigatorScreenParams<PaymentCodeStackParamList>;
};

export type InitStackParamList = {
  UnlockWithScreenRoot: undefined;
  ReorderWallets: undefined;
  Navigation: NavigatorScreenParams<RootStackParamList> | undefined;
};

export type RootStackScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, T>;
export type WalletsStackScreenProps<T extends keyof WalletsStackParamList> = NativeStackScreenProps<WalletsStackParamList, T>;
export type SendDetailsStackScreenProps<T extends keyof SendDetailsStackParamList> = NativeStackScreenProps<
  SendDetailsStackParamList,
  T
>;
export type ReceiveDetailsStackScreenProps<T extends keyof ReceiveDetailsStackParamList> = NativeStackScreenProps<
  ReceiveDetailsStackParamList,
  T
>;
export type AddWalletStackScreenProps<T extends keyof AddWalletStackParamList> = NativeStackScreenProps<AddWalletStackParamList, T>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
