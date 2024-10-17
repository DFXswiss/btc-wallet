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
  const { 
    ldsDEV, 
    setLdsDEVAsyncStorage, 
    isPosMode, 
    setIsPosModeAsyncStorage, 
    isDfxPos, 
    setIsDfxPosAsyncStorage,
    isDfxSwap,
    setIsDfxSwapAsyncStorage
  } = useContext(BlueStorageContext);
  const [isLoading, setIsLoading] = useState(false);
  const { colors } = useTheme();

  const stylesWithThemeHook = {
    root: {
      backgroundColor: colors.background,
    },
  };

  const handlePosModeChange = (value: boolean) => {
    setIsPosModeAsyncStorage(value);
    if (value) {
      setIsDfxPosAsyncStorage(false);
    }
  };

  const handleDfxPosChange = (value: boolean) => {
    setIsDfxPosAsyncStorage(value);
    if (value) {
      setIsPosModeAsyncStorage(false);
    }
  };

  return isLoading ? (
    <BlueLoading />
  ) : (
    <ScrollView style={[styles.root, stylesWithThemeHook.root]}>
      <BlueListItem
        // @ts-ignore: Fix later
        Component={Pressable}
        title="LDS DEV API"
        switch={{ onValueChange: setLdsDEVAsyncStorage, value: ldsDEV }}
      />
      <BlueCard>
        <BlueText>Requests to LDS go to https://dev.lightning.space/v1 instead of production</BlueText>
      </BlueCard>
      <BlueListItem
        // @ts-ignore: Fix later
        Component={Pressable}
        title="POS mode"
        switch={{ onValueChange: handlePosModeChange, value: isPosMode }}
      />
      <BlueListItem
        // @ts-ignore: Fix later
        Component={Pressable}
        title="DFX Point of Sale"
        switch={{ onValueChange: handleDfxPosChange, value: isDfxPos }}
      />
      <BlueListItem
        // @ts-ignore: Fix later
        Component={Pressable}
        title="DFX Swap"
        switch={{ onValueChange: setIsDfxSwapAsyncStorage, value: isDfxSwap }}
      />
    </ScrollView>
  );
};

// @ts-ignore: Fix later
FeatureFlags.navigationOptions = navigationStyle({}, opts => ({ ...opts, title: 'Feature flags' }));

export default FeatureFlags;
