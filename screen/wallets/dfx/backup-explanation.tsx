import React from 'react';
import { I18nManager, ScrollView, StyleSheet, Text, View } from 'react-native';
import navigationStyle from '../../../components/navigationStyle';
import loc from '../../../loc';
import { useTheme } from '@react-navigation/native';
import { BlueButton, SafeBlueArea } from '../../../BlueComponents';
import { navigate } from '../../../NavigationService';
import { useWalletContext } from '../../../contexts/wallet.context';

const BackupExplanation = () => {
  const { colors } = useTheme();
  const { walletID } = useWalletContext();

  const stylesHook = StyleSheet.create({
    flex: {
      backgroundColor: colors.elevated,
    },
    text: {
      color: colors.text,
    },
  });

  const navigateToBackup = () => {
    navigate('BackupSeedRoot', {
      screen: 'PleaseBackup',
      params: {
        walletID,
      },
    });
  };

  return (
    <SafeBlueArea style={stylesHook.flex}>
      <ScrollView style={styles.container}>
        <View style={styles.textContainer}>
          <Text style={[styles.text, stylesHook.text]}>{loc.backupExplanation.text}</Text>
        </View>
        <View style={styles.buttonContainer}>
          <View style={styles.button}>
            <BlueButton onPress={navigateToBackup} title={loc.backupExplanation.ready} testID="BackupExplanationReady" />
          </View>
        </View>
      </ScrollView>
    </SafeBlueArea>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  textContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  text: {
    backgroundColor: 'transparent',
    fontSize: 19,
    writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr',
  },
  buttonContainer: {
    flex: 1,
    flexGrow: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  button: {
    paddingVertical: 16,
    alignContent: 'center',
    minHeight: 44,
    minWidth: 200,
  },
});

BackupExplanation.navigationOptions = navigationStyle({}, opts => ({
  ...opts,
  headerTitle: loc.backupExplanation.title,
  headerHideBackButton: true,
  gestureEnabled: false,
}));

export default BackupExplanation;
