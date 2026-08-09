#!/usr/bin/env node
/**
 * Content gate for the built handbook.
 *
 *   node scripts/handbook/content-gate.js <builtDir>
 *
 * The handbook is published without authentication, so every pixel in it is
 * public. This gate is the last check in the PR path — `handbook-deploy.yaml`
 * builds and publishes from `develop` without running it. `develop` requires a
 * pull request with one approving review, so nothing reaches it unseen; this
 * job is not a required status check, though, so a red gate does not by itself
 * block the merge. The coverage rests on the review, not on an enforced check.
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
 * Three checks run over that set, plus one check on the checking:
 *
 *   QR — a decodable QR in a screenshot is an address, a payment request or,
 *   worst case, an encoded seed. Only the receive-address screen may carry one,
 *   and only with a payload shaped like a receive address.
 *
 *   Seed phrase — a QR gate is blind to the higher risk: a recovery phrase
 *   printed as plain text on a backup screen. OCR every image and look for a
 *   run of consecutive BIP39 words. See SEED_RUN_LIMIT for the threshold.
 *
 *   Extended public key — an xpub/zpub exposes every address of an account.
 *   Read out of the same OCR text. See EXTENDED_KEY_RE.
 *
 *   OCR yield — a tesseract that returns nothing, for the whole set or for
 *   part of it, would make the two OCR checks above vacuously green. See
 *   MIN_OCR_TOKENS and SCREENSHOTS_MUST_YIELD_OCR.
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
  'screenshots/04-empfangen-senden/01-erhalten.png': {
    // The path alone is not enough. Replace that file with a different
    // screenshot and a path-only allowlist would wave through whatever its QR
    // encodes — including the worst case this gate exists for. The payload has
    // to look like a receive address, or the exception does not apply.
    // Exact shapes, not a loose family: the payload is decoded, not OCR'd, so
    // there is no noise to tolerate. bech32 data alphabet for bc1 (42 for v0
    // P2WPKH, 62 for P2WSH/P2TR), base58 without 0/O/I/l for legacy.
    payload: /^(bitcoin:)?(bc1[02-9ac-hj-np-z]{39}|bc1[02-9ac-hj-np-z]{59}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/,
    reason: 'receive screen — the QR is the subject of the screenshot',
  },
};

/**
 * Fail when this many consecutive BIP39 words are read out of one image.
 *
 * Measured over the 70 PNGs the handbook currently publishes — all of them
 * German UI — the longest run is 3 ("open source push", from the
 * notification-settings screen). English prose sits higher: over this repo's
 * own English markdown the longest run is 6 ("can you make sure you follow"),
 * at roughly 2 hits of 5 or more per 1000 words. The handbook is the German
 * one, so 5 has headroom today.
 *
 * The threshold is deliberately kept low rather than parked above English
 * prose. OCR is imperfect, and a misread word splits a run. For a phrase of n
 * words and limit L, a leak needs the smallest k with n - k <= (k + 1)(L - 1)
 * misreads: for n = 12 that is 2 misreads at L = 5, but only 1 at L = 7 and
 * above. A false red costs one look at an image; a miss costs a published key.
 * If English screenshots ever land here, raise this — but record the
 * measurement, do not guess.
 *
 * Digits and punctuation are transparent: a phrase rendered as a numbered grid
 * ("1 abandon 2 ability …") still reads as one run. Any non-BIP39 word breaks
 * it, which is what keeps ordinary prose below the threshold.
 */
const SEED_RUN_LIMIT = 5;

/**
 * Fewest alphabetic tokens OCR must return across the whole image set before
 * the seed check is believed.
 *
 * Without this the seed half has no counter-check. The QR half does: an
 * allowlisted image that stops decoding fails the build, so a blind zbarimg is
 * caught. A blind tesseract — missing language data, an update that writes to a
 * file instead of stdout — returns empty text for every image, every run is
 * empty, and the gate reports "longest BIP39 run 0" and exits 0. That is the
 * same vacuous pass the scan-set comparison closes one level up.
 *
 * The 70 published PNGs yield 1264 tokens under tesseract 5.5.3 and 1263 under
 * the 5.3.4 the CI runner ships — a spread of one token.
 *
 * 700, not higher: the headroom argument only works pro rata. Dropping to the
 * MIN_SCREENSHOTS floor of 35 images leaves ~1055 tokens if the images that go
 * are average, but the seven most text-rich alone carry ~500, so a legitimate
 * edit could land near 750. A floor above that would report "broken tool" for a
 * content change, which is the wrong diagnosis at the wrong moment.
 *
 * Not lower either: 300 was 24% of the yield, and the four most text-rich
 * images clear that on their own.
 *
 * The sum only measures bulk. Partial blindness is caught by
 * SCREENSHOTS_MUST_YIELD_OCR, which looks at every screenshot individually — that is
 * the real canary, this is the backstop.
 */
