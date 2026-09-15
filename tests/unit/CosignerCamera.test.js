import React from 'react';
import { render } from '@testing-library/react-native';
import { CosignerCamera } from '../../screen/wallets/CosignerCamera';

jest.mock('react-native-camera-kit-no-google', () => {
  const react = require('react');
  const { View } = require('react-native');
  return { Camera: props => react.createElement(View, { testID: 'cosigner-camera', ...props }) };
});

// PR #200 gated the cosigner scanner's camera on useIsFocused so the session is
// released once the user navigates away from add-multisig step 2.
describe('CosignerCamera focus gating (PR #200)', () => {
  it('renders the camera while the screen is focused', () => {
    const screen = render(<CosignerCamera isFocused scanBarcode onReadCode={jest.fn()} />);
    expect(screen.queryByTestId('cosigner-camera')).toBeTruthy();
  });

  it('renders nothing (releases the camera) when the screen is not focused', () => {
    const screen = render(<CosignerCamera isFocused={false} scanBarcode onReadCode={jest.fn()} />);
    expect(screen.queryByTestId('cosigner-camera')).toBeNull();
  });
});
