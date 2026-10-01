import React, { useCallback, useEffect, useState, useContext } from 'react';
import { Platform, View, Keyboard, StyleSheet, Switch, TouchableWithoutFeedback, TouchableOpacity, Image } from 'react-native';
import { useFocusEffect, useNavigation, useRoute, useTheme } from '@react-navigation/native';

import {
  BlueButton,
  BlueDoneAndDismissKeyboardInputAccessory,
  BlueFormLabel,
  BlueFormMultiInput,
  BlueSpacing20,
  BlueText,
  SafeBlueArea,
} from '../../BlueComponents';
import navigationStyle from '../../components/navigationStyle';
import Privacy from '../../blue_modules/Privacy';
import loc from '../../loc';
import { BlueStorageContext } from '../../blue_modules/storage-context';

const WalletsImport = () => {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const route = useRoute();
  const label = route?.params?.label ?? '';
  const triggerImport = route?.params?.triggerImport ?? false;
  const { isAdvancedModeEnabled } = useContext(BlueStorageContext);
  const [importText, setImportText] = useState(label);
  const [isToolbarVisibleForAndroid, setIsToolbarVisibleForAndroid] = useState(false);
  const [, setSpeedBackdoor] = useState(0);
  const [isAdvancedModeEnabledRender, setIsAdvancedModeEnabledRender] = useState(false);
  const [searchAccounts, setSearchAccounts] = useState(false);
  const [askPassphrase, setAskPassphrase] = useState(false);

  const styles = StyleSheet.create({
    root: {
      paddingTop: 10,
      backgroundColor: colors.elevated,
      flex: 1,
      justifyContent: 'space-between',
    },
    center: {
      marginHorizontal: 16,
      backgroundColor: colors.elevated,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: 16,
      marginTop: 10,
      justifyContent: 'space-between',
    },
    formContainer: {
      flexGrow: 0.5,
    },
  });

  const onBlur = () => {
    const valueWithSingleWhitespace = importText.replace(/^\s+|\s+$|\s+(?=\s)/g, '');
    setImportText(valueWithSingleWhitespace);
    return valueWithSingleWhitespace;
  };

  // on focus, not on mount: the setting can change while this screen sits in the stack, and
  // enableBlur() reads it at call time - a mount-only call would keep the stale decision
  useFocusEffect(
    useCallback(() => {
      Privacy.enableBlur();

      return () => {
        Privacy.disableBlur();
      };
    }, []),
  );

  useEffect(() => {
    const willShow = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () =>
      setIsToolbarVisibleForAndroid(true),
    );
    const willHide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () =>
      setIsToolbarVisibleForAndroid(false),
    );
    navigation.setOptions({
      headerBackVisible: false,
      headerRight: () => (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={loc._.close}
          style={styles.button}
          onPress={() => {
            Keyboard.dismiss();
            navigation.replace('ScanImport');
          }}
        >
          <Image source={require('../../img/close-white.png')} />
        </TouchableOpacity>
      ),
    });
    return () => {
      willShow.remove();
      willHide.remove();
    };
  }, []);

  useEffect(() => {
    isAdvancedModeEnabled().then(setIsAdvancedModeEnabledRender);
    if (triggerImport) importButtonPressed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const importButtonPressed = () => {
    const textToImport = onBlur();
    if (textToImport.trim().length === 0) {
      return;
    }
    importMnemonic(textToImport);
  };

  const importMnemonic = text => {
    navigation.navigate('ImportWalletDiscovery', { importText: text, askPassphrase, searchAccounts });
  };

  const speedBackdoorTap = () => {
    setSpeedBackdoor(v => {
      v += 1;
      if (v < 5) return v;
      navigation.navigate('ImportSpeed');
      return 0;
    });
  };

  const renderOptionsAndImportButton = (
    <>
      {isAdvancedModeEnabledRender && (
        <>
          <View style={styles.row}>
            <BlueText>{loc.wallets.import_passphrase}</BlueText>
            <Switch testID="AskPassphrase" value={askPassphrase} onValueChange={setAskPassphrase} />
          </View>
          <View style={styles.row}>
            <BlueText>{loc.wallets.import_search_accounts}</BlueText>
            <Switch testID="SearchAccounts" value={searchAccounts} onValueChange={setSearchAccounts} />
          </View>
        </>
      )}

      <BlueSpacing20 />
      <View style={styles.center}>
        <BlueButton
          disabled={importText.trim().length === 0}
          title={loc.wallets.import_do_import}
          testID="DoImport"
          onPress={importButtonPressed}
        />
        <BlueSpacing20 />
      </View>
    </>
  );

  return (
    <SafeBlueArea style={styles.root}>
      <View style={styles.formContainer}>
        <BlueSpacing20 />
        <TouchableWithoutFeedback accessibilityRole="button" onPress={speedBackdoorTap} testID="SpeedBackdoor">
          <BlueFormLabel>{loc.wallets.import_explanation}</BlueFormLabel>
        </TouchableWithoutFeedback>
        <BlueSpacing20 />
        <BlueFormMultiInput
          value={importText}
          onBlur={onBlur}
          onChangeText={setImportText}
          testID="MnemonicInput"
          inputAccessoryViewID={BlueDoneAndDismissKeyboardInputAccessory.InputAccessoryViewID}
        />
      </View>
      <View>
        {Platform.select({ android: !isToolbarVisibleForAndroid && renderOptionsAndImportButton, default: renderOptionsAndImportButton })}
        {Platform.select({
          ios: (
            <BlueDoneAndDismissKeyboardInputAccessory
              onClearTapped={() => {
                setImportText('');
              }}
              onPasteTapped={text => {
                setImportText(text);
                Keyboard.dismiss();
              }}
            />
          ),
          android: isToolbarVisibleForAndroid && (
            <BlueDoneAndDismissKeyboardInputAccessory
              onClearTapped={() => {
                setImportText('');
                Keyboard.dismiss();
              }}
              onPasteTapped={text => {
                setImportText(text);
                Keyboard.dismiss();
              }}
            />
          ),
        })}
      </View>
    </SafeBlueArea>
  );
};

WalletsImport.navigationOptions = navigationStyle({}, opts => ({ ...opts, title: loc.wallets.import_title }));

export default WalletsImport;
