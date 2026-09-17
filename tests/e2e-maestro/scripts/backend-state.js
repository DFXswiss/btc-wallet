/* global E2E_API_URL, E2E_DFX_JWT, STATE_KIND, TIMEOUT_MS, POLL_MS, MIN_TX_ID, POLL_ONCE, output, http, Java, java */
// Polls GET {E2E_API_URL}/v1/transaction with Authorization: Bearer {E2E_DFX_JWT}
// until a transaction matches STATE_KIND. Observed on the local stack
// (http://127.0.0.1:3300, 2026-09-15): JSON array of TransactionDto.
// Fields read: id (number), type ("Buy"|"Sell"|...), state (e.g. "Completed",
// "LiquidityPending"). snapshot returns the highest id once and does not wait.
// Optional MIN_TX_ID (positive integer) keeps only rows with id > MIN_TX_ID for
// buy-complete, sell-booked, and sell-complete. Optional POLL_ONCE=true asks
// once, never waits, and exits 0 with backendState pending on a miss (ok plus
// id/state on a hit). Real errors still exit 2 or 1. userAddress is an optional
// API filter and is omitted because the JWT already scopes the subject. Never
// prints the JWT.

function fail(message, code) {
  const text = String(message || 'Backend state request failed');
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
    if (name === 'STATE_KIND' && typeof STATE_KIND !== 'undefined') {
      return scriptBinding(STATE_KIND);
    }
    if (name === 'TIMEOUT_MS' && typeof TIMEOUT_MS !== 'undefined') {
      return scriptBinding(TIMEOUT_MS);
    }
    if (name === 'POLL_MS' && typeof POLL_MS !== 'undefined') {
      return scriptBinding(POLL_MS);
    }
    if (name === 'MIN_TX_ID' && typeof MIN_TX_ID !== 'undefined') {
      return scriptBinding(MIN_TX_ID);
    }
    if (name === 'POLL_ONCE' && typeof POLL_ONCE !== 'undefined') {
      return scriptBinding(POLL_ONCE);
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

function readPositiveInt(name, fallback) {
  const raw = readEnv(name).trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    fail(name + ' must be a positive integer', 2);
  }
  return n;
}

function readOptionalPositiveInt(name) {
  const raw = readEnv(name).trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    fail(name + ' must be a positive integer', 2);
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
  const kind = readEnv('STATE_KIND').trim();
  if (!kind) fail('STATE_KIND is required', 2);
  if (kind !== 'buy-complete' && kind !== 'sell-booked' && kind !== 'sell-complete' && kind !== 'snapshot') {
    fail('STATE_KIND must be buy-complete, sell-booked, sell-complete, or snapshot', 2);
  }
  const timeoutMs = readPositiveInt('TIMEOUT_MS', 600000);
  const pollMs = readPositiveInt('POLL_MS', 5000);
  const minTxId = readOptionalPositiveInt('MIN_TX_ID');
  const pollOnce = readEnv('POLL_ONCE').trim().toLowerCase() === 'true';
  return {
    url,
    token,
    kind,
    timeoutMs,
    pollMs,
    minTxId,
    pollOnce,
    deadline: Date.now() + timeoutMs,
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

function parseJsonBody(raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(
      'Backend state response was not JSON [' + (raw === undefined ? 'UNDEFINED' : raw === null ? 'NULL' : String(raw).slice(0, 60)) + ']',
      2,
    );
  }
}

function asTxList(data) {
  if (!Array.isArray(data)) {
    fail('Backend state response was not a transaction array', 2);
  }
  return data;
}

function authHeaders(config) {
  return {
    Authorization: 'Bearer ' + config.token,
    Accept: 'application/json',
  };
}

function transactionPath() {
  return '/v1/transaction';
}

function httpJsonMaestro(config) {
  const url = config.url + transactionPath();
  const options = { headers: authHeaders(config) };
  let response;
  if (typeof http.request === 'function') {
    options.method = 'GET';
    response = http.request(url, options);
  } else if (typeof http.get === 'function') {
    response = http.get(url, options);
  } else {
    fail('Backend state helper has no HTTP runtime', 2);
  }
  const code = Number(response && response.status);
  if (!Number.isInteger(code) || code < 200 || code >= 300) {
    fail('Backend state request failed with HTTP ' + (response && response.status), 2);
  }
  return asTxList(parseJsonBody(response.body));
}

function httpJsonNode(config) {
  const { URL } = require('url');
  const lib = config.url.startsWith('https:') ? require('https') : require('http');
  const target = new URL(config.url + transactionPath());
  const options = {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
    path: target.pathname + target.search,
    method: 'GET',
    headers: authHeaders(config),
  };
  return new Promise(function (resolve, reject) {
    const req = lib.request(options, function (res) {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', function (chunk) {
        raw += chunk;
      });
      res.on('end', function () {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error('Backend state request failed with HTTP ' + res.statusCode));
          return;
        }
        let data;
        try {
          data = JSON.parse(raw);
        } catch (error) {
          reject(new Error('Backend state response was not JSON'));
          return;
        }
        resolve(asTxList(data));
      });
    });
    req.setTimeout(60000, function () {
      req.destroy();
      reject(new Error('Backend state request timed out'));
    });
    req.on('error', function () {
      reject(new Error('Backend state request failed'));
    });
    req.end();
  });
}

