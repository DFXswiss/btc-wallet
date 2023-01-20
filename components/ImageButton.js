import React from 'react';
import { Image, StyleSheet, TouchableOpacity } from 'react-native';
import PropTypes from 'prop-types';

ImageButton.propTypes = {
  source: PropTypes.number,
};

export function ImageButton(props) {
  const styles = StyleSheet.create({
    button: {
      aspectRatio: 1,
      flex: 2,
    },
    image: {
      height: '100%',
      resizeMode: 'contain',
      width: '100%',
    },
  });

  return (
    <TouchableOpacity style={styles.button} {...props}>
      <Image source={props.source} style={styles.image} />
    </TouchableOpacity>
  );
}
