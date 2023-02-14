import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Icon } from 'react-native-elements';

interface CheckboxProps {
  initialValue?: boolean;
  text: string;
  onChanged: (isClicked: boolean) => void;
}

export function Checkbox({ text, onChanged, initialValue = false }: CheckboxProps) {
  const [isClicked, setIsClicked] = useState(initialValue);
  const styles = StyleSheet.create({
    container: {
      flexDirection: 'row',
    },
    text: {
      color: '#FFFFFF',
      fontSize: 14,
      flexGrow: 1,
      paddingLeft: 8,
    },
  });

  useEffect(() => {
    onChanged(isClicked);
  }, [isClicked]);

  return (
    <TouchableOpacity style={styles.container} onPress={() => setIsClicked(!isClicked)}>
      <Icon name={isClicked ? 'checkbox-outline' : 'checkbox-blank-outline'} type="material-community" size={20} color={'#F5516C'} />
      <Text style={styles.text}>{text}</Text>
    </TouchableOpacity>
  );
}
