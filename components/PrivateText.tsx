import React, { useContext } from 'react';
import { BlueStorageContext } from '../blue_modules/storage-context';

export const PrivateText = ({ children }: { children: React.ReactNode }) => {
  const { hideBalance } = useContext(BlueStorageContext);
  return hideBalance ? <>*****</> : children;
};
