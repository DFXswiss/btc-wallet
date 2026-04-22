import React, { useCallback } from 'react';
import PropTypes from 'prop-types';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, TouchableWithoutFeedback, View } from 'react-native';
import { BlueButton, BlueSpacing10 } from '../BlueComponents';
import loc from '../loc';
import { useTheme } from '@react-navigation/native';

// Bottom-sheet modal backed by React Native's built-in <Modal>. Historically
// this component wrapped `react-native-modal`, but that dependency was removed
// during the React Navigation v7 migration. The public API is preserved so no
// call sites had to change.

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-end',
  },
  content: {
    width: '100%',
  },
  hasDoneButton: {
    padding: 16,
    paddingBottom: 24,
  },
});

const BottomModal = ({
  isVisible = false,
  onBackButtonPress = undefined,
  onBackdropPress = undefined,
  onClose,
  doneButton = undefined,
  avoidKeyboard = false,
  allowBackdropPress = true,
  children,
  // Accept and ignore legacy `react-native-modal` props (windowHeight,
  // windowWidth, deviceHeight, deviceWidth, propagateSwipe, useNativeDriver*, …)
  // so we don't have to touch call sites.
  // eslint-disable-next-line no-unused-vars
  ...legacyProps
}) => {
  const handleBackRequest = onBackButtonPress ?? onClose;
  const handleBackdropPress = allowBackdropPress ? onBackdropPress ?? onClose : undefined;
  const { colors } = useTheme();

  const stylesHook = StyleSheet.create({
    hasDoneButton: {
      backgroundColor: colors.elevated,
    },
  });

  const handleRequestClose = useCallback(() => {
    if (handleBackRequest) handleBackRequest();
  }, [handleBackRequest]);

  const content = (
    <View style={styles.content}>
      {children}
      {doneButton ? (
        <View style={[styles.hasDoneButton, stylesHook.hasDoneButton]}>
          <BlueButton title={loc.send.input_done} onPress={onClose} />
          <BlueSpacing10 />
        </View>
      ) : null}
    </View>
  );

  return (
    <Modal
      visible={isVisible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={handleRequestClose}
      accessibilityViewIsModal
      supportedOrientations={['portrait', 'landscape']}
    >
      <TouchableWithoutFeedback onPress={handleBackdropPress} accessible={false}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback accessible={false}>
            {avoidKeyboard ? (
              <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>{content}</KeyboardAvoidingView>
            ) : (
              content
            )}
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

BottomModal.propTypes = {
  children: PropTypes.oneOfType([PropTypes.arrayOf(PropTypes.element), PropTypes.element]),
  isVisible: PropTypes.bool,
  onBackButtonPress: PropTypes.func,
  onBackdropPress: PropTypes.func,
  onClose: PropTypes.func,
  doneButton: PropTypes.bool,
  avoidKeyboard: PropTypes.bool,
  allowBackdropPress: PropTypes.bool,
};

export default BottomModal;
