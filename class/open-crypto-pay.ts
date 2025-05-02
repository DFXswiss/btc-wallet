import DeeplinkSchemaMatch from './deeplink-schema-match';
import * as bitcoin from 'bitcoinjs-lib';
const currency = require('../blue_modules/currency');

export class OpenCryptoPayPaymentLink {
  private constructor(private readonly response: any) {}

  static isOpenCryptoPayResponse(_response: any) {
    return _response.standard === 'OpenCryptoPay';
  }

  static getInstanceFromResponse(_response: any) {
    if (!OpenCryptoPayPaymentLink.isOpenCryptoPayResponse(_response)) {
      throw new Error('Invalid response');
    }
    return new OpenCryptoPayPaymentLink(_response);
  }

  isLightningPaymentRequestAvailable() {
    return this.response.transferAmounts?.some((t: any) => t.method === 'Lightning');
  }

  isOnChainPaymentRequestAvailable() {
    const onchainMethod = this.response.transferAmounts.find((t: any) => t.method === 'Bitcoin');
    return onchainMethod && onchainMethod.assets.some((a: any) => a.asset === 'BTC');
  }

  isPaymentRequestAvailable() {
    return this.isLightningPaymentRequestAvailable() || this.isOnChainPaymentRequestAvailable();
  }
  getLightningPaymentRequestDetails() {
    const { tag, callback, minSendable, metadata } = this.response;
    const amountSat = (minSendable / 1000).toString();
    const description = JSON.parse(metadata).find(([k]: any) => k === 'text/plain')?.[1] || '';
    const [lightningMethod] = this.response.transferAmounts.filter((t: any) => t.method === 'Lightning');

    return {
      tag,
      callback,
      metadata,
      amountSat,
      description,
      minFee: lightningMethod.minFee,
    };
  }

  getOnChainPaymentRequestDetails() {
    if (!this.isOnChainPaymentRequestAvailable()) {
      return null;
    }

    const [onchainMethods] = this.response.transferAmounts.filter((t: any) => t.method === 'Bitcoin');
    const [asset] = onchainMethods.assets.filter((a: any) => a.asset === 'BTC');

    return {
      amountSats: currency.btcToSatoshi(asset.amount),
      minFee: onchainMethods.minFee,
    };
  }

  async getOnchainRecipientDetails() {
    const {
      callback,
      quote: { id },
    } = this.response;
    const response = await fetch(`${callback}?quote=${id}&asset=BTC&method=Bitcoin`);
    const { uri, ...data } = await response.json();
    const parsedUri = DeeplinkSchemaMatch.bip21decode(uri);
    return { uri, ...data, ...parsedUri };
  }

  async commitOnchainPayment(tx: bitcoin.Transaction) {
    const {
      callback,
      quote: { id },
    } = this.response;
    const txUrl = callback.replace('/cb/', '/tx/');
    const commitUrl = `${txUrl}?hex=${tx.toHex()}&tx=${tx.getId()}&asset=BTC&method=Bitcoin&quote=${id}`;
    console.log('commitUrl', commitUrl);
    const response = await fetch(commitUrl);
    return response.json();
  }

  async getLightningRecipientDetails() {
    const {
      callback,
      quote: { id },
    } = this.response;
    const response = await fetch(`${callback}?quote=${id}&asset=BTC&method=Lightning`);
    const { pr } = await response.json();
    return { invoice: pr };
  }

  getRecipientContactDetails() {
    return this.response?.recipient;
  }

  getMemo() {
    try {
      return JSON.parse(this.response?.metadata).find(([k]: any) => k === 'text/plain')?.[1] || '';
    } catch (e) {
      return '';
    }
  }
}
