/* global E2E_TREASURY_URL, E2E_TREASURY_KEY, E2E_TREASURY_MAX_SAT, E2E_TREASURY_MAX_FEE_SAT, output, maestro, http */
/* global TREASURY_FEE_RESERVE_SAT, TREASURY_VISIBLE, TREASURY_MEMO, TREASURY_CMD, TREASURY_SAT, TREASURY_BOLT11, TREASURY_HASH */
// Lightning counterpart for P14-P17. Speaks the LNbits HTTP API.
// Prints only the value the caller needs. Never prints the key or a
// full invoice except the single BOLT11 from the invoice command.

function fail(message, code) {
  const text = String(message || 'Treasury request failed');
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
    if (name === 'E2E_TREASURY_URL' && typeof E2E_TREASURY_URL !== 'undefined') {
      return scriptBinding(E2E_TREASURY_URL);
    }
    if (name === 'E2E_TREASURY_KEY' && typeof E2E_TREASURY_KEY !== 'undefined') {
      return scriptBinding(E2E_TREASURY_KEY);
    }
    if (name === 'E2E_TREASURY_MAX_SAT' && typeof E2E_TREASURY_MAX_SAT !== 'undefined') {
      return scriptBinding(E2E_TREASURY_MAX_SAT);
    }
    if (name === 'E2E_TREASURY_MAX_FEE_SAT' && typeof E2E_TREASURY_MAX_FEE_SAT !== 'undefined') {
      return scriptBinding(E2E_TREASURY_MAX_FEE_SAT);
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
  const url = readEnv('E2E_TREASURY_URL').trim().replace(/\/+$/, '');
  const key = readEnv('E2E_TREASURY_KEY').trim();
  if (!url || !key) {
    fail('E2E_TREASURY_URL and E2E_TREASURY_KEY are required', 2);
  }
  if (!/^https?:\/\//i.test(url)) {
    fail('E2E_TREASURY_URL must be an http or https URL', 2);
  }
  const maxSatRaw = readEnv('E2E_TREASURY_MAX_SAT').trim();
  const maxFeeRaw = readEnv('E2E_TREASURY_MAX_FEE_SAT').trim();
  const maxSat = maxSatRaw ? Number(maxSatRaw) : 1000;
  const maxFeeSat = maxFeeRaw ? Number(maxFeeRaw) : 100;
  if (!Number.isInteger(maxSat) || maxSat <= 0) {
    fail('E2E_TREASURY_MAX_SAT must be a positive integer', 2);
  }
  if (!Number.isInteger(maxFeeSat) || maxFeeSat < 0) {
    fail('E2E_TREASURY_MAX_FEE_SAT must be a non-negative integer', 2);
  }
  return { url: url, key: key, maxSat: maxSat, maxFeeSat: maxFeeSat };
}

function parseSat(value, label) {
  const sat = Number(value);
  if (!Number.isInteger(sat) || sat <= 0) {
    fail(label + ' must be a positive integer sat amount', 2);
  }
  return sat;
}

function assertWithinMax(sat, maxSat) {
  if (sat > maxSat) {
    fail('Requested amount exceeds E2E_TREASURY_MAX_SAT', 2);
  }
}

function bolt11AmountSat(invoice) {
  const match = String(invoice || '')
    .trim()
    .toLowerCase()
    .match(/^lnbc(?:([1-9][0-9]*)([munp]?))?1[02-9ac-hj-np-z]+$/);
  if (!match) return null;
  if (!match[1]) return null;
  const n = Number(match[1]);
  const mul = match[2] || '';
  let sat;
  if (mul === '') sat = n * 100000000;
  else if (mul === 'm') sat = n * 100000;
  else if (mul === 'u') sat = n * 100;
  else if (mul === 'n') sat = n / 10;
  else if (mul === 'p') sat = n / 10000;
  else return null;
  if (!Number.isFinite(sat) || sat <= 0 || Math.floor(sat) !== sat) return null;
  return sat;
}

function extractBolt11(text) {
  const match = String(text || '').match(/lnbc[0-9a-z]+/i);
  return match ? match[0] : '';
}

function extractPaymentHash(value) {
  const match = String(value || '').match(/^[0-9a-f]{64}$/i);
  return match ? match[0] : '';
}

function readCopiedText() {
  if (typeof maestro !== 'undefined' && maestro.copiedText) return String(maestro.copiedText);
  return '';
}

function tryParseVisibleSat(text) {
  const match = String(text || '').match(/([0-9][0-9.,\u00a0\s]*)sats/i);
  if (!match) return null;
  const sat = Number(match[1].replace(/[^\d]/g, ''));
  if (!Number.isInteger(sat) || sat < 0) return null;
  return sat;
}

function parseVisibleSat(text) {
  const sat = tryParseVisibleSat(text);
  if (sat === null) fail('Visible Spark balance could not be read', 2);
  if (sat <= 0) fail('Visible Spark balance was not a positive sat amount', 2);
  return sat;
}

function readFeeReserveSat() {
  const raw = scriptBinding(typeof TREASURY_FEE_RESERVE_SAT !== 'undefined' ? TREASURY_FEE_RESERVE_SAT : '').trim();
  if (!raw) return 4;
  const sat = Number(raw);
  if (!Number.isInteger(sat) || sat < 0) {
    fail('TREASURY_FEE_RESERVE_SAT must be a non-negative integer', 2);
  }
  return sat;
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
    fail('Treasury counterpart returned a non-JSON response [' + (raw === undefined ? 'UNDEFINED' : (raw === null ? 'NULL' : String(raw).slice(0, 60))) + ']', 2);
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
    fail('Treasury helper has no HTTP runtime', 2);
  }
  const code = Number(response && response.status);
  if (!Number.isInteger(code) || code < 200 || code >= 300) {
    fail('Treasury request failed with HTTP ' + (response && response.status), 2);
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
          reject(new Error('Treasury request failed with HTTP ' + res.statusCode));
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(new Error('Treasury counterpart returned a non-JSON response'));
        }
      });
    });
    req.setTimeout(60000, function () {
      req.destroy();
      reject(new Error('Treasury request timed out'));
    });
    req.on('error', function () {
      reject(new Error('Treasury request failed'));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

function httpJsonSync(config, method, path, body) {
  if (!hasMaestroHttp()) fail('Treasury helper has no HTTP runtime', 2);
  return httpJsonMaestro(config, method, path, body);
}

function msatToSat(value) {
  const msat = Number(value);
  if (!Number.isFinite(msat)) fail('Treasury balance was not a number', 2);
  return Math.floor(msat / 1000);
}

function paymentHashFrom(result) {
  const hash = extractPaymentHash(result && (result.payment_hash || result.paymentHash));
  if (!hash) fail('Treasury counterpart did not return a payment hash', 2);
  return hash;
}

function bolt11From(result) {
  const invoice = String((result && (result.payment_request || result.bolt11)) || '').trim();
  if (!/^lnbc[0-9a-z]+$/i.test(invoice)) fail('Treasury counterpart did not return a BOLT11 invoice', 2);
  return invoice;
}

function feeSatFrom(result) {
  const details = result && result.details;
  const fee = details && details.fee;
  if (fee === undefined || fee === null) return 0;
  const msat = Math.abs(Number(fee));
  if (!Number.isFinite(msat)) return 0;
  return Math.floor(msat / 1000);
}

function applyBalance(result) {
  const sat = msatToSat(result && result.balance);
  setOutput('treasuryBalanceSat', sat);
  writeStdout(String(sat));
}

function applyInvoice(result) {
  const invoice = bolt11From(result);
  const hash = paymentHashFrom(result);
  setOutput('bolt11', invoice);
  setOutput('paymentHash', hash);
  writeStdout(invoice);
}

function applyRefund(config, text, memo) {
  const visibleSat = parseVisibleSat(text);
  const reserve = readFeeReserveSat();
  const sat = visibleSat - reserve;
  if (sat <= 0) fail('Visible Spark balance is too small to return after the fee reserve', 2);
  setOutput('visibleSat', String(visibleSat));
  setOutput('refundSat', String(sat));
  applyInvoice(httpJsonSync(config, 'POST', '/api/v1/payments', prepareInvoice(config, sat, memo || 'Maestro-E2E-return')));
}

function skipRefund(reason) {
  setOutput('refundDue', 'false');
  setOutput('refundSkip', reason);
  writeStdout('refund skipped: ' + reason);
}

function refundAmountFrom(text) {
  const visibleSat = tryParseVisibleSat(text);
  if (visibleSat === null) return { skip: 'unreadable' };
  if (visibleSat === 0) return { skip: 'zero' };
  const reserve = readFeeReserveSat();
  const sat = visibleSat - reserve;
  if (sat <= 0) return { skip: 'below-reserve' };
  return { visibleSat: visibleSat, sat: sat };
}

function applyRefundIfDue(config, text, memo) {
  const parsed = refundAmountFrom(text);
  if (parsed.skip === 'unreadable') {
    fail('Visible Spark balance could not be read', 2);
  }
  if (parsed.skip) {
    skipRefund(parsed.skip);
    return;
  }
  setOutput('refundDue', 'true');
  setOutput('refundSkip', '');
  setOutput('visibleSat', String(parsed.visibleSat));
  setOutput('refundSat', String(parsed.sat));
  applyInvoice(
    httpJsonSync(config, 'POST', '/api/v1/payments', prepareInvoice(config, parsed.sat, memo || 'Maestro-E2E-return')),
  );
}

function refundText(parsed) {
  return parsed.args[1] || scriptBinding(typeof TREASURY_VISIBLE !== 'undefined' ? TREASURY_VISIBLE : '') || readCopiedText();
}

function refundMemo() {
  return scriptBinding(typeof TREASURY_MEMO !== 'undefined' ? TREASURY_MEMO : '') || 'Maestro-E2E-return';
}

function applyPay(config, result) {
  const hash = paymentHashFrom(result);
  const feeSat = feeSatFrom(result);
  if (feeSat > config.maxFeeSat) fail('Treasury fee exceeds E2E_TREASURY_MAX_FEE_SAT', 2);
  setOutput('paymentHash', hash);
  writeStdout(hash);
}

function applyStatus(result) {
  const paid = !!(result && result.paid === true);
  setOutput('treasuryPaid', paid ? 'true' : 'false');
  writeStdout(paid ? 'paid=true' : 'paid=false');
}

function prepareInvoice(config, sat, memo) {
  assertWithinMax(sat, config.maxSat);
  return { out: false, amount: sat, memo: memo || '' };
}

function preparePay(config, invoice) {
  const bolt11 = extractBolt11(invoice);
  if (!bolt11) fail('No BOLT11 invoice found', 2);
  const sat = bolt11AmountSat(bolt11);
  if (sat === null) fail('BOLT11 amount is missing or not a whole-sat value', 2);
  assertWithinMax(sat, config.maxSat);
  return { out: true, bolt11: bolt11 };
}

function prepareStatus(hash) {
  const paymentHash = extractPaymentHash(hash);
  if (!paymentHash) fail('status requires a 64-character hex payment hash', 2);
  return paymentHash;
}

function cliArgs() {
  if (!isNode() || !process.argv) return [];
  return process.argv.slice(2);
}

function usage() {
  fail(
    'Usage: node treasury.js balance|invoice <sat> [memo]|pay <bolt11>|status <hash>|refund [visible-text]|refundIfDue [visible-text]',
    2,
  );
}

function parsedCommand() {
  const args = cliArgs();
  const command = args[0] || scriptBinding(typeof TREASURY_CMD !== 'undefined' ? TREASURY_CMD : '').trim();
  if (!command) usage();
  return { args: args, command: command };
}

function dispatchSync(config, parsed) {
  if (parsed.command === 'balance') {
    applyBalance(httpJsonSync(config, 'GET', '/api/v1/wallet'));
    return;
  }
  if (parsed.command === 'invoice') {
    const sat = parseSat(parsed.args[1] || scriptBinding(typeof TREASURY_SAT !== 'undefined' ? TREASURY_SAT : ''), 'invoice amount');
    const memo = parsed.args.slice(2).join(' ') || scriptBinding(typeof TREASURY_MEMO !== 'undefined' ? TREASURY_MEMO : '');
    applyInvoice(httpJsonSync(config, 'POST', '/api/v1/payments', prepareInvoice(config, sat, memo)));
    return;
  }
  if (parsed.command === 'pay') {
    const invoice =
      parsed.args[1] || scriptBinding(typeof TREASURY_BOLT11 !== 'undefined' ? TREASURY_BOLT11 : '') || readCopiedText();
    applyPay(config, httpJsonSync(config, 'POST', '/api/v1/payments', preparePay(config, invoice)));
    return;
  }
  if (parsed.command === 'status') {
    const hash = parsed.args[1] || scriptBinding(typeof TREASURY_HASH !== 'undefined' ? TREASURY_HASH : '');
    const fromOutput = typeof output !== 'undefined' && output.paymentHash ? String(output.paymentHash) : '';
    applyStatus(httpJsonSync(config, 'GET', '/api/v1/payments/' + prepareStatus(hash || fromOutput)));
    return;
  }
  if (parsed.command === 'refund') {
    applyRefund(config, refundText(parsed), refundMemo());
    return;
  }
  if (parsed.command === 'refundIfDue') {
    applyRefundIfDue(config, refundText(parsed), refundMemo());
    return;
  }
  usage();
}

function dispatchAsync(config, parsed) {
  let pending;
  if (parsed.command === 'balance') {
    pending = httpJsonNode(config, 'GET', '/api/v1/wallet').then(applyBalance);
  } else if (parsed.command === 'invoice') {
    const sat = parseSat(parsed.args[1] || scriptBinding(typeof TREASURY_SAT !== 'undefined' ? TREASURY_SAT : ''), 'invoice amount');
    const memo = parsed.args.slice(2).join(' ') || scriptBinding(typeof TREASURY_MEMO !== 'undefined' ? TREASURY_MEMO : '');
    pending = httpJsonNode(config, 'POST', '/api/v1/payments', prepareInvoice(config, sat, memo)).then(applyInvoice);
  } else if (parsed.command === 'pay') {
    const invoice =
      parsed.args[1] || scriptBinding(typeof TREASURY_BOLT11 !== 'undefined' ? TREASURY_BOLT11 : '') || readCopiedText();
    pending = httpJsonNode(config, 'POST', '/api/v1/payments', preparePay(config, invoice)).then(function (result) {
      applyPay(config, result);
    });
  } else if (parsed.command === 'status') {
    const hash = parsed.args[1] || scriptBinding(typeof TREASURY_HASH !== 'undefined' ? TREASURY_HASH : '');
    const fromOutput = typeof output !== 'undefined' && output.paymentHash ? String(output.paymentHash) : '';
    pending = httpJsonNode(config, 'GET', '/api/v1/payments/' + prepareStatus(hash || fromOutput)).then(applyStatus);
  } else if (parsed.command === 'refund') {
    const visibleSat = parseVisibleSat(refundText(parsed));
    const reserve = readFeeReserveSat();
    const sat = visibleSat - reserve;
    if (sat <= 0) fail('Visible Spark balance is too small to return after the fee reserve', 2);
    const memo = refundMemo();
    pending = httpJsonNode(config, 'POST', '/api/v1/payments', prepareInvoice(config, sat, memo)).then(function (result) {
      setOutput('visibleSat', String(visibleSat));
      setOutput('refundSat', String(sat));
      applyInvoice(result);
    });
  } else if (parsed.command === 'refundIfDue') {
    const parsedAmount = refundAmountFrom(refundText(parsed));
    if (parsedAmount.skip === 'unreadable') {
      fail('Visible Spark balance could not be read', 2);
    } else if (parsedAmount.skip) {
      skipRefund(parsedAmount.skip);
      pending = Promise.resolve();
    } else {
      const memo = refundMemo();
      pending = httpJsonNode(
        config,
        'POST',
        '/api/v1/payments',
        prepareInvoice(config, parsedAmount.sat, memo),
      ).then(function (result) {
        setOutput('refundDue', 'true');
        setOutput('refundSkip', '');
        setOutput('visibleSat', String(parsedAmount.visibleSat));
        setOutput('refundSat', String(parsedAmount.sat));
        applyInvoice(result);
      });
    }
  } else {
    usage();
  }
  return pending;
}

const config = loadConfig();
const parsed = parsedCommand();
if (hasMaestroHttp()) {
  dispatchSync(config, parsed);
} else if (isNode()) {
  dispatchAsync(config, parsed)
    .then(function () {
      process.exit(0);
    })
    .catch(function (error) {
      fail(error && error.message ? error.message : 'Treasury request failed', 2);
    });
} else {
  fail('Treasury helper has no HTTP runtime', 2);
}
