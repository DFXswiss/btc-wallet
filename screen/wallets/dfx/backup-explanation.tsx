import React from 'react';
import { I18nManager, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import navigationStyle from '../../../components/navigationStyle';
import loc from '../../../loc';
import { useTheme } from '@react-navigation/native';
import { BlueButton, SafeBlueArea } from '../../../BlueComponents';
import { navigate } from '../../../NavigationService';
import { useWalletContext } from '../../../contexts/wallet.context';
import { Icon } from 'react-native-elements';

const BackupExplanation = () => {
  const { colors } = useTheme();
  const { walletID } = useWalletContext();

  const stylesHook = StyleSheet.create({
    container: {
      backgroundColor: colors.elevated,
    },
    text: {
      color: colors.backupText,
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

  const icons = [
    {
      name: 'file-document-outline',
      type: 'material-community',
      size: 18,
    },
    {
      name: 'restore',
      type: 'material',
      size: 20,
    },
    {
      name: 'key',
      type: 'octicon',
      size: 18,
    },
  ];

  return (
    <SafeBlueArea style={stylesHook.container}>
      <ScrollView contentContainerStyle={styles.scrollableContainer}>
        <View style={styles.contentContainer}>
          <Image source={require('../../img/dfx/backup-phrase.png')} />
          <Text style={styles.subtitle}>{loc.backupExplanation.subtitle}</Text>
          <Text style={[styles.subtext, stylesHook.text]}>{loc.backupExplanation.text}</Text>
          <View style={styles.itemsContainer}>
            {loc.backupExplanation.items.map((item: { title: string; text: string }, index: number) => (
              <View key={index} style={styles.itemTitleContainer}>
                <Icon name={icons[index].name} type={icons[index].type} size={icons[index].size} color="#F5516C" />
                <View style={styles.itemTextContainer}>
                  <Text style={styles.itemTitle}>{item.title}</Text>
                  <Text style={[styles.itemText, stylesHook.text]}>{item.text}</Text>
                </View>
              </View>
            ))}
          </View>
          <View style={styles.buttonContainer}>
            <View style={styles.button}>
              <BlueButton onPress={navigateToBackup} title={loc.backupExplanation.ready} testID="BackupExplanationReady" />
            </View>
          </View>
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
    alignItems: 'center',
    padding: 16,
  },
  subtitle: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 18,
    paddingTop: 20,
  },
  subtext: {
    backgroundColor: 'transparent',
    fontSize: 14,
    writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr',
    textAlign: 'center',
    marginTop: 4,
  },
  itemsContainer: {
    flex: 1,
    padding: 30,
  },
  itemTitleContainer: {
    flexDirection: 'row',
    paddingTop: 20,
  },
  itemTextContainer: {
    flexDirection: 'column',
    paddingHorizontal: 10,
  },
  itemTitle: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
  },
  itemText: {
    backgroundColor: 'transparent',
    fontSize: 14,
    writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr',
  },
  buttonContainer: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  button: {
    alignContent: 'center',
    minHeight: 44,
    minWidth: 220,
  },
});

BackupExplanation.navigationOptions = navigationStyle({ closeButton: true }, opts => ({
  ...opts,
  headerTitle: loc.backupExplanation.title,
  headerHideBackButton: true,
  gestureEnabled: false,
}));

export default BackupExplanation;
