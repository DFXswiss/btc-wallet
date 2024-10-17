import { useMemo } from 'react';
import { useApiAuth } from './api-auth.hook';
import { SwapInfo, SwapUrl } from '../definitions/swap';

export interface SwapInterface {
  getInfo: (walletId: string, id: number) => Promise<SwapInfo>;
}

export function useSwap(): SwapInterface {
  const { call } = useApiAuth();

  async function getInfo(walletId: string, id: number): Promise<SwapInfo> {
    return call<SwapInfo>(walletId, { url: SwapUrl.get + '/' + id, method: 'GET' });
  }

  return useMemo(
    () => ({ getInfo }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [call],
  );
}
