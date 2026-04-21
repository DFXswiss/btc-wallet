// No-op stub pending Phase 4 native-module replacement (switch to react-native-context-menu-view).
const React = require('react');
const { View } = require('react-native');

const passthrough = React.forwardRef(function PassThrough(props, ref) {
  const { children, style } = props;
  return React.createElement(View, { ref, style }, children);
});

exports.ContextMenuView = passthrough;
exports.ContextMenuButton = passthrough;
