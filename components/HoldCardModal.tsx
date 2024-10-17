import React from 'react';
import BottomModal from './BottomModal';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Icon, Image, Text } from 'react-native-elements';
import { useTheme } from '@react-navigation/native';
import { SecondButton } from '../BlueComponents';
import loc from '../loc';

interface HoldCardModalProps {
  message?: string;
  isHoldCardModalVisible: boolean;
  onCancelHoldCard: () => void;
  isSuccess?: boolean;
}

export const HoldCardModal: React.FC<HoldCardModalProps> = ({ message, isHoldCardModalVisible, isSuccess = false, onCancelHoldCard }) => {
  const { colors } = useTheme();
  const stylesHooks = StyleSheet.create({
    textdesc: {
      color: colors.alternativeTextColor,
    },
    modalContainer: {
      backgroundColor: colors.elevated,
    },
  });
  return (
    <BottomModal isVisible={isHoldCardModalVisible} onClose={() => {}}>
      <View style={[styles.modalContainer, stylesHooks.modalContainer]}>
        {isSuccess ? (
          <View style={styles.successContainer}>
            <View>
              <Icon name="check-circle-outline" size={70} color={colors.alternativeTextColor} />
              <Text style={[styles.title, styles.textdescBold, stylesHooks.textdesc]}>{loc.boltcard.keys_written}</Text>
            </View>
          </View>
        ) : (
          <View style={[styles.contentContainer]}>
            <View style={{ alignItems: 'center' }}>
              <View style={styles.modalCardIconContainer}>
                <Image source={require('../img/pay-card-link.png')} style={styles.boltcardLinkImage} />
              </View>
              {message ? (
                <Text style={[styles.title, styles.textdescBold, stylesHooks.textdesc]}>{message}</Text>
              ) : (
                <>
                  <Text style={[styles.title, styles.textdescBold, stylesHooks.textdesc]}>{loc.boltcard.hold_card}</Text>
                  <ActivityIndicator color={colors.foregroundColor} />
                </>
              )}
            </View>
            <View style={styles.modalButtonContainer}>
              <SecondButton title="Cancel" onPress={onCancelHoldCard} />
            </View>
          </View>
        )}
      </View>
    </BottomModal>
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
    minHeight: 360,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderColor: 'rgba(0, 0, 0, 0.1)',
    padding: 24,
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
    marginTop: 24,
  },
  successContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
