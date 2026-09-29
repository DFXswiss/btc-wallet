import React from 'react';
import fs from 'fs';
import path from 'path';
import { Platform, StyleSheet, Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

const mockContextMenuState = {
  props: null,
};

jest.mock('react-native-context-menu-view', () => {
  const RN = require('react');
  const PropTypes = require('prop-types');
  const { View } = require('react-native');
  function ContextMenu(props) {
    mockContextMenuState.props = props;
    return RN.createElement(View, { testID: 'ContextMenu' }, props.children);
  }
  ContextMenu.propTypes = {
    children: PropTypes.node,
  };
  return { __esModule: true, default: ContextMenu };
});

const ToolTipMenu = require('../../components/TooltipMenu').default;

const a = { id: 'a', text: 'Alpha', icon: { iconType: 'SYSTEM', iconValue: 'doc.on.doc' } };
const b = { id: 'b', text: 'Beta', icon: { iconType: 'SYSTEM', iconValue: 'link' } };
const c = { id: 'c', text: 'Gamma' };

const styles = StyleSheet.create({
  button: {
    padding: 4,
  },
});

const withPlatform = (os, fn) => {
  const previousOS = Platform.OS;
  Platform.OS = os;
  try {
    return fn();
  } finally {
    Platform.OS = previousOS;
  }
};

const child = <Text testID="child">Child</Text>;

beforeEach(() => {
  mockContextMenuState.props = null;
});

describe('ToolTipMenu', () => {
  it('flattens grouped Android actions in order and uses Android icons', () => {
    withPlatform('android', () => {
      render(
        <ToolTipMenu actions={[a, [b, c]]} onPressMenuItem={jest.fn()}>
          {child}
        </ToolTipMenu>,
      );

      const { actions } = mockContextMenuState.props;
      expect(actions.map(action => action.title)).toEqual(['Alpha', 'Beta', 'Gamma']);
      expect(actions[0].icon).toBe('doc.on.doc');
      expect(actions[0].systemIcon).toBeUndefined();
      expect(actions.some(action => action.inlineChildren === true)).toBe(false);
    });
  });

  it('uses the Android event index to select an action', () => {
    withPlatform('android', () => {
      const onPressMenuItem = jest.fn();
      render(
        <ToolTipMenu actions={[a, [b, c]]} onPressMenuItem={onPressMenuItem}>
          {child}
        </ToolTipMenu>,
      );

      mockContextMenuState.props.onPress({ nativeEvent: { index: 1, name: 'Beta' } });

      expect(onPressMenuItem).toHaveBeenCalledTimes(1);
      expect(onPressMenuItem).toHaveBeenCalledWith('b');
    });
  });

  it('ignores an out-of-range Android event index', () => {
    withPlatform('android', () => {
      const onPressMenuItem = jest.fn();
      render(
        <ToolTipMenu actions={[a, [b, c]]} onPressMenuItem={onPressMenuItem}>
          {child}
        </ToolTipMenu>,
      );

      mockContextMenuState.props.onPress({ nativeEvent: { index: 7 } });

      expect(onPressMenuItem).not.toHaveBeenCalled();
    });
  });

  it('uses the Android event index when action titles are duplicated', () => {
    withPlatform('android', () => {
      const onPressMenuItem = jest.fn();
      const copyA = { id: 'copy-a', text: 'Copy' };
      const copyB = { id: 'copy-b', text: 'Copy' };
      render(
        <ToolTipMenu actions={[copyA, copyB]} onPressMenuItem={onPressMenuItem}>
          {child}
        </ToolTipMenu>,
      );

      mockContextMenuState.props.onPress({ nativeEvent: { index: 1, name: 'Copy' } });

      expect(onPressMenuItem).toHaveBeenCalledWith('copy-b');
    });
  });

  it('preserves grouped iOS actions and resolves an index path', () => {
    withPlatform('ios', () => {
      const onPressMenuItem = jest.fn();
      render(
        <ToolTipMenu actions={[a, [b, c]]} onPressMenuItem={onPressMenuItem}>
          {child}
        </ToolTipMenu>,
      );

      const { actions } = mockContextMenuState.props;
      expect(actions).toHaveLength(2);
      expect(actions[0].title).toBe('Alpha');
      expect(actions[0].systemIcon).toBe('doc.on.doc');
      expect(actions[1].inlineChildren).toBe(true);
      expect(actions[1].actions.map(action => action.title)).toEqual(['Beta', 'Gamma']);

      mockContextMenuState.props.onPress({ nativeEvent: { indexPath: [1, 0] } });

      expect(onPressMenuItem).toHaveBeenCalledWith('b');
    });
  });

  it('sets dropdown menu mode only for a primary menu action', () => {
    render(
      <ToolTipMenu actions={[a]} onPressMenuItem={jest.fn()} isMenuPrimaryAction>
        {child}
      </ToolTipMenu>,
    );
    expect(mockContextMenuState.props.dropdownMenuMode).toBe(true);

    render(
      <ToolTipMenu actions={[a]} onPressMenuItem={jest.fn()}>
        {child}
      </ToolTipMenu>,
    );
    expect(mockContextMenuState.props.dropdownMenuMode).toBe(false);
  });

  it('applies buttonStyle to the context menu only in button mode', () => {
    render(
      <ToolTipMenu actions={[a]} onPressMenuItem={jest.fn()} isButton buttonStyle={styles.button}>
        {child}
      </ToolTipMenu>,
    );
    expect(mockContextMenuState.props.style).toEqual(styles.button);

    render(
      <ToolTipMenu actions={[a]} onPressMenuItem={jest.fn()} buttonStyle={styles.button}>
        {child}
      </ToolTipMenu>,
    );
    expect(mockContextMenuState.props.style).toBeUndefined();
  });

  it('keeps the context menu and invokes onPress through a button', () => {
    const onPress = jest.fn();
    const screen = render(
      <ToolTipMenu actions={[a]} onPressMenuItem={jest.fn()} onPress={onPress}>
        {child}
      </ToolTipMenu>,
    );

    expect(screen.getByTestId('ContextMenu')).toBeTruthy();
    fireEvent.press(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders only the child when disabled', () => {
    const screen = render(
      <ToolTipMenu actions={[a]} onPressMenuItem={jest.fn()} onPress={jest.fn()} disabled>
        {child}
      </ToolTipMenu>,
    );

    expect(screen.getByTestId('child')).toBeTruthy();
    expect(screen.queryByTestId('ContextMenu')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders an onPress button without a context menu when actions are empty', () => {
    const onPress = jest.fn();
    const screen = render(
      <ToolTipMenu actions={[]} onPressMenuItem={jest.fn()} onPress={onPress}>
        {child}
      </ToolTipMenu>,
    );

    expect(screen.getByTestId('child')).toBeTruthy();
    expect(screen.queryByTestId('ContextMenu')).toBeNull();
    fireEvent.press(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders only the child when actions are empty and onPress is omitted', () => {
    const screen = render(
      <ToolTipMenu actions={[]} onPressMenuItem={jest.fn()}>
        {child}
      </ToolTipMenu>,
    );

    expect(screen.getByTestId('child')).toBeTruthy();
    expect(screen.queryByTestId('ContextMenu')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps platform-only variants absent so Jest resolves the shared implementation', () => {
    const platformOnlyPaths = [
      'components/TooltipMenu.android.js',
      'components/TooltipMenu.android.tsx',
      'components/TooltipMenu.ios.js',
      'components/TooltipMenu.ios.tsx',
      'blue_modules/showPopupMenu.android.ts',
    ];

    platformOnlyPaths.forEach(platformOnlyPath => {
      expect(fs.existsSync(path.join(__dirname, '..', '..', platformOnlyPath))).toBe(false);
    });
  });

  it('patches the context menu library for the installed version so a long-press cancels the JS touch', () => {
    const lockfilePath = path.join(__dirname, '..', '..', 'package-lock.json');
    const lockfile = JSON.parse(fs.readFileSync(lockfilePath, 'utf8'));
    const version = lockfile.packages['node_modules/react-native-context-menu-view'].version;
    const patchPath = path.join(__dirname, '..', '..', 'patches', `react-native-context-menu-view+${version}.patch`);

    expect(fs.existsSync(patchPath)).toBe(true);
    expect(fs.readFileSync(patchPath, 'utf8')).toContain('NativeGestureUtil.notifyNativeGestureStarted');
  });
});
