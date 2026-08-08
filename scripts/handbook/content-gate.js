#!/usr/bin/env node
/**
 * Content gate for the built handbook.
 *
 *   node scripts/handbook/content-gate.js <builtDir>
 *
 * The handbook is published without authentication, so every pixel in it is
 * public. This gate is the last check between a screenshot and the open web.
 * It runs against the BUILT output, not against a source directory: the build
 * is what ships, and deriving the scan set from it closes three ways an image
 * could reach the public unscanned.
 *
 *   - New sources. The predecessor scanned a hard-coded
 *     `docs/handbook/screenshots`, so the 28 PNGs the build pulls from
 *     `img/dfx/**` and `img/icon*.png` were never looked at — including
 *     `img/dfx/backup-phrase.png`. Any future source would have been missed
 *     the same way.
 *   - Upper-case extensions. `build.js` discovers PNGs case-insensitively
 *     (`name.toLowerCase().endsWith('.png')`), the predecessor scanned with
 *     `find -name '*.png'`. A file named `seed.PNG` was therefore published
 *     and never scanned.
 *   - An empty scan. A loop over zero files reports success. Here the manifest
 *     states which PNGs must exist, the disk states which do, and the two sets
 *     must match exactly — scanning nothing is a failure, not a pass.
 *
 * Two checks run over that set:
 *
 *   QR — a decodable QR in a screenshot is an address, a payment request or,
 *   worst case, an encoded seed. Only the receive-address screen may carry one.
 *
 *   Seed phrase — a QR gate is blind to the higher risk: a recovery phrase
 *   printed as plain text on a backup screen. OCR every image and look for a
 *   run of consecutive BIP39 words. See SEED_RUN_LIMIT for the threshold.
 *
 * Requires `zbarimg` (zbar-tools) and `tesseract` on PATH, and the repository's
 * own `bip39` dependency resolvable. A missing tool fails the gate — a gate
 * that skips itself is not a gate.
 *
 * Everything above the `main()` line is pure and exported, so the rules are
 * unit-tested without zbarimg or tesseract installed; the workflow exercises
 * the real tools end to end on every handbook PR.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * Built paths that may legitimately contain a decodable QR, with the reason.
 * Entries are validated in both directions: an entry that no longer exists, or
 * that no longer carries a QR, fails the build. A stale allowlist silently
 * covers whatever moves into its path next.
 */
const QR_ALLOWLIST = {
  'screenshots/04-empfangen-senden/01-erhalten.png': 'receive screen — the QR is the subject of the screenshot',
};

/**
 * Fail when this many consecutive BIP39 words are read out of one image.
 *
 * The shortest real phrase is 12 words, so anything at or above this threshold
 * is far below a leak and far above prose. Measured over the 70 PNGs the
 * handbook currently publishes, the longest run is 3 ("open source push", from
 * the notification-settings screen), so 5 keeps headroom on both sides.
 *
 * Digits and punctuation are transparent: a phrase rendered as a numbered grid
 * ("1 abandon 2 ability …") still reads as one run. Any non-BIP39 word breaks
 * it, which is what keeps ordinary prose far below the threshold.
 */
const SEED_RUN_LIMIT = 5;

/** Longest runs worth naming in the summary, for diagnosis. */
const REPORT_TOP_N = 5;

/** PNG output paths the manifest claims are published. */
function collectDeclaredPngs(manifest) {
  if (!manifest || !Array.isArray(manifest.artifacts)) {
    throw new Error('manifest has no artifacts array');
  }
  return new Set(manifest.artifacts.map(a => a && a.outputPath).filter(p => typeof p === 'string' && p.toLowerCase().endsWith('.png')));
}

/**
 * The anti-vacuous-pass guard. `declared` (from the manifest) and `onDisk`
 * must describe the same set: an empty scan cannot satisfy it, and an image
 * that ships without being declared is caught rather than skipped.
 */
