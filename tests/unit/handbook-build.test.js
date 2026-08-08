/**
 * Regression tests for handbook build.js guards.
 *
 * Invokes scripts/handbook/build.js as a child process against temporary
 * fixture repos (HANDBOOK_REPO_ROOT). Guard failures must not depend on the
 * real repository's screenshot/doc counts.
 *
 * Guards that fire before markdown rendering do not need marked. Paths that
 * reach render use NODE_PATH pointing at the repo-local `_handbook-deps/`
 * (gitignored, same as the manual handbook build) so marked is installed at
 * most once and reused across runs — never re-fetched from the network into
 * a throwaway temp dir.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.resolve(REPO_ROOT, 'scripts/handbook/build.js');

/**
 * Read a numeric `const NAME = <int>;` from build.js source.
 * Exactly one match required — no silent default (that would re-introduce a
 * second source of truth and mask renames/duplication in build.js).
 * Do not require() build.js: it runs main() on load.
 */
function readBuildConst(name) {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  const re = new RegExp('^const\\s+' + name + '\\s*=\\s*(-?\\d+)\\s*;\\s*$', 'm');
  const matches = src.match(new RegExp(re.source, 'gm'));
  if (!matches || matches.length === 0) {
    throw new Error(`handbook-build tests: const ${name} not found in ${SCRIPT}`);
  }
  if (matches.length !== 1) {
    throw new Error(`handbook-build tests: const ${name} matches ${matches.length} times in ${SCRIPT} (need exactly 1)`);
  }
  const m = matches[0].match(re);
  const n = Number(m[1]);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`handbook-build tests: const ${name} is not an integer (got ${JSON.stringify(m[1])})`);
  }
  return n;
}

// Single source of truth: scripts/handbook/build.js (not a hand-copied table).
const MIN_SCREENSHOTS = readBuildConst('MIN_SCREENSHOTS');
const MIN_DOCS = readBuildConst('MIN_DOCS');
const MIN_STORE_FIELDS = readBuildConst('MIN_STORE_FIELDS');
const MIN_ASSETS = readBuildConst('MIN_ASSETS');
const MIN_CONTENT_LOCALES = readBuildConst('MIN_CONTENT_LOCALES');
const MIN_PNG_BYTES = readBuildConst('MIN_PNG_BYTES');
const MIN_ASSET_PNG_BYTES = readBuildConst('MIN_ASSET_PNG_BYTES');
// Mid-band: between the two floors (derived, not a third hardcoded threshold).
const ASSET_MID_BYTES = Math.floor((MIN_ASSET_PNG_BYTES + MIN_PNG_BYTES) / 2);

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Store-listing field names the fixtures write per locale. Enough of them that
// the pool stays above MIN_STORE_FIELDS.
const ANDROID_LOCALE_FIELDS = ['title', 'short_description', 'full_description', 'changelogs/default'];
const IOS_LOCALE_FIELDS = [
  'name',
  'description',
  'keywords',
  'subtitle',
  'release_notes',
  'promotional_text',
  'support_url',
  'marketing_url',
];

/**
 * How far a floor may sit below the repository it guards.
 *
 * The floors live in build.js and every test here reads them from there, which
 * is the right single source — but it also means lowering one keeps the whole
 * suite green while the guard stops guarding: MIN_SCREENSHOTS = 1 would still
 * satisfy every case below and no longer notice 41 deleted screenshots. This
 * ratio is what makes such an edit visible. Lowering it is a deliberate,
 * reviewable act; lowering a floor alone is not.
 */
const FLOOR_MIN_RATIO = 0.5;

function writePng(filePath, sizeBytes) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const buf = Buffer.alloc(sizeBytes, 0);
  PNG_MAGIC.copy(buf, 0);
  // Minimal IHDR-ish tail so tools that only peek magic still accept the file.
  fs.writeFileSync(filePath, buf);
}

/** Valid first 7 PNG magic bytes, wrong 8th — catches partial magic checks. */
function writePngCorruptLastMagic(filePath, sizeBytes) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const buf = Buffer.alloc(Math.max(sizeBytes, 8), 0);
  // 89 50 4e 47 0d 0a 1a  +  wrong trailing byte
  PNG_MAGIC.copy(buf, 0, 0, 7);
  buf[7] = 0xff;
  fs.writeFileSync(filePath, buf);
}

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Minimal fixture that satisfies all floors so a full build can succeed.
 * Collision / PNG cases mutate this base.
 */
function countStoreFields(root) {
  let storeN = 0;
  function walkStore(d) {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'images') walkStore(p);
      } else if (e.name.endsWith('.txt')) storeN += 1;
    }
  }
  walkStore(path.join(root, 'android/fastlane/metadata'));
  walkStore(path.join(root, 'ios/fastlane/metadata'));
  return storeN;
}

/**
 * Minimal fixture that satisfies all floors so a full build can succeed.
 * Collision / PNG / floor cases mutate this base via opts.
 *
 * opts.storeFieldCount: if set, create exactly that many store .txt fields
 * (for floor-guard tests). Both platform roots always exist.
 */
function populateValidFixture(root, opts = {}) {
  const shotCount = opts.shotCount !== undefined ? opts.shotCount : MIN_SCREENSHOTS;
  const docCount = opts.docCount !== undefined ? opts.docCount : MIN_DOCS;
  const assetCount = opts.assetCount !== undefined ? opts.assetCount : MIN_ASSETS;
  const shotSize = opts.shotSize !== undefined ? opts.shotSize : MIN_PNG_BYTES + 1;
  const assetSize = opts.assetSize !== undefined ? opts.assetSize : MIN_ASSET_PNG_BYTES + 50;
  // shotMagic: true = full magic; false = all zeros; 'last-byte' = first 7 ok
  const shotMagic = opts.shotMagic !== undefined ? opts.shotMagic : true;
  const storeFieldCount = opts.storeFieldCount !== undefined ? opts.storeFieldCount : null;
  const docContents = opts.docContents || {};

  // Screenshots (valid PNG magic + size unless shotMagic overrides)
  for (let i = 0; i < shotCount; i++) {
    const name = `shot-${String(i).padStart(2, '0')}.png`;
    const p = path.join(root, 'docs/handbook/screenshots/group', name);
    if (shotMagic === true) {
      writePng(p, shotSize);
    } else if (shotMagic === 'last-byte') {
      writePngCorruptLastMagic(p, shotSize);
    } else {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, Buffer.alloc(Math.max(shotSize, 8), 0x41));
    }
  }

  // Markdown docs (root-level names to avoid path collisions)
  for (let i = 0; i < docCount; i++) {
    const name = `DOC-${i}.md`;
    const body = docContents[name] !== undefined ? docContents[name] : `# Doc ${i}\n\nBody.\n`;
    writeText(path.join(root, name), body);
  }

  // Store: both platform roots required; field count controllable.
  fs.mkdirSync(path.join(root, 'android/fastlane/metadata/android'), { recursive: true });
  fs.mkdirSync(path.join(root, 'ios/fastlane/metadata'), { recursive: true });
  if (storeFieldCount === null) {
    for (const locale of ['de-DE', 'en-US']) {
      for (const f of ANDROID_LOCALE_FIELDS) {
        writeText(path.join(root, 'android/fastlane/metadata/android', locale, `${f}.txt`), `${locale} ${f}`);
      }
    }
    writeText(path.join(root, 'ios/fastlane/metadata/copyright.txt'), '2026');
    writeText(path.join(root, 'ios/fastlane/metadata/primary_category.txt'), 'FINANCE');
    for (const locale of ['de-DE', 'en-US']) {
      for (const f of IOS_LOCALE_FIELDS) {
        writeText(path.join(root, 'ios/fastlane/metadata', locale, `${f}.txt`), `${locale} ${f}`);
      }
    }
    assert.ok(countStoreFields(root) >= MIN_STORE_FIELDS, `fixture store fields ${countStoreFields(root)}`);
  } else {
    // Exactly N fields: fill android locales first, then ios/global, then the
    // ios locales. The pool must stay above MIN_STORE_FIELDS so the floor-guard
    // case (MIN - 1) can still be built exactly.
    let n = 0;
    const candidates = [];
    for (const locale of ['en-US', 'de-DE']) {
      for (const f of ANDROID_LOCALE_FIELDS) {
        candidates.push([`android/fastlane/metadata/android/${locale}`, f]);
      }
    }
    candidates.push(['ios/fastlane/metadata', 'copyright']);
    candidates.push(['ios/fastlane/metadata', 'primary_category']);
    for (const locale of ['en-US', 'de-DE']) {
      for (const f of IOS_LOCALE_FIELDS) {
        candidates.push([`ios/fastlane/metadata/${locale}`, f]);
      }
    }
    assert.ok(
      candidates.length >= storeFieldCount,
      `fixture store pool (${candidates.length}) is smaller than the requested ` +
        `${storeFieldCount} fields — extend ANDROID_LOCALE_FIELDS/IOS_LOCALE_FIELDS`,
    );
    for (const [dir, f] of candidates) {
      if (n >= storeFieldCount) break;
      writeText(path.join(root, dir, `${f}.txt`), `field ${n}`);
      n += 1;
    }
    // Empty locale dirs so roots exist even if N is small
    fs.mkdirSync(path.join(root, 'android/fastlane/metadata/android/en-US'), {
      recursive: true,
    });
    assert.strictEqual(countStoreFields(root), storeFieldCount);
  }

  // Assets
  for (let i = 0; i < assetCount; i++) {
    writePng(path.join(root, 'img/dfx', `asset-${i}.png`), assetSize);
  }
  // icon.png always written when assetCount > 0 so img/ is non-empty for discovery;
  // when testing asset floor with assetCount = MIN-1, do not double-count: icon is
  // included in assetCount via loop only when we want full set. Write icon only
  // as extra for full fixtures (when assetCount >= MIN_ASSETS).
  if (assetCount >= MIN_ASSETS) {
    writePng(path.join(root, 'img/icon.png'), assetSize);
  }
}

function runBuild(outDir, envExtra = {}) {
  const env = { ...process.env, ...envExtra };
  // Never inherit a real NODE_PATH that might hide missing-marked cases
  // unless the test explicitly sets one.
  if (!Object.prototype.hasOwnProperty.call(envExtra, 'NODE_PATH')) {
    delete env.NODE_PATH;
  }
  return spawnSync(process.execPath, [SCRIPT, outDir], {
    encoding: 'utf8',
    env,
    timeout: 60000,
  });
}

/**
 * Ensure marked is available under `<repoRoot>/_handbook-deps/` (gitignored).
 * Reuses an existing install; only runs `npm install` when the marker is
 * missing. Hard-fails with a clear message if install fails (no skip).
 */
function ensureMarkedNodePath(repoRoot) {
  const prefix = path.join(repoRoot, '_handbook-deps');
  const marker = path.join(prefix, 'node_modules', 'marked', 'package.json');
  if (!fs.existsSync(marker)) {
    const r = spawnSync('npm', ['install', '--prefix', prefix, '--no-save', '--no-audit', '--no-fund', 'marked@15.0.7'], {
      encoding: 'utf8',
      timeout: 120000,
    });
    assert.strictEqual(
      r.status,
      0,
      'handbook-build tests: marked@15.0.7 install into _handbook-deps failed ' +
        '(network or registry required once; directory is gitignored and reused). ' +
        `stderr=${r.stderr || ''}\nstdout=${r.stdout || ''}`,
    );
  }
  assert.ok(fs.existsSync(marker), `handbook-build tests: expected marked at ${marker} after ensureMarkedNodePath`);
  return path.join(prefix, 'node_modules');
}

/**
 * A permalink and a copy button are only useful if they carry the id of the
 * entry they sit in. `html` is the markup of that one entry.
 */
