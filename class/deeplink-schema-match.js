import URL, { parse } from 'url';
import { Chain } from '../models/bitcoinUnits';
import Lnurl from './lnurl';
import { OpenCryptoPayPaymentLink } from './open-crypto-pay';
const bitcoin = require('bitcoinjs-lib');
const bip21 = require('bip21');

class DeeplinkSchemaMatch {
  static hasSchema(schemaString) {
    if (typeof schemaString !== 'string' || schemaString.length <= 0) return false;
    const lowercaseString = schemaString.trim().toLowerCase();
    return (
      lowercaseString.startsWith('bitcoin:') ||
      lowercaseString.startsWith('lightning:') ||
      lowercaseString.startsWith('blue:') ||
      lowercaseString.startsWith('bluewallet:') ||
      lowercaseString.startsWith('lapp:') ||
      lowercaseString.startsWith('dfxtaro:')
    );
  }

  /**
   * Examines the content of the event parameter.
   * If the content is recognizable, create a dictionary with the respective
   * navigation dictionary required by react-navigation
   *
   * @param event {{url: string}} URL deeplink as passed to app, e.g. `bitcoin:bc1qh6tf004ty7z7un2v5ntu4mkf630545gvhs45u7?amount=666&label=Yo`
   * @param completionHandler {function} Callback that returns [string, params: object]
   */
  static navigationRouteFor(event, completionHandler, context = { wallets: [], saveToDisk: () => {}, addWallet: () => {} }) {
    if (event.url === null) {
      return;
    }
    if (typeof event.url !== 'string') {
      return;
    }

    if (
      event.url.toLowerCase().startsWith('bluewallet:bitcoin:') ||
      event.url.toLowerCase().startsWith('bluewallet:lightning:') ||
      event.url.toLowerCase().startsWith('dfxtaro:bitcoin:') ||
      event.url.toLowerCase().startsWith('dfxtaro:lightning:')
    ) {
      event.url = event.url.replace('bluewallet:', '');
      event.url = event.url.replace('dfxtaro:', '');
    } else if (event.url.toLocaleLowerCase().startsWith('bluewallet://widget?action=')) {
      event.url = event.url.substring('bluewallet://'.length);
    }

    if (DeeplinkSchemaMatch.isWidgetAction(event.url)) {
      if (context.wallets.length >= 0) {
        const wallet = context.wallets[0];
        const action = event.url.split('widget?action=')[1];
        if (wallet.chain === Chain.ONCHAIN) {
          if (action === 'openSend') {
            completionHandler([
              'SendDetailsRoot',
              {
                screen: 'SendDetails',
                params: {
                  walletID: wallet.getID(),
                },
              },
            ]);
          } else if (action === 'openReceive') {
            completionHandler([
              'ReceiveDetailsRoot',
              {
                screen: 'ReceiveDetails',
                params: {
                  walletID: wallet.getID(),
                },
              },
            ]);
          }
        } else if (wallet.chain === Chain.OFFCHAIN) {
          if (action === 'openSend') {
            completionHandler([
              'SendDetailsRoot',
              {
                screen: 'ScanLndInvoice',
                params: {
                  walletID: wallet.getID(),
                },
              },
            ]);
          } else if (action === 'openReceive') {
            completionHandler(['ReceiveDetailsRoot', { screen: 'LNDCreateInvoice', params: { walletID: wallet.getID() } }]);
          }
        }
      }
    } /* else if (DeeplinkSchemaMatch.isPossiblySignedPSBTFile(event.url)) {
      RNFS.readFile(decodeURI(event.url))
        .then(file => {
          if (file) {
            completionHandler([
              'SendDetailsRoot',
              {
                screen: 'PsbtWithHardwareWallet',
                params: {
                  deepLinkPSBT: file,
                },
              },
            ]);
          }
        })
        .catch(e => console.warn(e));
      return;
    } */

    /* let isBothBitcoinAndLightning;
    try {
      isBothBitcoinAndLightning = DeeplinkSchemaMatch.isBothBitcoinAndLightning(event.url);
    } catch (e) {
      console.log(e);
    }
    if (isBothBitcoinAndLightning) {
      completionHandler([
        'SelectWallet',
        {
          onWalletSelect: (wallet, { navigation }) => {
            navigation.pop(); // close select wallet screen
            navigation.navigate(...DeeplinkSchemaMatch.isBothBitcoinAndLightningOnWalletSelect(wallet, isBothBitcoinAndLightning));
          },
        },
      ]);
    } else */ if (DeeplinkSchemaMatch.isBitcoinAddress(event.url)) {
      completionHandler([
        'SendDetailsRoot',
        {
          screen: 'SendDetails',
          params: {
            uri: event.url.replace('://', ':'),
            walletID: context.walletID,
          },
        },
      ]);
    } else if (DeeplinkSchemaMatch.isLightningInvoice(event.url) || DeeplinkSchemaMatch.isTestnetLightningInvoice(event.url)) {
      completionHandler([
        'SendDetailsRoot',
        {
          screen: 'ScanLndInvoice',
          params: {
            uri: event.url.replace('://', ':'),
          },
        },
      ]);
    } else if (DeeplinkSchemaMatch.isLnUrl(event.url)) {
      // at this point we can not tell if it is lnurl-pay or lnurl-withdraw since it needs additional async call
      // to the server, which is undesirable here, so LNDCreateInvoice screen will handle it for us and will
      // redirect user to LnurlPay screen if necessary
      completionHandler([
        'ReceiveDetailsRoot',
        {
          screen: 'LNDCreateInvoice',
          params: {
            uri: Lnurl.findlnurl(event.url).replace('lightning:', '').replace('LIGHTNING:', ''),
          },
        },
      ]);
    } else if (Lnurl.isLightningAddress(event.url)) {
      // this might be not just an email but a lightning addres
      // @see https://lightningaddress.com
      completionHandler([
        'SendDetailsRoot',
        {
          screen: 'ScanLndInvoice',
          params: {
            uri: event.url,
          },
        },
      ]);
    } /* else if (Azteco.isRedeemUrl(event.url)) {
      completionHandler([
        'AztecoRedeemRoot',
        {
          screen: 'AztecoRedeem',
          params: Azteco.getParamsFromUrl(event.url),
        },
      ]);
    } else if (new WatchOnlyWallet().setSecret(event.url).init().valid()) {
      completionHandler([
        'AddWalletRoot',
        {
          screen: 'ImportWallet',
          params: {
            triggerImport: true,
            label: event.url,
          },
        },
      ]);
    } */ else {
      const urlObject = URL.parse(event.url, true); // eslint-disable-line n/no-deprecated-api
      (async () => {
        if (
          urlObject.protocol === 'bluewallet:' ||
          urlObject.protocol === 'lapp:' ||
          urlObject.protocol === 'blue:' ||
          urlObject.protocol === 'dfxtaro:'
        ) {
          switch (urlObject.host) {
            /* case 'openlappbrowser': {
              console.log('opening LAPP', urlObject.query.url);
              // searching for LN wallet:
              let haveLnWallet = false;
              for (const w of context.wallets) {
                if (w.type === LightningCustodianWallet.type) {
                  haveLnWallet = true;
                }
              }

              if (!haveLnWallet) {
                // need to create one
                const w = new LightningCustodianWallet();
                w.setLabel(w.typeReadable);

                try {
                  const lndhub = await AsyncStorage.getItem(AppStorage.LNDHUB);
                  if (lndhub) {
                    w.setBaseURI(lndhub);
                    w.init();
                  }
                  await w.createAccount();
                  await w.authorize();
                } catch (Err) {
                  // giving up, not doing anything
                  return;
                }
                context.addWallet(w);
                context.saveToDisk();
              }

              // now, opening lapp browser and navigating it to URL.
              // looking for a LN wallet:
              let lnWallet;
              for (const w of context.wallets) {
                if (w.type === LightningCustodianWallet.type) {
                  lnWallet = w;
                  break;
                }
              }

              if (!lnWallet) {
                // something went wrong
                return;
              }

              completionHandler([
                'LappBrowserRoot',
                {
                  screen: 'LappBrowser',
                  params: {
                    walletID: lnWallet.getID(),
                    url: urlObject.query.url,
                  },
                },
              ]);
              break;
            }
            case 'setelectrumserver':
              completionHandler([
                'ElectrumSettings',
                {
                  server: DeeplinkSchemaMatch.getServerFromSetElectrumServerAction(event.url),
                },
              ]);
              break;
            case 'setlndhuburl':
              completionHandler([
                'LightningSettings',
                {
                  url: DeeplinkSchemaMatch.getUrlFromSetLndhubUrlAction(event.url),
                },
              ]);
              break; */
            case 'buy':
              completionHandler(['WalletsRoot', { screen: 'WalletTransactions' }]);
              break;
            case 'sell':
              completionHandler(['DeeplinkRoot', { screen: 'Sell', params: urlObject.query }]);
              break;
            case 'swap':
              completionHandler(['DeeplinkRoot', { screen: 'Swap', params: urlObject.query }]);
              break;
          }
        }
      })();
    }
  }