function httpJsonSync(config) {
  if (!hasMaestroHttp()) fail('Backend state helper has no HTTP runtime', 2);
  return httpJsonMaestro(config);
}

function matchesKind(tx, kind, minTxId) {
  if (!tx || typeof tx !== 'object') return false;
  if (minTxId !== null) {
    const id = Number(tx.id);
    if (!Number.isInteger(id) || !(id > minTxId)) return false;
  }
  const type = String(tx.type || '');
  const state = String(tx.state || '');
  if (kind === 'buy-complete') return type === 'Buy' && state === 'Completed';
  if (kind === 'sell-booked') return type === 'Sell';
  if (kind === 'sell-complete') return type === 'Sell' && state === 'Completed';
  return false;
}

function findMatch(txs, kind, minTxId) {
  for (let i = 0; i < txs.length; i++) {
    if (matchesKind(txs[i], kind, minTxId)) return txs[i];
  }
  return null;
}

function summarize(txs) {
  if (!txs || txs.length === 0) return 'none';
  const parts = [];
  for (let i = 0; i < txs.length; i++) {
    const tx = txs[i] || {};
    parts.push(String(tx.type || '?') + ':' + String(tx.state || '?'));
  }
  return parts.join(', ');
}

function timeoutMessage(kind, timeoutMs, seen, minTxId) {
  return (
    'Timed out waiting for backend state ' +
    kind +
    ' after ' +
    timeoutMs +
    ' ms (MIN_TX_ID=' +
    (minTxId === null ? 'unset' : String(minTxId)) +
    '). Seen states: ' +
    seen
  );
}

function maxTxId(txs) {
  let max = 0;
  for (let i = 0; i < txs.length; i++) {
    const id = Number(txs[i] && txs[i].id);
    if (Number.isInteger(id) && id > max) max = id;
  }
  return max;
}

function applySnapshot(txs) {
  const max = maxTxId(txs);
  setOutput('backendMaxTxId', String(max));
  writeStdout('backendMaxTxId=' + max);
}

function txId(tx) {
  if (tx && tx.id !== undefined && tx.id !== null && String(tx.id) !== '') {
    return String(tx.id);
  }
  if (tx && tx.uid) return String(tx.uid);
  return '';
}

function applySuccess(tx) {
  const id = txId(tx);
  const state = String((tx && tx.state) || '');
  if (!id) fail('Matching transaction has no id', 2);
  setOutput('backendState', 'ok');
  setOutput('backendTxId', id);
  setOutput('backendTxState', state);
  writeStdout('backendState=ok id=' + id + ' state=' + state);
}

function applyPending() {
  setOutput('backendState', 'pending');
  writeStdout('backendState=pending');
}

function sleepSync(ms) {
  try {
    const Thread = Java.type('java.lang.Thread');
    Thread.sleep(ms);
    return;
  } catch (error) {}
  try {
    java.lang.Thread.sleep(ms);
    return;
  } catch (error) {}
  const end = Date.now() + ms;
  while (Date.now() < end) {}
}

function sleepNode(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

function pollSync(config) {
  let seen = 'none';
  while (true) {
    const txs = httpJsonSync(config);
    const hit = findMatch(txs, config.kind, config.minTxId);
    if (hit) {
      applySuccess(hit);
      return;
    }
    seen = summarize(txs);
    if (config.pollOnce) {
      applyPending();
      return;
    }
    if (Date.now() >= config.deadline) {
      fail(timeoutMessage(config.kind, config.timeoutMs, seen, config.minTxId), 1);
    }
    sleepSync(config.pollMs);
  }
}

function pollNode(config) {
  function once() {
    return httpJsonNode(config).then(function (txs) {
      const hit = findMatch(txs, config.kind, config.minTxId);
      if (hit) {
        applySuccess(hit);
        return;
      }
      const seen = summarize(txs);
      if (config.pollOnce) {
        applyPending();
        return;
      }
      if (Date.now() >= config.deadline) {
        fail(timeoutMessage(config.kind, config.timeoutMs, seen, config.minTxId), 1);
      }
      return sleepNode(config.pollMs).then(once);
    });
  }
  return once();
}

function runSync(config) {
  if (config.kind === 'snapshot') {
    applySnapshot(httpJsonSync(config));
    return;
  }
  pollSync(config);
}

function runNode(config) {
  if (config.kind === 'snapshot') {
    return httpJsonNode(config).then(applySnapshot);
  }
  return pollNode(config);
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
      fail(error && error.message ? error.message : 'Backend state request failed', 2);
    });
} else {
  fail('Backend state helper has no HTTP runtime', 2);
}