function assertSelfLinked(id, html, kind) {
  const href = html.match(/<a class="name permalink" href="#([^"]+)"/);
  const target = html.match(/data-target="([^"]+)"/);
  assert.ok(href, `${kind} ${id}: no permalink`);
  assert.ok(target, `${kind} ${id}: no copy button`);
  assert.strictEqual(href[1], id, `${kind} ${id}: permalink points at ${href[1]}`);
  assert.strictEqual(target[1], id, `${kind} ${id}: copy button targets ${target[1]}`);
}

/** Markdown body of a rendered doc page (excludes chrome: topbar, skip-link, script). */
function extractDocArticle(html) {
  const m = String(html).match(/<article\b[^>]*\bid="doc-content"[^>]*>([\s\S]*?)<\/article>/i);
  assert.ok(m, 'doc page must contain <article id="doc-content">');
  return m[1];
}

/**
 * Temporarily extend scripts/handbook/metadata.json for caption tests, then
 * restore. Suite runs with -i (runInBand); still always restore in finally.
 */
function withPatchedMetadata(patchFn, body) {
  const metaPath = path.join(REPO_ROOT, 'scripts/handbook/metadata.json');
  const original = fs.readFileSync(metaPath, 'utf8');
  try {
    const meta = JSON.parse(original);
    patchFn(meta);
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');
    return body();
  } finally {
    fs.writeFileSync(metaPath, original, 'utf8');
  }
}

