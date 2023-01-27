import React, { useState, useEffect, useContext } from 'react';
import {
  Text,
  ScrollView,
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  View,
  StatusBar,
  TextInput,
  StyleSheet,
  useColorScheme,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlueText, BlueListItem, BlueFormLabel, BlueButton, BlueButtonLink, BlueSpacing20 } from '../../BlueComponents';
import navigationStyle from '../../components/navigationStyle';
import { HDSegwitBech32Wallet, SegwitP2SHWallet, HDSegwitP2SHWallet, AppStorage } from '../../class';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import { useTheme, useNavigation } from '@react-navigation/native';
import { Chain } from '../../models/bitcoinUnits';
import loc from '../../loc';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import alert from '../../components/Alert';
const A = require('../../blue_modules/analytics');

const ButtonSelected = Object.freeze({
  ONCHAIN: Chain.ONCHAIN,
});

const WalletsAdd = () => {
  const { colors } = useTheme();
  const { addWallet, saveToDisk, isAdancedModeEnabled } = useContext(BlueStorageContext);
  const [isLoading, setIsLoading] = useState(true);
  const [walletBaseURI, setWalletBaseURI] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(2);
  const [label, setLabel] = useState('');
  const [isAdvancedOptionsEnabled, setIsAdvancedOptionsEnabled] = useState(false);
  const { navigate, goBack } = useNavigation();
  const [entropy, setEntropy] = useState();
  const [entropyButtonText, setEntropyButtonText] = useState(loc.wallets.add_entropy_provide);
  const stylesHook = {
    advancedText: {
      color: colors.feeText,
    },
    label: {
      borderColor: colors.formBorder,
      borderBottomColor: colors.formBorder,
      backgroundColor: colors.inputBackgroundColor,
    },
    noPadding: {
      backgroundColor: colors.elevated,
    },
    root: {
      backgroundColor: colors.elevated,
    },
    lndUri: {
      borderColor: colors.formBorder,
      borderBottomColor: colors.formBorder,
      backgroundColor: colors.inputBackgroundColor,
    },
  };
  const selectedWalletType = ButtonSelected.ONCHAIN;

  useEffect(() => {
    AsyncStorage.getItem(AppStorage.LNDHUB)
      .then(url => setWalletBaseURI(url || 'https://lndhub.io'))
      .catch(() => setWalletBaseURI(''));
    isAdancedModeEnabled()
      .then(setIsAdvancedOptionsEnabled)
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdvancedOptionsEnabled]);

  const entropyGenerated = newEntropy => {
    let entropyTitle;
    if (!newEntropy) {
      entropyTitle = loc.wallets.add_entropy_provide;
    } else if (newEntropy.length < 32) {
      entropyTitle = loc.formatString(loc.wallets.add_entropy_remain, {
        gen: newEntropy.length,
        rem: 32 - newEntropy.length,
      });
    } else {
      entropyTitle = loc.formatString(loc.wallets.add_entropy_generated, {
        gen: newEntropy.length,
      });
    }
    setEntropy(newEntropy);
    setEntropyButtonText(entropyTitle);
  };

  const createWallet = async () => {
    setIsLoading(true);

    const w = new HDSegwitP2SHWallet();
    w.setLabel(label || loc.wallets.details_title);

    if (entropy) {
      try {
        await w.generateFromEntropy(entropy);
      } catch (e) {
        console.log(e.toString());
        alert(e.toString());
        goBack();
        return;
      }
    } else {
      await w.generate();
    }
    addWallet(w);
    await saveToDisk();
    A(A.ENUM.CREATED_WALLET);
    ReactNativeHapticFeedback.trigger('notificationSuccess', { ignoreAndroidSystemSettings: false });
  };

  const navigateToEntropy = () => {
    navigate('ProvideEntropy', { onGenerated: entropyGenerated });
  };

  const navigateToImportWallet = () => {
    navigate('ImportWallet');
  };

  return (
    <ScrollView style={stylesHook.root}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <BlueSpacing20 />
      <KeyboardAvoidingView enabled behavior={Platform.OS === 'ios' ? 'padding' : null} keyboardVerticalOffset={62}>
        <BlueFormLabel>{loc.wallets.add_wallet_name}</BlueFormLabel>
        <View style={[styles.label, stylesHook.label]}>
          <TextInput
            testID="WalletNameInput"
            value={label}
            placeholderTextColor="#81868e"
            placeholder={loc.wallets.add_placeholder}
            onChangeText={setLabel}
            style={styles.textInputCommon}
            editable={!isLoading}
            underlineColorAndroid="transparent"
          />
        </View>

        <View style={styles.advanced}>
          {(() => {
            if (selectedWalletType === ButtonSelected.ONCHAIN && isAdvancedOptionsEnabled) {
              return (
                <View>
                  <BlueSpacing20 />
                  <Text style={[styles.advancedText, stylesHook.advancedText]}>{loc.settings.advanced_options}</Text>
                  <BlueListItem
                    containerStyle={[styles.noPadding, stylesHook.noPadding]}
                    bottomDivider={false}
                    onPress={() => setSelectedIndex(0)}
                    title={HDSegwitBech32Wallet.typeReadable}
                    checkmark={selectedIndex === 0}
                  />
                  <BlueListItem
                    containerStyle={[styles.noPadding, stylesHook.noPadding]}
                    bottomDivider={false}
                    onPress={() => setSelectedIndex(1)}
                    title={SegwitP2SHWallet.typeReadable}
                    checkmark={selectedIndex === 1}
                  />
                  <BlueListItem
                    containerStyle={[styles.noPadding, stylesHook.noPadding]}
                    bottomDivider={false}
                    onPress={() => setSelectedIndex(2)}
                    title={HDSegwitP2SHWallet.typeReadable}
                    checkmark={selectedIndex === 2}
                  />
                </View>
              );
            } else if (selectedWalletType === ButtonSelected.OFFCHAIN) {
              return (
                <>
                  <BlueSpacing20 />
                  <Text style={[styles.advancedText, stylesHook.advancedText]}>{loc.settings.advanced_options}</Text>
                  <BlueSpacing20 />
                  <BlueText>{loc.wallets.add_lndhub}</BlueText>
                  <View style={[styles.lndUri, stylesHook.lndUri]}>
                    <TextInput
                      value={walletBaseURI}
                      onChangeText={setWalletBaseURI}
                      onSubmitEditing={Keyboard.dismiss}
                      placeholder={loc.wallets.add_lndhub_placeholder}
                      clearButtonMode="while-editing"
                      autoCapitalize="none"
                      textContentType="URL"
                      autoCorrect={false}
                      placeholderTextColor="#81868e"
                      style={styles.textInputCommon}
                      editable={!isLoading}
                      underlineColorAndroid="transparent"
                    />
                  </View>
                </>
              );
            }
          })()}
          {isAdvancedOptionsEnabled && selectedWalletType === ButtonSelected.ONCHAIN && !isLoading && (
            <BlueButtonLink style={styles.import} title={entropyButtonText} onPress={navigateToEntropy} />
          )}
          <BlueSpacing20 />
          <View style={styles.createButton}>
            {!isLoading ? <BlueButton testID="Create" title={loc.wallets.add_create} onPress={createWallet} /> : <ActivityIndicator />}
          </View>
          {!isLoading && (
            <BlueButtonLink
              testID="ImportWallet"
              style={styles.import}
              title={loc.wallets.add_import_wallet}
              onPress={navigateToImportWallet}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </ScrollView>
  );
};

WalletsAdd.navigationOptions = navigationStyle(
  {
    headerHideBackButton: true,
    gestureEnabled: false,
  },
  opts => ({ ...opts, title: loc.wallets.add_title }),
);

const styles = StyleSheet.create({
  createButton: {
    flex: 1,
  },
  label: {
    flexDirection: 'row',
    borderWidth: 1,
    borderBottomWidth: 0.5,
    minHeight: 44,
    height: 44,
    marginHorizontal: 20,
    alignItems: 'center',
    marginVertical: 16,
    borderRadius: 4,
  },
  textInputCommon: {
    flex: 1,
    marginHorizontal: 8,
    color: '#81868e',
  },
  advanced: {
    marginHorizontal: 20,
  },
  advancedText: {
    fontWeight: '500',
  },
  lndUri: {
    flexDirection: 'row',
    borderWidth: 1,
    borderBottomWidth: 0.5,
    minHeight: 44,
    height: 44,
    alignItems: 'center',
    marginVertical: 16,
    borderRadius: 4,
  },
  import: {
    marginBottom: 0,
    marginTop: 24,
  },
  noPadding: {
    paddingHorizontal: 0,
  },
});

export default WalletsAdd;
