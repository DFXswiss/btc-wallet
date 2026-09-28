import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { Platform, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { useTheme } from '@react-navigation/native';

import { BlueButton, BlueText } from '../BlueComponents';
import loc from '../loc';

/**
 * Invisible button in the bottom left corner of a QR scanner: six taps open a text field whose content is handed to
 * `onScan` as if it had been scanned. End-to-end tests use it to feed QR contents without a camera.
 */
export const QrScanBackdoor = ({ onScan }) => {
  const { colors } = useTheme();
  const [pressed, setPressed] = useState(0);
  const [text, setText] = useState('');
  const [visible, setVisible] = useState(false);

  const onInvisiblePress = () => {
    setPressed(pressed + 1);
    if (pressed < 5) return;
    setPressed(0);
    setVisible(true);
  };

  const onOkPress = () => {
    setVisible(false);
    setText('');
    if (text) onScan(text);
  };

  return (
    <>
      {visible && (
        <View style={styles.inputWrapper}>
          <BlueText>Provide QR code contents manually:</BlueText>
          <TextInput
            testID="scanQrBackdoorInput"
            multiline
            underlineColorAndroid="transparent"
            style={[
              styles.input,
              { borderColor: colors.formBorder, backgroundColor: colors.inputBackgroundColor, color: colors.foregroundColor },
            ]}
            autoCorrect={false}
            autoCapitalize="none"
            spellCheck={false}
            selectTextOnFocus={false}
            keyboardType={Platform.OS === 'android' ? 'visible-password' : 'default'}
            value={text}
            onChangeText={setText}
          />
          <BlueButton title="OK" testID="scanQrBackdoorOkButton" onPress={onOkPress} />
        </View>
      )}
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={loc._.qr_custom_input_button}
        testID="ScanQrBackdoorButton"
        style={styles.button}
        onPress={onInvisiblePress}
      />
    </>
  );
};

QrScanBackdoor.propTypes = {
  onScan: PropTypes.func.isRequired,
};

const styles = StyleSheet.create({
  button: {
    width: 40,
    height: 40,
    backgroundColor: 'rgba(0,0,0,0.1)',
    position: 'absolute',
    left: 0,
    bottom: 0,
  },
  inputWrapper: { position: 'absolute', left: '5%', top: '0%', width: '90%', height: '70%', backgroundColor: 'white' },
  input: {
    height: '50%',
    marginTop: 5,
    marginHorizontal: 20,
    borderWidth: 1,
    borderRadius: 4,
    textAlignVertical: 'top',
  },
});
