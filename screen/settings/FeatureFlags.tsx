import React, { useContext, useState } from 'react';
import { ScrollView, Pressable, StyleSheet } from 'react-native';
import navigationStyle from '../../components/navigationStyle';
import { BlueLoading, BlueText, BlueListItem, BlueCard } from '../../BlueComponents';
import { useTheme } from '@react-navigation/native';
import { BlueStorageContext } from '../../blue_modules/storage-context';

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});

const FeatureFlags: React.FC = () => {
  const { ldsDEV, setLdsDEVAsyncStorage, isPayCardEnabled, setIsPayCardEnabledAsyncStorage } = useContext(BlueStorageContext);
  const [isLoading, setIsLoading] = useState(false);
  const { colors } = useTheme();

  const stylesWithThemeHook = {
    root: {
      backgroundColor: colors.background,
    },
  };

  return isLoading ? (
    <BlueLoading />
  ) : (
    <ScrollView style={[styles.root, stylesWithThemeHook.root]}>
      <BlueListItem
        // @ts-ignore: Fix later
        Component={Pressable}
        title="Pay Card area"
        switch={{ onValueChange: setIsPayCardEnabledAsyncStorage, value: isPayCardEnabled }}
      />
      <BlueCard>
        <BlueText>Access to Pay Card area: Use an NTAG424 as a debit card to make payments over the lightning network</BlueText>
      </BlueCard>
      <BlueListItem
        // @ts-ignore: Fix later
        Component={Pressable}
        title="LDS DEV API"
        switch={{ onValueChange: setLdsDEVAsyncStorage, value: ldsDEV }}
      />
      <BlueCard>
        <BlueText>Requests to LDS go to https://dev.lightning.space/v1 instead of production</BlueText>
      </BlueCard>
    </ScrollView>
  );
};

// @ts-ignore: Fix later
FeatureFlags.navigationOptions = navigationStyle({}, opts => ({ ...opts, title: 'Feature flags' }));

export default FeatureFlags;
