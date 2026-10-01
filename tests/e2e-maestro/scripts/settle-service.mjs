'use strict';

import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

// LOCAL TEST HELPER ONLY. This process writes bank-return fixture data directly
// into the local DFX database. Never point it at a development or production
// stack.
const DEFAULT_PORT = 18790;
const CONTAINER = process.env.SETTLE_DB_CONTAINER || 'spark276-db-1';
const BODY_LIMIT = 4096;

function failBoot(message) {
  console.error(message);
  process.exit(2);
}

function parsePort(raw) {
  if (raw == null || raw === '') return DEFAULT_PORT;
  if (!/^[1-9][0-9]*$/.test(String(raw))) failBoot('SETTLE_PORT must be a positive integer');
  const port = Number(raw);
  if (port > 65535) failBoot('SETTLE_PORT is out of range');
  return port;
}

function assertLocalApiUrl(raw) {
  if (raw == null || raw === '') failBoot('E2E_API_URL is missing');
  let url;
  try {
    url = new URL(String(raw));
  } catch (error) {
    failBoot('E2E_API_URL must be a valid local HTTP URL');
  }
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
  if (url.protocol !== 'http:' || !loopbackHosts.has(url.hostname)) {
    failBoot('E2E_API_URL must point to a local HTTP loopback stack');
  }
}

