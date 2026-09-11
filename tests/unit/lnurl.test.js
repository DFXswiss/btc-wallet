import Lnurl from '../../class/lnurl';
const assert = require('assert');
const bolt11 = require('bolt11');
const loc = require('../../loc').default;

describe('LNURL', function () {
  it('can findlnurl', () => {
    const base = 'lnurl1dp68gurn8ghj7mrww3uxymm59e3xjemnw4hzu7re0ghkcmn4wfkz7urp0ylh2um9wf5kg0fhxycnv9g9w58';
    assert.strictEqual(Lnurl.findlnurl(base), base);
    assert.strictEqual(Lnurl.findlnurl(base.toUpperCase()), base);
    assert.strictEqual(Lnurl.findlnurl('https://site.com/?lightning=' + base), base);
    assert.strictEqual(Lnurl.findlnurl('https://site.com/?lightning=' + base.toUpperCase()), base);
    assert.strictEqual(Lnurl.findlnurl('https://site.com/?nada=nada&lightning=' + base), base);
    assert.strictEqual(Lnurl.findlnurl('https://site.com/?nada=nada&lightning=' + base.toUpperCase()), base);
    assert.strictEqual(Lnurl.findlnurl('lightning:' + base), base);
    assert.strictEqual(Lnurl.findlnurl('dfxtaro:lightning:' + base), base);
    assert.strictEqual(Lnurl.findlnurl('dfxtaro:lightning:' + base.toUpperCase()), base);
    assert.strictEqual(Lnurl.findlnurl('DFXTARO:LIGHTNING:' + base.toUpperCase()), base);
    assert.strictEqual(Lnurl.findlnurl('dfxtaro:' + base), base);
    assert.strictEqual(Lnurl.findlnurl('bluewallet:lightning:' + base), base);
    assert.strictEqual(Lnurl.findlnurl('dfxtaro://lightning:' + base), base);
    assert.strictEqual(Lnurl.findlnurl('DFXTARO://LIGHTNING:' + base.toUpperCase()), base);
    assert.strictEqual(Lnurl.findlnurl('bluewallet://lightning:' + base), base);
    assert.strictEqual(Lnurl.findlnurl('mailto:' + base), base);
    assert.strictEqual(Lnurl.findlnurl('MAILTO:' + base.toUpperCase()), base);
    assert.strictEqual(Lnurl.findlnurl('bs'), null);
    assert.strictEqual(Lnurl.findlnurl('https://site.com'), null);
    assert.strictEqual(Lnurl.findlnurl('https://site.com/?bs=' + base), null);
  });

  it('can getUrlFromLnurl()', () => {
    assert.strictEqual(
      Lnurl.getUrlFromLnurl('LNURL1DP68GURN8GHJ7MRWW3UXYMM59E3XJEMNW4HZU7RE0GHKCMN4WFKZ7URP0YLH2UM9WF5KG0FHXYCNV9G9W58'),
      'https://lntxbot.bigsun.xyz/lnurl/pay?userid=7116',
    );
    assert.strictEqual(
      Lnurl.getUrlFromLnurl(
        'https://lnbits.com/?lightning=LNURL1DP68GURN8GHJ7MRWVF5HGUEWVDHK6TMHD96XSERJV9MJ7CTSDYHHVVF0D3H82UNV9UM9JDENFPN5SMMK2359J5RKWVMKZ5ZVWAV4VJD63TM',
      ),
      'https://lnbits.com/withdraw/api/v1/lnurl/6Y73HgHovThYPvs7aPLwYV',
    );
    const encoded = Lnurl.encode('https://example.com/lnurlp/user');
    assert.strictEqual(Lnurl.getUrlFromLnurl(encoded), 'https://example.com/lnurlp/user');
    assert.strictEqual(Lnurl.getUrlFromLnurl('bs'), false);
  });

  it('can isLnurl()', () => {
    assert.ok(Lnurl.isLnurl('LNURL1DP68GURN8GHJ7MRWW3UXYMM59E3XJEMNW4HZU7RE0GHKCMN4WFKZ7URP0YLH2UM9WF5KG0FHXYCNV9G9W58'));
    assert.ok(
      Lnurl.isLnurl(
        'https://site.com/?lightning=LNURL1DP68GURN8GHJ7MRWW3UXYMM59E3XJEMNW4HZU7RE0GHKCMN4WFKZ7URP0YLH2UM9WF5KG0FHXYCNV9G9W58',
      ),
    );
    assert.ok(
      !Lnurl.isLnurl('https://site.com/?bs=LNURL1DP68GURN8GHJ7MRWW3UXYMM59E3XJEMNW4HZU7RE0GHKCMN4WFKZ7URP0YLH2UM9WF5KG0FHXYCNV9G9W58'),
    );
    assert.ok(!Lnurl.isLnurl('bs'));
  });

  it('can parseOnionUrl()', () => {
    const vectors = [
      {
        test: 'http://abc.onion/path',
        expected: ['http://abc.onion', '/path'],
      },
      {
        test: 'http://abc.onion:12345/path',
        expected: ['http://abc.onion:12345', '/path'],
      },
      {
        test: 'http://abc.onion/',
        expected: ['http://abc.onion', '/'],
      },
      {
        test: 'http://abc.onion',
        expected: ['http://abc.onion', undefined],
      },
      {
        test: 'https://abc.onion',
        expected: null,
      },
      {
        test: 'http://abc.com',
        expected: null,
      },
      {
        test: 'http://a@bc.onion',
        expected: null,
      },
      {
        test: 'http://a/bc.onion',
        expected: null,
      },
      {
        test: 'http://a:bc.onion',
        expected: null,
      },
    ];
    for (const { test, expected } of vectors) {
      assert.deepStrictEqual(Lnurl.parseOnionUrl(test), expected);
    }
  });

  it('can callLnurlPayService() and requestBolt11FromLnurlPayService()', async () => {
    const LN = new Lnurl('LNURL1DP68GURN8GHJ7MRWW3UXYMM59E3XJEMNW4HZU7RE0GHKCMN4WFKZ7URP0YLH2UM9WF5KG0FHXYCNV9G9W58');

    // poor-man's mock:
    LN._fetchGet = LN.fetchGet;
    LN.fetchGet = () => {
      return {
        status: 'OK',
        callback: 'https://lntxbot.bigsun.xyz/lnurl/pay/callback?userid=7116',
        tag: 'payRequest',
        maxSendable: 1000000000,
        minSendable: 1000,
        metadata: '[["text/plain","Fund @overtorment account on t.me/lntxbot."]]',
      };
    };
    const lnurlpayPayload = await LN.callLnurlPayService();
    assert.deepStrictEqual(lnurlpayPayload, {
      amount: 1,
      callback: 'https://lntxbot.bigsun.xyz/lnurl/pay/callback?userid=7116',
      commentAllowed: undefined,
      description: 'Fund @overtorment account on t.me/lntxbot.',
      domain: 'lntxbot.bigsun.xyz',
      fixed: false,
      image: undefined,
      max: 1000000,
      metadata: '[["text/plain","Fund @overtorment account on t.me/lntxbot."]]',
      min: 1,
    });
    const payRequest = LN.getLnurlPayRequestDetails();
    assert.strictEqual(payRequest.callback, 'https://lntxbot.bigsun.xyz/lnurl/pay/callback?userid=7116');
    assert.strictEqual(payRequest.minSendable, 1000n);
    assert.strictEqual(payRequest.maxSendable, 1000000000n);
    assert.strictEqual(payRequest.metadataStr, '[["text/plain","Fund @overtorment account on t.me/lntxbot."]]');
    assert.strictEqual(payRequest.commentAllowed, 0);
    assert.strictEqual(payRequest.url, Lnurl.getUrlFromLnurl(LN.getLnurl()));
    assert.strictEqual(payRequest.domain, new URL(payRequest.url).hostname);
    LN.setSdkSuccessAction({ tag: 'Message', inner: { data: { message: 'paid' } } });
    assert.deepStrictEqual(LN.getSuccessAction(), { tag: 'message', message: 'paid' });
    assert.strictEqual(LN.getDisposable(), true);

    // mock:
    LN.fetchGet = () => {
      return {
        status: 'OK',
        successAction: null,
        routes: [],
        pr: 'lnbc20n1p03s853pp58v9lrqahj2zyuzsdqqm3wnt2damlnkkuzwm8s7jkmnauhtkq4fjshp5z766racq95ncpk27nksev2ntu8wte77zd46g8uvzlnm5hhwukjrqcqzysxq9p5hsqrzjq29zewx4rezd04lpprpwsz5cesrfz30qtfkjqfw0249a3pn0uv5exzdefqqqxecqqqqqqqlgqqqq03sq9qsp52guktgy9u0xpky06n7slhjcvkassj0xpc3t9wadfsa0sl5x4fz9s9qy9qsqff5ycjg6xh3cc0vf8wxzxdajrdl9pka3nl3v37vcqj0qrdkzhsqxs8atfnxm2xenlkz7fpghlnuypux7hdp63zct3fr9px2e349kyqspu3gswx',
        disposable: false,
      };
    };
    const rez = await LN.requestBolt11FromLnurlPayService(2);
    assert.deepStrictEqual(rez, {
      status: 'OK',
      successAction: null,
      routes: [],
      pr: 'lnbc20n1p03s853pp58v9lrqahj2zyuzsdqqm3wnt2damlnkkuzwm8s7jkmnauhtkq4fjshp5z766racq95ncpk27nksev2ntu8wte77zd46g8uvzlnm5hhwukjrqcqzysxq9p5hsqrzjq29zewx4rezd04lpprpwsz5cesrfz30qtfkjqfw0249a3pn0uv5exzdefqqqxecqqqqqqqlgqqqq03sq9qsp52guktgy9u0xpky06n7slhjcvkassj0xpc3t9wadfsa0sl5x4fz9s9qy9qsqff5ycjg6xh3cc0vf8wxzxdajrdl9pka3nl3v37vcqj0qrdkzhsqxs8atfnxm2xenlkz7fpghlnuypux7hdp63zct3fr9px2e349kyqspu3gswx',
      disposable: false,
    });

    assert.strictEqual(LN.getSuccessAction(), null);
    assert.strictEqual(LN.getDomain(), 'lntxbot.bigsun.xyz');
    assert.strictEqual(LN.getDescription(), 'Fund @overtorment account on t.me/lntxbot.');
    assert.strictEqual(LN.getImage(), undefined);
    assert.strictEqual(LN.getLnurl(), 'LNURL1DP68GURN8GHJ7MRWW3UXYMM59E3XJEMNW4HZU7RE0GHKCMN4WFKZ7URP0YLH2UM9WF5KG0FHXYCNV9G9W58');
    assert.strictEqual(LN.getDisposable(), false);
    assert.strictEqual(LN.getCommentAllowed(), false);

    const callbackPayload = { ...rez };
    delete callbackPayload.disposable;
    const callbackResponses = [
      callbackPayload,
      { ...callbackPayload, disposable: null },
      { ...callbackPayload, disposable: false },
      { ...callbackPayload, disposable: true },
    ];
    const observedDisposableValues = [];

    for (const response of callbackResponses) {
      LN.fetchGet = () => response;
      await LN.requestBolt11FromLnurlPayService(2);
      observedDisposableValues.push(LN.getDisposable());
    }

    assert.deepStrictEqual(observedDisposableValues, [true, true, false, true]);
  });

  it('can requestBolt11FromLnurlPayService() when the invoice has no description_hash', async () => {
    // some services (e.g. Wallet of Satoshi) return an invoice with a plain `description` tag
    // instead of the `description_hash` LUD-06 asks for. that must not block the payment.
    const LN = new Lnurl('testuser@example.com');

    LN.fetchGet = () => {
      return {
        status: 'OK',
        callback: 'https://example.com/api/v1/lnurl/payreq/00000000-0000-0000-0000-000000000000',
        tag: 'payRequest',
        maxSendable: 1000000000,
        minSendable: 1000,
        metadata: '[["text/plain","Pay to Wallet of Satoshi user: testuser"],["text/identifier","testuser@example.com"]]',
      };
    };
    await LN.callLnurlPayService();

    LN.fetchGet = () => {
      return {
        status: 'OK',
        pr: 'lnbc20n1pj48ugqpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pshjgr5dus9wctvd3jhggr0vcs9xct5daeks6fqw4ek2u36yp6x2um5w4ek2usxqrrsscqpfsapyhslrges8uppeeqv8l3v3yq74j9ny70pf0aa039mxp7pvu7hqr0guqg5rxcgy9h7ux9je9hq5w6yj45wx2xwxdr4ncj809lxq49qq6pumnl',
        routes: [],
      };
    };

    const rez = await LN.requestBolt11FromLnurlPayService(2);
    assert.strictEqual(rez.status, 'OK');
    assert.strictEqual(LN.decodeInvoice(rez.pr).description_hash, undefined);
  });

  it('rejects callLnurlPayService() with a clear error when the lnurl is not parseable', async () => {
    const LN = new Lnurl('bs');
    await assert.rejects(LN.callLnurlPayService(), err => {
      assert.strictEqual(err.message, 'Invalid LNURL');
      return true;
    });
  });

  it('defaults max to 0 when the service omits maxSendable', async () => {
    const LN = new Lnurl('testuser@example.com');

    LN.fetchGet = () => {
      return {
        status: 'OK',
        callback: 'https://example.com/api/v1/lnurl/payreq/00000000-0000-0000-0000-000000000000',
        tag: 'payRequest',
        minSendable: 1000,
        metadata: '[["text/plain","Pay to testuser"]]',
      };
    };

    const payload = await LN.callLnurlPayService();
    assert.strictEqual(payload.max, 0);
    // an undefined max used to produce NaN, which silently disabled the upper amount bound
    await assert.rejects(LN.requestBolt11FromLnurlPayService(100), /The specified amount is invalid/);
  });

  it('can callLnurlPayService() and requestBolt11FromLnurlPayService() with comment', async () => {
    const LN = new Lnurl('lnurl1dp68gurn8ghj7cmgv96zucnvd9u8gampd3kx2apwvdhk6tmpwp5j7um9dejz6ar90p6q3eqkzd');

    // poor-man's mock:
    LN._fetchGet = LN.fetchGet;
    LN.fetchGet = () => {
      return {
        status: 'OK',
        callback: 'https://lntxbot.bigsun.xyz/lnurl/pay/callback?userid=7116',
        tag: 'payRequest',
        maxSendable: 1000000000,
        minSendable: 1000,
        metadata: '[["text/plain","Comment on lnurl-pay chat 📝"]]',
        commentAllowed: 144,
      };
    };
    const lnurlpayPayload = await LN.callLnurlPayService();
    assert.deepStrictEqual(lnurlpayPayload, {
      amount: 1,
      callback: 'https://lntxbot.bigsun.xyz/lnurl/pay/callback?userid=7116',
      commentAllowed: 144,
      description: 'Comment on lnurl-pay chat 📝',
      domain: 'lntxbot.bigsun.xyz',
      fixed: false,
      image: undefined,
      max: 1000000,
      metadata: '[["text/plain","Comment on lnurl-pay chat 📝"]]',
      min: 1,
    });

    assert.strictEqual(LN.getDomain(), 'lntxbot.bigsun.xyz');
    assert.strictEqual(LN.getDescription(), 'Comment on lnurl-pay chat 📝');
    assert.strictEqual(LN.getImage(), undefined);
    assert.strictEqual(LN.getLnurl(), 'lnurl1dp68gurn8ghj7cmgv96zucnvd9u8gampd3kx2apwvdhk6tmpwp5j7um9dejz6ar90p6q3eqkzd');
    assert.strictEqual(LN.getCommentAllowed(), 144);
    assert.strictEqual(LN.getAmount(), LN.getMin());
    assert.strictEqual(LN.getMin(), 1);
    assert.strictEqual(LN.getMax(), 1000000);

    // mock only to get fetched url:
    let urlUsed = '';
    LN.fetchGet = urlToFetch => {
      urlUsed = urlToFetch;
      return {
        disposable: true,
        pr: 'lnbc100n1psj8g53pp50t7xmnvnzsm6y78kcvqqudlnnushc04sevtneessp463ndpf83qshp5nh0t5w4w5zh8jdnn5a03hk4pk279l3eex4nzazgkwmqpn7wga6hqcqzpgxqr23ssp5ddpxstde98ekccnvzms67h9uflxmpj939aj4rwc5xwru0x6nfkus9qyyssq55n5hn9gwmrzx2ekajlqshvu53u8h3p0npu7ng4d0lnttgueprzr4mtpwa83jrpz4skhdx3p0xnh9jc92ysnu8umuwa70hkxhp44svsq9u5uqr',
        successAction: null,
      };
    };

    try {
      await LN.requestBolt11FromLnurlPayService(10, 'hola pendejo!');
    } finally {
      assert.ok(urlUsed.includes('&comment=hola%20pendejo!'));
    }
  });

  it('can decipher AES', () => {
    const ciphertext = 'vCWn4TMhIKubUc5+aBVfvw==';
    const iv = 'eTGduB45hWTOxHj1dR+LJw==';
    const preimage = 'bf62911aa53c017c27ba34391f694bc8bf8aaf59b4ebfd9020e66ac0412e189b';

    assert.strictEqual(Lnurl.decipherAES(ciphertext, preimage, iv), '1234');
  });
});

