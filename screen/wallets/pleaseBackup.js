import React, { useEffect, useState, useCallback, useContext } from 'react';
import { ActivityIndicator, View, BackHandler, Text, ScrollView, StyleSheet, I18nManager } from 'react-native';
import { useNavigation, useRoute, useTheme } from '@react-navigation/native';

import { SafeBlueArea, BlueButton } from '../../BlueComponents';
import navigationStyle from '../../components/navigationStyle';
import Privacy from '../../blue_modules/Privacy';
import loc from '../../loc';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import { Icon } from 'react-native-elements';
import { ThemedCheckbox } from '../../components/ThemedCheckbox';

const PleaseBackup = () => {
  const { wallets, saveToDisk } = useContext(BlueStorageContext);
  const [isLoading, setIsLoading] = useState(true);
  const [isAccepted, setIsAccpted] = useState(false);
  const { walletID } = useRoute().params;
  const wallet = wallets.find(w => w.getID() === walletID);
  const navigation = useNavigation();
  const { colors } = useTheme();
  const stylesHook = StyleSheet.create({
    flex: {
      backgroundColor: colors.elevated,
    },
    word: {
      backgroundColor: '#2D2B47',
    },
    wortText: {
      color: colors.labelText,
    },
    infoText: {
      color: colors.brandingColor,
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

  const renderSecret = () => {
    return wallet
      .getSecret()
      .split(/\s/)
      .map((secret, index) => {
        const text = `${index + 1}.  ${secret}  `;
        return (
          <View style={[styles.word, stylesHook.word]} key={`${index}`}>
            <Text style={[styles.wortText, stylesHook.wortText]} textBreakStrategy="simple">
              {text}
            </Text>
          </View>
        );
      });
  };

  return isLoading ? (
    <View style={[styles.loading, stylesHook.flex]}>
      <ActivityIndicator />
    </View>
  ) : (
    <SafeBlueArea style={stylesHook.flex}>
      <ScrollView contentContainerStyle={styles.flex} testID="PleaseBackupScrollView">
        <View style={styles.please}>
          <Text style={styles.subtitle}>{loc.pleasebackup.subtitle}</Text>
          <Text style={[styles.subtext, stylesHook.text]}>{loc.pleasebackup.description}</Text>
        </View>
        <View style={styles.infoContainer}>
          <Icon name="info-outline" type="material" color={colors.brandingColor} size={18} />
          <Text style={[styles.infoText, stylesHook.infoText]}>{loc.pleasebackup.info}</Text>
        </View>
        <View style={styles.list}>
          <View style={styles.secret}>{renderSecret()}</View>
        </View>
        <View style={styles.bottomContainer}>
          <ThemedCheckbox text={loc.pleasebackup.confirm} onChanged={setIsAccpted} />
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
  flex: {
    flex: 1,
  },
  word: {
    marginRight: 8,
    marginBottom: 8,
    paddingTop: 6,
    paddingBottom: 6,
    paddingLeft: 8,
    paddingRight: 8,
    borderRadius: 6,
    minWidth: '47%',
  },
  wortText: {
    textAlign: 'left',
    fontSize: 17,
  },
  please: {
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  list: {
    flexGrow: 2,
    paddingHorizontal: 16,
  },
  bottomContainer: {
    flex: 1,
    flexGrow: 1,
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
  infoContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 243, 137, 0.9)',
    borderRadius: 8,
    marginHorizontal: 20,
    marginTop: 40,
    marginBottom: 15,
    padding: 7,
    paddingRight: 20,
  },
  infoText: {
    backgroundColor: 'transparent',
    fontSize: 14,
    marginHorizontal: 5,
    writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr',
  },
  secret: {
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: 14,
    flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row',
  },
});

export default PleaseBackup;