const MIN_OCR_TOKENS = 700;

/**
 * Every image under this prefix must return at least one word.
 *
 * This went a round trip. The first version was this prefix rule; review then
 * argued for naming the silent files explicitly and checking the list in both
 * directions, so that for `assets/dfx/backup-phrase.png` — the file this gate
 * widened its scan set to reach — "no phrase found" and "OCR read nothing"
 * would stop being indistinguishable. That version failed CI, and the failure
 * is the argument against it: `assets/dfx/telegram.png` returns one token under
 * tesseract 5.5.3 and none under the 5.3.4 the runner ships. No list can be
 * true on both, and a list checked in both directions is then self-
 * contradictory: listing the file fails on one version, omitting it on the
 * other.
 *
 * Screenshots do not have that problem — the thinnest returns 5 tokens on both
 * versions, and all 42 clear it. Assets are borderline by nature: 21 of 28
 * return nothing at all and the rest one to four words.
 *
 * What is left uncovered is narrow: a tool that goes blind for one asset and
 * nothing else. Real blindness shows up across all 42 screenshots at once, and
 * the token floor catches the bulk case — so the residue is a failure mode
 * nobody has seen, traded against a check that provably cannot hold.
 */
const SCREENSHOTS_MUST_YIELD_OCR = 'screenshots/';

/**
 * Extended public keys. One of them in a screenshot exposes every address of
 * that account, and the handbook documents that an export screen once carried
 * one.
 *
 * Written for OCR output, not for a key on the wire. A rendered 111-character
 * key never comes back in one piece: tesseract breaks it at glyph boundaries
 * and confuses Q/0, 1/l, f/£. Requiring 20 contiguous base58 characters
 * therefore caught 1 of 18 rendered variants of a real zpub; 10 contiguous
 * alphanumerics catch 17 of 18. Insisting on base58 (no 0, O, I, l) buys no
 * precision here and costs detections, because a misread of exactly those
 * characters ends the run. False positives measured at 0 over the OCR text of
 * all 70 published PNGs, every .md and loc/*.json in this repository, and
 * /usr/share/dict/words.
 *
 * Upper case matters for two reasons: this wallet emits `Ypub` and `Zpub` for
 * multisig itself (class/wallets/multisig-hd-wallet.js), and OCR read the
 * leading lower-case `z` as `Z` in all 18 renders. No word boundary — OCR
 * glues the key to the label in front of it.
 *
 * `prv` as well as `pub`: the same wallet class handles xprv/yprv/zprv and
 * their upper-case forms, and an extended PRIVATE key in a screenshot is not
 * an exposure of addresses but of the funds.
 */
const EXTENDED_KEY_RE = /[xyztuvXYZTUV](pub|prv)[A-Za-z0-9]{10,}/;

/** Longest runs worth naming in the summary, for diagnosis. */
const REPORT_TOP_N = 5;

/**
 * Nothing this gate finds is echoed, in any form.
 *
 * The job runs on a public repository, so its log is world-readable, indexed
 * and outlives the branch. Printing the words it recognised would turn a
 * picture into machine-searchable plain text — the gate would publish the very
 * thing it exists to stop, in the cheaper format.
 *
 * Two-character prefixes were the first attempt and are not enough either: for
 * a 12-word phrase they leave far too little to guess, in a log that never
 * expires. Nothing operational is lost by dropping them — every message says to
 * look at the image, and anyone who needs the words runs the gate locally
 * against the same file.
 */
function describeRun(run) {
  return `${run.length} word(s), not shown`;
}

/** Same rule for a decoded QR: shape only, never the content. */
function maskPayload(payload) {
  const p = String(payload);
  return `${p.length} characters, ${p.startsWith('bitcoin:') ? 'bitcoin: prefix' : 'no bitcoin: prefix'}, content not shown`;
}

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
    const entry = Object.prototype.hasOwnProperty.call(allowlist, rel) ? allowlist[rel] : null;
    if (entry && entry.payload.test(String(payload))) continue;
    problems.push(
      (entry
        ? `QR in ${rel} does not match what the allowlist permits (${entry.reason}):\n`
        : `QR decoded in a non-allowlisted image: ${rel}\n`) + `    payload: ${maskPayload(payload)} — decode it locally, not here`,
    );
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
  const tokens = foldAccents(text).match(/[a-z]+/g) || [];
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

