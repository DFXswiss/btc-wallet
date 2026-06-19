import React, { useContext, useEffect, useState } from 'react';
import { ScrollView, Platform, Pressable, StyleSheet, View } from 'react-native';

import navigationStyle from '../../components/navigationStyle';
import { BlueLoading, BlueText, BlueSpacing20, BlueListItem, BlueCard, BlueButton, SecondButton } from '../../BlueComponents';
import { useNavigation, useTheme } from '@react-navigation/native';
import loc, { STORAGE_KEY as LANG_STORAGE_KEY } from '../../loc';
import { BlueStorageContext } from '../../blue_modules/storage-context';
import { isURv1Enabled, clearUseURv1, setUseURv1 } from '../../blue_modules/ur';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PREFERRED_CURRENCY_STORAGE_KEY, EXCHANGE_RATES_STORAGE_KEY, LAST_UPDATED } from '../../blue_modules/currency';

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});

const GeneralSettings: React.FC = () => {
  const { isAdvancedModeEnabled, setIsAdvancedModeEnabled, isHandOffUseEnabled, setIsHandOffUseEnabledAsyncStorage } =
    useContext(BlueStorageContext);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdvancedModeSwitchEnabled, setIsAdvancedModeSwitchEnabled] = useState(false);
  const [isURv1SwitchEnabled, setIsURv1SwitchEnabled] = useState(false);
  const [isClearingAsyncStorage, setIsClearingAsyncStorage] = useState(false);
  const { navigate } = useNavigation();
  const { colors } = useTheme();
  const onAdvancedModeSwitch = async (value: boolean) => {
    await setIsAdvancedModeEnabled(value);
    setIsAdvancedModeSwitchEnabled(value);
  };
  const onLegacyURv1Switch = async (value: boolean) => {
    setIsURv1SwitchEnabled(value);
    return value ? setUseURv1() : clearUseURv1();
  };

  useEffect(() => {
    (async () => {
      setIsAdvancedModeSwitchEnabled(await isAdvancedModeEnabled());
      setIsURv1SwitchEnabled(await isURv1Enabled());
      setIsLoading(false);
    })();
  });

  const navigateToPrivacy = () => {
    // @ts-ignore: Fix later
    navigate('SettingsPrivacy');
  };

  const clearAsyncStorage = async () => {
    try {
      setIsClearingAsyncStorage(true);
      await Promise.all([
        AsyncStorage.removeItem(LANG_STORAGE_KEY),
        AsyncStorage.removeItem(PREFERRED_CURRENCY_STORAGE_KEY),
        AsyncStorage.removeItem(EXCHANGE_RATES_STORAGE_KEY),
        AsyncStorage.removeItem(LAST_UPDATED),
      ]);
    } catch (error) {}
    setIsClearingAsyncStorage(false);
  };

  const stylesWithThemeHook = {
    root: {
      backgroundColor: colors.background,
    },
  };

  return isLoading ? (
    <BlueLoading />
  ) : (
    <ScrollView style={[styles.root, stylesWithThemeHook.root]}>
      {/* @ts-ignore: Fix later */}
      <BlueListItem title={loc.settings.privacy} onPress={navigateToPrivacy} testID="SettingsPrivacy" chevron />
      {Platform.OS === 'ios' ? (
        <>
          <BlueListItem
            // @ts-ignore: Fix later
            hideChevron
            title={loc.settings.general_continuity}
            Component={Pressable}
            switch={{ onValueChange: setIsHandOffUseEnabledAsyncStorage, value: isHandOffUseEnabled }}
          />
          <BlueCard>
            <BlueText>{loc.settings.general_continuity_e}</BlueText>
          </BlueCard>
          <BlueSpacing20 />
        </>
      ) : null}
      <BlueListItem
        // @ts-ignore: Fix later
        Component={Pressable}
        title={loc.settings.general_adv_mode}
        switch={{ onValueChange: onAdvancedModeSwitch, value: isAdvancedModeSwitchEnabled, testID: 'AdvancedMode' }}
      />
      <BlueCard>
        <BlueText>{loc.settings.general_adv_mode_e}</BlueText>
      </BlueCard>
      <BlueSpacing20 />
      {/* @ts-ignore: Fix later */}
      <BlueListItem
        // @ts-ignore: Fix later
        Component={Pressable}
        title="Legacy URv1 QR"
        switch={{ onValueChange: onLegacyURv1Switch, value: isURv1SwitchEnabled }}
      />
      <BlueSpacing20 />
      <BlueListItem
        // @ts-ignore: Fix later
        Component={View}
        title="Clear AsyncStorage"
        // @ts-ignore: title? what?
        rightElement={<SecondButton title="Clear" onPress={clearAsyncStorage} isLoading={isClearingAsyncStorage} />}
      />
    </ScrollView>
  );
};

// @ts-ignore: Fix later
GeneralSettings.navigationOptions = navigationStyle({}, opts => ({ ...opts, title: loc.settings.general }));

export default GeneralSettings;
