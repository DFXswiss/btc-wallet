import React from 'react';
import { View, Text, StyleSheet, I18nManager } from 'react-native';
import { useTheme } from '@react-navigation/native';
import PropTypes from 'prop-types';
import loc from '../../loc';
import { Icon } from 'react-native-elements';

const Secret = ({ secret }) => {
  const { colors } = useTheme();

  const stylesHook = StyleSheet.create({
    word: {
      backgroundColor: '#2D2B47',
    },
    wortText: {
      color: colors.labelText,
    },
    infoText: {
      color: colors.brandingColor,
    },
  });

  const renderSecret = () => {
    const component = [];
    for (const [index, word] of secret.split(/\s/).entries()) {
      const text = `${index + 1}. ${word}  `;
      component.push(
        <View style={[styles.word, stylesHook.word]} key={index}>
          <Text style={[styles.wortText, stylesHook.wortText]} textBreakStrategy="simple">
            {text}
          </Text>
        </View>,
      );
    }
    return component;
  };

  return (
    <>
      <View style={styles.infoContainer}>
        <Icon name="info-outline" type="material" color={colors.brandingColor} size={18} />
        <Text style={[styles.infoText, stylesHook.infoText]}>{loc.pleasebackup.info}</Text>
      </View>
      <View style={styles.list}>
        <View style={styles.secret}>{renderSecret()}</View>
      </View>
    </>
  );
};

Secret.propTypes = {
  secret: PropTypes.string.isRequired,
};

const styles = StyleSheet.create({
  word: {
    marginRight: 8,
    marginBottom: 8,
    paddingTop: 6,
    paddingBottom: 6,
    paddingLeft: 8,
    paddingRight: 8,
    borderRadius: 6,
    minWidth: '47%',
  },
  wortText: {
    textAlign: 'left',
    fontSize: 17,
  },
  list: {
    flexGrow: 2,
    paddingHorizontal: 16,
  },
  infoContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 243, 137, 0.9)',
    borderRadius: 8,
    marginHorizontal: 20,
    marginBottom: 15,
    padding: 7,
    paddingRight: 20,
  },
  infoText: {
    backgroundColor: 'transparent',
    fontSize: 14,
    marginHorizontal: 5,
    writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr',
  },
  secret: {
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: 14,
    flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row',
  },
});

export default Secret;
