import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../components/themes';

import WalletHome from '../screen/wallets/home';
import Asset from '../screen/wallets/asset';
import AddLightning from '../screen/wallets/dfx/add-lightning';
import WalletsAddMultisig from '../screen/wallets/addMultisig';
import WalletsAddMultisigStep2 from '../screen/wallets/addMultisigStep2';
import ImportMultisignature from '../screen/wallets/importMultisignature';
import AddBoltcard from '../screen/boltcard/add';
import BoltcardDetails from '../screen/boltcard/details';
import BackupBolcard from '../screen/boltcard/backup';
import DeleteBolcard from '../screen/boltcard/delete';
import WrittenCardError from '../screen/boltcard/writtenCardError';
import TappedCardDetails from '../screen/wallets/tappedCardDetails';
import WalletDetails from '../screen/wallets/details';
import TransactionDetails from '../screen/transactions/details';
import TransactionStatus from '../screen/transactions/transactionStatus';
import CPFP from '../screen/transactions/CPFP';
import RBFBumpFee from '../screen/transactions/RBFBumpFee';
import RBFCancel from '../screen/transactions/RBFCancel';
import Settings from '../screen/settings/settings';
import SelectWallet from '../screen/wallets/selectWallet';
import Currency from '../screen/settings/currency';
import About from '../screen/settings/about';
import ReleaseNotes from '../screen/settings/releasenotes';
import Selftest from '../screen/selftest';
import Licensing from '../screen/settings/licensing';
import DefaultView from '../screen/settings/defaultView';
import Language from '../screen/settings/language';
import EncryptStorage from '../screen/settings/encryptStorage';
import GeneralSettings from '../screen/settings/GeneralSettings';
import FeatureFlags from '../screen/settings/FeatureFlags';
import NetworkSettings from '../screen/settings/NetworkSettings';
import NotificationSettings from '../screen/settings/notificationSettings';
import PlausibleDeniability from '../screen/plausibledeniability';
import LightningSettings from '../screen/settings/lightningSettings';
import ElectrumSettings from '../screen/settings/electrumSettings';
import SettingsPrivacy from '../screen/settings/SettingsPrivacy';
import Tools from '../screen/settings/tools';
import LNDViewInvoice from '../screen/lnd/lndViewInvoice';
import LNDViewAdditionalInvoiceInformation from '../screen/lnd/lndViewAdditionalInvoiceInformation';
import LNDViewAdditionalInvoicePreImage from '../screen/lnd/lndViewAdditionalInvoicePreImage';
import Broadcast from '../screen/send/broadcast';
import IsItMyAddress from '../screen/send/isItMyAddress';
import LnurlPay from '../screen/lnd/lnurlPay';
import LnurlPaySuccess from '../screen/lnd/lnurlPaySuccess';
import LnurlAuth from '../screen/lnd/lnurlAuth';
import Success from '../screen/send/success';
import WalletAddresses from '../screen/wallets/addresses';

import { WalletsStackParamList } from './types';

const Stack = createNativeStackNavigator<WalletsStackParamList>();

