import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, I18nManager } from 'react-native';
import { useNavigation, useRoute, useTheme } from '@react-navigation/native';

import { SafeBlueArea, BlueButton } from '../../BlueComponents';
import navigationStyle from '../../components/navigationStyle';
import loc from '../../loc';
import { ThemedCheckbox } from '../../components/ThemedCheckbox';

const SparkBackupNotice = () => {
  const [isAccepted, setIsAccepted] = useState(false);
  const { walletID } = useRoute().params;
  const { replace } = useNavigation();
  const { colors } = useTheme();
  const stylesHook = StyleSheet.create({
    flex: {
      backgroundColor: colors.elevated,
    },
    text: {
      color: colors.foregroundColor,
    },
  });

  return (
    <SafeBlueArea style={stylesHook.flex}>
      <ScrollView contentContainerStyle={styles.scrollableContainer} testID="SparkBackupNoticeScrollView">
        <View style={styles.content}>
          <Text style={[styles.title, stylesHook.text]}>{loc.wallets.lightning_spark_backup_notice_title}</Text>
          <Text style={[styles.text, stylesHook.text]}>{loc.wallets.lightning_spark_backup_notice_this_app}</Text>
          <Text style={[styles.text, stylesHook.text]}>{loc.wallets.lightning_spark_backup_notice_other_app}</Text>
        </View>
        <View style={styles.bottomContainer}>
          <ThemedCheckbox text={loc.wallets.lightning_spark_backup_notice_confirm} onChanged={setIsAccepted} />
          <View style={styles.bottom}>
            <BlueButton
              testID="SparkBackupNoticeContinue"
              onPress={() => replace('WalletExport', { walletID, noticeAccepted: true })}
              disabled={!isAccepted}
              title={loc._.continue}
            />
          </View>
        </View>
      </ScrollView>
    </SafeBlueArea>
  );
};

SparkBackupNotice.navigationOptions = navigationStyle(
  {
    closeButton: true,
    headerBackVisible: false,
  },
  opts => ({ ...opts, title: loc.wallets.export_title }),
);

const styles = StyleSheet.create({
  scrollableContainer: {
    flexGrow: 1,
    flexShrink: 0,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 20,
  },
  title: {
    fontWeight: '700',
    fontSize: 20,
    marginBottom: 16,
    writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr',
  },
  text: {
    fontSize: 16,
    lineHeight: 22,
    marginBottom: 16,
    writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr',
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
});

export default SparkBackupNotice;
