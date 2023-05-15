import { Linking } from 'react-native';

const authorizationUrl = (url, appId, callback, scope, responseType = 'token') =>
  `${url}?scope=${encodeURIComponent(scope)}&
  redirect_uri=${encodeURIComponent(callback)}&
  response_type=${responseType}&
  client_id=${appId}`.replace(/\s+/g, '');

export default class OAuth {
  constructor(clientId, clientSecret, callback, authUrl, tokenUrl, scope) {
    this.authenticate = this.authenticate.bind(this);
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.callback = callback;
    this.authUrl = authUrl;
    this.tokenUrl = tokenUrl;
    this.scope = scope;
  }

  authenticate() {
    return new Promise((resolve, reject) => {
      const handleUrl = event => {
        console.log('krysh-debug handleUrl', event);
        // const authCode = event.url.substring(event.url.indexOf('=') + 1, event.url.length);
        // const tokenRequest = {
        //   code: authCode,
        //   client_id: this.clientId,
        //   redirect_uri: this.callback,
        //   grant_type: 'authorization_code',
        // };
        // const s = [];
        // // eslint-disable-next-line prefer-const
        // for (let key in tokenRequest) {
        //   // eslint-disable-next-line no-prototype-builtins
        //   if (tokenRequest.hasOwnProperty(key)) {
        //     s.push(`${encodeURIComponent(key)}=${encodeURIComponent(tokenRequest[key])}`);
        //   }
        // }
        // console.log('handleEvent', s.join('&'));
        // fetch(this.tokenUrl, {
        //   method: 'POST',
        //   headers: {
        //     Accept: 'application/json',
        //     'Content-Type': 'application/x-www-form-urlencoded',
        //   },
        //   body: s.join('&'),
        // })
        //   .then(response => resolve(response))
        //   .catch(error => reject(error));
        Linking.removeEventListener('url', handleUrl);
      };
      Linking.addEventListener('url', handleUrl);
      console.log('krysh open', authorizationUrl(this.authUrl, this.clientId, this.callback, this.scope, 'code'));
      Linking.openURL(authorizationUrl(this.authUrl, this.clientId, this.callback, this.scope, 'code'));
    });
  }
}
