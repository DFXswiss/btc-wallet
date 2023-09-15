import { Sell, SellInfo, SellPaymentInfo, SellUrl } from '../definitions/sell';
import { useApi } from './api.hook';

export interface SellInterface {
  receiveFor: (info: SellPaymentInfo) => Promise<Sell>;
  getInfo: (id: number) => Promise<SellInfo>;
}

export function useSell(): SellInterface {
  const { call } = useApi();

  async function receiveFor(info: SellPaymentInfo): Promise<Sell> {
    return call<Sell>({ url: SellUrl.receive, method: 'PUT', data: info });
  }

  async function getInfo(id: number): Promise<SellInfo> {
    return call<SellInfo>({ url: SellUrl.get + '/' + id, method: 'GET' });
  }

  return { receiveFor, getInfo };
}
