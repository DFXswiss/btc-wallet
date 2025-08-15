import '@react-navigation/native';

declare module '@react-navigation/native' {
  export interface Theme {
    dark: boolean;
    colors: {
      primary: string;
      background: string;
      card: string;
      text: string;
      border: string;
      notification: string;
      // Custom colors
      brandingColor: string;
      customHeader: string;
      foregroundColor: string;
      borderTopColor: string;
      buttonBackgroundColor: string;
      buttonTextColor: string;
      buttonAlternativeTextColor: string;
      buttonDisabledBackgroundColor: string;
      buttonDisabledTextColor: string;
      inputBorderColor: string;
      inputBackgroundColor: string;
      alternativeTextColor: string;
      alternativeTextColor2: string;
      buttonBlueBackgroundColor: string;
      incomingBackgroundColor: string;
      incomingForegroundColor: string;
      outgoingBackgroundColor: string;
      outgoingForegroundColor: string;
      successColor: string;
      failedColor: string;
      shadowColor: string;
      inverseForegroundColor: string;
      hdborderColor: string;
      hdbackgroundColor: string;
      lnborderColor: string;
      lnbackgroundColor: string;
      lightButton: string;
      ballReceive: string;
      ballOutgoing: string;
      lightBorder: string;
      ballOutgoingExpired: string;
      modal: string;
      formBorder: string;
      modalButton: string;
      darkGray: string;
      scanLabel: string;
      feeText: string;
      feeLabel: string;
      feeValue: string;
      feeActive: string;
      labelText: string;
      cta2: string;
      outputValue: string;
      elevated: string;
      mainColor: string;
      success: string;
      successCheck: string;
      msSuccessBG: string;
      msSuccessCheck: string;
      newBlue: string;
      redBG: string;
      redText: string;
      changeBackground: string;
      changeText: string;
      receiveBackground: string;
      receiveText: string;
      backupText: string;
    };
    closeImage?: any;
    scanImage?: any;
    barStyle?: string;
  }
}