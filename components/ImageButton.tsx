import React from 'react';
import { Image, StyleSheet, TouchableOpacity, TouchableOpacityProps } from 'react-native';

interface ImageButtonProps extends TouchableOpacityProps {
  source: number;
  imageStyle?: any;
}

export function ImageButton(props: ImageButtonProps) {
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
      <Image source={props.source} style={[styles.image, props.imageStyle]} />
    </TouchableOpacity>
  );
}
