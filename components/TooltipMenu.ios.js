import React, { forwardRef, useCallback, useMemo } from 'react';
import ContextMenu from 'react-native-context-menu-view';
import PropTypes from 'prop-types';
import { TouchableOpacity } from 'react-native';
import QRCodeComponent from './QRCodeComponent';

const mapAction = action => {
  const item = {
    title: action.text,
    systemIcon: action.icon?.iconValue,
    disabled: Boolean(action.disabled),
  };
  if (action.menuStateOn !== undefined) item.selected = Boolean(action.menuStateOn);
  return { item, id: action.id };
};

const buildMenu = actions => {
  const items = [];
  const ids = [];

  for (const entry of actions) {
    if (Array.isArray(entry)) {
      const inline = entry.map(mapAction);
      if (inline.length === 0) continue;
      items.push({
        title: '',
        inlineChildren: true,
        actions: inline.map(r => r.item),
      });
      ids.push({ children: inline.map(r => ({ id: r.id })) });
    } else {
      const r = mapAction(entry);
      items.push(r.item);
      ids.push({ id: r.id });
    }
  }

  return { items, ids };
};

const lookupId = (ids, indexPath) => {
  if (!indexPath || indexPath.length === 0) return undefined;
  let nodes = ids;
  let node;
  for (const i of indexPath) {
    if (!nodes || i < 0 || i >= nodes.length) return undefined;
    node = nodes[i];
    nodes = node.children;
  }
  return node?.id;
};

const ToolTipMenu = (props, ref) => {
  const { items, ids } = useMemo(() => buildMenu(props.actions), [props.actions]);

  const handlePress = useCallback(
    ({ nativeEvent }) => {
      const path = nativeEvent.indexPath?.length ? nativeEvent.indexPath : typeof nativeEvent.index === 'number' ? [nativeEvent.index] : [];
      const id = lookupId(ids, path);
      if (id !== undefined) props.onPressMenuItem(id);
    },
    [ids, props],
  );

  const isButton = !!props.isButton;
  const isMenuPrimaryAction = !!props.isMenuPrimaryAction;
  const previewQRCode = props.previewQRCode ?? false;
  const previewValue = props.previewValue;
  const disabled = props.disabled ?? false;
  const buttonStyle = props.buttonStyle;

  if (disabled || items.length === 0) return props.children ?? null;

  // dropdownMenuMode: tap-to-open (matches old isMenuPrimaryAction behavior).
  // Without it, default is long-press.
  const menu = (
    <ContextMenu
      ref={ref}
      title={props.title ?? ''}
      actions={items}
      onPress={handlePress}
      dropdownMenuMode={isMenuPrimaryAction}
      previewBackgroundColor="transparent"
      preview={previewQRCode ? <QRCodeComponent value={previewValue} isMenuAvailable={false} /> : undefined}
      style={isButton ? buttonStyle : undefined}
    >
      {props.onPress ? (
        <TouchableOpacity accessibilityRole="button" onPress={props.onPress}>
          {props.children}
        </TouchableOpacity>
      ) : (
        props.children
      )}
    </ContextMenu>
  );

  return menu;
};

export default forwardRef(ToolTipMenu);
ToolTipMenu.propTypes = {
  actions: PropTypes.array.isRequired,
  title: PropTypes.string,
  children: PropTypes.node.isRequired,
  onPressMenuItem: PropTypes.func.isRequired,
  isMenuPrimaryAction: PropTypes.bool,
  isButton: PropTypes.bool,
  previewQRCode: PropTypes.bool,
  onPress: PropTypes.func,
  previewValue: PropTypes.string,
  disabled: PropTypes.bool,
};