/** Patch one content locale file temporarily (restored in finally). */
function withPatchedContent(locale, patchFn, body) {
  const contentPath = path.join(REPO_ROOT, 'scripts/handbook/content', locale + '.json');
  const original = fs.readFileSync(contentPath, 'utf8');
  try {
    const data = JSON.parse(original);
    patchFn(data);
    fs.writeFileSync(contentPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
    return body();
  } finally {
    fs.writeFileSync(contentPath, original, 'utf8');
  }
}

describe('unit - handbook build guards', () => {
  // Fixture setup can install marked once into repo _handbook-deps/.
  jest.setTimeout(120000);

  let tmpRoot;
  let markedNodePath;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'handbook-test-'));
    // Stable cache at repo root — not under tmpRoot (afterAll would wipe it).
    markedNodePath = ensureMarkedNodePath(REPO_ROOT);
  });

  afterAll(() => {
    // Only fixture/output scratch under tmpRoot. Never delete _handbook-deps.
    if (tmpRoot && fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  function freshDirs() {
    const fixture = fs.mkdtempSync(path.join(tmpRoot, 'fx-'));
    const out = fs.mkdtempSync(path.join(tmpRoot, 'out-'));
    return { fixture, out };
  }

  it('refuses output dir equal to repo root without deleting it', function () {
    const { fixture } = freshDirs();
    populateValidFixture(fixture);
    const canary = path.join(fixture, 'CANARY.md');
    writeText(canary, 'keep-me\n');

    const r = runBuild(fixture, { HANDBOOK_REPO_ROOT: fixture });
    assert.notStrictEqual(r.status, 0, r.stderr);
    assert.match(r.stderr, /repo root/i);
    assert.ok(fs.existsSync(canary), 'repo root must not be emptied');
    assert.strictEqual(fs.readFileSync(canary, 'utf8'), 'keep-me\n');
  });

  it('refuses output path containing a .git segment', function () {
    const { fixture } = freshDirs();
    populateValidFixture(fixture);
    const out = path.join(tmpRoot, 'nested', '.git', 'handbook-out');

    const r = runBuild(out, { HANDBOOK_REPO_ROOT: fixture });
    assert.notStrictEqual(r.status, 0, r.stderr);
    assert.match(r.stderr, /\.git/);
  });

  it('refuses output dir equal to the home directory', function () {
    const { fixture } = freshDirs();
    populateValidFixture(fixture);
    // Synthetic HOME under tmpRoot only — never use the real user home as
    // outDir (a failed guard would rmSync it). resolveHomeDir() prefers env.
    const fakeHome = fs.mkdtempSync(path.join(tmpRoot, 'fake-home-'));
    writeText(path.join(fakeHome, 'CANARY'), 'keep\n');

    const r = runBuild(fakeHome, {
      HANDBOOK_REPO_ROOT: fixture,
      HOME: fakeHome,
    });
    assert.notStrictEqual(r.status, 0, r.stderr);
    assert.match(r.stderr, /home directory/i);
    assert.ok(fs.existsSync(path.join(fakeHome, 'CANARY')), 'fake home not emptied');
  });

  it('refuses output dir equal to a discovery source root', function () {
    const { fixture } = freshDirs();
    populateValidFixture(fixture);
    const shotRoot = path.join(fixture, 'docs/handbook/screenshots');
    const canary = path.join(shotRoot, 'group', 'shot-00.png');
    assert.ok(fs.existsSync(canary), 'fixture must have a screenshot canary');

    const r = runBuild(shotRoot, { HANDBOOK_REPO_ROOT: fixture });
    assert.notStrictEqual(r.status, 0, r.stderr);
    assert.match(r.stderr, /discovery source/i);
    assert.match(r.stderr, /docs\/handbook\/screenshots/);
    assert.ok(fs.existsSync(canary), 'screenshot source must not be deleted');
  });

  it('rejects screenshot PNG just below MIN_PNG_BYTES', function () {
    const { fixture, out } = freshDirs();
    // Pin the threshold: size = MIN_PNG_BYTES - 1 (not a far-below value that
    // would still fail under a lowered floor of 100).
    const badSize = MIN_PNG_BYTES - 1;
    populateValidFixture(fixture, { shotCount: 1, shotSize: badSize });

    const r = runBuild(out, { HANDBOOK_REPO_ROOT: fixture });
    assert.notStrictEqual(r.status, 0, r.stderr);
    assert.match(r.stderr, /PNG guard/i);
    assert.match(r.stderr, new RegExp(`${badSize} bytes`));
  });

  it('accepts screenshot PNG just above MIN_PNG_BYTES', function () {
    const { fixture, out } = freshDirs();
    // Other side of the threshold: MIN_PNG_BYTES + 1 must pass size (and the
    // full floors). Raising MIN_PNG_BYTES in build.js above this size turns
    // the test red.
    populateValidFixture(fixture, { shotSize: MIN_PNG_BYTES + 1 });

    const r = runBuild(out, {
      HANDBOOK_REPO_ROOT: fixture,
      NODE_PATH: markedNodePath,
      GIT_SHA: 'test-sha',
    });
    assert.strictEqual(r.status, 0, `stderr=${r.stderr}\nstdout=${r.stdout}`);
    assert.ok(fs.existsSync(path.join(out, 'manifest.json')));
  });

  it('rejects screenshot whose last PNG magic byte is wrong', function () {
    const { fixture, out } = freshDirs();
    // First seven magic bytes correct, eighth wrong — a check that only
    // looks at byte 0 (or any proper prefix shorter than 8) would pass.
    populateValidFixture(fixture, {
      shotCount: 1,
      shotSize: MIN_PNG_BYTES + 50,
      shotMagic: 'last-byte',
    });

    const r = runBuild(out, { HANDBOOK_REPO_ROOT: fixture });
    assert.notStrictEqual(r.status, 0, r.stderr);
    assert.match(r.stderr, /PNG guard/i);
    assert.match(r.stderr, /magic/i);
  });

  it('accepts mid-size assets while rejecting screenshots of the same size', function () {
    // Pins MIN_ASSET_PNG_BYTES vs MIN_PNG_BYTES: size is the midpoint of the
    // two floors (valid for assets, invalid for screenshots). Raising
    // MIN_ASSET_PNG_BYTES to meet MIN_PNG_BYTES collapses the band and
    // turns the asset half red.
    assert.ok(
      ASSET_MID_BYTES > MIN_ASSET_PNG_BYTES && ASSET_MID_BYTES < MIN_PNG_BYTES,
      `mid-band ${ASSET_MID_BYTES} not strictly between asset floor ${MIN_ASSET_PNG_BYTES} and screenshot floor ${MIN_PNG_BYTES}`,
    );
    const { fixture: fxShot, out: outShot } = freshDirs();
    populateValidFixture(fxShot, { shotCount: 1, shotSize: ASSET_MID_BYTES });
    const rShot = runBuild(outShot, { HANDBOOK_REPO_ROOT: fxShot });
    assert.notStrictEqual(rShot.status, 0, rShot.stderr);
    assert.match(rShot.stderr, /PNG guard/i);
    assert.match(rShot.stderr, new RegExp(`${ASSET_MID_BYTES} bytes`));

    const { fixture: fxAsset, out: outAsset } = freshDirs();
    populateValidFixture(fxAsset, {
      shotSize: MIN_PNG_BYTES + 1,
      assetSize: ASSET_MID_BYTES,
    });
    const rAsset = runBuild(outAsset, {
      HANDBOOK_REPO_ROOT: fxAsset,
      NODE_PATH: markedNodePath,
      GIT_SHA: 'test-sha',
    });
    assert.strictEqual(rAsset.status, 0, `asset mid-size must pass: stderr=${rAsset.stderr}`);
  });

  it('rejects two markdown sources that map to the same output path', function () {
    const { fixture, out } = freshDirs();
    // Full valid floors first so discovery reaches the collision check
    // (which runs before markdown rendering — no marked required).
    populateValidFixture(fixture, { docCount: MIN_DOCS });
    writeText(path.join(fixture, 'README.md'), '# Root README\n');
    writeText(path.join(fixture, 'docs/README.md'), '# Nested README\n');

    const r = runBuild(out, { HANDBOOK_REPO_ROOT: fixture });
    assert.notStrictEqual(r.status, 0, r.stderr);
    assert.match(r.stderr, /collision/i);
    assert.match(r.stderr, /docs\/README\.html/);
    assert.match(r.stderr, /README\.md/);
    assert.match(r.stderr, /docs\/README\.md/);
  });

  it('succeeds on a complete valid fixture (positive probe)', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture);

    const r = runBuild(out, {
      HANDBOOK_REPO_ROOT: fixture,
      NODE_PATH: markedNodePath,
      GIT_SHA: 'test-sha',
    });
    assert.strictEqual(r.status, 0, `stderr=${r.stderr}\nstdout=${r.stdout}`);
    assert.ok(fs.existsSync(path.join(out, 'index.html')));
    assert.ok(fs.existsSync(path.join(out, 'manifest.json')));
    assert.ok(fs.existsSync(path.join(out, 'handbook.js')));
    const indexHtml = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    assert.ok(!/<script(?![^>]*\bsrc=)/i.test(indexHtml), 'index.html must not contain inline <script> (CSP script-src self)');
    assert.match(indexHtml, /src="handbook\.js"/);
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
    assert.ok(manifest.counts.screenshots >= MIN_SCREENSHOTS);
    assert.ok(manifest.counts.docs >= MIN_DOCS);
    assert.ok(manifest.counts.store >= MIN_STORE_FIELDS);
    assert.ok(manifest.counts.assets >= MIN_ASSETS);
  });

  // --- Floor guards (mutation target: `if (…length < MIN_*)` → `if (false)`) ---

  it('floor guard rejects fewer than MIN_SCREENSHOTS valid PNGs', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture, {
      shotCount: MIN_SCREENSHOTS - 1,
      shotSize: MIN_PNG_BYTES + 1,
    });
    const r = runBuild(out, { HANDBOOK_REPO_ROOT: fixture });
    assert.notStrictEqual(r.status, 0, r.stderr);
    assert.match(r.stderr, /MIN_SCREENSHOTS/);
    assert.match(r.stderr, new RegExp(String(MIN_SCREENSHOTS - 1)));
  });

  it('floor guard rejects fewer than MIN_DOCS markdown files', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture, {
      docCount: MIN_DOCS - 1,
      shotSize: MIN_PNG_BYTES + 1,
    });
    const r = runBuild(out, { HANDBOOK_REPO_ROOT: fixture });
    assert.notStrictEqual(r.status, 0, r.stderr);
    assert.match(r.stderr, /MIN_DOCS/);
  });

  it('floor guard rejects fewer than MIN_STORE_FIELDS store fields', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture, {
      storeFieldCount: MIN_STORE_FIELDS - 1,
      shotSize: MIN_PNG_BYTES + 1,
    });
    const r = runBuild(out, { HANDBOOK_REPO_ROOT: fixture });
    assert.notStrictEqual(r.status, 0, r.stderr);
    assert.match(r.stderr, /MIN_STORE_FIELDS/);
  });

  it('floor guard rejects fewer than MIN_ASSETS asset PNGs', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture, {
      assetCount: MIN_ASSETS - 1,
      shotSize: MIN_PNG_BYTES + 1,
    });
    const r = runBuild(out, { HANDBOOK_REPO_ROOT: fixture });
    assert.notStrictEqual(r.status, 0, r.stderr);
    assert.match(r.stderr, /MIN_ASSETS/);
  });

  it('floor guard rejects when content locales are below MIN_CONTENT_LOCALES', function () {
    // Content is loaded from scripts/handbook/content next to build.js (not fixture).
    const contentDir = path.join(REPO_ROOT, 'scripts/handbook/content');
    const parked = contentDir + '.parked-floor-' + Date.now();
    assert.ok(fs.existsSync(contentDir), 'content dir present for test setup');
    fs.renameSync(contentDir, parked);
    try {
      const { fixture, out } = freshDirs();
      populateValidFixture(fixture, { shotSize: MIN_PNG_BYTES + 1 });
      const r = runBuild(out, { HANDBOOK_REPO_ROOT: fixture });
      assert.notStrictEqual(r.status, 0, r.stderr);
      assert.match(r.stderr, /MIN_CONTENT_LOCALES/);
      assert.match(r.stderr, /found 0/);
      assert.match(r.stderr, new RegExp(String(MIN_CONTENT_LOCALES)));
      assert.match(r.stderr, /path=/);
    } finally {
      if (fs.existsSync(parked) && !fs.existsSync(contentDir)) {
        fs.renameSync(parked, contentDir);
      }
    }
    assert.ok(fs.existsSync(contentDir), 'content dir restored');
  });

  it('fails the build when a content locale file is invalid JSON', function () {
    const contentPath = path.join(REPO_ROOT, 'scripts/handbook/content', 'en.json');
    const original = fs.readFileSync(contentPath, 'utf8');
    try {
      fs.writeFileSync(contentPath, '{ this is not valid json\n', 'utf8');
      const { fixture, out } = freshDirs();
      populateValidFixture(fixture, { shotSize: MIN_PNG_BYTES + 1 });
      const r = runBuild(out, { HANDBOOK_REPO_ROOT: fixture });
      assert.notStrictEqual(r.status, 0, r.stderr);
      assert.match(r.stderr, /invalid JSON/);
      assert.match(r.stderr, /content\/en\.json/);
    } finally {
      fs.writeFileSync(contentPath, original, 'utf8');
    }
  });

  it('rejects screenshot PNG of exactly MIN_PNG_BYTES (strict upper-bound floor)', function () {
    // Pins `st.size <= minBytes` — mutation to `<` would accept exact size.
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture, {
      shotCount: 1,
      shotSize: MIN_PNG_BYTES,
    });
    const r = runBuild(out, { HANDBOOK_REPO_ROOT: fixture });
    assert.notStrictEqual(r.status, 0, r.stderr);
    assert.match(r.stderr, /PNG guard/i);
    assert.match(r.stderr, new RegExp(`${MIN_PNG_BYTES} bytes`));
  });

  // --- Render / sanitize (need marked + full floors) ---

  it('strips dangerous HTML and rewrites or drops local links', function () {
    const { fixture, out } = freshDirs();
    // Markdown links first (so marked parses them); then raw HTML vectors.
    const evilScheme = ['java', 'script', ':'].join('');
    const danger =
      '# Title\n\n' +
      '[broken](./missing-file.txt)\n\n' +
      '[peer](./DOC-1.md)\n\n' +
      '<script>alert(1)</script>\n\n' +
      '<img src=x onerror="alert(2)">\n\n' +
      '<a href="' +
      evilScheme +
      'alert(3)">js</a>\n';
    populateValidFixture(fixture, {
      shotSize: MIN_PNG_BYTES + 1,
      docContents: { 'DOC-0.md': danger },
    });
    const r = runBuild(out, {
      HANDBOOK_REPO_ROOT: fixture,
      NODE_PATH: markedNodePath,
      GIT_SHA: 't',
    });
    assert.strictEqual(r.status, 0, r.stderr);
    const html = fs.readFileSync(path.join(out, 'docs/DOC-0.html'), 'utf8');
    // Sanitizer properties apply to the rendered markdown body, not chrome.
    const article = extractDocArticle(html);
    assert.ok(!/<script/i.test(article), 'script tags stripped from article');
    assert.ok(!/onerror/i.test(article), 'on* handlers stripped');
    assert.ok(!new RegExp('java' + 'script:', 'i').test(article), 'dangerous URL scheme neutralized');
    // Link becomes plain label text; no remaining href to the missing path.
    assert.ok(!/href="[^"]*missing-file/i.test(article), 'unresolved local href stripped');
    assert.match(article, /href="DOC-1\.html"/);
    assert.match(r.stderr, /stripped unresolved local link/);
    // Whole page: exactly one legitimate external script (handbook.js).
    const scriptTags = html.match(/<script\b[^>]*>/gi) || [];
    assert.strictEqual(
      scriptTags.length,
      1,
      `expected exactly one <script> on doc page, got ${scriptTags.length}: ${scriptTags.join(' | ')}`,
    );
    assert.match(scriptTags[0], /\bsrc\s*=/i, 'the only script must have src=');
    assert.match(scriptTags[0], /handbook\.js/i, 'script src must be handbook.js');
    assert.ok(!/<script\b(?![^>]*\bsrc\s*=)[^>]*>/i.test(html), 'no inline <script>');
  });

  it('escapes HTML special characters in store field content on index', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture, { shotSize: MIN_PNG_BYTES + 1 });
    // Overwrite one store field with special chars
    writeText(path.join(fixture, 'android/fastlane/metadata/android/en-US/title.txt'), `A <b> & "q" 's'`);
    const r = runBuild(out, {
      HANDBOOK_REPO_ROOT: fixture,
      NODE_PATH: markedNodePath,
      GIT_SHA: 't',
    });
    assert.strictEqual(r.status, 0, r.stderr);
    const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    assert.ok(index.includes('&lt;b&gt;'), 'angle brackets escaped');
    assert.ok(index.includes('&amp;'), 'ampersand escaped');
    assert.ok(index.includes('&quot;q&quot;') || index.includes('&#39;'), 'quotes escaped');
    assert.ok(!index.includes('A <b> & "q"'), 'raw specials must not appear');
  });

  it('dedupes heading slugs within one document', function () {
    const { fixture, out } = freshDirs();
    // ["A","A","A-1","A"] → a, a-1, a-1-1, a-2 (GitHub-compatible counter)
    const md = '# A\n\n# A\n\n# A-1\n\n# A\n';
    populateValidFixture(fixture, {
      shotSize: MIN_PNG_BYTES + 1,
      docContents: { 'DOC-0.md': md },
    });
    const r = runBuild(out, {
      HANDBOOK_REPO_ROOT: fixture,
      NODE_PATH: markedNodePath,
      GIT_SHA: 't',
    });
    assert.strictEqual(r.status, 0, r.stderr);
    const html = fs.readFileSync(path.join(out, 'docs/DOC-0.html'), 'utf8');
    const article = extractDocArticle(html);
    const ids = [...article.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
    assert.deepStrictEqual(ids, ['a', 'a-1', 'a-1-1', 'a-2']);
  });

  it('percent-encodes # and ? in asset href/src paths', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture, { shotSize: MIN_PNG_BYTES + 1 });
    writePng(path.join(fixture, 'img/dfx', 'hash#tag.png'), MIN_ASSET_PNG_BYTES + 50);
    writePng(path.join(fixture, 'img/dfx', 'q?x.png'), MIN_ASSET_PNG_BYTES + 50);
    const r = runBuild(out, {
      HANDBOOK_REPO_ROOT: fixture,
      NODE_PATH: markedNodePath,
      GIT_SHA: 't',
    });
    assert.strictEqual(r.status, 0, r.stderr);
    const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    assert.match(index, /hash%23tag\.png/);
    assert.match(index, /q%3Fx\.png/);
    assert.ok(fs.existsSync(path.join(out, 'assets/dfx/hash#tag.png')));
  });

  // --- Design-Runde: captions, remote imgs, doc chrome, no-JS chrome ---

  it('uses metadata caption when present and derives title plus badge from filename otherwise', function () {
    const { fixture, out } = freshDirs();
    // Invented stems under group/ — never depend on scripts/handbook/content text.
    // - 01-meta-win: metadata.captions entry wins
    // - 03-my-feature: no metadata caption → derive from filename
    populateValidFixture(fixture, { shotSize: MIN_PNG_BYTES + 1 });
    const metaTitle = 'META-CAPTION-FIXTURE-XYZ';
    writePng(path.join(fixture, 'docs/handbook/screenshots/group/01-meta-win.png'), MIN_PNG_BYTES + 1);
    writePng(path.join(fixture, 'docs/handbook/screenshots/group/03-my-feature.png'), MIN_PNG_BYTES + 1);
    withPatchedMetadata(
      meta => {
        meta.screenshots = meta.screenshots || {};
        meta.screenshots.group = {
          title: 'Fixture group for caption probe',
          description: 'fixture only',
          captions: { '01-meta-win': metaTitle },
        };
      },
      () => {
        // Strip any content caption for these keys so metadata (not content) is under test.
        withPatchedContent(
          'de',
          data => {
            data.captions = data.captions || {};
            delete data.captions['group/01-meta-win'];
            delete data.captions['group/03-my-feature'];
          },
          () => {
            const r = runBuild(out, {
              HANDBOOK_REPO_ROOT: fixture,
              NODE_PATH: markedNodePath,
              GIT_SHA: 't',
            });
            assert.strictEqual(r.status, 0, r.stderr);
            const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
            const metaCard = index.match(/<figure class="shot-card"[^>]*data-file="01-meta-win"[\s\S]*?<\/figure>/);
            assert.ok(metaCard, 'metadata-caption screenshot card present');
            const mc = metaCard[0];
            assert.match(mc, /data-caption="META-CAPTION-FIXTURE-XYZ"/);
            assert.match(mc, /alt="META-CAPTION-FIXTURE-XYZ"/);
            assert.match(mc, /class="name permalink"[^>]*>META-CAPTION-FIXTURE-XYZ</);
            assert.match(mc, /num-badge">01</);

            // Derived: 03-my-feature → badge 03 + "My feature" (not the raw stem as title)
            const featureCard = index.match(/<figure class="shot-card"[^>]*data-file="03-my-feature"[\s\S]*?<\/figure>/);
            assert.ok(featureCard, 'derived screenshot card present');
            const card = featureCard[0];
            assert.match(card, /data-caption="My feature"/);
            assert.match(card, /num-badge">03</);
            assert.match(card, /class="name permalink"[^>]*>My feature</);
            assert.ok(!/class="name permalink"[^>]*>03-my-feature</.test(card), 'raw stem must not be the title');
          },
        );
      },
    );
  });

  it('HTML-escapes caption text in title, alt, and data-caption attributes', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture, { shotSize: MIN_PNG_BYTES + 1 });
    writePng(path.join(fixture, 'docs/handbook/screenshots/group/01-evil.png'), MIN_PNG_BYTES + 1);
    const evilCaption = 'A <b> & "q"';
    withPatchedMetadata(
      meta => {
        meta.screenshots = meta.screenshots || {};
        meta.screenshots.group = {
          title: 'Fixture group',
          description: 'test',
          captions: { '01-evil': evilCaption },
        };
      },
      () => {
        const r = runBuild(out, {
          HANDBOOK_REPO_ROOT: fixture,
          NODE_PATH: markedNodePath,
          GIT_SHA: 't',
        });
        assert.strictEqual(r.status, 0, r.stderr);
        const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
        const card = index.match(/<figure class="shot-card"[^>]*data-file="01-evil"[\s\S]*?<\/figure>/);
        assert.ok(card, 'evil caption card present');
        const c = card[0];
        assert.ok(c.includes('&lt;b&gt;'), 'angle brackets escaped in card');
        assert.ok(c.includes('&amp;'), 'ampersand escaped in card');
        assert.ok(c.includes('&quot;q&quot;'), 'quotes escaped in card');
        assert.ok(!c.includes(evilCaption), 'raw caption must not appear');
        assert.match(c, /data-caption="A &lt;b&gt; &amp; &quot;q&quot;"/);
        assert.match(c, /alt="A &lt;b&gt; &amp; &quot;q&quot;"/);
        assert.match(c, /class="name permalink"[^>]*>A &lt;b&gt; &amp; &quot;q&quot;</);
      },
    );
  });

  it('warns on orphan caption metadata without failing the build', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture, { shotSize: MIN_PNG_BYTES + 1 });
    withPatchedMetadata(
      meta => {
        meta.screenshots = meta.screenshots || {};
        meta.screenshots.group = {
          title: 'Fixture group',
          description: 'test',
          captions: { '99-does-not-exist': 'Orphan caption' },
        };
      },
      () => {
        const r = runBuild(out, {
          HANDBOOK_REPO_ROOT: fixture,
          NODE_PATH: markedNodePath,
          GIT_SHA: 't',
        });
        assert.strictEqual(r.status, 0, r.stderr);
        const orphanLines = (r.stderr || '').split('\n').filter(l => /orphan/i.test(l) && /99-does-not-exist/.test(l));
        assert.strictEqual(orphanLines.length, 1, `expected exactly one orphan caption warning, got:\n${r.stderr}`);
        assert.match(orphanLines[0], /captions/);
        // Other screenshots still present
        const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
        assert.match(index, /shot-00/);
        assert.ok(fs.existsSync(path.join(out, 'index.html')));
      },
    );
  });

  it('replaces remote markdown images with alt text but keeps remote links', function () {
    const { fixture, out } = freshDirs();
    const md = '# Remote\n\n' + '![Alt-Text](https://example.com/x.png)\n\n' + '[keep me](https://example.com)\n';
    populateValidFixture(fixture, {
      shotSize: MIN_PNG_BYTES + 1,
      docContents: { 'DOC-0.md': md },
    });
    const r = runBuild(out, {
      HANDBOOK_REPO_ROOT: fixture,
      NODE_PATH: markedNodePath,
      GIT_SHA: 't',
    });
    assert.strictEqual(r.status, 0, r.stderr);
    const html = fs.readFileSync(path.join(out, 'docs/DOC-0.html'), 'utf8');
    const article = extractDocArticle(html);
    assert.ok(!/<img\b[^>]*src=["']https:\/\/example\.com\/x\.png/i.test(article), 'remote img must not remain');
    assert.ok(!/<img\b[^>]*src=["']https:\/\/example\.com/i.test(article), 'no img pointing at example.com');
    assert.match(article, /Alt-Text/);
    assert.match(article, /href="https:\/\/example\.com"/);
    assert.match(article, />keep me</);
    const remoteImgLines = (r.stderr || '').split('\n').filter(l => /replaced remote image/i.test(l) && /example\.com\/x\.png/.test(l));
    assert.strictEqual(remoteImgLines.length, 1, `expected one remote-image log line, got:\n${r.stderr}`);
  });

  it('keeps data:image imgs while replacing remote and unresolved local imgs with alt text', function () {
    const { fixture, out } = freshDirs();
    // Minimal 1×1 PNG (valid magic + IHDR); CSP allows data:image/* on handbook.
    const dataUri =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const md =
      '# Images\n\n' +
      '![inline-dot](' +
      dataUri +
      ')\n\n' +
      '![remote-alt](https://example.com/y.png)\n\n' +
      '![missing-alt](./no-such-file.png)\n';
    populateValidFixture(fixture, {
      shotSize: MIN_PNG_BYTES + 1,
      docContents: { 'DOC-0.md': md },
    });
    const r = runBuild(out, {
      HANDBOOK_REPO_ROOT: fixture,
      NODE_PATH: markedNodePath,
      GIT_SHA: 't',
    });
    assert.strictEqual(r.status, 0, r.stderr);
    const html = fs.readFileSync(path.join(out, 'docs/DOC-0.html'), 'utf8');
    const article = extractDocArticle(html);
    // data:image stays as <img src="data:image/png;base64,…">
    assert.match(article, /<img\b[^>]*src="data:image\/png;base64,[A-Za-z0-9+/=]+"/i, 'data:image img must remain');
    assert.match(article, /alt="inline-dot"/);
    // https remote replaced by alt text
    assert.ok(!/<img\b[^>]*src=["']https:\/\/example\.com\/y\.png/i.test(article), 'https img must not remain');
    assert.match(article, /remote-alt/);
    // unresolved relative replaced by alt text
    assert.ok(!/<img\b[^>]*src=["'][^"']*no-such-file/i.test(article), 'unresolved local img must not remain');
    assert.match(article, /missing-alt/);
  });

  it('computes relative paths to chrome assets from nested and top-level docs', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture, {
      shotSize: MIN_PNG_BYTES + 1,
      docCount: MIN_DOCS,
    });
    writeText(path.join(fixture, 'docs/nested/Deep.md'), '# Nested deep\n\nBody.\n');
    const r = runBuild(out, {
      HANDBOOK_REPO_ROOT: fixture,
      NODE_PATH: markedNodePath,
      GIT_SHA: 't',
    });
    assert.strictEqual(r.status, 0, r.stderr);
    // Top-level DOC-0.md → docs/DOC-0.html → one level up
    const top = fs.readFileSync(path.join(out, 'docs/DOC-0.html'), 'utf8');
    assert.match(top, /href="\.\.\/index\.html"/);
    assert.match(top, /href="\.\.\/assets\/icon\.png"/);
    assert.match(top, /src="\.\.\/handbook\.js"/);
    assert.ok(!/href="\.\.\/\.\.\/index\.html"/.test(top), 'top-level doc must not use ../../ for index');
    // Nested docs/nested/Deep.md → docs/nested/Deep.html → two levels up
    const nested = fs.readFileSync(path.join(out, 'docs/nested/Deep.html'), 'utf8');
    assert.match(nested, /href="\.\.\/\.\.\/index\.html"/);
    assert.match(nested, /href="\.\.\/\.\.\/assets\/icon\.png"/);
    assert.match(nested, /src="\.\.\/\.\.\/handbook\.js"/);
    assert.ok(
      !/href="\.\.\/index\.html"/.test(nested) || nested.includes('href="../../index.html"'),
      'nested doc must use ../../index.html',
    );
    // Count ../ segments on the icon link specifically
    const iconHref = nested.match(/href="((?:\.\.\/)+)assets\/icon\.png"/);
    assert.ok(iconHref, 'nested icon href present');
    assert.strictEqual((iconHref[1].match(/\.\.\//g) || []).length, 2, `expected two ../ segments, got ${iconHref[1]}`);
  });

  it('hides JS-only chrome controls with the hidden attribute while keeping screenshot links', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture, { shotSize: MIN_PNG_BYTES + 1 });
    const r = runBuild(out, {
      HANDBOOK_REPO_ROOT: fixture,
      NODE_PATH: markedNodePath,
      GIT_SHA: 't',
    });
    assert.strictEqual(r.status, 0, r.stderr);
    const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    // Controls that are inert without handbook.js ship hidden.
    assert.match(index, /id="search-wrap"[^>]*\bhidden\b|id="search-wrap"\s+hidden\b/);
    // Theme / sidebar / status / lightbox: hidden in opening tag
    function assertHiddenId(id) {
      const m = index.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`));
      assert.ok(m, `element #${id} present`);
      assert.match(m[0], /\bhidden\b/, `#${id} must have hidden attribute`);
    }
    assertHiddenId('theme-toggle');
    assertHiddenId('sidebar-toggle');
    assertHiddenId('search-status');
    assertHiddenId('lightbox');
    // Screenshot links remain usable without JS
    const shotHrefs = index.match(/href="screenshots\/[^"]+\.png"/g) || [];
    const shotFiles = [];
    function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.png')) shotFiles.push(p);
      }
    }
    walk(path.join(fixture, 'docs/handbook/screenshots'));
    assert.strictEqual(shotHrefs.length, shotFiles.length, `href count ${shotHrefs.length} vs fixture pngs ${shotFiles.length}`);
    assert.ok(shotHrefs.length >= MIN_SCREENSHOTS);
  });
  it('gives every screenshot and every group a reachable permalink', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture, { shotSize: MIN_PNG_BYTES + 1 });
    const r = runBuild(out, {
      HANDBOOK_REPO_ROOT: fixture,
      NODE_PATH: markedNodePath,
      GIT_SHA: 't',
    });
    assert.strictEqual(r.status, 0, r.stderr);
    const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');

    // Assert the pairing, not just membership: an entry's permalink and copy
    // button must carry that entry's OWN id. Checking only that every id occurs
    // somewhere as an href would still pass if the hrefs were rotated by one —
    // every link would then point at the neighbouring screen.
    const anchorIds = [...index.matchAll(/id="((?:shot|group)-[^"]+)"/g)].map(m => m[1]);
    assert.ok(anchorIds.length > 0, 'fixture must produce shot/group anchors');

    const paired = [];
    for (const [, id, body] of index.matchAll(/<figure class="shot-card" id="([^"]+)"[^>]*>([\s\S]*?)<\/figure>/g)) {
      assertSelfLinked(id, body, 'screenshot');
      paired.push(id);
    }
    for (const [, block] of index.matchAll(/<div class="group-head">([\s\S]*?)<\/div>/g)) {
      const gid = block.match(/<h3 id="([^"]+)"/);
      assert.ok(gid, `group head without an id: ${block.slice(0, 80)}`);
      assertSelfLinked(gid[1], block, 'group');
      paired.push(gid[1]);
    }
    // Single-group chapters hang the group anchor on the chapter chrome
    // (span.group-anchor + copy button) without a visible heading.
    for (const [, id] of index.matchAll(/<span id="((?:group)-[^"]+)" class="group-anchor"/g)) {
      const copy =
        index.match(new RegExp(`class="copy-link"[^>]*data-target="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`)) ||
        index.match(new RegExp(`data-target="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*class="copy-link"`));
      assert.ok(copy, `single-group anchor ${id}: no copy button`);
      paired.push(id);
    }
    // Every anchor must have been reached by one of the loops above, so a
    // new kind of entry cannot slip past the pairing check unnoticed.
    assert.deepStrictEqual(
      anchorIds.filter(id => !paired.includes(id)),
      [],
      'anchors not covered by the pairing check',
    );
  });

  it('keeps permalink anchor ids unique', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture, { shotSize: MIN_PNG_BYTES + 1 });
    const r = runBuild(out, {
      HANDBOOK_REPO_ROOT: fixture,
      NODE_PATH: markedNodePath,
      GIT_SHA: 't',
    });
    assert.strictEqual(r.status, 0, r.stderr);
    const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    const ids = [...index.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    // A duplicate anchor yields a link that jumps to the wrong screen — with
    // permalinks made visible that lands on the reader.
    assert.deepStrictEqual([...new Set(dupes)], []);
  });

  it('fails the build when two sources claim the same permalink anchor', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture, { shotSize: MIN_PNG_BYTES + 1 });
    const shots = path.join(fixture, 'docs/handbook/screenshots');
    // slugify() collapses every non-alphanumeric run to '-', so each pair below
    // lands on one id — one pair of screenshots, one pair of groups.
    writePng(path.join(shots, 'group', 'fee ok.png'), MIN_PNG_BYTES + 1);
    writePng(path.join(shots, 'group', 'fee-ok.png'), MIN_PNG_BYTES + 1);
    writePng(path.join(shots, 'karte/dfx', 'x.png'), MIN_PNG_BYTES + 1);
    writePng(path.join(shots, 'karte-dfx', 'x.png'), MIN_PNG_BYTES + 1);
    const r = runBuild(out, {
      HANDBOOK_REPO_ROOT: fixture,
      NODE_PATH: markedNodePath,
      GIT_SHA: 't',
    });
    // Suffixing the loser would be worse than failing: "first" is first in sort
    // order, not oldest, and ' ' sorts before '-'. The newcomer would take the
    // incumbent's bare id, so a permalink copied yesterday would open a
    // different screenshot today — silently, with a green build.
    assert.notStrictEqual(r.status, 0, r.stderr);
    assert.match(r.stderr, /anchor collision/i);
    assert.match(r.stderr, /#shot-group-fee-ok\b/);
    assert.match(r.stderr, /fee ok\.png/);
    assert.match(r.stderr, /fee-ok\.png/);
    assert.match(r.stderr, /#group-karte-dfx\b/);
  });

  it('ships the copy-link handler in handbook.js, not inline', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture, { shotSize: MIN_PNG_BYTES + 1 });
    const r = runBuild(out, {
      HANDBOOK_REPO_ROOT: fixture,
      NODE_PATH: markedNodePath,
      GIT_SHA: 't',
    });
    assert.strictEqual(r.status, 0, r.stderr);
    const js = fs.readFileSync(path.join(out, 'handbook.js'), 'utf8');
    assert.match(js, /copy-link/);
    // Pin the calls, not the word: `clipboard` also occurs in a prose comment,
    // so matching it would keep passing after the whole API use was removed.
    assert.match(js, /navigator\.clipboard\.writeText\(/);
    assert.match(js, /execCommand\('copy'\)/);
    // CSP is script-src 'self': an inline <script> carrying logic would break
    // the page silently. The HTML may only carry the external reference.
    const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    const inlineScripts = [...index.matchAll(/<script(?![^>]*\ssrc=)[^>]*>/g)];
    assert.deepStrictEqual(
      inlineScripts.map(m => m[0]),
      [],
    );
  });

  it('keeps the copy button out of the heading element', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture, { shotSize: MIN_PNG_BYTES + 1 });
    const r = runBuild(out, {
      HANDBOOK_REPO_ROOT: fixture,
      NODE_PATH: markedNodePath,
      GIT_SHA: 't',
    });
    assert.strictEqual(r.status, 0, r.stderr);
    const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    // A button inside <h3> becomes part of the heading's text and its
    // accessible name — a screen reader then announces "Einstellungen
    // Direkt-Link kopieren". The button belongs next to the heading.
    const headings = [...index.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)];
    assert.ok(headings.length > 0, 'fixture must produce headings');
    const polluted = headings.filter(m => m[2].includes('copy-link')).map(m => m[0]);
    assert.deepStrictEqual(polluted, []);
  });

  it('refuses a non-locale directory under the Android store metadata root', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture);
    // fastlane keeps the reviewer's contact details and the demo account's
    // credentials right next to the locales. Discovery published every .txt
    // under every subdirectory, so this would have gone straight onto a page
    // that is served without authentication.
    writeText(path.join(fixture, 'android/fastlane/metadata/android/review_information/phone_number.txt'), '+41 00 000 00 00');

    const r = runBuild(out, { HANDBOOK_REPO_ROOT: fixture, NODE_PATH: markedNodePath, GIT_SHA: 't' });
    assert.notStrictEqual(r.status, 0, r.stdout);
    assert.match(r.stderr, /not a locale/i);
    assert.match(r.stderr, /review_information/);
    assert.ok(!fs.existsSync(path.join(out, 'index.html')), 'no page may be written');
  });

  it('refuses a non-locale directory under the iOS store metadata root', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture);
    writeText(path.join(fixture, 'ios/fastlane/metadata/review_information/demo_password.txt'), 'hunter2');
    // Second shape, without an underscore: otherwise the guard is only pinned
    // against the character, not against the length of the letter class.
    writeText(path.join(fixture, 'ios/fastlane/metadata/default/copyright.txt'), '2026');
    // Four letters, one past the longest language subtag either store defines.
    // Without it, widening the class to `{2,4}` keeps every test green while
    // turning a whole shape of directory into a published locale.
    writeText(path.join(fixture, 'ios/fastlane/metadata/beta/name.txt'), 'Beta');
    // A valid language with an invalid region. The three cases above all fail
    // on the language part, so none of them reaches the region alternation:
    // widening it to `(-.*)?` keeps every test green and turns exactly this
    // directory into a published locale. The guard's own error message tells
    // maintainers to widen the pattern when a real locale is refused, so that
    // edit is expected to happen — this is the net under it. Widenings that
    // stay inside [A-Za-z0-9] are deliberately not pinned: measured, `{2,8}`
    // and `[A-Za-z0-9]+` both survive, and neither can admit anything fastlane
    // puts in these roots. Every non-locale there either carries an underscore
    // or fails the language part outright, and `.*` is the one form that lets
    // an underscore through.
    writeText(path.join(fixture, 'ios/fastlane/metadata/de-review_information/demo_password.txt'), 'hunter2');

    const r = runBuild(out, { HANDBOOK_REPO_ROOT: fixture, NODE_PATH: markedNodePath, GIT_SHA: 't' });
    assert.notStrictEqual(r.status, 0, r.stdout);
    assert.match(r.stderr, /not a locale/i);
    assert.match(r.stderr, /review_information/);
    // Also name the underscore-free directory: without this the length bound
    // in LOCALE_DIR_RE is unpinned, because review_information already fails on
    // the underscore alone.
    assert.match(r.stderr, /metadata\/default\b/);
    assert.match(r.stderr, /metadata\/beta\b/);
    assert.match(r.stderr, /metadata\/de-review_information\b/);
    assert.ok(!fs.existsSync(path.join(out, 'index.html')), 'no page may be written');
  });

  it('still picks up a new locale without an edit to build.js', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture);
    // The guard must not turn discovery into a hand-maintained list: real
    // locale shapes have to keep appearing by themselves.
    writeText(path.join(fixture, 'android/fastlane/metadata/android/pt-BR/title.txt'), 'Carteira');
    writeText(path.join(fixture, 'ios/fastlane/metadata/zh-Hans/name.txt'), '钱包');
    // es-419 is Google Play's Latin-American Spanish: a UN M.49 numeric region.
    // The first version of the guard rejected it and would have broken the
    // build the day that listing is created.
    writeText(path.join(fixture, 'android/fastlane/metadata/android/es-419/title.txt'), 'Billetera');
    // Filipino is the one code in fastlane's list of 79 Play languages whose
    // language subtag is three letters. Narrowing the class to `{2}` keeps
    // every other fixture green and aborts the build the day `supply init`
    // creates this directory — the es-419 mistake one position further left.
    writeText(path.join(fixture, 'android/fastlane/metadata/android/fil/title.txt'), 'Pitaka');

    const r = runBuild(out, { HANDBOOK_REPO_ROOT: fixture, NODE_PATH: markedNodePath, GIT_SHA: 't' });
    assert.strictEqual(r.status, 0, r.stderr);
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
    const sources = manifest.artifacts.map(a => a.sourcePath);
    assert.ok(sources.includes('android/fastlane/metadata/android/pt-BR/title.txt'), 'pt-BR was not discovered');
    assert.ok(sources.includes('ios/fastlane/metadata/zh-Hans/name.txt'), 'zh-Hans was not discovered');
    assert.ok(sources.includes('android/fastlane/metadata/android/es-419/title.txt'), 'es-419 was not discovered');
    assert.ok(sources.includes('android/fastlane/metadata/android/fil/title.txt'), 'fil was not discovered');
  });

  it('keeps the content floors meaningful against the real repository', function () {
    // Every other case here builds a fixture, so a floor lowered to 1 would
    // never be noticed. This one measures the repository the floors exist to
    // protect. It fails in both directions: a floor above reality breaks the
    // build, a floor far below it stops detecting deletions.
    const out = fs.mkdtempSync(path.join(tmpRoot, 'real-'));
    const r = runBuild(out, { NODE_PATH: markedNodePath, GIT_SHA: 'floor-check' });
    assert.strictEqual(r.status, 0, `real repository build failed: ${r.stderr}`);

    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
    const floors = {
      screenshots: ['MIN_SCREENSHOTS', MIN_SCREENSHOTS],
      docs: ['MIN_DOCS', MIN_DOCS],
      store: ['MIN_STORE_FIELDS', MIN_STORE_FIELDS],
      assets: ['MIN_ASSETS', MIN_ASSETS],
    };
    for (const [category, [name, floor]] of Object.entries(floors)) {
      const actual = manifest.counts[category];
      assert.ok(Number.isInteger(actual) && actual > 0, `manifest.counts.${category} is ${JSON.stringify(actual)}`);
      assert.ok(floor <= actual, `${name}=${floor} is above the ${actual} ${category} in the repository`);
      const weakest = Math.ceil(actual * FLOOR_MIN_RATIO);
      assert.ok(
        floor >= weakest,
        `${name}=${floor} while the repository has ${actual} ${category}. Below ` +
          `${weakest} the floor no longer detects a mass deletion: raise it, or ` +
          'change FLOOR_MIN_RATIO deliberately if the content really shrank.',
      );
    }

    // The ratio alone does not pin what MIN_STORE_FIELDS was raised for. At 20
    // — comfortably inside the ratio — deleting both Android locales landed on
    // exactly 20, and `20 < 20` is false: the whole Google Play listing could
    // go without a word. The floor has to sit above "everything minus the
    // smallest locale".
    const perLocale = {};
    for (const a of manifest.artifacts) {
      if (a.category !== 'store') continue;
      const group = a.group || 'unknown';
      // `<platform>/global` is the iOS metadata that belongs to no locale
      // (copyright, primary_category). Counting it as one would make the
      // smallest "locale" two fields and the assertion meaningless.
      if (group.endsWith('/global')) continue;
      perLocale[group] = (perLocale[group] || 0) + 1;
    }
    const sizes = Object.values(perLocale);
    assert.ok(sizes.length >= 2, `expected several store locales, saw ${JSON.stringify(perLocale)}`);
    const smallest = Math.min(...sizes);
    const survives = manifest.counts.store - smallest;
    assert.ok(
      MIN_STORE_FIELDS > survives,
      `MIN_STORE_FIELDS=${MIN_STORE_FIELDS} still passes with the smallest locale ` +
        `(${smallest} fields) deleted — ${survives} fields would remain. It has to be above ${survives}.`,
    );
  });
  // --- Kundenfassung: locales, chapters, pod ---

  it('writes a page per content locale with hreflang alternates and all screenshot links', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture, { shotSize: MIN_PNG_BYTES + 1 });
    const r = runBuild(out, {
      HANDBOOK_REPO_ROOT: fixture,
      NODE_PATH: markedNodePath,
      GIT_SHA: 't',
    });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(out, 'index.html')));
    assert.ok(fs.existsSync(path.join(out, 'en/index.html')));
    assert.ok(fs.existsSync(path.join(out, 'fr/index.html')));
    assert.ok(fs.existsSync(path.join(out, 'it/index.html')));
    const de = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    const en = fs.readFileSync(path.join(out, 'en/index.html'), 'utf8');
    assert.match(de, /<html lang="de"/);
    assert.match(en, /<html lang="en"/);
    assert.match(de, /rel="alternate" hreflang="en"/);
    assert.match(de, /rel="alternate" hreflang="x-default"/);
    assert.match(en, /rel="alternate" hreflang="de"/);
    const deShots = de.match(/href="[^"]*screenshots\/[^"]+\.png"/g) || [];
    const enShots = en.match(/href="[^"]*screenshots\/[^"]+\.png"/g) || [];
    assert.ok(deShots.length >= MIN_SCREENSHOTS, `de shot links ${deShots.length}`);
    assert.strictEqual(enShots.length, deShots.length);
    // en page uses depth-prefixed paths
    assert.ok(
      enShots.some(h => h.includes('../screenshots/')),
      'en uses ../screenshots',
    );
  });

  it('fails the build when one screenshot is assigned to two chapters', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture, { shotSize: MIN_PNG_BYTES + 1 });
    // Fixture screenshots live under group/; dual-assign shot-00 via group + image.
    withPatchedContent(
      'de',
      data => {
        data.chapters = [
          {
            id: 'a',
            title: 'A',
            summary: '',
            intro: '',
            groups: ['group'],
          },
          {
            id: 'b',
            title: 'B',
            summary: '',
            intro: '',
            images: ['group/shot-00'],
          },
        ];
      },
      () => {
        const r = runBuild(out, {
          HANDBOOK_REPO_ROOT: fixture,
          NODE_PATH: markedNodePath,
          GIT_SHA: 't',
        });
        assert.notStrictEqual(r.status, 0, r.stderr);
        assert.match(r.stderr, /chapter collision/i);
        assert.match(r.stderr, /group\/shot-00/);
        assert.match(r.stderr, /"a"/);
        assert.match(r.stderr, /"b"/);
      },
    );
  });

  it('places unassigned screenshots under moreScreens and warns once each', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture, { shotSize: MIN_PNG_BYTES + 1 });
    // Extra screenshot not covered by any chapter groups
    writePng(path.join(fixture, 'docs/handbook/screenshots/orphan-group/99-extra.png'), MIN_PNG_BYTES + 1);
    const r = runBuild(out, {
      HANDBOOK_REPO_ROOT: fixture,
      NODE_PATH: markedNodePath,
      GIT_SHA: 't',
    });
    assert.strictEqual(r.status, 0, r.stderr);
    const warns = (r.stderr || '').split('\n').filter(l => /orphan-group\/99-extra/.test(l) && /moreScreens|not assigned/i.test(l));
    assert.strictEqual(warns.length, 1, `expected one moreScreens warning, got:\n${r.stderr}`);
    const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    assert.match(index, /99-extra/);
    assert.match(index, /more-screens|Weitere Screens|More screens/);
  });

  it('prefers content captions over metadata then filename derivation', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture, { shotSize: MIN_PNG_BYTES + 1 });
    writePng(path.join(fixture, 'docs/handbook/screenshots/01-onboarding/01-start.png'), MIN_PNG_BYTES + 1);
    writePng(path.join(fixture, 'docs/handbook/screenshots/group/03-my-feature.png'), MIN_PNG_BYTES + 1);
    withPatchedContent(
      'de',
      data => {
        data.captions['01-onboarding/01-start'] = {
          title: 'CONTENT-CAPTION-WINS',
          text: 'from content',
        };
      },
      () => {
        const r = runBuild(out, {
          HANDBOOK_REPO_ROOT: fixture,
          NODE_PATH: markedNodePath,
          GIT_SHA: 't',
        });
        assert.strictEqual(r.status, 0, r.stderr);
        const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
        assert.match(index, /CONTENT-CAPTION-WINS/);
        assert.match(index, /from content/);
        // derived still works for unknown stem
        assert.match(index, /My feature|data-caption="My feature"/);
      },
    );
  });

  it('embeds the logo as inline SVG and does not type DFX in the topbar', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture, { shotSize: MIN_PNG_BYTES + 1 });
    const r = runBuild(out, {
      HANDBOOK_REPO_ROOT: fixture,
      NODE_PATH: markedNodePath,
      GIT_SHA: 't',
    });
    assert.strictEqual(r.status, 0, r.stderr);
    const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    const topbar = index.match(/<header class="topbar">([\s\S]*?)<\/header>/);
    assert.ok(topbar, 'topbar present');
    const tb = topbar[1];
    assert.match(tb, /<svg[\s\S]*class="logo-dark"/);
    assert.match(tb, /<svg[\s\S]*class="logo-white"/);
    const withoutSvg = tb.replace(/<svg[\s\S]*?<\/svg>/g, '');
    assert.ok(!withoutSvg.includes('DFX'), 'no typed DFX in topbar outside SVG');
    assert.match(tb, /BTC Taro Wallet/);
  });

  it('ships local @font-face rules for the Design Pod woff2 files', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture, { shotSize: MIN_PNG_BYTES + 1 });
    const r = runBuild(out, {
      HANDBOOK_REPO_ROOT: fixture,
      NODE_PATH: markedNodePath,
      GIT_SHA: 't',
    });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(out, 'assets/fonts/Inter-Regular.woff2')));
    assert.ok(fs.existsSync(path.join(out, 'assets/fonts/Inter-SemiBold.woff2')));
    assert.ok(fs.existsSync(path.join(out, 'assets/fonts/Inter-Bold.woff2')));
    assert.ok(fs.existsSync(path.join(out, 'assets/fonts/SourceCodePro-Regular.woff2')));
    const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    assert.match(index, /@font-face\{font-family:Inter;[^}]*Inter-Regular\.woff2/);
    assert.match(index, /@font-face\{font-family:Inter;[^}]*Inter-Bold\.woff2/);
    assert.match(index, /Source Code Pro[^}]*SourceCodePro-Regular\.woff2/);
    assert.ok(!/@font-face[^}]*https:\/\//.test(index), 'no remote fonts');
    // tokens.css is embedded verbatim
    const tokens = fs.readFileSync(path.join(REPO_ROOT, 'scripts/handbook/pod/tokens.css'), 'utf8');
    assert.ok(index.includes(tokens), 'tokens.css embedded byte-identical');
  });

  // --- B1: logo theme show/hide must not lose to size rule display ---

  it('keeps logo size rule free of display so theme rules alone control visibility', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture, { shotSize: MIN_PNG_BYTES + 1 });
    const r = runBuild(out, {
      HANDBOOK_REPO_ROOT: fixture,
      NODE_PATH: markedNodePath,
      GIT_SHA: 't',
    });
    assert.strictEqual(r.status, 0, r.stderr);
    const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    const sizeMatch = index.match(/\.topbar-brand\s+\.logo-wrap\s+svg\s*\{([^}]*)\}/);
    assert.ok(sizeMatch, 'logo size rule present');
    assert.ok(!/\bdisplay\s*:/i.test(sizeMatch[1]), `size rule must not set display (got: ${sizeMatch[1].trim()})`);
    assert.match(sizeMatch[1], /height\s*:/);

    function ruleBody(selector) {
      const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
      const m = index.match(re);
      assert.ok(m, `CSS rule for ${selector}`);
      return m[1];
    }
    // Each theme: exactly one logo display:block and one display:none.
    const lightDark = ruleBody('.theme-light .logo-dark');
    const lightWhite = ruleBody('.theme-light .logo-white');
    const darkDark = ruleBody('.theme-dark .logo-dark');
    const darkWhite = ruleBody('.theme-dark .logo-white');
    assert.match(lightDark, /display\s*:\s*block\b/);
    assert.match(lightWhite, /display\s*:\s*none\b/);
    assert.match(darkDark, /display\s*:\s*none\b/);
    assert.match(darkWhite, /display\s*:\s*block\b/);
    // No equal-or-higher specificity rule re-asserts display on the size selector.
    const competing = [...index.matchAll(/([^{}]+)\.logo-wrap\s+svg\s*\{([^}]*)\}/g)];
    for (const m of competing) {
      assert.ok(!/\bdisplay\s*:/i.test(m[2]), `selector "${m[1].trim()}.logo-wrap svg" must not set display`);
    }
  });

  // --- B2: handbook.js loads from <head> without defer (theme FOUC) ---

  it('loads handbook.js from head without defer or async', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture, { shotSize: MIN_PNG_BYTES + 1 });
    const r = runBuild(out, {
      HANDBOOK_REPO_ROOT: fixture,
      NODE_PATH: markedNodePath,
      GIT_SHA: 't',
    });
    assert.strictEqual(r.status, 0, r.stderr);
    const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    const head = index.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
    assert.ok(head, '<head> present');
    const headScripts = head[1].match(/<script\b[^>]*>/gi) || [];
    assert.strictEqual(headScripts.length, 1, `expected one script in head, got ${headScripts.length}: ${headScripts.join(' | ')}`);
    assert.match(headScripts[0], /handbook\.js/i);
    assert.ok(!/\bdefer\b/i.test(headScripts[0]), 'no defer');
    assert.ok(!/\basync\b/i.test(headScripts[0]), 'no async');
    const body = index.match(/<body\b[^>]*>([\s\S]*)/i);
    assert.ok(body, '<body> present');
    assert.ok(!/<script\b[^>]*handbook\.js/i.test(body[1]), 'handbook.js must not also appear after <body>');
    const js = fs.readFileSync(path.join(out, 'handbook.js'), 'utf8');
    assert.match(js, /applyThemeEarly/);
    // Early theme runs before DOMContentLoaded; rest waits for the event.
    const earlyIdx = js.indexOf('applyThemeEarly');
    const domIdx = js.indexOf("addEventListener('DOMContentLoaded'");
    assert.ok(earlyIdx >= 0 && domIdx > earlyIdx, 'applyThemeEarly before DOMContentLoaded');
  });

  // --- B3 + B5: images[] never get a group h3; single groups[] neither ---

  it('renders images[] and single groups[] without group h3; multi-group has one h3 each', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture, { shotSize: MIN_PNG_BYTES + 1 });
    // Extra groups so multi-group and single-group chapters can coexist.
    writePng(path.join(fixture, 'docs/handbook/screenshots/solo/01-solo.png'), MIN_PNG_BYTES + 1);
    writePng(path.join(fixture, 'docs/handbook/screenshots/alpha/01-a.png'), MIN_PNG_BYTES + 1);
    writePng(path.join(fixture, 'docs/handbook/screenshots/beta/01-b.png'), MIN_PNG_BYTES + 1);
    withPatchedContent(
      'de',
      data => {
        data.chapters = [
          {
            id: 'solo-image',
            title: 'Solo image chapter',
            summary: '',
            intro: 'one image only',
            images: ['solo/01-solo'],
          },
          {
            id: 'single-group',
            title: 'Single group chapter',
            summary: '',
            intro: 'one whole group, no subheading',
            groups: ['group'],
          },
          {
            id: 'multi-group',
            title: 'Multi group chapter',
            summary: '',
            intro: 'two groups keep headings',
            groups: ['alpha', 'beta'],
          },
        ];
        data.groupTitles = Object.assign({}, data.groupTitles, {
          alpha: 'Alpha Gruppe DE',
          beta: 'Beta Gruppe DE',
          group: 'Fixture Group DE',
        });
      },
      () => {
        const r = runBuild(out, {
          HANDBOOK_REPO_ROOT: fixture,
          NODE_PATH: markedNodePath,
          GIT_SHA: 't',
        });
        assert.strictEqual(r.status, 0, r.stderr);
        const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');

        function chapterHtml(id) {
          const m = index.match(new RegExp(`id="chapter-${id}"[\\s\\S]*?</details>`));
          assert.ok(m, `chapter ${id} present`);
          return m[0];
        }
        const solo = chapterHtml('solo-image');
        const single = chapterHtml('single-group');
        const multi = chapterHtml('multi-group');
        assert.strictEqual((solo.match(/<h3\b/g) || []).length, 0, 'images[] chapter must have 0 group h3');
        assert.strictEqual((single.match(/<h3\b/g) || []).length, 0, 'single groups[] chapter must have 0 group h3 (B5)');
        assert.strictEqual((multi.match(/<h3\b/g) || []).length, 2, 'multi groups[] chapter must have one h3 per group');
        assert.match(solo, /solo\/01-solo|01-solo\.png/);
        assert.ok(!/class="group-head"/.test(single), 'single group: no group-head');
        assert.match(single, /class="group-anchor"/);
        assert.match(multi, /class="group-head"/);
        assert.match(multi, /Alpha Gruppe DE/);
        assert.match(multi, /Beta Gruppe DE/);
        // Customer chapters: no image-count line under the title.
        assert.ok(!/class="sec-count"/.test(solo), 'solo chapter must not show sec-count');
        assert.ok(!/class="sec-count"/.test(single), 'single-group chapter must not show sec-count');
        assert.ok(!/class="sec-count"/.test(multi), 'multi-group chapter must not show sec-count');
      },
    );
  });

  // --- B4: stats bar labels come from ui.* of each locale ---

  it('reads developer stats labels from ui.* with fallback warning when missing', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture, { shotSize: MIN_PNG_BYTES + 1 });
    const r = runBuild(out, {
      HANDBOOK_REPO_ROOT: fixture,
      NODE_PATH: markedNodePath,
      GIT_SHA: 't',
    });
    assert.strictEqual(r.status, 0, r.stderr);

    function devStatLabels(html) {
      const dev = html.match(/id="developer"[\s\S]*?<\/details>/);
      assert.ok(dev, 'developer section present');
      const main = [...dev[0].matchAll(/class="stat"(?![^>]*stat-sha)[^>]*>[\s\S]*?class="l">([^<]*)/g)].map(m => m[1]);
      const sha = [...dev[0].matchAll(/class="stat stat-sha"[\s\S]*?class="l">([^<]*)/g)].map(m => m[1]);
      return main.concat(sha);
    }

    for (const loc of ['de', 'en', 'fr', 'it']) {
      const content = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts/handbook/content', loc + '.json'), 'utf8'));
      const devKeys = ['statDocs', 'statStore', 'statAssets', 'statRevision'];
      assert.ok(
        devKeys.every(k => typeof content.ui[k] === 'string' && content.ui[k].trim()),
        `${loc} content must define developer ui.stat* keys`,
      );
      const pagePath = loc === 'de' ? path.join(out, 'index.html') : path.join(out, loc, 'index.html');
      const html = fs.readFileSync(pagePath, 'utf8');
      assert.ok(!/class="hero-meta"/.test(html), `${loc}: no customer hero-meta line`);
      assert.deepStrictEqual(
        devStatLabels(html),
        devKeys.map(k => content.ui[k]),
        `${loc} developer stats labels`,
      );
    }

    // Missing developer key → English fallback + stderr warning (not silent).
    withPatchedContent(
      'de',
      data => {
        delete data.ui.statDocs;
      },
      () => {
        const { fixture: f2, out: o2 } = freshDirs();
        populateValidFixture(f2, { shotSize: MIN_PNG_BYTES + 1 });
        const r2 = runBuild(o2, {
          HANDBOOK_REPO_ROOT: f2,
          NODE_PATH: markedNodePath,
          GIT_SHA: 't',
        });
        assert.strictEqual(r2.status, 0, r2.stderr);
        assert.match(r2.stderr, /missing ui\.statDocs/i);
        const de = fs.readFileSync(path.join(o2, 'index.html'), 'utf8');
        const dev = de.match(/id="developer"[\s\S]*?<\/details>/);
        assert.ok(dev);
        assert.match(dev[0], /class="l">Docs</);
      },
    );
  });

  // --- B5: groupTitles from locale beat metadata.json on foreign pages ---

  it('uses groupTitles from the locale file instead of German metadata titles', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture, { shotSize: MIN_PNG_BYTES + 1 });
    writePng(path.join(fixture, 'docs/handbook/screenshots/alpha/01-a.png'), MIN_PNG_BYTES + 1);
    writePng(path.join(fixture, 'docs/handbook/screenshots/beta/01-b.png'), MIN_PNG_BYTES + 1);
    // Plant a German-looking metadata title that must not appear on /fr/ when
    // groupTitles provides a French string.
    withPatchedMetadata(
      meta => {
        meta.screenshots = meta.screenshots || {};
        meta.screenshots.alpha = {
          title: 'Deutscher Alpha-Titel aus Metadata',
          description: 'Deutsche Beschreibung die nicht auf Kundenseiten darf',
        };
        meta.screenshots.beta = {
          title: 'Deutscher Beta-Titel aus Metadata',
          description: 'Auch diese Beschreibung bleibt weg',
        };
      },
      () => {
        withPatchedContent(
          'fr',
          data => {
            data.chapters = [
              {
                id: 'deux-groupes',
                title: 'Deux groupes',
                summary: '',
                intro: 'intro fr',
                groups: ['alpha', 'beta'],
              },
            ];
            data.groupTitles = Object.assign({}, data.groupTitles, {
              alpha: 'Titre Alpha FR',
              beta: 'Titre Beta FR',
            });
          },
          () => {
            // de chapters still need something that does not claim alpha/beta
            // exclusively — structure is resolved from de. Point de at group only.
            withPatchedContent(
              'de',
              data => {
                data.chapters = [
                  {
                    id: 'deux-groupes',
                    title: 'Zwei Gruppen',
                    summary: '',
                    intro: 'intro de',
                    groups: ['alpha', 'beta'],
                  },
                  {
                    id: 'rest',
                    title: 'Rest',
                    summary: '',
                    intro: '',
                    groups: ['group'],
                  },
                ];
                data.groupTitles = Object.assign({}, data.groupTitles, {
                  alpha: 'Alpha DE',
                  beta: 'Beta DE',
                  group: 'Group DE',
                });
              },
              () => {
                const r = runBuild(out, {
                  HANDBOOK_REPO_ROOT: fixture,
                  NODE_PATH: markedNodePath,
                  GIT_SHA: 't',
                });
                assert.strictEqual(r.status, 0, r.stderr);
                const fr = fs.readFileSync(path.join(out, 'fr/index.html'), 'utf8');
                assert.match(fr, /Titre Alpha FR/);
                assert.match(fr, /Titre Beta FR/);
                assert.ok(!fr.includes('Deutscher Alpha-Titel aus Metadata'), 'metadata German title must not appear on /fr/');
                assert.ok(!fr.includes('Deutscher Beta-Titel aus Metadata'), 'metadata German title must not appear on /fr/');
                assert.ok(!fr.includes('Deutsche Beschreibung'), 'metadata group description must not appear on customer pages');
                // Customer chapter h3 texts are the locale titles only.
                const chapterH3 = [...fr.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/g)]
                  .map(m =>
                    m[1]
                      .replace(/<[^>]+>/g, ' ')
                      .replace(/\s+/g, ' ')
                      .trim(),
                  )
                  .filter(t => /Titre|Deutscher|Alpha|Beta/.test(t));
                assert.ok(
                  chapterH3.some(t => t.includes('Titre Alpha FR')),
                  `expected FR alpha h3, got ${JSON.stringify(chapterH3)}`,
                );
              },
            );
          },
        );
      },
    );
  });

  // --- Caption Erklärsatz (cap-text) is emitted, scoped, and escaped ---

  it('emits one escaped cap-text under the title for each content caption with text', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture, { shotSize: MIN_PNG_BYTES + 1 });
    // Fixture group/shot-NN.png: three controlled captions on de + fr.
    // shot-00: title + text; shot-01: title only (no empty cap-text);
    // shot-02: title + text with HTML specials.
    const evilDe = 'A <b> & "q" DE';
    const evilFr = 'A <b> & "q" FR';
    withPatchedContent(
      'de',
      data => {
        data.chapters = [
          {
            id: 'cap-probe',
            title: 'Caption probe DE',
            summary: '',
            intro: '',
            groups: ['group'],
          },
        ];
        data.captions = {
          'group/shot-00': { title: 'Titel DE 00', text: 'Erklaersatz DE 00' },
          'group/shot-01': { title: 'Titel DE 01 only' },
          'group/shot-02': { title: 'Titel DE evil', text: evilDe },
        };
      },
      () => {
        withPatchedContent(
          'fr',
          data => {
            data.captions = Object.assign({}, data.captions, {
              'group/shot-00': { title: 'Titre FR 00', text: 'Phrase FR 00' },
              'group/shot-01': { title: 'Titre FR 01 only' },
              'group/shot-02': { title: 'Titre FR evil', text: evilFr },
            });
          },
          () => {
            const r = runBuild(out, {
              HANDBOOK_REPO_ROOT: fixture,
              NODE_PATH: markedNodePath,
              GIT_SHA: 't',
            });
            assert.strictEqual(r.status, 0, r.stderr);

            // Exactly two images carry text → exactly two cap-text paragraphs.
            const expectedWithText = 2;

            function assertCard(html, dataFile, title, bodyText, expectCapText) {
              const card = html.match(new RegExp(`<figure class="shot-card"[^>]*data-file="${dataFile}"[\\s\\S]*?</figure>`));
              assert.ok(card, `card for ${dataFile}`);
              const c = card[0];
              assert.match(c, new RegExp(`class="name permalink"[^>]*>${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<`));
              if (expectCapText) {
                // Own element under the title row, not merely anywhere on the page.
                assert.match(c, new RegExp(`class="name permalink"[\\s\\S]*?</div>\\s*<p class="cap-text">${bodyText}</p>`));
                assert.strictEqual((c.match(/class="cap-text"/g) || []).length, 1, `${dataFile}: one cap-text inside its card`);
              } else {
                assert.ok(!/class="cap-text"/.test(c), `${dataFile}: title-only caption must not emit cap-text`);
                assert.ok(!/<p class="cap-text"><\/p>/.test(c), `${dataFile}: no empty cap-text paragraph`);
              }
            }

            const de = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
            const deCaps = de.match(/<p class="cap-text">[\s\S]*?<\/p>/g) || [];
            assert.strictEqual(
              deCaps.length,
              expectedWithText,
              `de: expected ${expectedWithText} cap-text paragraphs, got ${deCaps.length}`,
            );
            assertCard(de, 'shot-00', 'Titel DE 00', 'Erklaersatz DE 00', true);
            assertCard(de, 'shot-01', 'Titel DE 01 only', null, false);
            assertCard(de, 'shot-02', 'Titel DE evil', 'A &lt;b&gt; &amp; &quot;q&quot; DE', true);
            assert.ok(!de.includes(evilDe), 'de: raw evil caption text must not appear');

            // Foreign page: sentence from that locale's content file, not DE.
            const fr = fs.readFileSync(path.join(out, 'fr/index.html'), 'utf8');
            const frCaps = fr.match(/<p class="cap-text">[\s\S]*?<\/p>/g) || [];
            assert.strictEqual(
              frCaps.length,
              expectedWithText,
              `fr: expected ${expectedWithText} cap-text paragraphs, got ${frCaps.length}`,
            );
            assertCard(fr, 'shot-00', 'Titre FR 00', 'Phrase FR 00', true);
            assertCard(fr, 'shot-01', 'Titre FR 01 only', null, false);
            assertCard(fr, 'shot-02', 'Titre FR evil', 'A &lt;b&gt; &amp; &quot;q&quot; FR', true);
            assert.ok(!fr.includes('Erklaersatz DE 00'), 'fr must not use DE explanation');
            assert.ok(!fr.includes(evilFr), 'fr: raw evil caption text must not appear');
            assert.ok(!fr.includes(evilDe), 'fr: DE evil raw text must not appear');
          },
        );
      },
    );
  });

  it('omits sec-count in customer chapters but keeps them in the developer section', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture, { shotSize: MIN_PNG_BYTES + 1 });
    const r = runBuild(out, {
      HANDBOOK_REPO_ROOT: fixture,
      NODE_PATH: markedNodePath,
      GIT_SHA: 't',
    });
    assert.strictEqual(r.status, 0, r.stderr);

    for (const loc of ['de', 'en', 'fr', 'it']) {
      const pagePath = loc === 'de' ? path.join(out, 'index.html') : path.join(out, loc, 'index.html');
      const html = fs.readFileSync(pagePath, 'utf8');
      const parts = html.split(/id="developer"/);
      assert.ok(parts.length >= 2, `${loc}: developer section present`);
      const customer = parts[0];
      const developer = parts.slice(1).join('id="developer"');
      const custCounts = (customer.match(/class="sec-count"/g) || []).length;
      const devCounts = (developer.match(/class="sec-count"/g) || []).length;
      assert.strictEqual(custCounts, 0, `${loc}: customer sec-count must be 0, got ${custCounts}`);
      assert.strictEqual(devCounts, 3, `${loc}: developer sec-count must be 3, got ${devCounts}`);
    }
  });

  // --- Design polish B1 / B2 / B6 ---

  it('marks active lang and toc with surface fill, not accent borders', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture, { shotSize: MIN_PNG_BYTES + 1 });
    const r = runBuild(out, {
      HANDBOOK_REPO_ROOT: fixture,
      NODE_PATH: markedNodePath,
      GIT_SHA: 't',
    });
    assert.strictEqual(r.status, 0, r.stderr);
    const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    const style = index.match(/<style>([\s\S]*?)<\/style>/);
    assert.ok(style, 'embedded CSS present');
    const css = style[1];
    // Own CSS only (tokens already embedded above). Slice after tokens is hard;
    // assert active rules do not use accent borders/underlines.
    function ruleBody(selector) {
      const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
      const m = css.match(re);
      assert.ok(m, `rule for ${selector}`);
      return m[1];
    }
    const langActive = ruleBody('.lang-switch a[aria-current="true"]');
    assert.match(langActive, /background\s*:\s*var\(--brand-navy\)/);
    assert.ok(!/border(-left)?\s*:[^;]*var\(--(accent|primary|brand-accent)/.test(langActive));
    assert.ok(!/box-shadow\s*:[^;]*var\(--(accent|primary|brand-accent)/.test(langActive));
    assert.ok(!/text-decoration\s*:\s*underline/.test(langActive));

    const tocActive = ruleBody('.toc a[aria-current="true"]');
    assert.match(tocActive, /background\s*:\s*var\(--surface-2\)/);
    assert.match(tocActive, /font-weight\s*:\s*var\(--fw-semibold\)/);
    assert.ok(!/\bborder(-left)?\s*:/.test(tocActive), 'active toc must not set border');
    assert.ok(!/border-left-color/.test(tocActive));
    assert.ok(!/text-decoration\s*:\s*underline/.test(tocActive));

    // Inactive base rules must not paint an accent edge either.
    const tocBase = ruleBody('.toc a');
    assert.ok(!/border-left\s*:\s*3px/.test(tocBase));

    // Focus ring remains for keyboard use.
    assert.match(css, /:focus-visible[^{]*\{[^}]*outline\s*:\s*2px\s+solid\s+var\(--primary\)[^}]*outline-offset\s*:\s*2px/);
  });

  it('has no customer kennzahlen line; developer section keeps four stat tiles', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture, { shotSize: MIN_PNG_BYTES + 1 });
    const r = runBuild(out, {
      HANDBOOK_REPO_ROOT: fixture,
      NODE_PATH: markedNodePath,
      GIT_SHA: 't',
    });
    assert.strictEqual(r.status, 0, r.stderr);

    for (const loc of ['de', 'en', 'fr', 'it']) {
      const content = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts/handbook/content', loc + '.json'), 'utf8'));
      const pagePath = loc === 'de' ? path.join(out, 'index.html') : path.join(out, loc, 'index.html');
      const html = fs.readFileSync(pagePath, 'utf8');
      const hero = html.match(/<header class="hero">([\s\S]*?)<\/header>/);
      assert.ok(hero, `${loc} hero`);
      const h = hero[1];
      assert.ok(!/class="hero-meta"/.test(h), `${loc}: no hero-meta`);
      assert.ok(!/class="stats"/.test(h), `${loc} hero must not contain stats tiles`);
      // Customer main body before developer: no four developer labels as tiles.
      const beforeDev = html.split(/id="developer"/)[0];
      assert.ok(!/class="hero-meta"/.test(beforeDev), `${loc}: no hero-meta in customer`);
      assert.ok(
        !new RegExp(`class="l">${content.ui.statDocs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<`).test(beforeDev),
        `${loc}: docs tile not before developer`,
      );
      assert.ok(
        !new RegExp(`class="l">${content.ui.statStore.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<`).test(beforeDev),
        `${loc}: store tile not before developer`,
      );
      assert.ok(
        !new RegExp(`class="l">${content.ui.statAssets.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<`).test(beforeDev),
        `${loc}: assets tile not before developer`,
      );
      assert.ok(
        !new RegExp(`class="l">${content.ui.statRevision.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<`).test(beforeDev),
        `${loc}: revision tile not before developer`,
      );
      const dev = html.match(/id="developer"[\s\S]*?<\/details>/);
      assert.ok(dev, `${loc} developer`);
      assert.match(dev[0], /class="stats"/);
      // class="stat" or class="stat stat-sha" — not class="stats"
      const tiles = (dev[0].match(/class="stat(?:\s|")/g) || []).length;
      assert.strictEqual(tiles, 4, `${loc}: developer must keep 4 stat tiles, got ${tiles}`);
      assert.match(dev[0], new RegExp(`class="l">${content.ui.statDocs}<`));
      assert.match(dev[0], new RegExp(`class="l">${content.ui.statStore}<`));
      assert.match(dev[0], new RegExp(`class="l">${content.ui.statAssets}<`));
      assert.match(dev[0], new RegExp(`class="l">${content.ui.statRevision}<`));
    }
  });

  it('defaults to theme-light when localStorage is empty even if system prefers dark', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture, { shotSize: MIN_PNG_BYTES + 1 });
    const r = runBuild(out, {
      HANDBOOK_REPO_ROOT: fixture,
      NODE_PATH: markedNodePath,
      GIT_SHA: 't',
    });
    assert.strictEqual(r.status, 0, r.stderr);
    const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    assert.match(index, /<meta name="color-scheme" content="light">/);
    assert.match(index, /<html[^>]*class="theme-light"/);

    const js = fs.readFileSync(path.join(out, 'handbook.js'), 'utf8');
    // Measurement: run applyThemeEarly with empty storage + dark prefers-color-scheme.
    const vm = require('vm');
    const m = js.match(/\(function applyThemeEarly\(\) \{([\s\S]*?)\}\)\(\);/);
    assert.ok(m, 'applyThemeEarly present in handbook.js');

    function runEarly(getItem) {
      const classes = new Set();
      const context = {
        THEME_KEY: 'handbook-theme',
        document: {
          documentElement: {
            classList: {
              remove: function () {
                for (let i = 0; i < arguments.length; i++) classes.delete(arguments[i]);
              },
              add: function (c) {
                classes.add(c);
              },
            },
          },
        },
        localStorage: { getItem },
        window: {
          matchMedia: function () {
            return { matches: true };
          },
        },
      };
      vm.runInNewContext('(function applyThemeEarly() {\n' + m[1] + '\n})();', context);
      return classes;
    }

    const noStore = runEarly(function () {
      return null;
    });
    assert.ok(noStore.has('theme-light'), `expected theme-light, got ${[...noStore].join(',')}`);
    assert.ok(!noStore.has('theme-dark'), 'must not follow prefers-color-scheme: dark');

    const storedDark = runEarly(function () {
      return 'dark';
    });
    assert.ok(storedDark.has('theme-dark'), 'stored dark must apply');
  });

  // --- B7: own CSS never paints with --text-tertiary (light theme is 2.74:1) ---

  it('does not use color: var(--text-tertiary) in own CSS', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture, { shotSize: MIN_PNG_BYTES + 1 });
    const r = runBuild(out, {
      HANDBOOK_REPO_ROOT: fixture,
      NODE_PATH: markedNodePath,
      GIT_SHA: 't',
    });
    assert.strictEqual(r.status, 0, r.stderr);
    const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    const style = index.match(/<style>([\s\S]*?)<\/style>/);
    assert.ok(style, 'embedded CSS present');
    const tokens = fs.readFileSync(path.join(REPO_ROOT, 'scripts/handbook/pod/tokens.css'), 'utf8');
    assert.ok(style[1].includes(tokens), 'tokens embedded');
    // Own CSS only — the pod may still *define* --text-tertiary; it must not be used as color.
    const own = style[1].slice(style[1].indexOf(tokens) + tokens.length);
    const hits = [...own.matchAll(/color\s*:\s*var\(\s*--text-tertiary\s*\)/g)];
    assert.strictEqual(hits.length, 0, 'own CSS must not set color: var(--text-tertiary); found ' + hits.length);
    // Pod definition of the role remains (byte-identical tokens already asserted above).
    assert.match(tokens, /--text-tertiary\s*:/);
  });

  // --- Customer tiles: no visible filename line; data-file stays for search ---

  it('omits .cap-file in customer chapters while keeping data-file on shot cards', function () {
    const { fixture, out } = freshDirs();
    populateValidFixture(fixture, { shotSize: MIN_PNG_BYTES + 1 });
    const r = runBuild(out, {
      HANDBOOK_REPO_ROOT: fixture,
      NODE_PATH: markedNodePath,
      GIT_SHA: 't',
    });
    assert.strictEqual(r.status, 0, r.stderr);

    for (const loc of ['de', 'en', 'fr', 'it']) {
      const pagePath = loc === 'de' ? path.join(out, 'index.html') : path.join(out, loc, 'index.html');
      const html = fs.readFileSync(pagePath, 'utf8');
      const customer = html.split(/id="developer"/)[0];
      assert.ok(!/class="cap-file"/.test(customer), `${loc}: no .cap-file in customer section`);
      assert.ok(!/class="lightbox-file"/.test(html), `${loc}: no lightbox-file element`);
      const dataFiles = customer.match(/\bdata-file="/g) || [];
      assert.ok(dataFiles.length >= MIN_SCREENSHOTS, `${loc}: data-file attrs ${dataFiles.length} (need ≥ ${MIN_SCREENSHOTS})`);
      // Visible text before developer must not expose fixture stems as a caption line.
      const textOnly = customer.replace(/<[^>]+>/g, ' ');
      assert.ok(!/\bshot-\d{2}\b/.test(textOnly), `${loc}: raw screenshot stems must not appear as visible text`);
    }
  });
});
