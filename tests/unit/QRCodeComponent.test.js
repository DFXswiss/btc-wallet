import React from 'react';
import { Platform } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import Share from 'react-native-share';
import loc from '../../loc';

const mockQrCodeState = {
  dataUrl: 'qr-payload',
  latestProps: null,
};

const mockMenuState = {
  latestActions: [],
};

const mockCreateToolTipMenu = () => {
  const RN = require('react');
  const PropTypes = require('prop-types');
  const { View, TouchableOpacity } = require('react-native');
  function ToolTipMenu({ actions, onPressMenuItem, children }) {
    mockMenuState.latestActions = actions || [];
    return RN.createElement(
      View,
      { testID: 'ToolTipMenu' },
      (actions || []).map(action =>
        RN.createElement(TouchableOpacity, {
          key: action.id,
          testID: `menu-${action.id}`,
          accessibilityRole: 'button',
          onPress: () => onPressMenuItem(action.id),
        }),
      ),
      RN.createElement(TouchableOpacity, {
        testID: 'menu-unknown',
        accessibilityRole: 'button',
        onPress: () => onPressMenuItem('unknown'),
      }),
      children,
    );
  }
  ToolTipMenu.propTypes = {
    actions: PropTypes.array,
    onPressMenuItem: PropTypes.func,
    children: PropTypes.node,
  };
  return { __esModule: true, default: ToolTipMenu };
};

jest.mock('../../components/TooltipMenu', () => mockCreateToolTipMenu());
jest.mock('../../components/TooltipMenu.ios', () => mockCreateToolTipMenu());
jest.mock('../../components/TooltipMenu.android', () => mockCreateToolTipMenu());

jest.mock('react-native-qrcode-svg', () => {
  const RN = require('react');
  function QRCode(props) {
    mockQrCodeState.latestProps = props;
    if (typeof props.getRef === 'function') {
      props.getRef({
        toDataURL(cb) {
          cb(mockQrCodeState.dataUrl);
        },
      });
    }
    return RN.createElement('QRCode', { testID: 'QRCodeSvg' });
  }
  return { __esModule: true, default: QRCode };
});

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useTheme: () => ({
      colors: {
        brandingColor: '#ffffff',
      },
    }),
  };
});

const QRCodeComponent = require('../../components/QRCodeComponent').default;

const VALUE = 'bitcoin:bc1qexample';

beforeEach(() => {
  mockQrCodeState.dataUrl = 'qr-payload';
  mockQrCodeState.latestProps = null;
  mockMenuState.latestActions = [];
  Share.open.mockReset();
  Share.open.mockResolvedValue({ success: true });
  Clipboard.setImage.mockClear();
});