function keysEqual(got, expected) {
  const a = Buffer.from(String(got || ''), 'utf8');
  const b = Buffer.from(String(expected || ''), 'utf8');
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function readHeader(req, name) {
  const headers = req.headers || {};
  const want = String(name).toLowerCase();
  for (const key of Object.keys(headers)) {
    if (String(key).toLowerCase() === want) {
      const value = headers[key];
      return Array.isArray(value) ? String(value[0] || '') : String(value || '');
    }
  }
  return '';
}

function readJson(req) {
  return new Promise(function (resolve, reject) {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', function (chunk) {
      raw += chunk;
      if (raw.length > BODY_LIMIT) reject(new Error('body too large'));
    });
    req.on('end', function () {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', function () {
      reject(new Error('invalid json'));
    });
  });
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function parseTransactionId(body) {
  const raw = body && body.transactionId;
  if (raw === undefined || raw === null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function assertPsqlValue(name, value) {
  const text = value == null ? '' : String(value);
  if (/[\n\r\0]/.test(text)) {
    throw new Error(name + ' contains illegal characters');
  }
  return text;
}

function psql(vars, sql) {
  // docker exec + psql -c does not interpolate :vars; stdin does.
  const args = [
    'exec',
    '-i',
    CONTAINER,
    'psql',
    '-U',
    'sa',
    '-d',
    'dfx',
    '--no-psqlrc',
    '-v',
    'ON_ERROR_STOP=1',
    '-A',
    '-t',
    '-q',
  ];
  for (const [key, value] of Object.entries(vars || {})) {
    args.push('-v', key + '=' + assertPsqlValue(key, value));
  }
  const payload = /;\s*$/.test(sql) ? sql : sql + ';';
  return new Promise(function (resolve, reject) {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(function () {
      child.kill('SIGKILL');
    }, 20000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', function (chunk) {
      stdout += chunk;
    });
    child.stderr.on('data', function (chunk) {
      stderr += chunk;
    });
    child.on('error', function (error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', function (code) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        const containerMissing = /\bNo such container\b/i.test(stderr);
        const message = containerMissing
          ? 'database container ' + JSON.stringify(CONTAINER) + ' was not found; set SETTLE_DB_CONTAINER to the local database container name'
          : 'psql failed';
        const error = new Error(message);
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(String(stdout || '').trim());
    });
    child.stdin.on('error', function () {});
    child.stdin.end(payload);
  });
}

async function psqlJson(vars, sql) {
  const text = await psql(vars, sql);
  if (!text) return null;
  return JSON.parse(text);
}

const LOAD_BUY_FIAT_SQL = `
SELECT json_build_object(
  'buyFiatId', bf.id,
  'fiatOutputId', fo.id,
  'cryptoInputId', bf."cryptoInputId",
  'accountIban', fo."accountIban",
  'currency', fo.currency,
  'amount', fo.amount,
  'valutaDate', fo."valutaDate",
  'remittanceInfo', fo."remittanceInfo",
  'frickReference', fo."frickReference",
  'frickCustomId', fo."frickCustomId",
  'endToEndId', fo."endToEndId",
  'isReadyDate', fo."isReadyDate",
  'bankTxId', fo."bankTxId"
)
FROM buy_fiat bf
LEFT JOIN fiat_output fo ON fo.id = bf."fiatOutputId"
WHERE bf."transactionId" = :transaction_id
LIMIT 1
`.trim();

const FIND_EXISTING_SQL = `
SELECT json_build_object('id', bt.id)
FROM bank_tx bt
WHERE bt."creditDebitIndicator" = 'DBIT'
  AND UPPER(REPLACE(bt."accountIban", ' ', '')) = UPPER(REPLACE(:'iban', ' ', ''))
  AND UPPER(bt.currency) = UPPER(:'currency')
  AND ABS((bt.amount - COALESCE(bt."chargeAmount", 0)) - :amount) < 0.005
  AND REPLACE(COALESCE(bt."remittanceInfo", ''), ' ', '') = REPLACE(:'remittance', ' ', '')
  AND NOT EXISTS (
    SELECT 1 FROM fiat_output fo WHERE fo."bankTxId" = bt.id
  )
ORDER BY bt.id DESC
LIMIT 1
`.trim();

const INSERT_SQL = `
INSERT INTO bank_tx (
  "creditDebitIndicator",
  "accountIban",
  currency,
  amount,
  "remittanceInfo",
  "endToEndId",
  "accountServiceRef",
  created,
  updated
) VALUES (
  'DBIT',
  :'iban',
  :'currency',
  :amount,
  :'remittance',
  NULLIF(:'e2e', ''),
  :'aref',
  NOW(),
  NOW()
)
RETURNING json_build_object('id', id)
`.trim();

function emptyValue(value) {
  return value == null || value === '';
}

function missingBackendField(row) {
  if (!row.fiatOutputId) return 'fiat_output is not assigned yet';
  if (!row.accountIban) return 'accountIban is not set yet';
  if (row.amount == null || !Number.isFinite(Number(row.amount))) return 'amount is not set yet';
  if (!row.currency) return 'currency is not set yet';
  return null;
}

function frickCustomIdFor(fiatOutputId) {
  return 'DFX-FO-' + fiatOutputId;
}

function frickReferenceFor(fiatOutputId, cryptoInputId) {
  return 'DFX-FO-' + fiatOutputId + ' DFX Payment: 754' + cryptoInputId;
}

async function fillReadyFields(row) {
  const filled = [];
  const assignments = [];
  const vars = { fo_id: String(row.fiatOutputId) };

  if (emptyValue(row.valutaDate)) {
    assignments.push('"valutaDate" = COALESCE("valutaDate", NOW())');
    filled.push('valutaDate');
  }
  if (emptyValue(row.frickReference) && row.cryptoInputId != null && Number.isFinite(Number(row.cryptoInputId))) {
    vars.frick_ref = frickReferenceFor(row.fiatOutputId, row.cryptoInputId);
    assignments.push('"frickReference" = COALESCE(NULLIF("frickReference", \'\'), :\'frick_ref\')');
    filled.push('frickReference');
  }

  // BuyFiat.complete verlangt remittanceInfo, outputDate und bankTx. Der
  // Cron-Schritt setzt remittanceInfo zusammen mit der Frick-Referenz; fehlt
  // es, bleibt der Verkauf offen, obwohl die Bankzeile schon zugeordnet ist.
  if (emptyValue(row.remittanceInfo) && row.cryptoInputId != null && Number.isFinite(Number(row.cryptoInputId))) {
    vars.rem_info = 'DFX Payment: 754' + String(row.cryptoInputId);
    assignments.push('"remittanceInfo" = COALESCE(NULLIF("remittanceInfo", \'\'), :\'rem_info\')');
    filled.push('remittanceInfo');
  }
  if (emptyValue(row.frickCustomId)) {
    vars.frick_custom = frickCustomIdFor(row.fiatOutputId);
    assignments.push('"frickCustomId" = COALESCE(NULLIF("frickCustomId", \'\'), :\'frick_custom\')');
    filled.push('frickCustomId');
  }
  if (emptyValue(row.isReadyDate)) {
    assignments.push('"isReadyDate" = COALESCE("isReadyDate", NOW())');
    filled.push('isReadyDate');
  }

  if (assignments.length === 0) return filled;

  assignments.push('updated = NOW()');
  await psql(
    vars,
    'UPDATE fiat_output SET ' + assignments.join(', ') + ' WHERE id = :fo_id AND "bankTxId" IS NULL',
  );
  return filled;
}

function uniqueAccountServiceRef(buyFiatId) {
  return 'settle-fiat-' + buyFiatId + '-' + Date.now() + '-' + crypto.randomBytes(6).toString('hex');
}

let chain = Promise.resolve();
function serialize(work) {
  const run = chain.then(work, work);
  chain = run.then(
    function () {},
    function () {},
  );
  return run;
}

async function loadBuyFiat(transactionId) {
  return psqlJson({ transaction_id: String(transactionId) }, LOAD_BUY_FIAT_SQL);
}

async function settleFiat(transactionId) {
  let row = await loadBuyFiat(transactionId);
  if (!row) {
    return { status: 404, body: { ok: false, error: 'buy_fiat not found' } };
  }

  const missingBackend = missingBackendField(row);
  if (missingBackend) {
    return { status: 409, body: { ok: false, error: missingBackend } };
  }

  if (row.bankTxId) {
    return { status: 200, body: { ok: true, bankTxId: row.bankTxId, filled: [] } };
  }

  const filled = await fillReadyFields(row);
  if (filled.length > 0) {
    const reloaded = await loadBuyFiat(transactionId);
    if (reloaded) row = reloaded;
  }

  if (emptyValue(row.frickReference)) {
    return { status: 409, body: { ok: false, error: 'frickReference is not set yet' } };
  }

  const vars = {
    iban: row.accountIban,
    currency: row.currency,
    amount: String(row.amount),
    remittance: row.frickReference,
    e2e: row.frickCustomId || '',
  };

  const existing = await psqlJson(vars, FIND_EXISTING_SQL);
  if (existing && existing.id) {
    return { status: 200, body: { ok: true, bankTxId: existing.id, filled: filled } };
  }

  const inserted = await psqlJson(
    { ...vars, aref: uniqueAccountServiceRef(row.buyFiatId) },
    INSERT_SQL,
  );
  if (!inserted || !inserted.id) {
    return { status: 500, body: { ok: false, error: 'insert did not return an id' } };
  }
  return { status: 200, body: { ok: true, bankTxId: inserted.id, filled: filled } };
}

const authKey = process.env.SETTLE_KEY;
if (authKey == null || authKey === '') failBoot('SETTLE_KEY is missing');
assertLocalApiUrl(process.env.E2E_API_URL);
const port = parsePort(process.env.SETTLE_PORT);

const server = http.createServer(function (req, res) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (req.method !== 'POST' || url.pathname !== '/settle-fiat') {
    sendJson(res, req.method === 'POST' ? 404 : 405, { ok: false, error: 'not found' });
    return;
  }

  const provided = readHeader(req, 'x-api-key');
  if (!keysEqual(provided, authKey)) {
    sendJson(res, 401, { ok: false, error: 'unauthorized' });
    return;
  }

  readJson(req)
    .then(function (body) {
      const transactionId = parseTransactionId(body);
      if (!transactionId) {
        sendJson(res, 400, { ok: false, error: 'transactionId must be a positive integer' });
        return;
      }
      return serialize(function () {
        return settleFiat(transactionId);
      }).then(function (result) {
        sendJson(res, result.status, result.body);
      });
    })
    .catch(function (error) {
      const message = error && error.message ? error.message : 'settle failed';
      if (message === 'invalid json' || message === 'body too large') {
        sendJson(res, 400, { ok: false, error: message });
        return;
      }
      console.error('settle failed:', message, error && error.stderr ? error.stderr.trim() : '');
      sendJson(res, 500, { ok: false, error: 'settle failed' });
    });
});

server.listen(port, '127.0.0.1', function () {
  console.log('settle-service listening on 127.0.0.1:' + port);
});
