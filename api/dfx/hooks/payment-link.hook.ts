import { useMemo } from 'react';
import { useApiAuth } from './api-auth.hook';

export enum PaymentStatus {
  PENDING = 'Pending',
  COMPLETED = 'Completed',
  EXPIRED = 'Expired',
  CANCELLED = 'Cancelled',
}

export interface PaymentLinksInterface {
  getPaymentLinkExternalId: (routeId: number) => string;
  getPaymentRoutes: (walletId: string) => Promise<any>;
  getPaymentLink: (walletId: string, routeId: number) => Promise<any>;
  createPaymentLink: (walletId: string, routeId: number) => Promise<any>;
  waitPayment: (walletId: string, externalPaymentId: string, controller?: AbortSignal) => Promise<any>;
  createPayment: (walletId: string, routeId: number, amount: number) => Promise<any>;
  cancelPayment: (walletId: string, routeId: number) => Promise<any>;
}

export function usePaymentLinks(): PaymentLinksInterface {
  const { call } = useApiAuth();

  function getPaymentLinkExternalId(routeId: number): string {
    return `BtcTaroPos_01_${routeId}`;
  }

  async function getPaymentRoutes(walletId: string): Promise<any> {
    return call<any>(walletId, { url: 'route', method: 'GET' });
  }

  async function getPaymentLink(walletId: string, routeId: number): Promise<any> {
    const externalLinkId = getPaymentLinkExternalId(routeId);
    return call<any>(walletId, { url: `paymentLink?externalLinkId=${externalLinkId}`, method: 'GET' });
  }

  async function createPaymentLink(walletId: string, routeId: number): Promise<any> {
    const externalId = getPaymentLinkExternalId(routeId);
    return call<any>(walletId, { url: 'paymentLink', method: 'POST', data: { routeId, externalId } });
  }

  async function waitPayment(walletId: string, externalPaymentId: string, signal?: AbortSignal): Promise<any> {
    return call<any>(walletId, { url: `paymentLink/payment/wait?externalPaymentId=${externalPaymentId}`, method: 'GET', signal });
  }

  async function createPayment(walletId: string, routeId: number, amount: number): Promise<any> {
    const paymentLinkExternalId = getPaymentLinkExternalId(routeId);
    const now = new Date();
    const externalId = `BtcTaroPayment_${now.getTime()}`;
    now.setHours(now.getHours() + 1);
    const expiryDate = now.toISOString();
    return call<any>(walletId, {
      url: `paymentLink/payment?externalLinkId=${paymentLinkExternalId}`,
      method: 'POST',
      data: { externalId, amount, expiryDate },
    });
  }

  async function cancelPayment(walletId: string, routeId: number): Promise<any> {
    const paymentLinkExternalId = getPaymentLinkExternalId(routeId);
    return call<any>(walletId, { url: `paymentLink/payment?externalLinkId=${paymentLinkExternalId}`, method: 'DELETE' });
  }

  return useMemo(
    () => ({ getPaymentLinkExternalId, getPaymentRoutes, getPaymentLink, createPaymentLink, waitPayment, createPayment, cancelPayment }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [call],
  );
}
