/* global E2E_API_URL, E2E_DFX_JWT, SIM_AMOUNT, SIM_CURRENCY, SIM_IDEMPOTENCY_KEY, output, http */
// Looks up the identity's buy routes via GET {E2E_API_URL}/v1/buy and
// triggers PUT /v1/buy/<id>/simulatePayment on the first active one.
// Observed on the local stack (http://127.0.0.1:3300, 2026-09-15): GET /v1/buy
// returns a JSON array of BuyDto. Fields read: id (number), active (boolean).
// The test identity had one active route (id 1, Spark/BTC, bankUsage
// "64EB-5A06-6C0B"). simulatePayment body: amount (number), currency
// ("CHF"|"EUR"), optional idempotencyKey. Never prints the JWT.

function fail(message, code) {
  const text = String(message || 'Simulate payment request failed');
  if (typeof process !== 'undefined' && process.stderr && process.stderr.write) {
    process.stderr.write(text + '\n');
    process.exit(code || 2);
  }
  throw new Error(text);
}

function scriptBinding(value) {
  return value === undefined || value === null ? '' : String(value);
}

function readScriptBinding(name) {
  try {
    if (name === 'E2E_API_URL' && typeof E2E_API_URL !== 'undefined') {
      return scriptBinding(E2E_API_URL);
    }
    if (name === 'E2E_DFX_JWT' && typeof E2E_DFX_JWT !== 'undefined') {
      return scriptBinding(E2E_DFX_JWT);
    }
    if (name === 'SIM_AMOUNT' && typeof SIM_AMOUNT !== 'undefined') {
      return scriptBinding(SIM_AMOUNT);
    }
    if (name === 'SIM_CURRENCY' && typeof SIM_CURRENCY !== 'undefined') {
      return scriptBinding(SIM_CURRENCY);
    }
    if (name === 'SIM_IDEMPOTENCY_KEY' && typeof SIM_IDEMPOTENCY_KEY !== 'undefined') {
      return scriptBinding(SIM_IDEMPOTENCY_KEY);
    }
  } catch (error) {}
  return '';
}

function readEnv(name) {
  const bound = readScriptBinding(name);
  if (bound) return bound;
  try {
    if (typeof process !== 'undefined' && process.env && process.env[name]) {
      return String(process.env[name]);
    }
  } catch (error) {}
  return '';
}

function setOutput(key, value) {
  if (typeof output !== 'undefined') output[key] = value;
}

function writeStdout(value) {
  if (!isNode()) return;
  process.stdout.write(String(value) + '\n');
}

function isNode() {
  return typeof process !== 'undefined' && process.versions && process.versions.node;
}

function readPositiveAmount(name, fallback) {
  const raw = readEnv(name).trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    fail(name + ' must be a positive number', 2);
  }
  return n;
}

function loadConfig() {
  const url = readEnv('E2E_API_URL').trim().replace(/\/+$/, '');
  if (!url) fail('E2E_API_URL is required', 2);
  if (!/^https?:\/\//i.test(url)) {
    fail('E2E_API_URL must be an http or https URL', 2);
  }
  const token = readEnv('E2E_DFX_JWT').trim();
  if (!token) fail('E2E_DFX_JWT is required', 2);
  const amount = readPositiveAmount('SIM_AMOUNT', 100);
  const currency = readEnv('SIM_CURRENCY').trim() || 'CHF';
  if (currency !== 'CHF' && currency !== 'EUR') {
    fail('SIM_CURRENCY must be CHF or EUR', 2);
  }
  const idempotencyKey = readEnv('SIM_IDEMPOTENCY_KEY').trim();
  if (idempotencyKey && !/^[A-Za-z0-9_-]+$/.test(idempotencyKey)) {
    fail('SIM_IDEMPOTENCY_KEY must match [A-Za-z0-9_-]', 2);
  }
  return {
    url,
    token,
    amount,
    currency,
    idempotencyKey: idempotencyKey || '',
  };
}

function hasMaestroHttp() {
  try {
    return (
      typeof http !== 'undefined' &&
      http &&
      (typeof http.request === 'function' || typeof http.get === 'function' || typeof http.post === 'function')
    );
  } catch (error) {
    return false;
  }
}

function authHeaders(config, hasBody) {
  const headers = {
    Authorization: 'Bearer ' + config.token,
    Accept: 'application/json',
  };
  if (hasBody) headers['Content-Type'] = 'application/json';
  return headers;
}

