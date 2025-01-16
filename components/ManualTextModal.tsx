import React, { useState } from 'react';
import BottomModal from './BottomModal';
import { StyleSheet, TextInput, View, Keyboard } from 'react-native';
import { useTheme } from '@react-navigation/native';
import { BlueButton, BlueDismissKeyboardInputAccessory, BlueSpacing10, BlueSpacing20, BlueText, SecondButton } from '../BlueComponents';
import loc from '../loc';
import { Icon } from 'react-native-elements';

interface ManualTextModalProps {
  title: string;
  isVisible: boolean;
  onMessageAccepted: (text: string) => void;
  validateMessage: (message: string) => boolean;
  onClose: () => void;
}

export const ManualTextModal: React.FC<ManualTextModalProps> = ({ title, isVisible, onMessageAccepted, validateMessage = () => true, onClose }) => {
  const [text, setText] = useState('');
  const { colors } = useTheme();

  const stylesHooks = StyleSheet.create({
    textdesc: {
      color: colors.alternativeTextColor,
    },
    modalContainer: {
      backgroundColor: colors.elevated,
    },
    inputContainer: {
      borderColor: colors.formBorder,
      borderBottomColor: colors.formBorder,
      backgroundColor: colors.inputBackgroundColor,
    },
    input: {
      color: colors.foregroundColor,
    },
  });

  const handleAccept = async () => {
    Keyboard.dismiss();
    await new Promise(resolve => setTimeout(resolve, 300));

    if (validateMessage(text)) onMessageAccepted(text);
    setText('');
    onClose();
  };

  return (
    <>
      <BottomModal isVisible={isVisible} onClose={onClose} avoidKeyboard>
        <View style={[styles.modalContainer, stylesHooks.modalContainer]}>
          <View style={[styles.contentContainer]}>
            <View style={styles.headerContainer}>
              <View style={{ paddingVertical: 15, alignItems: 'center' }}>
                <Icon 
                  name="close" 
                  type="material"
                  size={28}
                  onPress={onClose}
                  color={colors.text}
                />
              </View>
              <View style={{ paddingVertical: 10, alignItems: 'center' }}>
                <BlueText style={styles.title}>{title}</BlueText>
              </View>
              <View style={{ width: 30 }} />
            </View>
            <View style={[styles.inputContainer, stylesHooks.inputContainer]}>
              <TextInput
                placeholderTextColor="#65728A"
                value={text}
                onChangeText={setText}
                style={[styles.input, stylesHooks.input]}
                multiline
                textAlignVertical="top"
                inputAccessoryViewID={BlueDismissKeyboardInputAccessory.InputAccessoryViewID}
              />
            </View>
            <View style={styles.modalButtonContainer}>
              <BlueButton title={loc._.continue} onPress={handleAccept} />
              <BlueSpacing20 />
            </View>
          </View>
        </View>
      </BottomModal>
      <BlueDismissKeyboardInputAccessory onPress={handleAccept} />
    </>
  );
};

const styles = StyleSheet.create({
  textdesc: {
    fontWeight: '500',
    alignSelf: 'center',
    textAlign: 'center',
    marginBottom: 16,
  },
  textdescBold: {
    fontWeight: '700',
    alignSelf: 'center',
    textAlign: 'center',
  },
  modalContainer: {
    minHeight: 460,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderColor: 'rgba(0, 0, 0, 0.1)',
    paddingHorizontal: 20,
  },
  contentContainer: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontWeight: '500',
    alignSelf: 'center',
    textAlign: 'center',
    marginTop: 20,
    marginBottom: 20,
    fontSize: 16,
  },
  modalCardIconContainer: {
    padding: 8,
    marginBottom: 24,
  },
  boltcardLinkImage: {
    width: 1.3 * 50,
    height: 50,
  },
  modalButtonContainer: {
    width: '100%',
    marginVertical: 24,
  },
  inputContainer: {
    flexDirection: 'row',
    borderWidth: 1.0,
    borderBottomWidth: 0.5,
    alignItems: 'center',
    marginVertical: 8,
    borderRadius: 4,
    flexGrow: 1,
  },
  input: {
    flex: 1,
    flexGrow: 1,
    marginHorizontal: 8,
    fontSize: 14,
    padding: 2,
    height: '100%',
  },
  headerContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
});
