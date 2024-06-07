import React, { useContext } from 'react';
import { ScrollView, StyleSheet, Platform, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import navigationStyle from '../../components/navigationStyle';
import { BlueListItem, BlueHeaderDefaultSub } from '../../BlueComponents';
import loc from '../../loc';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import { MultisigHDWallet } from '../../class';
import { LightningLdsWallet } from '../../class/wallets/lightning-lds-wallet';

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});

const Settings = () => {
  const { navigate } = useNavigation();
  const { walletID } = useRoute().params;
  // By simply having it here, it'll re-render the UI if language is changed
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { wallets, language } = useContext(BlueStorageContext);
  const lndWallet = wallets.find(wallet => wallet.type === LightningLdsWallet.type);
  const multiDeviceWallet = wallets.find(wallet => wallet.type === MultisigHDWallet.type);

  const navigateToWalletDetails = id => {
    navigate('WalletDetails', {
      walletID: id,
    });
  };

  return (
    <>
      <View />
      <ScrollView style={styles.root}>
        {Platform.OS === 'android' ? <BlueHeaderDefaultSub leftText={loc.settings.header} /> : <></>}
        <BlueListItem title={loc.settings.general} onPress={() => navigate('GeneralSettings')} testID="GeneralSettings" chevron />
        <BlueListItem title={loc.wallets.main_wallet_label} onPress={() => navigateToWalletDetails(walletID)} testID="WalletDetails" chevron />
        <BlueListItem
          title={loc.wallets.lightning_wallet_label}
          disabled={!lndWallet}
          onPress={() => navigateToWalletDetails(lndWallet?.getID())}
          testID="WalletDetailsLnd"
          chevron
        />
        <BlueListItem
          title={loc.wallets.multi_sig_wallet_label}
          disabled={!multiDeviceWallet}
          onPress={() => navigateToWalletDetails(multiDeviceWallet?.getID())}
          testID="WalletDetailsMultisig"
          chevron
        />
        <BlueListItem title={loc.settings.currency} onPress={() => navigate('Currency')} testID="Currency" chevron />
        <BlueListItem title={loc.settings.language} onPress={() => navigate('Language')} testID="Language" chevron />
        <BlueListItem title={loc.settings.encrypt_title} onPress={() => navigate('EncryptStorage')} testID="SecurityButton" chevron />
        <BlueListItem title={loc.settings.network} onPress={() => navigate('NetworkSettings')} testID="NetworkSettings" chevron />
        <BlueListItem title={loc.settings.tools} onPress={() => navigate('Tools')} testID="Tools" chevron />
        <BlueListItem title={loc.settings.about} onPress={() => navigate('About')} testID="AboutButton" chevron />
      </ScrollView>
    </>
  );
};

export default Settings;
Settings.navigationOptions = navigationStyle({
  headerTitle: Platform.select({ ios: loc.settings.header, default: '' }),
  headerLargeTitle: true,
});