function tryParseJson(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function apiErrorText(raw, data) {
  if (data && typeof data === 'object') {
    if (Array.isArray(data.message)) return data.message.map(String).join('; ');
    if (data.message !== undefined && data.message !== null && String(data.message) !== '') {
      return String(data.message);
    }
    if (data.error !== undefined && data.error !== null && String(data.error) !== '') {
      return String(data.error);
    }
  }
  const text = raw === undefined || raw === null ? '' : String(raw).trim();
  if (text) return text.slice(0, 200);
  return 'no error body';
}

function failHttp(label, status, raw, data) {
  fail(label + ' failed with HTTP ' + status + ': ' + apiErrorText(raw, data), 1);
}

function asBuyList(data, raw) {
  if (!Array.isArray(data)) {
    fail(
      'Buy route response was not a JSON array [' +
        (raw === undefined ? 'UNDEFINED' : raw === null ? 'NULL' : String(raw).slice(0, 60)) +
        ']',
      2,
    );
  }
  return data;
}

function pickActiveBuy(buys) {
  for (let i = 0; i < buys.length; i++) {
    const buy = buys[i];
    if (!buy || typeof buy !== 'object') continue;
    if (buy.active !== true) continue;
    if (buy.id === undefined || buy.id === null || String(buy.id) === '') continue;
    return buy;
  }
  fail('No active buy route', 1);
}

function paymentBody(config) {
  const body = { amount: config.amount, currency: config.currency };
  if (config.idempotencyKey) body.idempotencyKey = config.idempotencyKey;
  return body;
}

function applySuccess(buyId, amount) {
  setOutput('simulatedPayment', 'ok');
  setOutput('simulatedBuyId', String(buyId));
  setOutput('simulatedAmount', String(amount));
  writeStdout('simulatedPayment=ok simulatedBuyId=' + buyId + ' simulatedAmount=' + amount);
}

function httpMaestro(config, method, path, body) {
  const url = config.url + path;
  const payload = body ? JSON.stringify(body) : null;
  const options = { headers: authHeaders(config, !!payload) };
  if (payload) options.body = payload;
  const verb = String(method || '').toUpperCase();
  let response;
  if (typeof http.request === 'function') {
    options.method = verb;
    response = http.request(url, options);
  } else if (verb === 'GET' && typeof http.get === 'function') {
    response = http.get(url, options);
  } else if (verb === 'POST' && typeof http.post === 'function') {
    response = http.post(url, options);
  } else {
    fail('Simulate payment helper has no HTTP runtime', 2);
  }
  return {
    status: response && response.status,
    raw: response && response.body,
    data: tryParseJson(response && response.body),
  };
}

function httpNode(config, method, path, body) {
  const { URL } = require('url');
  const lib = config.url.startsWith('https:') ? require('https') : require('http');
  const payload = body ? JSON.stringify(body) : null;
  const target = new URL(config.url + path);
  const options = {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
    path: target.pathname + target.search,
    method,
    headers: authHeaders(config, !!payload),
  };
  if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload);
  return new Promise(function (resolve, reject) {
    const req = lib.request(options, function (res) {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', function (chunk) {
        raw += chunk;
      });
      res.on('end', function () {
        resolve({ status: res.statusCode, raw, data: tryParseJson(raw) });
      });
    });
    req.setTimeout(60000, function () {
      req.destroy();
      reject(new Error('Simulate payment request timed out'));
    });
    req.on('error', function () {
      reject(new Error('Simulate payment request failed'));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

function assertOk(label, result) {
  const code = Number(result && result.status);
  if (!Number.isInteger(code) || code < 200 || code >= 300) {
    failHttp(label, result && result.status, result && result.raw, result && result.data);
  }
}

function getBuysSync(config) {
  const result = httpMaestro(config, 'GET', '/v1/buy');
  assertOk('Buy route request', result);
  return asBuyList(result.data, result.raw);
}

function simulateSync(config, buyId) {
  const result = httpMaestro(config, 'PUT', '/v1/buy/' + buyId + '/simulatePayment', paymentBody(config));
  assertOk('Simulate payment', result);
}

function getBuysNode(config) {
  return httpNode(config, 'GET', '/v1/buy').then(function (result) {
    assertOk('Buy route request', result);
    return asBuyList(result.data, result.raw);
  });
}

function simulateNode(config, buyId) {
  return httpNode(config, 'PUT', '/v1/buy/' + buyId + '/simulatePayment', paymentBody(config)).then(function (result) {
    assertOk('Simulate payment', result);
  });
}

function runSync(config) {
  const buy = pickActiveBuy(getBuysSync(config));
  simulateSync(config, buy.id);
  applySuccess(buy.id, config.amount);
}

function runNode(config) {
  return getBuysNode(config).then(function (buys) {
    const buy = pickActiveBuy(buys);
    return simulateNode(config, buy.id).then(function () {
      applySuccess(buy.id, config.amount);
    });
  });
}

const config = loadConfig();
if (hasMaestroHttp()) {
  runSync(config);
} else if (isNode()) {
  runNode(config)
    .then(function () {
      process.exit(0);
    })
    .catch(function (error) {
      fail(error && error.message ? error.message : 'Simulate payment request failed', 2);
    });
} else {
  fail('Simulate payment helper has no HTTP runtime', 2);
}
