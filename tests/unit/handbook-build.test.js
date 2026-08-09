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
    assert.ok(!/<script/i.test(html), 'script tags stripped');
    assert.ok(!/onerror/i.test(html), 'on* handlers stripped');
    assert.ok(!new RegExp('java' + 'script:', 'i').test(html), 'dangerous URL scheme neutralized');
    // Link becomes plain label text; no remaining href to the missing path.
    assert.ok(!/href="[^"]*missing-file/i.test(html), 'unresolved local href stripped');
    assert.match(html, /href="DOC-1\.html"/);
    assert.match(r.stderr, /stripped unresolved local link/);
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
    const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
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
    for (const [, id, head] of index.matchAll(/<div class="test" id="([^"]+)">([\s\S]*?)<div class="img">/g)) {
      assertSelfLinked(id, head, 'screenshot');
      paired.push(id);
    }
    for (const [, block] of index.matchAll(/<div class="group-head">([\s\S]*?)<\/div>/g)) {
      const gid = block.match(/<h3 id="([^"]+)"/);
      assert.ok(gid, `group head without an id: ${block.slice(0, 80)}`);
      assertSelfLinked(gid[1], block, 'group');
      paired.push(gid[1]);
    }
    // Every anchor must have been reached by one of the two loops above, so a
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

    const r = runBuild(out, { HANDBOOK_REPO_ROOT: fixture, NODE_PATH: markedNodePath, GIT_SHA: 't' });
    assert.notStrictEqual(r.status, 0, r.stdout);
    assert.match(r.stderr, /not a locale/i);
    assert.match(r.stderr, /review_information/);
    // Also name the underscore-free directory: without this the length bound
    // in LOCALE_DIR_RE is unpinned, because review_information already fails on
    // the underscore alone.
    assert.match(r.stderr, /metadata\/default\b/);
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

    const r = runBuild(out, { HANDBOOK_REPO_ROOT: fixture, NODE_PATH: markedNodePath, GIT_SHA: 't' });
    assert.strictEqual(r.status, 0, r.stderr);
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
    const sources = manifest.artifacts.map(a => a.sourcePath);
    assert.ok(sources.includes('android/fastlane/metadata/android/pt-BR/title.txt'), 'pt-BR was not discovered');
    assert.ok(sources.includes('ios/fastlane/metadata/zh-Hans/name.txt'), 'zh-Hans was not discovered');
    assert.ok(sources.includes('android/fastlane/metadata/android/es-419/title.txt'), 'es-419 was not discovered');
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
});
