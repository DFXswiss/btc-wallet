import React from 'react';
import { View, StyleSheet } from 'react-native';

export const DisabledOverlay = ({ disabled, children }: { disabled: boolean; children: React.ReactNode }) => {
  return (
    <View style={{ position: 'relative' }}>
      {children}
      {disabled && <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(128,128,128,0.4)', borderRadius: 5 }} pointerEvents="none" />}
    </View>
  );
};