describe('lightning address', function () {
  it('can getUrlFromLnurl()', () => {
    assert.strictEqual(Lnurl.getUrlFromLnurl('lnaddress@zbd.gg'), 'https://zbd.gg/.well-known/lnurlp/lnaddress');
    assert.strictEqual(Lnurl.getUrlFromLnurl('lnaddress@hidden.onion'), 'http://hidden.onion/.well-known/lnurlp/lnaddress');
  });

  it('can detect', async () => {
    assert.ok(Lnurl.isLightningAddress('lnaddress@zbd.gg'));
    assert.ok(Lnurl.isLightningAddress('avatar@st5owtpsa2e62yf64luxogbecj7lk3t5vmesshsnrzu2untyf2i4t4ad.onion'));
    assert.ok(Lnurl.isLightningAddress(' lnaddress@zbd.gg '));
    assert.ok(Lnurl.isLightningAddress(' lnaddress@zbd.gg '));
    assert.ok(Lnurl.isLightningAddress(' lnaddress@8.8.8.8 '));
    assert.ok(Lnurl.isLightningAddress(' lnaddress@hidden.onion '));
    assert.ok(!Lnurl.isLightningAddress(' bla bla '));
    assert.ok(!Lnurl.isLightningAddress(''));
    assert.ok(!Lnurl.isLightningAddress('@'));
    assert.ok(!Lnurl.isLightningAddress('@a'));
    assert.ok(!Lnurl.isLightningAddress('a@'));
  });

  it('can authenticate', async () => {
    const LN = new Lnurl(
      'LNURL1DP68GURN8GHJ7MRFVA58GMNFDENKCMM8D9HZUMRFWEJJ7MR0VA5KU0MTXY7NYVFEX93X2DFK8P3KVEFKVSEXZWR98PSNJVRRV5CRGCE3X4JKGE3HXPNXGCMPV5MXXVTZ89NXZENXXCURGCTRV93RVE35XQCXVCFSVSN8GCT884KX7EMFDCDKKXQ0',
    );

    // poor-man's mock:
    LN._fetchGet = LN.fetchGet;
    let requestedUri = -1;
    LN.fetchGet = actuallyRequestedUri => {
      requestedUri = actuallyRequestedUri;
      return {
        status: 'OK',
      };
    };

    await assert.doesNotReject(LN.authenticate('lndhub://dc56b8cf8ef3b60060cf:94eac57510de2738451d'));
    assert.strictEqual(
      requestedUri,
      'https://lightninglogin.live/login?k1=2191be568cfe6d2a8e8a90ce04c15edf70fdcae6c1b9faff684acab6f400fa0d&tag=login&sig=304502210093ab4ead8dd619f2ddb3d52bd4bb01725badcb2a3daa3870fb41a38096f9a37d0220464a32e94e13dcec20ea94b94df0fa52f45cd88b01d7247042136ad0c71752d2&key=03e7b61e57efff1925ab9082625400cae2c8ad88a984e7aa4987abb77818570018',
    );
  });

  it('rejects authenticate() with a clear error when the lnurl is not parseable', async () => {
    const LN = new Lnurl('bs');
    await assert.rejects(LN.authenticate('lndhub://dc56b8cf8ef3b60060cf:94eac57510de2738451d'), err => {
      assert.strictEqual(err.message, 'Invalid URL: hostname is null');
      return true;
    });
  });

  it('returns the server error response as the reject error from lnurl-auth', async () => {
    const LN = new Lnurl(
      'LNURL1DP68GURN8GHJ7MRFVA58GMNFDENKCMM8D9HZUMRFWEJJ7MR0VA5KU0MTXY7NYVFEX93X2DFK8P3KVEFKVSEXZWR98PSNJVRRV5CRGCE3X4JKGE3HXPNXGCMPV5MXXVTZ89NXZENXXCURGCTRV93RVE35XQCXVCFSVSN8GCT884KX7EMFDCDKKXQ0',
    );

    // poor-man's mock:
    LN._fetchGet = LN.fetchGet;
    LN.fetchGet = () => {
      return {
        reason: 'Invalid signature',
        status: 'ERROR',
      };
    };

    await assert.rejects(LN.authenticate('lndhub://dc56b8cf8ef3b60060cf:94eac57510de2738451d'), err => {
      assert.strictEqual(err, 'Invalid signature');
      return true;
    });
  });

  it('works', async () => {
    const LN = new Lnurl('lnaddress@zbd.gg');

    // poor-man's mock:
    LN._fetchGet = LN.fetchGet;
    let requestedUri = -1;
    LN.fetchGet = actuallyRequestedUri => {
      requestedUri = actuallyRequestedUri;
      return {
        minSendable: 1000,
        maxSendable: 45000000,
        commentAllowed: 150,
        tag: 'payRequest',
        metadata: '[["text/plain","lnaddress - lightningaddress.com"],["text/identifier","lnaddress@zbd.gg"],["image/png;base64","img"]]',
        callback: 'https://api.zebedee.io/v0/process-static-charges/9a44621d-0665-44eb-96af-e06534311be5',
      };
    };

    const lnurlpayPayload = await LN.callLnurlPayService();
    assert.deepStrictEqual(lnurlpayPayload, {
      amount: 1,
      callback: 'https://api.zebedee.io/v0/process-static-charges/9a44621d-0665-44eb-96af-e06534311be5',
      commentAllowed: 150,
      description: 'lnaddress - lightningaddress.com',
      domain: 'api.zebedee.io',
      fixed: false,
      image: 'data:image/png;base64,img',
      max: 45000,
      metadata: '[["text/plain","lnaddress - lightningaddress.com"],["text/identifier","lnaddress@zbd.gg"],["image/png;base64","img"]]',
      min: 1,
    });

    assert.strictEqual(requestedUri, 'https://zbd.gg/.well-known/lnurlp/lnaddress');
  });

  it('works with onion', async () => {
    assert.ok(Lnurl.isLightningAddress('avatar@st5owtpsa2e62yf64luxogbecj7lk3t5vmesshsnrzu2untyf2i4t4ad.onion'));

    const LN = new Lnurl('avatar@st5owtpsa2e62yf64luxogbecj7lk3t5vmesshsnrzu2untyf2i4t4ad.onion');

    // poor-man's mock:
    LN._fetchGet = LN.fetchGet;
    let requestedUri = -1;
    LN.fetchGet = actuallyRequestedUri => {
      requestedUri = actuallyRequestedUri;
      return {
        status: 'OK',
        callback: 'http://st5owtpsa2e62yf64luxogbecj7lk3t5vmesshsnrzu2untyf2i4t4ad.onion/.well-known/lnurlp/avatar',
        tag: 'payRequest',
        maxSendable: 100000000,
        minSendable: 1000,
        metadata:
          '[["text/identifier", "avatar@st5owtpsa2e62yf64luxogbecj7lk3t5vmesshsnrzu2untyf2i4t4ad.onion"], ["text/plain", "Sats for avatar@st5owtpsa2e62yf64luxogbecj7lk3t5vmesshsnrzu2untyf2i4t4ad.onion"]]',
        commentAllowed: 0,
      };
    };

    const lnurlpayPayload = await LN.callLnurlPayService();
    assert.deepStrictEqual(lnurlpayPayload, {
      amount: 1,
      callback: 'http://st5owtpsa2e62yf64luxogbecj7lk3t5vmesshsnrzu2untyf2i4t4ad.onion/.well-known/lnurlp/avatar',
      commentAllowed: 0,
      description: 'Sats for avatar@st5owtpsa2e62yf64luxogbecj7lk3t5vmesshsnrzu2untyf2i4t4ad.onion',
      domain: 'st5owtpsa2e62yf64luxogbecj7lk3t5vmesshsnrzu2untyf2i4t4ad.onion',
      fixed: false,
      image: undefined,
      max: 100000,
      metadata:
        '[["text/identifier", "avatar@st5owtpsa2e62yf64luxogbecj7lk3t5vmesshsnrzu2untyf2i4t4ad.onion"], ["text/plain", "Sats for avatar@st5owtpsa2e62yf64luxogbecj7lk3t5vmesshsnrzu2untyf2i4t4ad.onion"]]',
      min: 1,
    });

    assert.strictEqual(requestedUri, 'http://st5owtpsa2e62yf64luxogbecj7lk3t5vmesshsnrzu2untyf2i4t4ad.onion/.well-known/lnurlp/avatar');
  });
});

