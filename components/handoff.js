import React, { useContext } from 'react';
import Handoff from 'react-native-handoff';
import { BlueStorageContext } from '../blue_modules/storage-context';
import PropTypes from 'prop-types';

const HandoffComponent = props => {
  const { isHandOffUseEnabled } = useContext(BlueStorageContext);

  return isHandOffUseEnabled ? <Handoff {...props} /> : null;
};
export default HandoffComponent;

HandoffComponent.propTypes = {
  url: PropTypes.string,
};

HandoffComponent.activityTypes = {
  ReceiveOnchain: 'com.defichain.app.dfx.bitcoin.receiveonchain',
  Xpub: 'com.defichain.app.dfx.bitcoin.xpub',
  ViewInBlockExplorer: 'com.defichain.app.dfx.bitcoin.blockexplorer',
};
