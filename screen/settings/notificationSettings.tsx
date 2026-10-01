import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, TouchableWithoutFeedback, I18nManager, StyleSheet, Linking, View, TextInput } from 'react-native';
import { Button } from 'react-native-elements';

import navigationStyle, { NavigationOptionsGetter } from '../../components/navigationStyle';
import { BlueButton, BlueCard, BlueCopyToClipboardButton, BlueListItem, BlueLoading, BlueSpacing20, BlueText } from '../../BlueComponents';
import loc from '../../loc';
import { BlueCurrentTheme, useTheme } from '../../components/themes';
import {
  checkPermissions,
  cleanUserOptOutFlag,
  getDefaultUri,
  getPushToken,
  getSavedUri,
  getStoredNotifications,
  isGroundControlUriValid,
  isNotificationsEnabled,
  saveUri,
  setLevels,
  tryToObtainPermissions,
} from '../../blue_modules/notifications';
import alert from '../../components/Alert';

const NotificationSettings: React.FC & { navigationOptions: NavigationOptionsGetter } = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [isNotificationsEnabledState, setNotificationsEnabledState] = useState(false);
  const [isShowTokenInfo, setShowTokenInfo] = useState(0);
  const [tokenInfo, setTokenInfo] = useState('<empty>');
  const [URI, setURI] = useState<string | undefined>();

  const { colors } = useTheme();

  const onNotificationsSwitch = async (value: boolean) => {
    setNotificationsEnabledState(value);
    if (value) {
      await cleanUserOptOutFlag();
      if (await getPushToken()) {
        await setLevels(true);
      } else {
        await tryToObtainPermissions();
      }
    } else {
      await setLevels(false);
    }

    setNotificationsEnabledState(await isNotificationsEnabled());
  };

  useEffect(() => {
    (async () => {
      setNotificationsEnabledState(await isNotificationsEnabled());
      setURI((await getSavedUri()) ?? undefined);
      setTokenInfo(
        'token: ' +
          JSON.stringify(await getPushToken()) +
          ' permissions: ' +
          JSON.stringify(await checkPermissions()) +
          ' stored notifications: ' +
          JSON.stringify(await getStoredNotifications()),
      );
      setIsLoading(false);
    })();
  }, []);

  const stylesWithThemeHook = {
    root: {
      ...styles.root,
      backgroundColor: colors.background,
    },
    scroll: {
      ...styles.scroll,
      backgroundColor: colors.background,
    },
    scrollBody: {
      ...styles.scrollBody,
      backgroundColor: colors.background,
    },
  };

  const save = useCallback(async () => {
    setIsLoading(true);
    try {
      if (URI) {
        if (await isGroundControlUriValid(URI)) {
          await saveUri(URI);
          alert(loc.settings.saved);
        } else {
          alert(loc.settings.not_a_valid_uri);
        }
      } else {
        await saveUri('');
        alert(loc.settings.saved);
      }
    } catch (error) {
      console.error('notificationSettings: failed to save GroundControl URI', error);
    }
    setIsLoading(false);
  }, [URI]);

  return isLoading ? (
    <BlueLoading />
  ) : (
    <ScrollView style={stylesWithThemeHook.scroll}>
      <BlueListItem
        // @ts-ignore: Fix later
        Component={TouchableWithoutFeedback}
        title={loc.settings.push_notifications}
        switch={{ onValueChange: onNotificationsSwitch, value: isNotificationsEnabledState, testID: 'NotificationsSwitch' }}
      />
      <BlueSpacing20 />

      <BlueCard>
        <BlueText>{loc.settings.groundcontrol_explanation}</BlueText>
      </BlueCard>

      <Button
        icon={{
          name: 'github',
          type: 'font-awesome',
          color: colors.foregroundColor,
        }}
        onPress={() => Linking.openURL('https://github.com/BlueWallet/GroundControl')}
        titleStyle={{ color: colors.buttonAlternativeTextColor }}
        title="github.com/BlueWallet/GroundControl"
        buttonStyle={styles.buttonStyle}
      />

      <BlueCard>
        <View style={styles.uri}>
          <TextInput
            placeholder={getDefaultUri()}
            value={URI}
            onChangeText={setURI}
            numberOfLines={1}
            style={styles.uriText}
            placeholderTextColor="#81868e"
            editable={!isLoading}
            textContentType="URL"
            autoCapitalize="none"
            underlineColorAndroid="transparent"
          />
        </View>

        <BlueSpacing20 />
        <BlueText style={styles.centered} onPress={() => setShowTokenInfo(isShowTokenInfo + 1)}>
          ♪ Ground Control to Major Tom ♪
        </BlueText>
        <BlueText style={styles.centered} onPress={() => setShowTokenInfo(isShowTokenInfo + 1)}>
          ♪ Commencing countdown, engines on ♪
        </BlueText>

        {isShowTokenInfo >= 9 && (
          <View>
            {/* @ts-ignore: BlueComponents JS prop typing */}
            <BlueCopyToClipboardButton stringToCopy={tokenInfo} displayText={tokenInfo} />
          </View>
        )}

        <BlueSpacing20 />
        <BlueButton onPress={save} title={loc.settings.save} />
      </BlueCard>
    </ScrollView>
  );
};

NotificationSettings.navigationOptions = navigationStyle({}, opts => ({ ...opts, title: loc.settings.notifications }));

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollBody: {
    flex: 1,
  },
  uri: {
    flexDirection: 'row',
    borderColor: BlueCurrentTheme.colors.formBorder,
    borderBottomColor: BlueCurrentTheme.colors.formBorder,
    borderWidth: 1,
    borderBottomWidth: 0.5,
    backgroundColor: BlueCurrentTheme.colors.inputBackgroundColor,
    minHeight: 44,
    height: 44,
    alignItems: 'center',
    borderRadius: 4,
  },
  centered: {
    textAlign: 'center',
  },
  uriText: {
    flex: 1,
    color: '#81868e',
    marginHorizontal: 8,
    minHeight: 36,
    height: 36,
  },
  buttonStyle: {
    backgroundColor: 'transparent',
    flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row',
  },
});

export default NotificationSettings;