const WalletsStack = () => {
  const theme = useTheme();

  return (
    <Stack.Navigator screenOptions={{ headerShadowVisible: false }}>
      <Stack.Screen name="WalletTransactions" component={WalletHome} options={WalletHome.navigationOptions(theme)} />
      <Stack.Screen name="WalletAsset" component={Asset} options={Asset.navigationOptions(theme)} />
      <Stack.Screen name="AddLightning" component={AddLightning} options={AddLightning.navigationOptions(theme)} />
      <Stack.Screen name="WalletsAddMultisig" component={WalletsAddMultisig} options={WalletsAddMultisig.navigationOptions(theme)} />
      <Stack.Screen
        name="WalletsAddMultisigStep2"
        component={WalletsAddMultisigStep2}
        options={WalletsAddMultisigStep2.navigationOptions(theme)}
      />
      <Stack.Screen
        name="ImportMultisignature"
        component={ImportMultisignature}
        options={(ImportMultisignature as any).navigationOptions(theme)}
      />
      <Stack.Screen name="AddBoltcard" component={AddBoltcard} options={(AddBoltcard as any).navigationOptions(theme)} />
      <Stack.Screen name="BoltCardDetails" component={BoltcardDetails} options={(BoltcardDetails as any).navigationOptions(theme)} />
      <Stack.Screen name="BackupBoltcard" component={BackupBolcard} options={(BackupBolcard as any).navigationOptions(theme)} />
      <Stack.Screen name="DeleteBoltcard" component={DeleteBolcard} options={(DeleteBolcard as any).navigationOptions(theme)} />
      <Stack.Screen name="WrittenCardError" component={WrittenCardError} options={(WrittenCardError as any).navigationOptions(theme)} />
      <Stack.Screen name="TappedCardDetails" component={TappedCardDetails} options={TappedCardDetails.navigationOptions(theme)} />
      <Stack.Screen name="WalletDetails" component={WalletDetails} options={WalletDetails.navigationOptions(theme)} />
      <Stack.Screen name="TransactionDetails" component={TransactionDetails} options={TransactionDetails.navigationOptions(theme)} />
      <Stack.Screen name="TransactionStatus" component={TransactionStatus} options={TransactionStatus.navigationOptions(theme)} />
      <Stack.Screen name="CPFP" component={CPFP} options={CPFP.navigationOptions(theme)} />
      <Stack.Screen name="RBFBumpFee" component={RBFBumpFee} options={RBFBumpFee.navigationOptions(theme)} />
      <Stack.Screen name="RBFCancel" component={RBFCancel} options={RBFCancel.navigationOptions(theme)} />
      <Stack.Screen name="Settings" component={Settings} options={Settings.navigationOptions(theme)} />
      <Stack.Screen name="SelectWallet" component={SelectWallet} options={SelectWallet.navigationOptions(theme)} />
      <Stack.Screen name="Currency" component={Currency} options={Currency.navigationOptions(theme)} />
      <Stack.Screen name="About" component={About} options={About.navigationOptions(theme)} />
      <Stack.Screen name="ReleaseNotes" component={ReleaseNotes} options={ReleaseNotes.navigationOptions(theme)} />
      <Stack.Screen name="Selftest" component={Selftest} options={Selftest.navigationOptions(theme)} />
      <Stack.Screen name="Licensing" component={Licensing} options={Licensing.navigationOptions(theme)} />
      <Stack.Screen name="DefaultView" component={DefaultView} options={DefaultView.navigationOptions(theme)} />
      <Stack.Screen name="Language" component={Language} options={Language.navigationOptions(theme)} />
      <Stack.Screen name="EncryptStorage" component={EncryptStorage} options={EncryptStorage.navigationOptions(theme)} />
      <Stack.Screen name="GeneralSettings" component={GeneralSettings} options={(GeneralSettings as any).navigationOptions(theme)} />
      <Stack.Screen name="FeatureFlags" component={FeatureFlags} options={(FeatureFlags as any).navigationOptions(theme)} />
      <Stack.Screen name="NetworkSettings" component={NetworkSettings} options={NetworkSettings.navigationOptions(theme)} />
      <Stack.Screen name="NotificationSettings" component={NotificationSettings} options={NotificationSettings.navigationOptions(theme)} />
      <Stack.Screen name="PlausibleDeniability" component={PlausibleDeniability} options={PlausibleDeniability.navigationOptions(theme)} />
      <Stack.Screen name="LightningSettings" component={LightningSettings} options={LightningSettings.navigationOptions(theme)} />
      <Stack.Screen name="ElectrumSettings" component={ElectrumSettings} options={(ElectrumSettings as any).navigationOptions(theme)} />
      <Stack.Screen name="SettingsPrivacy" component={SettingsPrivacy} options={SettingsPrivacy.navigationOptions(theme)} />
      <Stack.Screen name="Tools" component={Tools} options={Tools.navigationOptions(theme)} />
      <Stack.Screen name="LNDViewInvoice" component={LNDViewInvoice} options={LNDViewInvoice.navigationOptions(theme)} />
      <Stack.Screen
        name="LNDViewAdditionalInvoiceInformation"
        component={LNDViewAdditionalInvoiceInformation}
        options={LNDViewAdditionalInvoiceInformation.navigationOptions(theme)}
      />
      <Stack.Screen
        name="LNDViewAdditionalInvoicePreImage"
        component={LNDViewAdditionalInvoicePreImage}
        options={LNDViewAdditionalInvoicePreImage.navigationOptions(theme)}
      />
      <Stack.Screen name="Broadcast" component={Broadcast} options={Broadcast.navigationOptions(theme)} />
      <Stack.Screen name="IsItMyAddress" component={IsItMyAddress} options={IsItMyAddress.navigationOptions(theme)} />
      <Stack.Screen name="LnurlPay" component={LnurlPay} options={LnurlPay.navigationOptions(theme)} />
      <Stack.Screen name="LnurlPaySuccess" component={LnurlPaySuccess} options={LnurlPaySuccess.navigationOptions(theme)} />
      <Stack.Screen name="LnurlAuth" component={LnurlAuth} options={LnurlAuth.navigationOptions(theme)} />
      <Stack.Screen name="Success" component={Success} options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="WalletAddresses" component={WalletAddresses} options={WalletAddresses.navigationOptions(theme)} />
    </Stack.Navigator>
  );
};

export default WalletsStack;