function scanSetProblems(declared, onDisk) {
  if (declared.size === 0) {
    return ['the manifest declares no PNG artifacts — nothing to scan means the ' + 'gate cannot vouch for anything'];
  }
  const undeclared = [...onDisk].filter(p => !declared.has(p)).sort();
  const missing = [...declared].filter(p => !onDisk.has(p)).sort();
  if (!undeclared.length && !missing.length) return [];

  const lines = ['the published PNG set does not match the manifest, so the scan set cannot be trusted:'];
  if (undeclared.length) {
    lines.push('    shipped but not declared in the manifest:');
    lines.push(...undeclared.map(p => `      ${p}`));
  }
  if (missing.length) {
    lines.push('    declared in the manifest but absent on disk:');
    lines.push(...missing.map(p => `      ${p}`));
  }
  return [lines.join('\n')];
}

/**
 * `qrByPath`: built path -> decoded payload, for the images that carry one.
 * Checked in both directions so the allowlist cannot outlive its reason.
 */
function qrProblems(qrByPath, declared, allowlist) {
  const problems = [];
  for (const [rel, payload] of qrByPath) {
    if (Object.prototype.hasOwnProperty.call(allowlist, rel)) continue;
    problems.push(`QR decoded in a non-allowlisted image: ${rel}\n` + `    payload starts: ${String(payload).slice(0, 80)}`);
  }
  for (const rel of Object.keys(allowlist)) {
    if (!declared.has(rel)) {
      problems.push(
        `stale QR allowlist entry: ${rel} is not published any more. Remove ` +
          'the entry — otherwise it silently covers whatever moves into that path next.',
      );
    } else if (!qrByPath.has(rel)) {
      problems.push(
        `pointless QR allowlist entry: ${rel} no longer contains a decodable QR. ` +
          'Remove the entry so the image is held to the same rule as the rest.',
      );
    }
  }
  return problems.sort();
}

/**
 * Longest run of consecutive BIP39 words in OCR text.
 *
 * Only alphabetic tokens are considered, so digits and punctuation are
 * transparent and a numbered seed grid reads as one run; any non-BIP39 word
 * ends the run.
 */
function longestBip39Run(text, words) {
  const tokens =
    String(text)
      .toLowerCase()
      .match(/[a-z]+/g) || [];
  let best = [];
  let run = [];
  for (const t of tokens) {
    if (words.has(t)) {
      run.push(t);
      if (run.length > best.length) best = run.slice();
    } else {
      run = [];
    }
  }
  return best;
}

/** `runs`: [{ rel, run }], sorted longest first. */
function seedProblems(runs, limit) {
  return runs
    .filter(r => r.run.length >= limit)
    .map(
      ({ rel, run }) =>
        `${run.length} consecutive BIP39 words read out of ${rel} (limit ${limit}): ` +
        `${run.slice(0, 24).join(' ')}\n` +
        '    If this is a recovery phrase, the screenshot must not be published at ' +
        'all. If it is a false positive, redact or replace the image — the ' +
        'threshold is not the place to fix it.',
    );
}

// ---------------------------------------------------------------------------
// Everything below touches the filesystem or external tools.
// ---------------------------------------------------------------------------

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

/** Every file under `dir` whose name ends in .png, case-insensitive. */
function listPngRecursive(dir) {
  const out = [];
  function walk(absDir, relDir) {
    for (const d of fs.readdirSync(absDir, { withFileTypes: true })) {
      const rel = relDir ? path.posix.join(relDir, d.name) : d.name;
      if (d.isDirectory()) walk(path.join(absDir, d.name), rel);
      else if (d.isFile() && d.name.toLowerCase().endsWith('.png')) out.push(rel);
    }
  }
  walk(dir, '');
  return out.sort();
}

/** Hard-fail unless `tool` is usable. */
function requireTool(tool, versionArgs, hint) {
  try {
    execFileSync(tool, versionArgs, { stdio: 'pipe' });
  } catch (e) {
    fail(`handbook content gate: ${tool} is not usable (${e.message}). ${hint} ` + 'The gate does not skip checks it cannot run.');
  }
}

