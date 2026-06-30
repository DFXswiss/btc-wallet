// @ts-ignore: Ignore
import type { Element } from 'react';
import { Text, TouchableNativeFeedback, TouchableWithoutFeedback, View, findNodeHandle, UIManager } from 'react-native';

// `UIManager.showPopupMenu` is a legacy Android-only API that is still present at
// runtime but missing from the current React Native type definitions. Declare its
// real signature so the call below is type-checked rather than suppressed.
declare module 'react-native' {
  interface UIManagerStatic {
    showPopupMenu(
      reactTag: number | null,
      items: string[],
      error: () => void,
      success: (eventName: 'dismissed' | 'itemSelected', selectedIndex?: number) => void,
    ): void;
  }
}

type PopupMenuItem = { id?: any; label: string };
type OnPopupMenuItemSelect = (selectedPopupMenuItem: PopupMenuItem) => void;
type PopupAnchor = Element<typeof Text | typeof TouchableNativeFeedback | typeof TouchableWithoutFeedback | typeof View>;
type PopupMenuOptions = { onCancel?: () => void };

function showPopupMenu(
  items: PopupMenuItem[],
  onSelect: OnPopupMenuItemSelect,
  anchor: PopupAnchor,
  { onCancel }: PopupMenuOptions = {},
): void {
  UIManager.showPopupMenu(
    // @ts-ignore: Ignore
    findNodeHandle(anchor),
    items.map(item => item.label),
    function () {
      if (onCancel) onCancel();
    },
    function (eventName: 'dismissed' | 'itemSelected', selectedIndex?: number) {
      // @ts-ignore: Ignore
      if (eventName === 'itemSelected') onSelect(items[selectedIndex]);
      else onCancel && onCancel();
    },
  );
}

export type { PopupMenuItem, OnPopupMenuItemSelect, PopupMenuOptions };
export default showPopupMenu;
