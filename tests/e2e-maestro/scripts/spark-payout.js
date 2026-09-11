/* global E2E_SPARK_PAYOUT_URL, E2E_SPARK_PAYOUT_KEY, E2E_SPARK_PAYOUT_MAX_SAT, output, http */
/* global E2E_SPARK_WALLET_ADDRESS, E2E_PAYMENT_SAT, SPARK_PAYOUT_SAT, SPARK_WALLET_BALANCE */
// Spark payout counterpart for P16. Speaks the local loopback payout service.
// Prints only the value the caller needs. Never prints the key or the seed.

function fail(message, code) {
  const text = String(message || 'Spark payout request failed');
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
    if (name === 'E2E_SPARK_PAYOUT_URL' && typeof E2E_SPARK_PAYOUT_URL !== 'undefined') {
      return scriptBinding(E2E_SPARK_PAYOUT_URL);
    }
    if (name === 'E2E_SPARK_PAYOUT_KEY' && typeof E2E_SPARK_PAYOUT_KEY !== 'undefined') {
      return scriptBinding(E2E_SPARK_PAYOUT_KEY);
    }
    if (name === 'E2E_SPARK_PAYOUT_MAX_SAT' && typeof E2E_SPARK_PAYOUT_MAX_SAT !== 'undefined') {
      return scriptBinding(E2E_SPARK_PAYOUT_MAX_SAT);
    }
    if (name === 'E2E_SPARK_WALLET_ADDRESS' && typeof E2E_SPARK_WALLET_ADDRESS !== 'undefined') {
      return scriptBinding(E2E_SPARK_WALLET_ADDRESS);
    }
    if (name === 'E2E_PAYMENT_SAT' && typeof E2E_PAYMENT_SAT !== 'undefined') {
      return scriptBinding(E2E_PAYMENT_SAT);
    }
    if (name === 'SPARK_PAYOUT_SAT' && typeof SPARK_PAYOUT_SAT !== 'undefined') {
      return scriptBinding(SPARK_PAYOUT_SAT);
    }
    if (name === 'SPARK_WALLET_BALANCE' && typeof SPARK_WALLET_BALANCE !== 'undefined') {
      return scriptBinding(SPARK_WALLET_BALANCE);
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
  const url = readEnv('E2E_SPARK_PAYOUT_URL').trim().replace(/\/+$/, '');
  const key = readEnv('E2E_SPARK_PAYOUT_KEY').trim();
  if (!url || !key) {
    fail('E2E_SPARK_PAYOUT_URL and E2E_SPARK_PAYOUT_KEY are required', 2);
  }
  if (!/^https?:\/\/127\.0\.0\.1(?::\d+)?(?:\/|$)/i.test(url) && !/^https?:\/\/localhost(?::\d+)?(?:\/|$)/i.test(url)) {
    fail('E2E_SPARK_PAYOUT_URL must be a loopback http URL', 2);
  }
  const maxSatRaw = readEnv('E2E_SPARK_PAYOUT_MAX_SAT').trim();
  const maxSat = maxSatRaw ? Number(maxSatRaw) : 1000;
  if (!Number.isInteger(maxSat) || maxSat <= 0) {
    fail('E2E_SPARK_PAYOUT_MAX_SAT must be a positive integer', 2);
  }
  return { url: url, key: key, maxSat: maxSat };
}

function parseSat(value, label) {
  const sat = Number(value);
  if (!Number.isInteger(sat) || sat <= 0) {
    fail(label + ' must be a positive integer sat amount', 2);
  }
  return sat;
}

function assertWithinMax(sat, maxSat) {
  if (sat >= maxSat) {
    fail('Requested amount exceeds E2E_SPARK_PAYOUT_MAX_SAT', 2);
  }
}

function hasMaestroHttp() {
  try {
    return (
      typeof http !== 'undefined' &&
      http &&
      (typeof http.request === 'function' ||
        typeof http.get === 'function' ||
        typeof http.post === 'function')
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
      'Spark payout service returned a non-JSON response [' +
        (raw === undefined ? 'UNDEFINED' : raw === null ? 'NULL' : String(raw).slice(0, 60)) +
        ']',
      2,
    );
  }
}

function httpJsonMaestro(config, method, path, body) {
  const url = config.url + path;
  const headers = {
    'X-Api-Key': config.key,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const options = { headers: headers };
  if (body) options.body = JSON.stringify(body);
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
    fail('Spark payout helper has no HTTP runtime', 2);
  }
  const code = Number(response && response.status);
  if (!Number.isInteger(code) || code < 200 || code >= 300) {
    fail('Spark payout request failed with HTTP ' + (response && response.status), 2);
  }
  return parseJsonBody(response.body);
}

function httpJsonNode(config, method, path, body) {
  const { URL } = require('url');
  const lib = config.url.startsWith('https:') ? require('https') : require('http');
  const payload = body ? JSON.stringify(body) : null;
  const target = new URL(config.url + path);
  const options = {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
    path: target.pathname + target.search,
    method: method,
    headers: {
      'X-Api-Key': config.key,
      Accept: 'application/json',
    },
  };
  if (payload) {
    options.headers['Content-Type'] = 'application/json';
    options.headers['Content-Length'] = Buffer.byteLength(payload);
  }
  return new Promise(function (resolve, reject) {
    const req = lib.request(options, function (res) {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', function (chunk) {
        raw += chunk;
      });
      res.on('end', function () {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error('Spark payout request failed with HTTP ' + res.statusCode));
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(new Error('Spark payout service returned a non-JSON response'));
        }
      });
    });
    req.setTimeout(60000, function () {
      req.destroy();
      reject(new Error('Spark payout request timed out'));
    });
    req.on('error', function () {
      reject(new Error('Spark payout request failed'));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

function httpJsonSync(config, method, path, body) {
  if (!hasMaestroHttp()) fail('Spark payout helper has no HTTP runtime', 2);
  return httpJsonMaestro(config, method, path, body);
}

function applyPayout(result, requestedSat, maxSat) {
  if (!result || result.ok !== true) {
    fail('Spark payout service did not confirm the transfer', 2);
  }
  const sat = Number(result.amountSat);
  if (!Number.isInteger(sat) || sat <= 0) {
    fail('Spark payout service returned an invalid amount', 2);
  }
  if (sat !== requestedSat) {
    fail('Spark payout service returned an amount that does not match the request', 2);
  }
  if (sat >= maxSat) {
    fail('Spark payout service returned an amount that exceeds E2E_SPARK_PAYOUT_MAX_SAT', 2);
  }
  const visible = readEnv('SPARK_WALLET_BALANCE').trim();
  if (!visible) fail('SPARK_WALLET_BALANCE is required', 2);
  var match = visible.match(/([0-9][0-9., ]*)sats/i);
  var beforeSat = match ? Number(String(match[1]).replace(/[^0-9]/g, '')) : 0;
  if (!Number.isFinite(beforeSat) || beforeSat < 0) beforeSat = 0;
  var expectedDigits = String(beforeSat + sat).split('');
  setOutput('payoutOk', 'true');
  setOutput('payoutSat', String(sat));
  setOutput('walletBalanceText', visible);
  setOutput('walletBalanceRegex', '^' + visible.replace(/[.]/g, '[.,]') + '$');
  setOutput('expectedBalanceRegex', '^' + expectedDigits.join('[., ]?') + ' sats$');
  setOutput('payoutBalanceBefore', String(result.balanceBeforeSat));
  setOutput('payoutBalanceAfter', String(result.balanceAfterSat));
  writeStdout('payoutOk=true sat=' + sat);
}

function preparePayout(config) {
  const address = readEnv('E2E_SPARK_WALLET_ADDRESS').trim();
  if (!address) fail('E2E_SPARK_WALLET_ADDRESS is required', 2);
  const satRaw = readEnv('SPARK_PAYOUT_SAT').trim() || readEnv('E2E_PAYMENT_SAT').trim() || '10';
  const sat = parseSat(satRaw, 'payout amount');
  assertWithinMax(sat, config.maxSat);
  return { address: address, sat: sat };
}

const config = loadConfig();
const body = preparePayout(config);
if (hasMaestroHttp()) {
  applyPayout(httpJsonSync(config, 'POST', '/v1/payout', body), body.sat, config.maxSat);
} else if (isNode()) {
  httpJsonNode(config, 'POST', '/v1/payout', body)
    .then(function (result) {
      applyPayout(result, body.sat, config.maxSat);
      process.exit(0);
    })
    .catch(function (error) {
      fail(error && error.message ? error.message : 'Spark payout request failed', 2);
    });
} else {
  fail('Spark payout helper has no HTTP runtime', 2);
}
