import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import loc from '../../loc';

const mockReplace = jest.fn();
jest.mock('../../components/navigationStyle', () => (_options, format) => {
  return theme => deps => (format ? format(_options, { theme, ...deps }) : _options);
});
jest.mock('../../BlueComponents', () => {
  const ReactModule = require('react');
  const { Pressable, Text: RNText, View: RNView } = require('react-native');
  return {
    SafeBlueArea: ({ children }) => ReactModule.createElement(RNView, null, children),
    BlueButton: ({ title, onPress, disabled, testID }) =>
      ReactModule.createElement(
        Pressable,
        { testID, onPress, disabled, accessibilityState: { disabled } },
        ReactModule.createElement(RNText, null, title),
      ),
  };
});
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useRoute: () => ({ params: { walletID: 'spark-export' } }),
    useNavigation: () => ({ replace: mockReplace }),
    useTheme: () => require('../../components/themes').BlueDarkTheme,
  };
});

const SparkBackupNotice = require('../../screen/wallets/sparkBackupNotice').default;

beforeEach(() => {
  mockReplace.mockClear();
});

it('explains that the phrase is only for another app', () => {
  const screen = render(<SparkBackupNotice />);

  expect(screen.getByText(loc.wallets.lightning_spark_backup_notice_this_app)).toBeTruthy();
  expect(screen.getByText(loc.wallets.lightning_spark_backup_notice_other_app)).toBeTruthy();
});

it('opens the backup only after the user confirms', () => {
  const screen = render(<SparkBackupNotice />);

  fireEvent.press(screen.getByTestId('SparkBackupNoticeContinue'));
  expect(mockReplace).not.toHaveBeenCalled();

  fireEvent.press(screen.getByText(loc.wallets.lightning_spark_backup_notice_confirm));
  fireEvent.press(screen.getByTestId('SparkBackupNoticeContinue'));
  expect(mockReplace).toHaveBeenCalledWith('WalletExport', { walletID: 'spark-export', noticeAccepted: true });
});

it('uses the export title', () => {
  const options = SparkBackupNotice.navigationOptions({})({});

  expect(options.title).toBe(loc.wallets.export_title);
});
