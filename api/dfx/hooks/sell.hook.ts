import { useMemo } from 'react';
import { Sell, SellInfo, SellPaymentInfo, SellUrl } from '../definitions/sell';
import { useApiAuth } from './api-auth.hook';

export interface SellInterface {
  receiveFor: (walletId: string, info: SellPaymentInfo) => Promise<Sell>;
  getInfo: (walletId: string, id: number) => Promise<SellInfo>;
}

export function useSell(): SellInterface {
  const { call } = useApiAuth();

  async function receiveFor(walletId: string, info: SellPaymentInfo): Promise<Sell> {
    return call<Sell>(walletId, { url: SellUrl.receive, method: 'PUT', data: info });
  }

  async function getInfo(walletId: string, id: number): Promise<SellInfo> {
    return call<SellInfo>(walletId, { url: SellUrl.get + '/' + id, method: 'GET' });
  }

  return useMemo(
    () => ({ receiveFor, getInfo }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [call],
  );
}
