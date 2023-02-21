import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { CheckBox } from 'react-native-elements';

interface ThemedCheckboxProps {
  initialValue?: boolean;
  text: string;
  onChanged: (isClicked: boolean) => void;
}

export function ThemedCheckbox({ text, onChanged, initialValue = false }: ThemedCheckboxProps): JSX.Element {
  const [isClicked, setIsClicked] = useState(initialValue);
  const styles = StyleSheet.create({
    container: {
      backgroundColor: 'transparent',
      borderWidth: 0,
    },
    text: {
      color: '#FFFFFF',
      fontSize: 14,
      fontWeight: '400',
    },
  });

  useEffect(() => {
    onChanged(isClicked);
  }, [isClicked, onChanged]);

  return (
    <CheckBox
      title={text}
      checkedColor="#F5516C"
      checkedIcon="checkbox-outline"
      uncheckedColor="#F5516C"
      uncheckedIcon="checkbox-blank-outline"
      iconType="material-community"
      textStyle={styles.text}
      containerStyle={styles.container}
      checked={isClicked}
      onPress={() => setIsClicked(!isClicked)}
    />
  );
}
