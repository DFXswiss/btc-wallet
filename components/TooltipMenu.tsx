import React, { forwardRef, useCallback, useMemo } from 'react';
import { NativeSyntheticEvent, Platform, TouchableOpacity } from 'react-native';
import ContextMenu, { ContextMenuOnPressNativeEvent } from 'react-native-context-menu-view';

import { buildMenu, lookupId } from './TooltipMenu.helpers';
import { ToolTipMenuProps } from './types';

const ToolTipMenu = forwardRef<ContextMenu, ToolTipMenuProps>(
  (
    {
      actions,
      children,
      onPressMenuItem,
      title = '',
      isMenuPrimaryAction = false,
      isButton = false,
      buttonStyle,
      onPress,
      disabled = false,
    },
    ref,
  ) => {
    const platform = Platform.OS === 'android' ? 'android' : 'ios';
    const { items, ids } = useMemo(() => buildMenu(actions, platform), [actions, platform]);
    const handlePressMenuItem = useCallback(
      (e: NativeSyntheticEvent<ContextMenuOnPressNativeEvent>) => {
        const { indexPath, index } = e.nativeEvent;
        const path = indexPath?.length ? indexPath : typeof index === 'number' ? [index] : [];
        const id = lookupId(ids, path);
        if (id !== undefined) onPressMenuItem(id);
      },
      [ids, onPressMenuItem],
    );

    if (disabled) return <>{children}</>;

    const content = onPress ? (
      <TouchableOpacity accessibilityRole="button" onPress={onPress}>
        {children}
      </TouchableOpacity>
    ) : (
      children
    );

    if (items.length === 0) return <>{content}</>;

    return (
      <ContextMenu
        ref={ref}
        title={title}
        actions={items}
        onPress={handlePressMenuItem}
        dropdownMenuMode={isMenuPrimaryAction}
        previewBackgroundColor="transparent"
        style={isButton ? buttonStyle : undefined}
      >
        {content}
      </ContextMenu>
    );
  },
);

export default ToolTipMenu;