  /**
   * Extracts server from a deeplink like `bluewallet:setelectrumserver?server=electrum1.bluewallet.io%3A443%3As`
   * returns FALSE if none found
   *
   * @param url {string}
   * @return {string|boolean}
   */
  static getServerFromSetElectrumServerAction(url) {
    if (!url.startsWith('bluewallet:setelectrumserver') && !url.startsWith('setelectrumserver')) return false;
    const splt = url.split('server=');
    if (splt[1]) return decodeURIComponent(splt[1]);
    return false;
  }

  /**
   * Extracts url from a deeplink like `bluewallet:setlndhuburl?url=https%3A%2F%2Flndhub.herokuapp.com`
   * returns FALSE if none found
   *
   * @param url {string}
   * @return {string|boolean}
   */
  static getUrlFromSetLndhubUrlAction(url) {
    if (!url.startsWith('bluewallet:setlndhuburl') && !url.startsWith('setlndhuburl')) return false;
    const splt = url.split('url=');
    if (splt[1]) return decodeURIComponent(splt[1]);
    return false;
  }

  static isTXNFile(filePath) {
    return (
      (filePath.toLowerCase().startsWith('file:') || filePath.toLowerCase().startsWith('content:')) &&
      filePath.toLowerCase().endsWith('.txn')
    );
  }

