import React, { useContext, useState } from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import navigationStyle from '../../components/navigationStyle';
import { BlueButton, BlueSpacing40, BlueText } from '../../BlueComponents';
import { ScrollView, TextInput } from 'react-native-gesture-handler';
import { useNavigation, useRoute, useTheme } from '@react-navigation/native';
import DeeplinkSchemaMatch from '../../class/deeplink-schema-match';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import { useWalletContext } from '../../contexts/wallet.context';
import { Chain } from '../../models/bitcoinUnits';
import loc from '../../loc';

const ManualAddressSend: React.FC = () => {
  const { wallets } = useContext(BlueStorageContext);
  const { wallet: mainWallet } = useWalletContext();
  const { params } = useRoute();
  const { replace } = useNavigation();
  const [address, setAddress] = useState('');
  const [disableContinue, setDisableContinue] = useState(true);
  const { colors } = useTheme();

  const stylesHook = StyleSheet.create({
    inputContainer: {
      borderColor: colors.formBorder,
      borderBottomColor: colors.formBorder,
      backgroundColor: colors.inputBackgroundColor,
    },
    input: {
      color: colors.foregroundColor,
    },
  });

  const handleOnChange = (text: string) => {
    setAddress(text);
    const isValid = DeeplinkSchemaMatch.isPossiblyLightningDestination(text) || DeeplinkSchemaMatch.isPossiblyOnChainDestination(text);
    setDisableContinue(!isValid);
  };

  const onContinue = () => {
    if (DeeplinkSchemaMatch.isBothBitcoinAndLightning(address)) {
      const selectedWallet = wallets.find(w => w.getID() === params?.walletID);
      const lightningWallet = wallets.find(w => w.chain === Chain.OFFCHAIN);
      const uri = DeeplinkSchemaMatch.isBothBitcoinAndLightning(address);
      const destinationWallet = selectedWallet || lightningWallet || mainWallet;
      const route = DeeplinkSchemaMatch.isBothBitcoinAndLightningOnWalletSelect(destinationWallet, uri);
      ReactNativeHapticFeedback.trigger('impactLight', { ignoreAndroidSystemSettings: false });
      replace(...route);
    } else if (DeeplinkSchemaMatch.isPossiblyLightningDestination(address) || DeeplinkSchemaMatch.isPossiblyOnChainDestination(address)) {
      DeeplinkSchemaMatch.navigationRouteFor({ url: address }, completionValue => {
        ReactNativeHapticFeedback.trigger('impactLight', { ignoreAndroidSystemSettings: false });
        replace(...completionValue);
      });
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.content}>
        <BlueText style={styles.title}>{loc.send.text_address_or_invoice}</BlueText>
        <View style={[styles.inputContainer, stylesHook.inputContainer]}>
          <TextInput
            placeholderTextColor="#65728A"
            value={address}
            onChangeText={handleOnChange}
            style={[styles.input, stylesHook.input]}
            multiline
          />
        </View>
      </View>
      <KeyboardAvoidingView behavior={Platform.select({ ios: 'position' })} keyboardVerticalOffset={80}>
        <ScrollView style={styles.actionsContainer}>
          <BlueButton title={loc._.continue} onPress={onContinue} disabled={disableContinue} />
          <BlueSpacing40 />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    marginHorizontal: 20,
    paddingTop: 30,
    flex: 1,
  },
  content: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    marginBottom: 4,
  },
  inputContainer: {
    flexDirection: 'row',
    borderWidth: 1.0,
    borderBottomWidth: 0.5,
    minHeight: 44,
    alignItems: 'center',
    marginVertical: 8,
    borderRadius: 4,
  },
  input: {
    flex: 1,
    marginHorizontal: 8,
    minHeight: 33,
    fontSize: 18,
    padding: 10,
  },
  actionsContainer: {
    flexDirection: 'column-reverse',
  },
});
ManualAddressSend.navigationOptions = navigationStyle(
  {
    closeButton: false,
  },
  opts => ({ ...opts, title: loc.send.enter_address }),
);

export default ManualAddressSend;
