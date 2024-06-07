import React, { useState, useEffect, useContext } from 'react';
import {
  Text,
  Linking,
  ScrollView,
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  View,
  StatusBar,
  TextInput,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlueText, BlueListItem, BlueButton, BlueButtonLink, BlueSpacing20 } from '../../BlueComponents';
import navigationStyle from '../../components/navigationStyle';
import { HDSegwitBech32Wallet, SegwitP2SHWallet, HDSegwitP2SHWallet } from '../../class';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import { useTheme, useNavigation, StackActions } from '@react-navigation/native';
import { WalletLabel, Chain } from '../../models/bitcoinUnits';
import loc from '../../loc';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import alert from '../../components/Alert';
import Config from 'react-native-config';
import { useAuth } from '../../api/dfx/hooks/auth.hook';
const BlueApp = require('../../BlueApp');
const AppStorage = BlueApp.AppStorage;
const A = require('../../blue_modules/analytics');

const ButtonSelected = Object.freeze({
  ONCHAIN: Chain.ONCHAIN,
});

const WalletsAdd = () => {
  const { colors } = useTheme();
  const { addWallet, saveToDisk, isAdvancedModeEnabled } = useContext(BlueStorageContext);
  const [isLoading, setIsLoading] = useState(true);
  const [walletBaseURI, setWalletBaseURI] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(2);
  const [isAdvancedOptionsEnabled, setIsAdvancedOptionsEnabled] = useState(false);
  const { navigate, goBack, dispatch } = useNavigation();
  const [entropy, setEntropy] = useState();
  const [entropyButtonText, setEntropyButtonText] = useState(loc.wallets.add_entropy_provide);
  const { getSignMessage } = useAuth();
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
    disclaimer: {
      margin: 20,
      color: colors.buttonDisabledTextColor,
      textAlign: 'center',
    },
  };
  const selectedWalletType = ButtonSelected.ONCHAIN;

  useEffect(() => {
    AsyncStorage.getItem(AppStorage.LNDHUB)
      .then(url => setWalletBaseURI(url))
      .catch(() => setWalletBaseURI(''));
    isAdvancedModeEnabled()
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

    const w = new HDSegwitBech32Wallet();
    w.setLabel(WalletLabel[Chain.ONCHAIN]);

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
    const mainAddress = w._getExternalAddressByIndex(0);
    const message = getSignMessage(mainAddress);
    w.addressOwnershipProof = await w.signMessage(message, mainAddress);
    addWallet(w);
    await saveToDisk();
    A(A.ENUM.CREATED_WALLET);
    ReactNativeHapticFeedback.trigger('notificationSuccess', { ignoreAndroidSystemSettings: false });
    dispatch(StackActions.replace('Navigation'));
  };

  const navigateToEntropy = () => {
    navigate('ProvideEntropy', { onGenerated: entropyGenerated });
  };

  const navigateToImportWallet = () => {
    navigate('ImportWallet');
  };

  const handleDisclaimerPress = () => {
    if (Config.REACT_APP_DISCLAIMER_URL) Linking.openURL(Config.REACT_APP_DISCLAIMER_URL);
  };

  return (
    <ScrollView contentContainerStyle={[styles.root, stylesHook.root]}>
      <View>
        <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
        <BlueSpacing20 />
        <KeyboardAvoidingView enabled behavior={Platform.OS === 'ios' ? 'padding' : null} keyboardVerticalOffset={62}>
          {!isLoading && (
            <TouchableOpacity onPress={handleDisclaimerPress}>
              <Text style={stylesHook.disclaimer}>{loc.wallets.add_disclaimer}</Text>
            </TouchableOpacity>
          )}
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
          </View>
        </KeyboardAvoidingView>
      </View>
      <View style={styles.buttonContainer}>
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
        <BlueSpacing20 />
      </View>
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
  root: {
    flex: 1,
    justifyContent: 'space-between',
  },
  textInputCommon: {
    flex: 1,
    marginHorizontal: 8,
    color: '#ffffff',
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
  buttonContainer: {
    marginBottom: 24,
    paddingHorizontal: 16,
  },
});

export default WalletsAdd;