/**
 * The counter-check for the seed half: OCR that returns nothing for every image
 * would leave every run empty and report success. See MIN_OCR_TOKENS.
 */
function ocrYieldProblems(tokens, floor) {
  if (tokens >= floor) return [];
  return [
    `OCR returned only ${tokens} alphabetic tokens across the whole image set ` +
      `(floor ${floor}). Two things look like this: a broken tool — check the ` +
      'tesseract install and its language data — or an image set that genuinely ' +
      'lost most of its text. In the second case re-measure and move the floor ' +
      'deliberately; do not move it to make this go away.',
  ];
}

/**
 * `perFile`: [{ rel, tokens }] for every scanned image. Catches a tool that is
 * blind for part of the set — the sum floor above cannot see that.
 */
function ocrCoverageProblems(perFile, prefix) {
  const inScope = perFile.filter(f => f.rel.startsWith(prefix));
  if (inScope.length === 0) {
    // The same vacuous pass the scan-set comparison closes one level up: with
    // nothing to look at, "no silent screenshot" is true and meaningless. The
    // prefix mirrors the output layout of build.js; if that ever moves, this
    // says so instead of quietly checking nothing.
    return [
      `no published image sits under "${prefix}", so the per-screenshot OCR check ` +
        'had nothing to look at. Either the build output moved or the screenshots ' +
        'are gone — both are failures, not a clean run.',
    ];
  }
  const silent = inScope
    .filter(f => f.tokens === 0)
    .map(f => f.rel)
    .sort();
  if (!silent.length) return [];
  return [
    `OCR returned nothing for ${silent.length} screenshot(s), so they were not ` +
      'checked for a recovery phrase or a key at all:\n' +
      silent.map(r => `      ${r}`).join('\n') +
      '\n    A wallet screen without a single readable word means the tool failed ' +
      'on that file.',
  ];
}

/** `found`: [{ rel, key }] — extended keys read out of the images. */
function extendedKeyProblems(found) {
  return found.map(
    ({ rel, key }) =>
      `extended key read out of ${rel}: ${String(key).slice(0, 8)}… ` +
      `(${String(key).length} characters)\n` +
      '    A public one exposes every address of that account; a private one ' +
      '(xprv/zprv) exposes the funds. Truncated on purpose — this log is ' +
      'public. The screenshot must be redacted or replaced.',
  );
}

/**
 * Scan the images and run every check, with the two external tools passed in.
 *
 * Exported and tool-free so a test can drive the whole path — scan, checks,
 * problem list — with stubs, on a machine that has neither zbarimg nor
 * tesseract. Without it the wiring between the tools and the checks was
 * covered by nothing: deleting one line here disarms a check while every unit
 * test stays green, which is the failure mode this whole file exists to close.
 */
function runGate({ files, declared, words, decodeQr, ocr, allowlist = QR_ALLOWLIST, silentAllowed = SCREENSHOTS_MUST_YIELD_OCR }) {
  const qrByPath = new Map();
  const runs = [];
  const extendedKeys = [];
  const perFile = [];
  let ocrTokens = 0;
  for (const rel of files) {
    const payload = decodeQr(rel);
    if (payload) qrByPath.set(rel, payload);
    const text = ocr(rel);
    const tokens = (text.match(/[A-Za-z]+/g) || []).length;
    perFile.push({ rel, tokens });
    ocrTokens += tokens;
    const key = text.match(EXTENDED_KEY_RE);
    if (key) extendedKeys.push({ rel, key: key[0] });
    const run = longestBip39Run(text, words);
    if (run.length) runs.push({ rel, run });
  }
  runs.sort((a, b) => b.run.length - a.run.length || a.rel.localeCompare(b.rel));

  const longest = runs.length ? runs[0].run.length : 0;
  return {
    summary:
      `handbook content gate: scanned ${files.length} published PNGs — ` +
      `${qrByPath.size} with a QR (${Object.keys(allowlist).length} allowlisted), ` +
      `${ocrTokens} OCR tokens (floor ${MIN_OCR_TOKENS}), ` +
      `longest BIP39 run ${longest} (limit ${SEED_RUN_LIMIT}).`,
    detail: runs.slice(0, REPORT_TOP_N).map(({ rel, run }) => `  ${String(run.length).padStart(2)} ${rel}`),
    problems: allProblems({ declared, qrByPath, runs, extendedKeys, perFile, ocrTokens, allowlist, silentAllowed }),
  };
}

