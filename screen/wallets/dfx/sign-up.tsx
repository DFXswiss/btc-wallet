import React from 'react';
import { I18nManager, Linking, StyleSheet, Text, View } from 'react-native';
import navigationStyle from '../../../components/navigationStyle';
import loc from '../../../loc';
import { useNavigation, useTheme } from '@react-navigation/native';
import { BlueButton, BlueButtonLink } from '../../../BlueComponents';
import Config from 'react-native-config';
import { useSessionContext } from '../../../contexts/session.context';

const SignUp = () => {
  const { colors } = useTheme();
  const { signUp } = useSessionContext();
  const { goBack } = useNavigation();

  const styleHook = StyleSheet.create({
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
    <View style={styles.container}>
      <View style={styles.textContainer}>
        <Text style={[styles.text, styleHook.text]}>{loc.signUp.text}</Text>
        <BlueButtonLink style={styles.link} title={loc.signUp.link} onPress={handleOnLinkPress} />
      </View>
      <View style={styles.buttonContainer}>
        <View style={styles.button}>
          <BlueButton onPress={handleOnSignUp} title={loc.signUp.accept} testID="AcceptSignUp" />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 10,
  },
  textContainer: {
    flex: 1,
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
    marginVertical: 4,
    marginHorizontal: 4,
    alignContent: 'center',
    alignSelf: 'stretch',
    minHeight: 44,
  },
});

SignUp.navigationOptions = navigationStyle({}, opts => ({
  ...opts,
  headerTitle: loc.signUp.title,
  headerHideBackButton: true,
  gestureEnabled: false,
}));

export default SignUp;