  static isPossiblySignedPSBTFile(filePath) {
    return (
      (filePath.toLowerCase().startsWith('file:') || filePath.toLowerCase().startsWith('content:')) &&
      filePath.toLowerCase().endsWith('-signed.psbt')
    );
  }

  static isPossiblyPSBTFile(filePath) {
    return (
      (filePath.toLowerCase().startsWith('file:') || filePath.toLowerCase().startsWith('content:')) &&
      filePath.toLowerCase().endsWith('.psbt')
    );
  }

  static isPossiblyPSBTString(text) {
    try {
      return Boolean(bitcoin.Psbt.fromBase64(text));
    } catch (e) {
      return false;
    }
  }

  static isBothBitcoinAndLightningOnWalletSelect(wallet, uri) {
    if (wallet.chain === Chain.ONCHAIN) {
      return [
        'SendDetailsRoot',
        {
          screen: 'SendDetails',
          params: {
            uri: uri.bitcoin,
            walletID: wallet.getID(),
          },
        },
      ];
    } else if (wallet.chain === Chain.OFFCHAIN) {
      return [
        'SendDetailsRoot',
        {
          screen: 'ScanLndInvoice',
          params: {
            uri: uri.lndInvoice,
            walletID: wallet.getID(),
          },
        },
      ];
    }
  }

  static isBitcoinAddress(address) {
    address = address.replace('://', ':').replace('bitcoin:', '').replace('BITCOIN:', '').replace('bitcoin=', '').split('?')[0];
    let isValidBitcoinAddress = false;
    try {
      bitcoin.address.toOutputScript(address);
      isValidBitcoinAddress = true;
    } catch (err) {
      isValidBitcoinAddress = false;
    }
    return isValidBitcoinAddress;
  }

  static isLightningInvoice(invoice) {
    let isValidLightningInvoice = false;
    if (
      invoice.toLowerCase().startsWith('lightning:lnb') ||
      invoice.toLowerCase().startsWith('lightning://lnb') ||
      invoice.toLowerCase().startsWith('lnb')
    ) {
      isValidLightningInvoice = true;
    }
    return isValidLightningInvoice;
  }

  static isTestnetLightningInvoice(invoice) {
    let isValidLightningInvoice = false;
    if (
      invoice.toLowerCase().startsWith('lightning:lntb') ||
      invoice.toLowerCase().startsWith('lightning://lntb') ||
      invoice.toLowerCase().startsWith('lntb')
    ) {
      isValidLightningInvoice = true;
    }
    return isValidLightningInvoice;
  }

  static isLnUrl(text) {
    return Lnurl.isLnurl(text);
  }

  static isWidgetAction(text) {
    return text.startsWith('widget?action=');
  }

  static isBothBitcoinAndLightning(url) {
    if (url.includes('lightning') && (url.includes('bitcoin') || url.includes('BITCOIN'))) {
      const txInfo = url.split(/(bitcoin:\/\/|BITCOIN:\/\/|bitcoin:|BITCOIN:|lightning:|lightning=|bitcoin=)+/);
      let btc;
      let lndInvoice;
      for (const [index, value] of txInfo.entries()) {
        try {
          // Inside try-catch. We dont wan't to  crash in case of an out-of-bounds error.
          if (value.startsWith('bitcoin') || value.startsWith('BITCOIN')) {
            btc = `bitcoin:${txInfo[index + 1]}`;
            if (!DeeplinkSchemaMatch.isBitcoinAddress(btc)) {
              btc = false;
              break;
            }
          } else if (value.startsWith('lightning')) {
            const lnpart = txInfo[index + 1].split('&').find(el => el.toLowerCase().startsWith('ln'));
            lndInvoice = `lightning:${lnpart}`;
            if (!this.isLightningInvoice(lndInvoice)) {
              lndInvoice = false;
              break;
            }
          }
        } catch (e) {
          console.log(e);
        }
        if (btc && lndInvoice) break;
      }
      if (btc && lndInvoice) {
        return { bitcoin: btc, lndInvoice };
      } else {
        return undefined;
      }
    }
    return undefined;
  }

