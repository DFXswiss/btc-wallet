import React, { createContext, PropsWithChildren, useContext, useEffect, useState } from 'react';
import { Asset } from '../definitions/asset';
import { useAsset } from '../hooks/asset.hook';

import { useAuthContext } from './auth.context';

interface AssetInterface {
  assets: Asset[];
  assetsLoading: boolean;
}

const AssetContext = createContext<AssetInterface>(undefined as any);

export function useAssetContext(): AssetInterface {
  return useContext(AssetContext);
}

export function AssetContextProvider(props: PropsWithChildren<any>): JSX.Element {
  const { isLoggedIn } = useAuthContext();
  const { getAssets } = useAsset();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState<boolean>(false);

  function updateAssets(assets: Asset[]) {
    setAssets(assets.filter(a => a.buyable || a.comingSoon).sort((a, b) => (a.sortOrder ?? 1) - (b.sortOrder ?? 1)));
  }

  useEffect(() => {
    if (!isLoggedIn) return;
    setAssetsLoading(true);
    getAssets()
      .then(updateAssets)
      .catch(console.error)
      .finally(() => setAssetsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn]);

  const context: AssetInterface = { assets, assetsLoading };

  return <AssetContext.Provider value={context}>{props.children}</AssetContext.Provider>;
}