/**
 * Every check that runs after the scan, in one place. Exported so a test can
 * assert that all five are actually wired.
 */
function allProblems({
  declared,
  qrByPath,
  runs,
  extendedKeys,
  perFile,
  ocrTokens,
  // The two path-keyed sets are injectable so a test can describe its own
  // fixture instead of contorting it to match production. The thresholds are
  // not: a test that moved them would stop saying anything about the gate.
  allowlist = QR_ALLOWLIST,
  silentAllowed = SCREENSHOTS_MUST_YIELD_OCR,
}) {
  return [
    ...ocrYieldProblems(ocrTokens, MIN_OCR_TOKENS),
    ...ocrCoverageProblems(perFile, silentAllowed),
    ...extendedKeyProblems(extendedKeys),
    ...qrProblems(qrByPath, declared, allowlist),
    ...seedProblems(runs, SEED_RUN_LIMIT),
  ];
}

/** `runs`: [{ rel, run }], sorted longest first. */
function seedProblems(runs, limit) {
  return runs
    .filter(r => r.run.length >= limit)
    .map(
      ({ rel, run }) =>
        `${run.length} consecutive BIP39 words read out of ${rel} (limit ${limit}): ` +
        `${describeRun(run)}\n` +
        '    The words are withheld on purpose: this log is public. Look at the ' +
        'image before doing anything else. If this is a recovery ' +
        'phrase, it must not be published at all — no redaction, a new ' +
        'screenshot. If it is ordinary English text, redact or replace the ' +
        'image, or raise SEED_RUN_LIMIT and record the measurement that ' +
        'justifies the new value in its comment.',
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

/**
 * BIP39 wordlists in Latin script, from the repository's own dependency.
 *
 * English alone was too narrow: blue_modules/bip39.js validates a mnemonic
 * against ten wordlists, so a French or Spanish recovery phrase in a screenshot
 * would have gone unread. The four non-Latin lists are pointless here — the
 * tokenizer reads Latin letters — and are left out.
 *
 * Accents are folded on both sides so `éolien` and OCR's `eolien` are the same
 * word. Measured: the union is 12114 words against English's 2048, and the
 * longest natural run over the 70 published PNGs stays at 3 either way.
 */
const BIP39_LATIN_WORDLISTS = ['english', 'french', 'spanish', 'italian', 'czech', 'portuguese'];

/** NFD-fold to plain lower-case Latin, so accents never split a word. */
function foldAccents(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

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
  const all = new Set();
  for (const name of BIP39_LATIN_WORDLISTS) {
    const words = bip39.wordlists && bip39.wordlists[name];
    if (!Array.isArray(words) || words.length !== 2048) {
      fail(
        `handbook content gate: bip39.wordlists.${name} is not the expected ` +
          `2048-word list (got ${Array.isArray(words) ? words.length : typeof words}).`,
      );
    }
    for (const w of words) all.add(foldAccents(w));
  }
  return all;
}

/**
 * zbarimg exits 4 when it found no symbol — the normal case here — and 1 for a
 * read error. Treating both as "clean" is the mistake the predecessor made with
 * `|| true`: an unreadable file passed as safe. Pure and exported so the rule is
 * pinned by a test rather than by a comment.
 */
function qrExitIsClean(status) {
  return status === 4;
}

/** Decoded QR payload of one image, or '' when it carries none. */
function decodeQr(absPath) {
  try {
    return execFileSync('zbarimg', ['-q', '--raw', absPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (e) {
    if (qrExitIsClean(e.status)) return '';
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

  const { summary, detail, problems } = runGate({
    files,
    declared,
    words,
    decodeQr: rel => decodeQr(path.join(root, rel)),
    ocr: rel => ocr(path.join(root, rel)),
  });
  console.log(summary);
  for (const line of detail) console.log(line);

  if (problems.length) {
    fail('handbook content gate failed:\n  ' + problems.join('\n  '));
  }
}

module.exports = {
  QR_ALLOWLIST,
  SEED_RUN_LIMIT,
  MIN_OCR_TOKENS,
  SCREENSHOTS_MUST_YIELD_OCR,
  EXTENDED_KEY_RE,
  BIP39_LATIN_WORDLISTS,
  foldAccents,
  collectDeclaredPngs,
  scanSetProblems,
  qrProblems,
  longestBip39Run,
  seedProblems,
  describeRun,
  maskPayload,
  qrExitIsClean,
  runGate,
  ocrYieldProblems,
  ocrCoverageProblems,
  extendedKeyProblems,
  allProblems,
};

if (require.main === module) main();
