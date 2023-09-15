import React, { useContext, useState } from 'react';
import { ScrollView, StyleSheet, View, Text, Linking, Alert } from 'react-native';
import navigationStyle from '../../../components/navigationStyle';
import loc from '../../../loc';
import {
  BlueButton,
  BlueButtonLink,
  BlueSpacing10,
  BlueSpacing20,
  BlueSpacingAuto,
  SafeBlueArea,
  SecondButton,
  SelectButton,
} from '../../../BlueComponents';
import { useNavigation } from '@react-navigation/native';
import { useLds } from '../../../api/lds/hooks/lds.hook';
import { useWalletContext } from '../../../contexts/wallet.context';
import { BlueStorageContext } from '../../../blue_modules/storage-context';
import { LightningCustodianWallet } from '../../../class';
import { Chain, WalletLabel } from '../../../models/bitcoinUnits';

const AddLightning = () => {
  const { navigate } = useNavigation();
  const { address, signMessage } = useWalletContext();
  const { getUser } = useLds();

  const { addWallet, saveToDisk } = useContext(BlueStorageContext);

  const [useCustom, setUseCustom] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const onBack = () => navigate('WalletTransactions');

  const onCreate = () => {
    setIsLoading(true);
    create()
      .catch(e =>
        Alert.alert('Something went wrong', e.message.toString(), [
          {
            text: loc._.ok,
            onPress: () => {},
            style: 'default',
          },
        ]),
      )
      .finally(() => setIsLoading(false));
  };

  const create = async () => {
    if (useCustom) {
      // TODO
    } else {
      if (!address) throw new Error('Address is not defined');

      const user = await getUser(address, m => signMessage(m, address));

      for (const lnWallet of user.lightning.wallets) {
        if (lnWallet.lndhubAdminUrl) {
          const [secret, baseUri] = lnWallet.lndhubAdminUrl.split('@');

          // TODO: taproot wallet?

          const wallet = new LightningCustodianWallet();
          wallet.setLabel(WalletLabel[Chain.OFFCHAIN]);
          wallet.setBaseURI(baseUri);
          wallet.setSecret(secret);
          await wallet.init();
          await wallet.authorize();
          await wallet.fetchTransactions();
          await wallet.fetchUserInvoices();
          await wallet.fetchPendingTransactions();
          await wallet.fetchBalance();

          addWallet(wallet);
          await saveToDisk();
        }
      }

      onBack();
    }
  };

  return (
    <SafeBlueArea>
      <ScrollView contentContainerStyle={styles.scrollableContainer}>
        <View style={styles.contentContainer}>
          <SelectButton active={!useCustom} onPress={() => setUseCustom(false)}>
            <Text style={styles.selectButtonText}>lightning.space</Text>
          </SelectButton>
          <BlueSpacing10 />
          <SelectButton active={useCustom} onPress={() => setUseCustom(true)}>
            <Text style={styles.selectButtonText}>Custom</Text>
          </SelectButton>

          {useCustom && (
            <>
              {/* TODO: translation */}
              <BlueButtonLink
                title="How to use your own LNDHub"
                onPress={() => Linking.openURL('https://docs.dfx.swiss/en/faq.html#how-to-use-your-own-LND-Hub')}
              />
              {/* TODO */}
            </>
          )}

          <BlueSpacingAuto />

          {/* TODO: translation! */}
          <Text style={styles.disclaimer}>
            Please note that by adding an LNDHub provider you automatically accept the terms and conditions of the corresponding provider.
          </Text>
          <BlueButton title={loc._.continue} onPress={onCreate} disabled={useCustom} isLoading={isLoading} />
          <BlueSpacing20 />
          {/* @ts-ignore components in JS */}
          <SecondButton title={loc._.cancel} onPress={onBack} />
        </View>
      </ScrollView>
    </SafeBlueArea>
  );
};

const styles = StyleSheet.create({
  scrollableContainer: {
    flexGrow: 1,
    flexShrink: 0,
  },
  contentContainer: {
    flex: 1,
    alignItems: 'stretch',
    padding: 16,
  },
  selectButtonText: { color: 'white' },
  disclaimer: {
    margin: 20,
    color: '#9aa0aa',
    textAlign: 'center',
  },
});

AddLightning.navigationOptions = navigationStyle({}, opts => ({
  ...opts,
  headerTitle: 'Add LND Hub', // TODO: translation
  headerHideBackButton: true,
  gestureEnabled: false,
}));

export default AddLightning;