describe('QRCodeComponent', () => {
  it('renders the QR value with default size, logo, ecl and branding colour', () => {
    const screen = render(<QRCodeComponent value={VALUE} />);

    expect(screen.getByTestId('BitcoinAddressQRCodeContainer')).toBeTruthy();
    expect(screen.getByTestId('QRCodeSvg')).toBeTruthy();
    expect(mockQrCodeState.latestProps.value).toBe(VALUE);
    expect(mockQrCodeState.latestProps.size).toBe(300);
    expect(mockQrCodeState.latestProps.logoSize).toBe(90);
    expect(mockQrCodeState.latestProps.ecl).toBe('H');
    expect(mockQrCodeState.latestProps.color).toBe('#000000');
    expect(mockQrCodeState.latestProps.backgroundColor).toBe('#FFFFFF');
    expect(mockQrCodeState.latestProps.logoBackgroundColor).toBe('#ffffff');
    expect(mockQrCodeState.latestProps.logo).toBeTruthy();
  });

  it('omits the logo when isLogoRendered is false', () => {
    render(<QRCodeComponent value={VALUE} isLogoRendered={false} />);

    expect(mockQrCodeState.latestProps.logo).toBeUndefined();
  });

  it('forwards a custom size, logoSize and ecl when they are provided', () => {
    render(<QRCodeComponent value={VALUE} isLogoRendered size={120} logoSize={40} ecl="L" />);

    expect(mockQrCodeState.latestProps.size).toBe(120);
    expect(mockQrCodeState.latestProps.logoSize).toBe(40);
    expect(mockQrCodeState.latestProps.ecl).toBe('L');
    expect(mockQrCodeState.latestProps.logo).toBeTruthy();
  });

  it('invokes the provided onError callback when the QR renderer reports an error', () => {
    const onError = jest.fn();
    render(<QRCodeComponent value={VALUE} onError={onError} />);

    expect(mockQrCodeState.latestProps.onError).toBe(onError);
    mockQrCodeState.latestProps.onError();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('uses a no-op onError when none is provided so the QR renderer can still call it', () => {
    render(<QRCodeComponent value={VALUE} />);

    expect(typeof mockQrCodeState.latestProps.onError).toBe('function');
    expect(() => mockQrCodeState.latestProps.onError()).not.toThrow();
  });

  it('wraps the QR code in the menu when isMenuAvailable is true', () => {
    const screen = render(<QRCodeComponent value={VALUE} isMenuAvailable />);

    expect(screen.getByTestId('ToolTipMenu')).toBeTruthy();
    expect(screen.getByTestId('QRCodeSvg')).toBeTruthy();
  });

  it('renders the QR code without the menu when isMenuAvailable is false', () => {
    const screen = render(<QRCodeComponent value={VALUE} isMenuAvailable={false} />);

    expect(screen.queryByTestId('ToolTipMenu')).toBeNull();
    expect(screen.getByTestId('QRCodeSvg')).toBeTruthy();
  });

  it('offers Copy and Share on iOS with the loc labels and system icons', () => {
    const previousOS = Platform.OS;
    Platform.OS = 'ios';
    try {
      render(<QRCodeComponent value={VALUE} />);

      expect(mockMenuState.latestActions).toEqual([
        {
          id: 'copy',
          text: loc.transactions.details_copy,
          icon: { iconType: 'SYSTEM', iconValue: 'doc.on.doc' },
        },
        {
          id: 'share',
          text: loc.receive.details_share,
          icon: { iconType: 'SYSTEM', iconValue: 'square.and.arrow.up' },
        },
      ]);
    } finally {
      Platform.OS = previousOS;
    }
  });

  it('offers Copy and Share on macOS', () => {
    const previousOS = Platform.OS;
    Platform.OS = 'macos';
    try {
      render(<QRCodeComponent value={VALUE} />);

      expect(mockMenuState.latestActions.map(action => action.id)).toEqual(['copy', 'share']);
    } finally {
      Platform.OS = previousOS;
    }
  });

  it('offers only Share on Android', () => {
    const previousOS = Platform.OS;
    Platform.OS = 'android';
    try {
      const screen = render(<QRCodeComponent value={VALUE} />);

      expect(mockMenuState.latestActions.map(action => action.id)).toEqual(['share']);
      expect(screen.queryByTestId('menu-copy')).toBeNull();
      expect(screen.getByTestId('menu-share')).toBeTruthy();
    } finally {
      Platform.OS = previousOS;
    }
  });

  it('shares the QR image as a base64 data URL with line breaks stripped', async () => {
    mockQrCodeState.dataUrl = 'aa\nbb\r\ncc\rdd';
    const screen = render(<QRCodeComponent value={VALUE} />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('menu-share'));
    });

    expect(Share.open).toHaveBeenCalledWith({ url: 'data:image/png;base64,aabbccdd' });
  });

  it('shares the QR image unchanged when the payload has no line breaks', async () => {
    mockQrCodeState.dataUrl = 'plainbase64';
    const screen = render(<QRCodeComponent value={VALUE} />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('menu-share'));
    });

    expect(Share.open).toHaveBeenCalledWith({ url: 'data:image/png;base64,plainbase64' });
  });

  it('swallows a rejected Share.open so a cancelled share does not throw', async () => {
    Share.open.mockRejectedValueOnce(new Error('user cancelled'));
    const screen = render(<QRCodeComponent value={VALUE} />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('menu-share'));
    });

    expect(Share.open).toHaveBeenCalledTimes(1);
  });

  it('copies the QR image by passing Clipboard.setImage to toDataURL', () => {
    const previousOS = Platform.OS;
    Platform.OS = 'ios';
    try {
      const screen = render(<QRCodeComponent value={VALUE} />);
      fireEvent.press(screen.getByTestId('menu-copy'));
      expect(Clipboard.setImage).toHaveBeenCalledWith('qr-payload');
    } finally {
      Platform.OS = previousOS;
    }
  });

  it('does not share or copy when the menu id is neither share nor copy', () => {
    const screen = render(<QRCodeComponent value={VALUE} />);
    fireEvent.press(screen.getByTestId('menu-unknown'));
    expect(Share.open).not.toHaveBeenCalled();
    expect(Clipboard.setImage).not.toHaveBeenCalled();
  });
});
