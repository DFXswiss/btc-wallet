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
function populateValidFixture(root, opts = {}) {
  const shotCount = opts.shotCount !== undefined ? opts.shotCount : MIN_SCREENSHOTS;
  const docCount = opts.docCount !== undefined ? opts.docCount : MIN_DOCS;
  const assetCount = opts.assetCount !== undefined ? opts.assetCount : MIN_ASSETS;
  const shotSize = opts.shotSize !== undefined ? opts.shotSize : MIN_PNG_BYTES + 1;
  const assetSize = opts.assetSize !== undefined ? opts.assetSize : MIN_ASSET_PNG_BYTES + 50;
  // shotMagic: true = full magic; false = all zeros; 'last-byte' = first 7 ok
  const shotMagic = opts.shotMagic !== undefined ? opts.shotMagic : true;

  // Screenshots
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
    writeText(path.join(root, `DOC-${i}.md`), `# Doc ${i}\n\nBody.\n`);
  }

  // Store fields (≥ MIN_STORE_FIELDS)
  const androidFields = ['title', 'short_description', 'full_description', 'changelogs/default'];
  for (const locale of ['de-DE', 'en-US']) {
    for (const f of androidFields) {
      writeText(path.join(root, 'android/fastlane/metadata/android', locale, `${f}.txt`), `${locale} ${f}`);
    }
  }
  writeText(path.join(root, 'ios/fastlane/metadata/copyright.txt'), '2026');
  writeText(path.join(root, 'ios/fastlane/metadata/primary_category.txt'), 'FINANCE');
  for (const locale of ['de-DE', 'en-US']) {
    for (const f of ['name', 'description', 'keywords', 'subtitle']) {
      writeText(path.join(root, 'ios/fastlane/metadata', locale, `${f}.txt`), `${locale} ${f}`);
    }
  }
  // Count is well above MIN_STORE_FIELDS=12 (assert for safety).
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
  assert.ok(storeN >= MIN_STORE_FIELDS, `fixture store fields ${storeN}`);

  // Assets
  for (let i = 0; i < assetCount; i++) {
    writePng(path.join(root, 'img/dfx', `asset-${i}.png`), assetSize);
  }
  writePng(path.join(root, 'img/icon.png'), assetSize);
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
    const home = os.homedir();
    assert.ok(home && home.length > 1, 'test host must have a resolvable home');

    const r = runBuild(home, { HANDBOOK_REPO_ROOT: fixture, HOME: home });
    assert.notStrictEqual(r.status, 0, r.stderr);
    assert.match(r.stderr, /home directory/i);
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
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
    assert.ok(manifest.counts.screenshots >= MIN_SCREENSHOTS);
    assert.ok(manifest.counts.docs >= MIN_DOCS);
    assert.ok(manifest.counts.store >= MIN_STORE_FIELDS);
    assert.ok(manifest.counts.assets >= MIN_ASSETS);
  });
});
