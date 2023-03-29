import React from 'react';
import { RouteProp, useRoute, useTheme } from '@react-navigation/native';
import { I18nManager, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeBlueArea } from '../../BlueComponents';
import { navigationStyleTx } from '../../components/navigationStyle';
import loc from '../../loc';

type SellRouteProps = RouteProp<
  {
    params: {
      amount: string;
      sellId: string;
    };
  },
  'params'
>;

const Sell = () => {
  const { colors } = useTheme();
  const { amount, sellId } = useRoute<SellRouteProps>().params;

  const stylesHook = StyleSheet.create({
    container: {
      backgroundColor: colors.elevated,
    },
    text: {
      color: colors.backupText,
    },
  });
  return (
    <SafeBlueArea style={stylesHook.container}>
      <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
        <Text style={[styles.subtext, stylesHook.text]}>Hello sell screen</Text>
        <Text style={[styles.subtext, stylesHook.text]}>Amount: {amount}</Text>
        <Text style={[styles.subtext, stylesHook.text]}>SellId: {sellId}</Text>
      </ScrollView>
    </SafeBlueArea>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
  },
  contentContainer: {
    flex: 1,
    alignItems: 'center',
  },
  subtext: {
    backgroundColor: 'transparent',
    fontSize: 14,
    writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr',
    textAlign: 'center',
    marginTop: 4,
  },
});

Sell.navigationOptions = navigationStyleTx({}, options => ({
  ...options,
  title: loc.sell.header,
}));

export default Sell;