describe('LNURL edge cases', function () {
  const TEST_PRIVATE_KEY = 'e126f68f7eafcc8b74f54d269fe206be715000f94dac067d1c04a8ca3b2db734';
  const TEST_PAYMENT_HASH = '0001020304050607080900010203040506070809000102030405060708090102';

  function makeInvoice(millisatoshis, addDefaults = true) {
    const invoice = {
      timestamp: 1496314658,
      tags: [
        { tagName: 'payment_hash', data: TEST_PAYMENT_HASH },
        { tagName: 'description', data: 'fractional test invoice' },
      ],
    };
    if (millisatoshis !== undefined) invoice.millisatoshis = String(millisatoshis);
    return bolt11.sign(bolt11.encode(invoice, addDefaults), TEST_PRIVATE_KEY).paymentRequest;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects onion, HTTP error, and protocol error responses in fetchGet', async () => {
    const ln = new Lnurl('https://example.com');
    await assert.rejects(ln.fetchGet('http://hidden.onion/path'), new RegExp(loc.settings.tor_unsupported));

    jest.spyOn(global, 'fetch').mockResolvedValueOnce({ status: 500 });
    await assert.rejects(ln.fetchGet('https://example.com'), /Bad response from server/);

    jest.spyOn(global, 'fetch').mockResolvedValueOnce({ status: 200, json: async () => ({ status: 'ERROR', reason: 'denied' }) });
    await assert.rejects(ln.fetchGet('https://example.com'), /Reply from server: denied/);

    jest.spyOn(global, 'fetch').mockResolvedValueOnce({ status: 200, json: async () => ({ status: 'OK' }) });
    expect(await ln.fetchGet('https://example.com')).toEqual({ status: 'OK' });
  });

  it('decodes a millisatoshi invoice and supplies its default expiry', () => {
    const decoded = new Lnurl().decodeInvoice(makeInvoice(2001));
    assert.strictEqual(decoded.num_satoshis, '2.001');
    assert.strictEqual(decoded.num_millisatoshis, '2001');
    assert.strictEqual(decoded.expiry, '3600');
    assert.strictEqual(decoded.description, 'fractional test invoice');
  });

  it('keeps zero millisatoshi invoices at zero satoshis', () => {
    const decoded = new Lnurl().decodeInvoice(makeInvoice(undefined, false));
    expect(decoded.num_satoshis).toBe('0');
    expect(decoded.num_millisatoshis).toBe('0');
  });

  it('rejects requestBolt11 calls before a payload or callback is available', async () => {
    const ln = new Lnurl();
    await assert.rejects(ln.requestBolt11FromLnurlPayService(1), /_lnurlPayServicePayload is not set/);

    const service = new Lnurl('user@example.com');
    service.fetchGet = jest.fn().mockResolvedValue({
      callback: 'https://example.com/callback',
      tag: 'payRequest',
      minSendable: 1000,
      maxSendable: 2000,
      metadata: '[["text/plain","test"]]',
    });
    const servicePayload = await service.callLnurlPayService();
    servicePayload.callback = undefined;
    await assert.rejects(service.requestBolt11FromLnurlPayService(1), /callback is not set/);
  });

  it('truncates an overlong comment before requesting a callback invoice', async () => {
    const ln = new Lnurl('user@example.com');
    ln.fetchGet = jest
      .fn()
      .mockResolvedValueOnce({
        callback: 'https://example.com/callback',
        tag: 'payRequest',
        minSendable: 1000,
        maxSendable: 2000,
        commentAllowed: 3,
        metadata: '[["text/plain","test"]]',
      })
      .mockResolvedValueOnce({ status: 'ERROR', reason: 'stop before invoice decoding' });
    await ln.callLnurlPayService();
    await assert.rejects(ln.requestBolt11FromLnurlPayService(1, 'abcdef'), /stop before invoice decoding/);
    expect(ln.fetchGet.mock.calls[1][0]).toContain('comment=abc');
  });

  it('rejects callback errors and invoices whose amount does not match', async () => {
    const ln = new Lnurl('user@example.com');
    const invoice =
      'lnbc20n1p03s853pp58v9lrqahj2zyuzsdqqm3wnt2damlnkkuzwm8s7jkmnauhtkq4fjshp5z766racq95ncpk27nksev2ntu8wte77zd46g8uvzlnm5hhwukjrqcqzysxq9p5hsqrzjq29zewx4rezd04lpprpwsz5cesrfz30qtfkjqfw0249a3pn0uv5exzdefqqqxecqqqqqqqlgqqqq03sq9qsp52guktgy9u0xpky06n7slhjcvkassj0xpc3t9wadfsa0sl5x4fz9s9qy9qsqff5ycjg6xh3cc0vf8wxzxdajrdl9pka3nl3v37vcqj0qrdkzhsqxs8atfnxm2xenlkz7fpghlnuypux7hdp63zct3fr9px2e349kyqspu3gswx';
    ln.fetchGet = jest
      .fn()
      .mockResolvedValueOnce({
        callback: 'https://example.com/callback',
        tag: 'payRequest',
        minSendable: 1000,
        maxSendable: 5000,
        metadata: '[["text/plain","test"]]',
      })
      .mockResolvedValueOnce({ status: 'ERROR', reason: 'callback denied' });
    await ln.callLnurlPayService();
    await assert.rejects(ln.requestBolt11FromLnurlPayService(1), /callback denied/);

    ln.fetchGet.mockResolvedValue({ status: 'OK', pr: invoice });
    await assert.rejects(ln.requestBolt11FromLnurlPayService(3), /doesn't match specified amount/);

    ln.fetchGet.mockResolvedValue({ status: 'ERROR' });
    await assert.rejects(ln.requestBolt11FromLnurlPayService(1), /requestBolt11FromLnurlPayService\(\) error/);
  });

  it('rejects a non-pay response and an LNURL URL without a hostname', async () => {
    const wrongTag = new Lnurl('user@example.com');
    wrongTag.fetchGet = jest.fn().mockResolvedValue({
      callback: 'https://example.com/callback',
      tag: 'withdrawRequest',
      minSendable: 1000,
      maxSendable: 2000,
      metadata: '[["text/plain","test"]]',
    });
    await assert.rejects(wrongTag.callLnurlPayService(), /expected, found tag withdrawRequest/);

    const noHost = new Lnurl(Lnurl.encode('file:///tmp/lnurl'));
    noHost.fetchGet = jest.fn().mockResolvedValue({ tag: 'payRequest', metadata: '[]' });
    await assert.rejects(noHost.callLnurlPayService(), /Invalid LNURL domain/);
  });

  it('uses the JPEG metadata image and defaults missing sendable bounds to zero', async () => {
    const ln = new Lnurl('user@example.com');
    ln.fetchGet = jest.fn().mockResolvedValue({
      callback: 'https://example.com/callback',
      tag: 'payRequest',
      metadata: '[["image/jpeg;base64","abc"]]',
    });
    const payload = await ln.callLnurlPayService();
    assert.strictEqual(payload.min, 0);
    assert.strictEqual(payload.max, 0);
    assert.strictEqual(payload.image, 'data:image/jpeg;base64,abc');
    assert.strictEqual(ln.getCommentAllowed(), false);
    assert.strictEqual(ln.getMin(), false);
    assert.strictEqual(ln.getMax(), false);
    assert.strictEqual(ln.getAmount(), false);
  });

  it('returns false for invalid LNURL addresses and callLnurlPayService without a URL', async () => {
    expect(Lnurl.getLnurlFromAddress('invalid')).toBe(false);
    expect(Lnurl.getLnurlFromAddress('user@example.com')).toBe(Lnurl.encode('https://example.com/.well-known/lnurlp/user'));
    await assert.rejects(new Lnurl().callLnurlPayService(), /this._lnurl is not set/);
  });

  it('loads, stores, and exposes a successful payment through AsyncStorage', async () => {
    const storage = { getItem: jest.fn(), setItem: jest.fn().mockResolvedValue(undefined) };
    const ln = new Lnurl('user@example.com', storage);
    await ln.storeSuccess('hash', { data: [1, 2, 3] });
    expect(storage.setItem).toHaveBeenCalledWith('lnurlpay_success_data_hash', expect.stringContaining('010203'));

    const storedData = storage.setItem.mock.calls[0][1];
    storage.getItem.mockResolvedValue(storedData);
    const loaded = new Lnurl(false, storage);
    expect(await loaded.loadSuccessfulPayment('hash')).toBe(true);
    expect(loaded.getLnurl()).toBe('user@example.com');
    expect(loaded.getPreimage()).toBe('010203');
    await assert.rejects(loaded.loadSuccessfulPayment(''), /No paymentHash provided/);
    storage.getItem.mockResolvedValue(null);
    expect(await loaded.loadSuccessfulPayment('missing')).toBe(false);

    await ln.storeSuccess('text', 'plain');
    expect(storage.setItem).toHaveBeenLastCalledWith('lnurlpay_success_data_text', expect.stringContaining('"preimage":"plain"'));
  });

  it('returns false for malformed and empty stored payment data', async () => {
    const storage = { getItem: jest.fn().mockResolvedValue('{') };
    const ln = new Lnurl(false, storage);
    expect(await ln.loadSuccessfulPayment('bad')).toBe(false);
    storage.getItem.mockResolvedValue('null');
    expect(await ln.loadSuccessfulPayment('empty')).toBe(false);
    storage.getItem.mockRejectedValue(new Error('storage down'));
    expect(await ln.loadSuccessfulPayment('error')).toBe(false);
  });

  it('requires a loaded pay request before returning its details', async () => {
    const ln = new Lnurl('user@example.com');
    expect(() => ln.getLnurlPayRequestDetails()).toThrow(/not loaded/);
    ln.fetchGet = jest.fn().mockResolvedValue({
      callback: 'https://example.com/callback',
      tag: 'payRequest',
      minSendable: 1000,
      maxSendable: 2000,
      metadata: '[]',
    });
    await ln.callLnurlPayService();
    expect(ln.getLnurlPayRequestDetails().domain).toBe('example.com');
  });

  it('maps every supported SDK success action and rejects unknown tags', () => {
    const ln = new Lnurl();
    for (const [tag, expected] of [
      ['Aes', 'aes'],
      ['Message', 'message'],
      ['Url', 'url'],
    ]) {
      ln.setSdkSuccessAction({ tag, inner: { data: { value: tag } } });
      expect(ln.getSuccessAction()).toEqual({ tag: expected, value: tag });
    }
    ln.setSdkSuccessAction(undefined);
    expect(ln.getSuccessAction()).toBeUndefined();
    expect(() => ln.setSdkSuccessAction({ tag: 'Unknown', inner: { data: {} } })).toThrow(/Unsupported LNURL success action/);
  });

  it('rejects authenticate without an LNURL and includes additional parameters', async () => {
    await assert.rejects(new Lnurl(false).authenticate('secret'), /this._lnurl is not set/);
    const ln = new Lnurl(
      'LNURL1DP68GURN8GHJ7MRFVA58GMNFDENKCMM8D9HZUMRFWEJJ7MR0VA5KU0MTXY7NYVFEX93X2DFK8P3KVEFKVSEXZWR98PSNJVRRV5CRGCE3X4JKGE3HXPNXGCMPV5MXXVTZ89NXZENXXCURGCTRV93RVE35XQCXVCFSVSN8GCT884KX7EMFDCDKKXQ0',
    );
    ln.fetchGet = jest.fn().mockResolvedValue({ status: 'OK' });
    await ln.authenticate('lndhub://dc56b8cf8ef3b60060cf:94eac57510de2738451d', { foo: 'bar' });
    await new Promise(resolve => setImmediate(resolve));
    expect(ln.fetchGet.mock.calls[0][0]).toContain('&foo=bar');
  });

  it('rejects authenticate when the callback request throws and rejects invalid domains', async () => {
    const ln = new Lnurl(
      'LNURL1DP68GURN8GHJ7MRFVA58GMNFDENKCMM8D9HZUMRFWEJJ7MR0VA5KU0MTXY7NYVFEX93X2DFK8P3KVEFKVSEXZWR98PSNJVRRV5CRGCE3X4JKGE3HXPNXGCMPV5MXXVTZ89NXZENXXCURGCTRV93RVE35XQCXVCFSVSN8GCT884KX7EMFDCDKKXQ0',
    );
    const callbackError = new Error('network failure');
    ln.fetchGet = jest.fn().mockRejectedValue(callbackError);
    await assert.rejects(ln.authenticate('lndhub://dc56b8cf8ef3b60060cf:94eac57510de2738451d'), error => {
      assert.strictEqual(error, callbackError);
      return true;
    });
    expect(Lnurl.getDomainFromLightningAddress('invalid')).toBe('');
  });
});
