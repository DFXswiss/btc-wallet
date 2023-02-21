import React, { useState } from 'react';
import { I18nManager, Linking, StyleSheet, Text, View } from 'react-native';
import navigationStyle from '../../../components/navigationStyle';
import loc from '../../../loc';
import { useNavigation, useTheme } from '@react-navigation/native';
import { BlueButton, BlueButtonLink, SafeBlueArea } from '../../../BlueComponents';
import Config from 'react-native-config';
import { useSessionContext } from '../../../contexts/session.context';
import { Checkbox } from '../../../components/Checkbox';
import { ThemedCheckbox } from '../../../components/ThemedCheckbox';

const SignUp = () => {
  const { colors } = useTheme();
  const { signUp } = useSessionContext();
  const { goBack } = useNavigation();
  const [isAccepted, setIsAccepted] = useState(false);

  const stylesHook = StyleSheet.create({
    flex: {
      backgroundColor: colors.evelated,
    },
    text: {
      color: colors.text,
    },
  });

  const handleOnLinkPress = () => {
    if (Config.REACT_APP_TNC_URL) Linking.openURL(Config.REACT_APP_TNC_URL);
  };

  const handleOnSignUp = async () => {
    signUp().finally(goBack);
  };

  return (
    <SafeBlueArea style={stylesHook.flex}>
      <View style={styles.container}>
        <View style={styles.textContainer}>
          <Text style={[styles.text, stylesHook.text]}>{loc.signUp.text}</Text>
          <BlueButtonLink style={styles.link} title={loc.signUp.link} onPress={handleOnLinkPress} hasUnderline />
        </View>
        <View style={styles.buttonContainer}>
          <ThemedCheckbox text={loc.signUp.confirm} onChanged={setIsAccepted} />
          <View style={styles.button}>
            <BlueButton onPress={handleOnSignUp} title={loc.signUp.accept} disabled={!isAccepted} testID="AcceptSignUp" />
          </View>
        </View>
      </View>
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
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  text: {
    backgroundColor: 'transparent',
    fontSize: 19,
    writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr',
  },
  link: {
    padding: 16,
  },
  buttonContainer: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 16,
  },
  button: {
    alignContent: 'center',
    alignSelf: 'stretch',
    minHeight: 44,
    marginTop: 20,
  },
});

SignUp.navigationOptions = navigationStyle({}, opts => ({
  ...opts,
  headerTitle: loc.signUp.title,
  headerHideBackButton: true,
  gestureEnabled: false,
}));

export default SignUp;