/** BIP39 English wordlist from the repository's own dependency. */
function loadBip39Words() {
  let bip39;
  try {
    bip39 = require('bip39');
  } catch (e) {
    fail(
      `handbook content gate: cannot resolve the bip39 package (${e.message}). ` +
        'It is a dependency of this repository — install it, or point NODE_PATH ' +
        'at a prefix that has it.',
    );
  }
  const words = bip39.wordlists && bip39.wordlists.english;
  if (!Array.isArray(words) || words.length !== 2048) {
    fail(
      'handbook content gate: bip39.wordlists.english is not the expected ' +
        `2048-word list (got ${Array.isArray(words) ? words.length : typeof words}).`,
    );
  }
  return new Set(words);
}

/** Decoded QR payload of one image, or '' when it carries none. */
function decodeQr(absPath) {
  try {
    return execFileSync('zbarimg', ['-q', '--raw', absPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (e) {
    // 4 is zbarimg's "no symbol found" — the normal case here. Every other
    // exit code means the image was not scanned, which is not the same as
    // clean: a `|| true` there would pass an unreadable file as safe.
    if (e.status === 4) return '';
    fail(`handbook content gate: zbarimg failed on ${absPath} (exit ${e.status}). ` + 'Cannot certify the image as QR-free.');
  }
}

/** OCR text of one image. */
function ocr(absPath) {
  try {
    return execFileSync('tesseract', [absPath, 'stdout', '-l', 'eng'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (e) {
    fail(`handbook content gate: tesseract failed on ${absPath} (exit ${e.status}). ` + 'Cannot certify the image as seed-free.');
  }
}

function main() {
  const builtDir = process.argv[2];
  if (!builtDir) {
    fail('usage: node scripts/handbook/content-gate.js <builtDir>');
  }
  if (!fs.existsSync(builtDir) || !fs.statSync(builtDir).isDirectory()) {
    fail(`handbook content gate: ${builtDir} is not a directory (build first).`);
  }
  // Resolve symlinks before handing paths to the external tools. On macOS
  // `/tmp` is a symlink to `/private/tmp`, and the Homebrew tesseract cannot
  // open through it ("failed to open locally with tail …") — an unresolved
  // path would abort the gate on every developer machine.
  const root = fs.realpathSync(path.resolve(builtDir));

  const manifestPath = path.join(root, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    fail(`handbook content gate: no manifest.json in ${root} (build first).`);
  }
  let declared;
  try {
    declared = collectDeclaredPngs(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
  } catch (e) {
    fail(`handbook content gate: unusable manifest.json (${e.message}).`);
  }

  const scanProblems = scanSetProblems(declared, new Set(listPngRecursive(root)));
  if (scanProblems.length) {
    fail('handbook content gate: ' + scanProblems.join('\n  '));
  }

  const files = [...declared].sort();
  requireTool('zbarimg', ['--version'], 'Install zbar-tools.');
  requireTool('tesseract', ['--version'], 'Install tesseract-ocr.');
  const words = loadBip39Words();

  const qrByPath = new Map();
  const runs = [];
  for (const rel of files) {
    const abs = path.join(root, rel);
    const payload = decodeQr(abs);
    if (payload) qrByPath.set(rel, payload);
    const run = longestBip39Run(ocr(abs), words);
    if (run.length) runs.push({ rel, run });
  }
  runs.sort((a, b) => b.run.length - a.run.length || a.rel.localeCompare(b.rel));

  const longest = runs.length ? runs[0].run.length : 0;
  console.log(
    `handbook content gate: scanned ${files.length} published PNGs — ` +
      `${qrByPath.size} with a QR (${Object.keys(QR_ALLOWLIST).length} allowlisted), ` +
      `longest BIP39 run ${longest} (limit ${SEED_RUN_LIMIT}).`,
  );
  for (const { rel, run } of runs.slice(0, REPORT_TOP_N)) {
    console.log(`  ${String(run.length).padStart(2)} ${rel}: ${run.join(' ')}`);
  }

  const problems = [...qrProblems(qrByPath, declared, QR_ALLOWLIST), ...seedProblems(runs, SEED_RUN_LIMIT)];
  if (problems.length) {
    fail('handbook content gate failed:\n  ' + problems.join('\n  '));
  }
}

module.exports = {
  QR_ALLOWLIST,
  SEED_RUN_LIMIT,
  collectDeclaredPngs,
  scanSetProblems,
  qrProblems,
  longestBip39Run,
  seedProblems,
};

if (require.main === module) main();