  static bip21decode(uri) {
    if (!uri) return {};
    let replacedUri = uri;
    for (const replaceMe of ['BITCOIN://', 'bitcoin://', 'BITCOIN:']) {
      replacedUri = replacedUri.replace(replaceMe, 'bitcoin:');
    }

    return bip21.decode(replacedUri);
  }

  static bip21encode() {
    const argumentsArray = Array.from(arguments);
    for (const argument of argumentsArray) {
      if (String(argument.label).replace(' ', '').length === 0) {
        delete argument.label;
      }
      if (!(Number(argument.amount) > 0)) {
        delete argument.amount;
      }
    }
    return bip21.encode.apply(bip21, argumentsArray);
  }

  static decodeBitcoinUri(uri) {
    let amount = '';
    let parsedBitcoinUri = null;
    let address = uri || '';
    let memo = '';
    let payjoinUrl = '';
    try {
      parsedBitcoinUri = DeeplinkSchemaMatch.bip21decode(uri);
      address = 'address' in parsedBitcoinUri ? parsedBitcoinUri.address : address;
      if ('options' in parsedBitcoinUri) {
        if ('amount' in parsedBitcoinUri.options) {
          amount = parsedBitcoinUri.options.amount.toString();
          amount = parsedBitcoinUri.options.amount;
        }
        if ('label' in parsedBitcoinUri.options) {
          memo = parsedBitcoinUri.options.label || memo;
        }
        if ('pj' in parsedBitcoinUri.options) {
          payjoinUrl = parsedBitcoinUri.options.pj;
        }
      }
    } catch (_) {}
    return { address, amount, memo, payjoinUrl };
  }

  static isPossiblyLightningDestination(text, options = { includeDualFormats: true }) {
    if (DeeplinkSchemaMatch.isLnUrl(text)) return true;
    if (Lnurl.isLightningAddress(text)) return true;
    if (DeeplinkSchemaMatch.isLightningInvoice(text)) return true;
    if (DeeplinkSchemaMatch.isTestnetLightningInvoice(text)) return true;

    if (options.includeDualFormats) {
      if (DeeplinkSchemaMatch.isBothBitcoinAndLightning(text)) return true;
    }

    return false;
  }

  static isPossiblyOnChainDestination(text, options = { includeDualFormats: true }) {
    if (DeeplinkSchemaMatch.isBitcoinAddress(text)) return true;

    try {
      if (DeeplinkSchemaMatch.bip21decode(text).address) return true;
    } catch (_) { }

    if (options.includeDualFormats) {
      if (DeeplinkSchemaMatch.isBothBitcoinAndLightning(text)) return true;
    }

    return false;
  }

  static async assertNavigationByLnurl(text, context) {
    const url = Lnurl.getUrlFromLnurl(text);
    if (!url) return;

    const { query } = parse(url, true);

    if (query.tag === Lnurl.TAG_LOGIN_REQUEST) {
      return ['LnurlAuth', {
        lnurl: text,
        walletID: context?.walletID,
      }];
    }

    try {
      const reply = await new Lnurl(url).fetchGet(url);

      if (OpenCryptoPayPaymentLink.isOpenCryptoPayResponse(reply)) {
        return ['SendDetailsRoot', {
          screen: 'OpenCryptoPaySend',
          params: {
            plDetails: reply,
            walletID: context?.walletID,
          },
        }];
      }

      if (reply.tag === Lnurl.TAG_PAY_REQUEST) {
        return ['SendDetailsRoot', {
          screen: 'ScanLndInvoice',
          params: {
            uri: text,
            walletID: context?.walletID,
          },
        }];
      }

      if (reply.tag === Lnurl.TAG_WITHDRAW_REQUEST) {
        return ['ReceiveDetailsRoot', {
          screen: 'LNDCreateInvoice',
          params: {
            uri: text,
            walletID: context?.walletID,
          },
        }];
      }

      throw new Error('Unsupported lnurl');
    } catch (error) {
      console.error(error);
    }
  }
    
}

export default DeeplinkSchemaMatch;
