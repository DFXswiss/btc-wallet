/* global E2E_SETTLE_URL, E2E_SETTLE_KEY, TRANSACTION_ID, output, http */
// Calls POST {E2E_SETTLE_URL}/settle-fiat with { transactionId } so the
// loopback settle service can insert the DBIT bank_tx that
// searchOutgoingBankTx matches. Never prints the key.

function fail(message, code) {
  const text = String(message || 'Settle fiat request failed');
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
    if (name === 'E2E_SETTLE_URL' && typeof E2E_SETTLE_URL !== 'undefined') {
      return scriptBinding(E2E_SETTLE_URL);
    }
    if (name === 'E2E_SETTLE_KEY' && typeof E2E_SETTLE_KEY !== 'undefined') {
      return scriptBinding(E2E_SETTLE_KEY);
    }
    if (name === 'TRANSACTION_ID' && typeof TRANSACTION_ID !== 'undefined') {
      return scriptBinding(TRANSACTION_ID);
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

function loadConfig() {
  const url = readEnv('E2E_SETTLE_URL').trim().replace(/\/+$/, '');
  const key = readEnv('E2E_SETTLE_KEY').trim();
  if (!url || !key) {
    fail('E2E_SETTLE_URL and E2E_SETTLE_KEY are required', 2);
  }
  if (!/^https?:\/\//i.test(url)) {
    fail('E2E_SETTLE_URL must be an http or https URL', 2);
  }
  const transactionRaw = readEnv('TRANSACTION_ID').trim();
  const transactionId = Number(transactionRaw);
  if (!Number.isInteger(transactionId) || transactionId <= 0) {
    fail('TRANSACTION_ID must be a positive integer', 2);
  }
  return { url: url, key: key, transactionId: transactionId };
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
    if (data.error !== undefined && data.error !== null && String(data.error) !== '') {
      return String(data.error);
    }
    if (data.message !== undefined && data.message !== null && String(data.message) !== '') {
      return String(data.message);
    }
  }
  const text = raw === undefined || raw === null ? '' : String(raw).trim();
  if (text) return text.slice(0, 200);
  return 'no error body';
}

function authHeaders(config) {
  return {
    'X-Api-Key': config.key,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

function settlePath() {
  return '/settle-fiat';
}

function settleBody(config) {
  return { transactionId: config.transactionId };
}

function applyOk() {
  setOutput('settled', 'ok');
  writeStdout('settled=ok');
}

function applyPending() {
  setOutput('settled', 'pending');
  writeStdout('settled=pending');
}

function failHttp(status, raw, data) {
  fail('Settle fiat request failed with HTTP ' + status + ': ' + apiErrorText(raw, data), 1);
}

function handleResult(result) {
  const code = Number(result && result.status);
  // 409 heisst: der Auszahlungsposten ist noch nicht auszahlungsreif.
  // 404 heisst: er existiert noch gar nicht - die Kette legt ihn erst ueber
  // mehrere Cron-Takte an. Beides ist "spaeter nochmal", kein Fehler; der
  // Flow wiederholt den Aufruf. Ein echter Fehlschlag (401, 500) faellt
  // weiterhin durch.
  if (code === 409 || code === 404) {
    applyPending();
    return;
  }
  if (!Number.isInteger(code) || code < 200 || code >= 300) {
    failHttp(result && result.status, result && result.raw, result && result.data);
  }
  applyOk();
}

function httpMaestro(config) {
  const url = config.url + settlePath();
  const payload = JSON.stringify(settleBody(config));
  const options = { headers: authHeaders(config), body: payload };
  let response;
  if (typeof http.request === 'function') {
    options.method = 'POST';
    response = http.request(url, options);
  } else if (typeof http.post === 'function') {
    response = http.post(url, options);
  } else {
    fail('Settle fiat helper has no HTTP runtime', 2);
  }
  return {
    status: response && response.status,
    raw: response && response.body,
    data: tryParseJson(response && response.body),
  };
}

function httpNode(config) {
  const { URL } = require('url');
  const lib = config.url.startsWith('https:') ? require('https') : require('http');
  const payload = JSON.stringify(settleBody(config));
  const target = new URL(config.url + settlePath());
  const options = {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
    path: target.pathname + target.search,
    method: 'POST',
    headers: authHeaders(config),
  };
  options.headers['Content-Length'] = Buffer.byteLength(payload);
  return new Promise(function (resolve, reject) {
    const req = lib.request(options, function (res) {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', function (chunk) {
        raw += chunk;
      });
      res.on('end', function () {
        resolve({ status: res.statusCode, raw: raw, data: tryParseJson(raw) });
      });
    });
    req.setTimeout(60000, function () {
      req.destroy();
      reject(new Error('Settle fiat request timed out'));
    });
    req.on('error', function (err) {
      reject(new Error('Settle fiat request failed: ' + (err && err.message ? err.message : 'unknown')));
    });
    req.write(payload);
    req.end();
  });
}

const config = loadConfig();
if (hasMaestroHttp()) {
  handleResult(httpMaestro(config));
} else if (isNode()) {
  httpNode(config)
    .then(function (result) {
      handleResult(result);
      process.exit(0);
    })
    .catch(function (error) {
      fail(error && error.message ? error.message : 'Settle fiat request failed', 1);
    });
} else {
  fail('Settle fiat helper has no HTTP runtime', 2);
}
