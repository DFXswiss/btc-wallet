import React, { useEffect, useState, useCallback, useContext } from 'react';
import { ActivityIndicator, View, BackHandler, Text, ScrollView, StyleSheet, I18nManager } from 'react-native';
import { useNavigation, useRoute, useTheme } from '@react-navigation/native';

import { SafeBlueArea, BlueButton } from '../../BlueComponents';
import navigationStyle from '../../components/navigationStyle';
import Privacy from '../../blue_modules/Privacy';
import loc from '../../loc';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import { ThemedCheckbox } from '../../components/ThemedCheckbox';
import Secret from './secret';

const PleaseBackup = () => {
  const { wallets, saveToDisk } = useContext(BlueStorageContext);
  const [isLoading, setIsLoading] = useState(true);
  const [isAccepted, setIsAccepted] = useState(false);
  const { walletID } = useRoute().params;
  const wallet = wallets.find(w => w.getID() === walletID);
  const navigation = useNavigation();
  const { colors } = useTheme();
  const stylesHook = StyleSheet.create({
    flex: {
      backgroundColor: colors.elevated,
    },
    text: {
      color: colors.backupText,
    },
  });

  const handleBackButton = useCallback(
    async hasConfirmed => {
      wallet.setUserHasBackedUpSeed(hasConfirmed);
      await saveToDisk();
      navigation.dangerouslyGetParent().pop();
      return true;
    },
    [navigation],
  );

  useEffect(() => {
    Privacy.enableBlur();
    setIsLoading(false);
    const listener = () => handleBackButton(false);
    BackHandler.addEventListener('hardwareBackPress', listener);
    return () => {
      Privacy.disableBlur();
      BackHandler.removeEventListener('hardwareBackPress', listener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return isLoading ? (
    <View style={[styles.loading, stylesHook.flex]}>
      <ActivityIndicator />
    </View>
  ) : (
    <SafeBlueArea style={stylesHook.flex}>
      <ScrollView contentContainerStyle={styles.scrollableContainer} testID="PleaseBackupScrollView">
        <View style={styles.please}>
          <Text style={styles.subtitle}>{loc.pleasebackup.subtitle}</Text>
          <Text style={[styles.subtext, stylesHook.text]}>{loc.pleasebackup.description}</Text>
        </View>
        <View style={styles.secret}>
          <Secret secret={wallet.getSecret()} />
        </View>
        <View style={styles.bottomContainer}>
          <ThemedCheckbox text={loc.pleasebackup.confirm} onChanged={setIsAccepted} />
          <View style={styles.bottom}>
            <BlueButton
              testID="PleasebackupOk"
              onPress={() => handleBackButton(isAccepted)}
              disabled={!isAccepted}
              title={loc._.continue}
            />
          </View>
        </View>
      </ScrollView>
    </SafeBlueArea>
  );
};

PleaseBackup.navigationOptions = navigationStyle({}, opts => ({ ...opts, title: loc.pleasebackup.title }));

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
  },
  scrollableContainer: {
    flexGrow: 1,
    flexShrink: 0,
  },
  please: {
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  secret: {
    marginTop: 40,
    marginBottom: 15,
  },
  bottomContainer: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
  },
  bottom: {
    paddingTop: 30,
    paddingBottom: 16,
    paddingHorizontal: 16,
    alignContent: 'center',
    minHeight: 44,
    minWidth: 220,
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
});

export default PleaseBackup;
