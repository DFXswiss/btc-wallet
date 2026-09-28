import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { CosignerCamera } from '../../screen/wallets/CosignerCamera';

jest.mock('react-native-camera-kit-no-google', () => {
  const react = require('react');
  const { View } = require('react-native');
  return { Camera: props => react.createElement(View, { testID: 'cosigner-camera', ...props }) };
});
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useTheme: () => require('../../components/themes').BlueDarkTheme,
}));

const enterThroughBackdoor = (screen, text) => {
  for (let tap = 0; tap < 6; tap++) fireEvent.press(screen.getByTestId('ScanQrBackdoorButton'));
  fireEvent.changeText(screen.getByTestId('scanQrBackdoorInput'), text);
  fireEvent.press(screen.getByTestId('scanQrBackdoorOkButton'));
};

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
    expect(screen.queryByTestId('ScanQrBackdoorButton')).toBeNull();
  });
});

describe('CosignerCamera scan backdoor', () => {
  it('opens only on the sixth tap and hands the text over like a scanned code', () => {
    const onReadCode = jest.fn();
    const screen = render(<CosignerCamera isFocused scanBarcode onReadCode={onReadCode} />);
    for (let tap = 0; tap < 5; tap++) fireEvent.press(screen.getByTestId('ScanQrBackdoorButton'));
    expect(screen.queryByTestId('scanQrBackdoorInput')).toBeNull();

    fireEvent.press(screen.getByTestId('ScanQrBackdoorButton'));
    fireEvent.changeText(screen.getByTestId('scanQrBackdoorInput'), '{"xfp":"00000000"}');
    fireEvent.press(screen.getByTestId('scanQrBackdoorOkButton'));

    expect(onReadCode).toHaveBeenCalledTimes(1);
    expect(onReadCode).toHaveBeenCalledWith({ nativeEvent: { codeStringValue: '{"xfp":"00000000"}' } });
    expect(screen.queryByTestId('scanQrBackdoorInput')).toBeNull();
  });

  it('ignores backdoor input while scanning is paused', () => {
    const onReadCode = jest.fn();
    const screen = render(<CosignerCamera isFocused scanBarcode={false} onReadCode={onReadCode} />);
    enterThroughBackdoor(screen, 'xpub');
    expect(onReadCode).not.toHaveBeenCalled();
  });

  it('does not hand over an empty input', () => {
    const onReadCode = jest.fn();
    const screen = render(<CosignerCamera isFocused scanBarcode onReadCode={onReadCode} />);
    enterThroughBackdoor(screen, '');
    expect(onReadCode).not.toHaveBeenCalled();
  });
});
