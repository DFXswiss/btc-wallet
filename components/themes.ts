import { DefaultTheme, DarkTheme, useTheme as useThemeBase } from '@react-navigation/native';
import { Appearance } from 'react-native';

export const BlueDefaultTheme = {
  ...DefaultTheme,
  closeImage: require('../img/close.png'),
  barStyle: 'dark-content',
  scanImage: require('../img/scan.png'),
  colors: {
    ...DefaultTheme.colors,
    brandingColor: '#ffffff',
    customHeader: '#ffffff',
    foregroundColor: '#0c2550',
    borderTopColor: 'rgba(0, 0, 0, 0.1)',
    buttonBackgroundColor: '#ccddf9',
    buttonTextColor: '#0c2550',
    buttonAlternativeTextColor: '#2f5fb3',
    buttonDisabledBackgroundColor: '#eef0f4',
    buttonDisabledTextColor: '#9aa0aa',
    inputBorderColor: '#d2d2d2',
    inputBackgroundColor: '#f5f5f5',
    alternativeTextColor: '#9aa0aa',
    alternativeTextColor2: '#0f5cc0',
    buttonBlueBackgroundColor: '#ccddf9',
    incomingBackgroundColor: '#d2f8d6',
    incomingForegroundColor: '#37c0a1',
    outgoingBackgroundColor: '#f8d2d2',
    outgoingForegroundColor: '#d0021b',
    successColor: '#37c0a1',
    failedColor: '#e73955',
    shadowColor: '#000000',
    inverseForegroundColor: '#ffffff',
    hdborderColor: '#68BBE1',
    hdbackgroundColor: '#ECF9FF',
    lnborderColor: '#FFB600',
    lnbackgroundColor: '#FFFAEF',
    background: '#FFFFFF',
    lightButton: '#eef0f4',
    ballReceive: '#d2f8d6',
    ballOutgoing: '#f8d2d2',
    lightBorder: '#ededed',
    ballOutgoingExpired: '#EEF0F4',
    modal: '#ffffff',
    formBorder: '#d2d2d2',
    modalButton: '#ccddf9',
    darkGray: '#9AA0AA',
    scanLabel: '#9AA0AA',
    feeText: '#81868e',
    feeLabel: '#d2f8d6',
    feeValue: '#37c0a1',
    feeActive: '#d2f8d6',
    labelText: '#81868e',
    cta2: '#062453',
    outputValue: '#13244D',
    elevated: '#ffffff',
    mainColor: '#CFDCF6',
    success: '#ccddf9',
    successCheck: '#0f5cc0',
    msSuccessBG: '#37c0a1',
    msSuccessCheck: '#ffffff',
    newBlue: '#007AFF',
    redBG: '#F8D2D2',
    redText: '#D0021B',
    changeBackground: '#FDF2DA',
    changeText: '#F38C47',
    receiveBackground: '#D1F9D6',
    receiveText: '#37C0A1',
    backupText: '#B8C4D8',
  },
};

export type Theme = typeof BlueDefaultTheme;

export const BlueDarkTheme: Theme = {
  ...DarkTheme,
  closeImage: require('../img/close-white.png'),
  scanImage: require('../img/scan-white.png'),
  barStyle: 'light-content',
  colors: {
    ...BlueDefaultTheme.colors,
    ...DarkTheme.colors,
    card: '#082948',
    background: '#072440',
    customHeader: '#000000',
    brandingColor: '#072440',
    borderTopColor: '#9aa0aa',
    foregroundColor: '#ffffff',
    buttonDisabledBackgroundColor: '#113759',
    buttonBackgroundColor: '#113759',
    buttonTextColor: '#ffffff',
    lightButton: 'rgba(255,255,255,.1)',
    buttonAlternativeTextColor: '#ffffff',
    alternativeTextColor: '#9AA5B8',
    alternativeTextColor2: '#F5516C',
    ballReceive: '#132F4a',
    ballOutgoing: '#132F4a',
    lightBorder: '#313030',
    ballOutgoingExpired: '#132F4a',
    modal: '#072440',
    formBorder: '#132F4a',
    inputBackgroundColor: '#132F4A',
    modalButton: '#F5516C',
    darkGray: '#113759',
    feeText: '#65728A',
    feeLabel: '#B8C4D8',
    feeValue: '#072440',
    feeActive: '#113759',
    cta2: '#ffffff',
    outputValue: '#ffffff',
    elevated: '#082948',
    mainColor: '#F5516C',
    success: '#132F4a',
    successCheck: '#F5516C',
    buttonBlueBackgroundColor: '#132F4a',
    scanLabel: '#123F69',
    labelText: '#ffffff',
    msSuccessBG: '#B8C4D8',
    msSuccessCheck: '#000000',
    newBlue: '#F5516C',
    redBG: '#5A4E4E',
    redText: '#FC6D6D',
    changeBackground: '#5A4E4E',
    changeText: '#F38C47',
    receiveBackground: '#1C4350',
    receiveText: '#37C0A1',
  },
};

// Casting theme value to get autocompletion
export const useTheme = (): Theme => useThemeBase() as Theme;

export class BlueCurrentTheme {
  static colors: Theme['colors'];
  static closeImage: Theme['closeImage'];
  static scanImage: Theme['scanImage'];

  static updateColorScheme(): void {
    const isColorSchemeDark = Appearance.getColorScheme() === 'dark';
    BlueCurrentTheme.colors = isColorSchemeDark ? BlueDarkTheme.colors : BlueDefaultTheme.colors;
    BlueCurrentTheme.closeImage = isColorSchemeDark ? BlueDarkTheme.closeImage : BlueDefaultTheme.closeImage;
    BlueCurrentTheme.scanImage = isColorSchemeDark ? BlueDarkTheme.scanImage : BlueDefaultTheme.scanImage;
  }
}

BlueCurrentTheme.updateColorScheme();
