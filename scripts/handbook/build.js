#!/usr/bin/env node
/**
 * Handbook assembly for DFXswiss/btc-wallet (DFX BTC Taro Wallet).
 *
 * Auto-discovers screenshots, store-listing text, app assets and markdown
 * docs; generates a single deterministic index.html + manifest.json.
 *
 * No hand-maintained mapping table: new screenshots / locales / docs appear
 * automatically. Floor guards catch empty/corrupt checkouts; exact counts
 * are never enforced.
 *
 * Usage:
 *   npm install --prefix ./_handbook-deps --no-save --no-audit --no-fund marked@15.0.7
 *   NODE_PATH=./_handbook-deps/node_modules node scripts/handbook/build.js <output-dir>
 */

'use strict';

const fs = require('fs');
const path = require('path');

// --- Floor guards (today's counts minus a small buffer; never exact) ---
// A floor only detects content loss while it stays close to reality, and these
// constants are the single source the unit tests read — lowering one here would
// otherwise weaken every guard at once without turning a test red. The test
// "keeps the content floors meaningful against the real repository" ties them
// to what the repository actually contains; see FLOOR_MIN_RATIO there.
const MIN_SCREENSHOTS = 35;
const MIN_DOCS = 8;
// 25, not 12: the 28 store fields come from two Android locales (4 each), two
// iOS locales (9 each) and two global iOS files. The point of this floor is to
// notice a locale disappearing, so it has to sit above 28 minus the smallest
// locale — 24. At 20 both Android locales could vanish and the count would land
// exactly on the floor, which is not below it: the whole Google Play listing
// would have gone without a word.
const MIN_STORE_FIELDS = 25;
const MIN_ASSETS = 20;
// Screenshots / LFS-scale PNGs: a truncated checkout or LFS pointer is far
// below this. App icons under img/dfx/ can legitimately be smaller
// (telegram.png 611 B, twitter.png 606 B at a5e2a9185) — those use
// MIN_ASSET_PNG_BYTES. Magic-byte check still catches LFS pointer text.
const MIN_PNG_BYTES = 1000;
const MIN_ASSET_PNG_BYTES = 100;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MARKED_INSTALL =
  'npm install --prefix ./_handbook-deps --no-save --no-audit --no-fund marked@15.0.7';

// Repo-relative discovery roots (same strings discovery walks). prepareOutputDir
// refuses to empty these or any ancestor path that would wipe them.
const SOURCE_SCREENSHOTS_REL = 'docs/handbook/screenshots';
const SOURCE_DOCS_REL = 'docs';
const SOURCE_ANDROID_META_REL = 'android/fastlane/metadata/android';
const SOURCE_IOS_META_REL = 'ios/fastlane/metadata';
const SOURCE_DFX_ASSETS_REL = 'img/dfx';
const SOURCE_IMG_REL = 'img';
const DISCOVERY_SOURCE_RELS = [
  SOURCE_SCREENSHOTS_REL,
  SOURCE_DOCS_REL,
  SOURCE_ANDROID_META_REL,
  SOURCE_IOS_META_REL,
  SOURCE_DFX_ASSETS_REL,
  SOURCE_IMG_REL,
];

// Shape of a fastlane locale directory: `de`, `de-DE`, `pt-BR`, `zh-Hans`,
// `es-419`. The numeric alternative is not decoration: Google Play's
// Latin-American Spanish listing is the UN M.49 region `es-419`, and fastlane
// reads these directory names verbatim off the filesystem. Without it the
// build would abort the day someone runs `supply init` for that locale.
// Discovery treats every directory under the two metadata roots as a locale and
// publishes every .txt inside it. fastlane keeps more than locales there —
// `review_information/` holds the review contact's name, phone number, e-mail
// and the demo account's credentials, and the handbook is public. A shape check
// rather than a hand-maintained list keeps the "new locales appear by
// themselves" property; anything that is not locale-shaped is a hard failure,
// so the decision to publish a new kind of directory is always a deliberate one.
const LOCALE_DIR_RE = /^[a-z]{2,3}(-([A-Za-z]{2,4}|[0-9]{3}))?$/;

const SORT_LOCALE = 'en';

function sortStrings(a, b) {
  return a.localeCompare(b, SORT_LOCALE);
}

/**
 * Locale directory names directly under a fastlane metadata root, sorted.
 * Dot-directories are skipped as everywhere else; a non-locale directory
 * aborts the build instead of being published.
 */
function localeDirsUnder(metaRootAbs, metaRootRel) {
  const dirs = fs
    .readdirSync(metaRootAbs, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort(sortStrings);
  const foreign = dirs.filter((name) => !LOCALE_DIR_RE.test(name));
  if (foreign.length > 0) {
    fail(
      `handbook: ${metaRootRel}/ contains ${foreign.length} ` +
        `director${foreign.length === 1 ? 'y' : 'ies'} that ${
          foreign.length === 1 ? 'is' : 'are'
        } not a locale:\n` +
        foreign.map((n) => `  ${metaRootRel}/${n}`).join('\n') +
        '\nEverything under a locale directory is published to the public ' +
        'handbook, so this is refused rather than guessed. fastlane stores ' +
        'reviewer contact details and demo credentials next to the locales ' +
        '(review_information/); move the directory out of the metadata root, ' +
        'or widen LOCALE_DIR_RE in scripts/handbook/build.js if it really is ' +
        'a locale.',
    );
  }
  return dirs;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

// marked is loaded lazily on first markdown render — not at module load —
// so unit tests of guards that run before rendering (output dir, PNG, floors,
// collisions) do not require _handbook-deps. When rendering is actually
// needed, hard-fail with install instructions (no fallback renderer — that
// would make output environment-dependent and break determinism).
let MarkedRenderer = null;
let markedParseImpl = null;

function loadMarked() {
  try {
    // eslint-disable-next-line import/no-extraneous-dependencies
    return require('marked');
  } catch (err) {
    fail(
      'handbook: marked is required but could not be loaded.\n' +
        'Install it in isolation (do not add to package.json):\n' +
        '  ' +
        MARKED_INSTALL +
        '\n' +
        'Then re-run:\n' +
        '  NODE_PATH=./_handbook-deps/node_modules node scripts/handbook/build.js <out>\n' +
        'Original error: ' +
        (err && err.message ? err.message : String(err)),
    );
  }
}

function ensureMarked() {
  if (markedParseImpl) return;
  const markedModule = loadMarked();
  MarkedRenderer =
    typeof markedModule.Renderer === 'function'
      ? markedModule.Renderer
      : markedModule.marked && typeof markedModule.marked.Renderer === 'function'
        ? markedModule.marked.Renderer
        : null;
  markedParseImpl =
    typeof markedModule.parse === 'function'
      ? (md, opts) => markedModule.parse(md, opts)
      : typeof markedModule.marked?.parse === 'function'
        ? (md, opts) => markedModule.marked.parse(md, opts)
        : null;
  if (!markedParseImpl) {
    fail('handbook: marked loaded but no parse() API found (expected marked@15).');
  }
  if (!MarkedRenderer) {
    fail('handbook: marked loaded but no Renderer class found (expected marked@15).');
  }
}

// GitHub-compatible heading slug: lowercase; strip chars that are not letters
// (\p{L}), decimal digits (\p{Nd}) and letter numbers (\p{Nl}), marks (\p{M}),
// underscore (\p{Pc}), hyphen or space; spaces → '-'. No collapsing of multiple
// hyphens, no trim of leading/trailing hyphens. Unicode letters/digits/marks/
// underscore are kept. Other number categories (e.g. No: ² ³ ¼) are stripped,
// matching GitHub. Duplicate slugs within one document get -1, -2, … (first
// occurrence keeps the bare slug). Counter is per parse call only.
function createHeadingRenderer() {
  ensureMarked();
  const renderer = new MarkedRenderer();
  const seen = new Map();
  renderer.heading = function ({ tokens, depth }) {
    const text = this.parser.parseInline(tokens, this.parser.textRenderer);
    let slug = String(text)
      .toLowerCase()
      .replace(/[^\p{L}\p{Nd}\p{Nl}\p{M}\p{Pc}\- ]/gu, '')
      .replace(/ /g, '-');
    // Register every emitted id in `seen` so later collisions never re-use a
    // suffix that is already taken (e.g. ["A","A","A-1"] → a, a-1, a-1-1).
    let candidate = slug;
    while (seen.has(candidate)) {
      const n = seen.get(slug);
      seen.set(slug, n + 1);
      candidate = slug + '-' + n;
    }
    seen.set(candidate, 1);
    if (!seen.has(slug)) seen.set(slug, 1);
    slug = candidate;
    return (
      '<h' +
      depth +
      ' id="' +
      slug +
      '">' +
      this.parser.parseInline(tokens) +
      '</h' +
      depth +
      '>\n'
    );
  };
  return renderer;
}

// Renderer is created per call so heading-id counters never leak across documents.
function markedParse(md) {
  ensureMarked();
  return markedParseImpl(md, { renderer: createHeadingRenderer() });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Inverse of escapeHtml, for re-reading paths out of already-escaped HTML.
// Order matters: undo the single-character entities first, &amp; last —
// otherwise "&amp;lt;" would incorrectly decode to "<".
function decodeHtmlEntities(str) {
  return String(str)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

// URL-encode a relative output path for safe use inside an href/src
// attribute. encodeURIComponent is applied per path segment so '/' stays a
// separator, while reserved characters like '#' and '?' (left alone by
// encodeURI) are encoded — otherwise a filename containing them silently
// produces a broken link. Applied BEFORE escapeHtml — encodeURIComponent
// still leaves '&' untouched, so escapeHtml is still needed as a separate
// step to make the attribute value HTML-safe.
function encodeHtmlPath(p) {
  return String(p).split('/').map(encodeURIComponent).join('/');
}

// Inverse of encodeHtmlPath: decodeURIComponent per path segment. decodeURI
// does not reverse encodeURIComponent for reserved characters (# ? & +), so
// a filename like hash#tag.png encoded as hash%23tag.png would not round-trip.
function decodeHtmlPath(p) {
  return String(p)
    .split('/')
    .map((seg) => {
      try {
        return decodeURIComponent(seg);
      } catch {
        return seg;
      }
    })
    .join('/');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

/**
 * Resolve the user's home directory without a cwd-shaped fallback.
 * path.resolve('') === process.cwd(), so falling back to an empty string
 * would silently compare against the working directory when home is unknown:
 * blocking a legitimate outDir and no longer protecting $HOME. Fail closed
 * for the guard: only compare when home is actually known; if not, skip the
 * home check and log once (other path guards still apply).
 */
function resolveHomeDir() {
  let raw = process.env.HOME;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    try {
      raw = require('os').homedir();
    } catch {
      raw = null;
    }
  }
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return null;
  }
  return path.resolve(String(raw));
}

/** True if `a` is the same path as `b` or a strict ancestor of `b`. */
function isSameOrAncestor(a, b) {
  return a === b || b.startsWith(a + path.sep);
}

/**
 * Empty the output directory before writing so a rebuild never leaves stale
 * files from a previous run (deleted markdown still present as HTML, old
 * discovery trees, leftover foreign files). The CLI accepts an arbitrary
 * path, so rmdir must never touch the repo root, discovery source trees
 * (screenshots, store metadata, assets, docs), .git, the filesystem root or
 * the home directory — a wrong argument would be catastrophic.
 *
 * Missing outDir is fine (nothing to clear); writers recreate it.
 */
function prepareOutputDir(outDir, repoRoot) {
  const resolvedOut = path.resolve(outDir);
  const resolvedRoot = path.resolve(repoRoot);
  const homeDir = resolveHomeDir();

  if (resolvedOut === path.resolve('/')) {
    fail(
      'handbook: refusing to use filesystem root (/) as output directory.',
    );
  }
  if (homeDir === null) {
    console.error(
      'handbook warning: home directory could not be determined; ' +
        'skipping home-directory output guard (other guards still apply).',
    );
  } else if (resolvedOut === homeDir) {
    fail(
      `handbook: refusing to use home directory as output directory: ${resolvedOut}`,
    );
  }
  // Repo root itself, or any ancestor of the repo (emptying would wipe the tree).
  if (isSameOrAncestor(resolvedOut, resolvedRoot)) {
    fail(
      'handbook: refusing to empty output path that is the repo root or an ' +
        `ancestor of it: ${resolvedOut} (repo root: ${resolvedRoot})`,
    );
  }
  // Never empty a discovery source tree (or an ancestor that would wipe it).
  // E.g. outDir=docs/handbook/screenshots would delete the PNG set.
  for (const rel of DISCOVERY_SOURCE_RELS) {
    const protectedPath = path.resolve(resolvedRoot, rel);
    if (isSameOrAncestor(resolvedOut, protectedPath)) {
      fail(
        'handbook: refusing to empty output path that is a discovery source ' +
          `root or an ancestor of one: ${resolvedOut} ` +
          `(would wipe source ${rel} at ${protectedPath})`,
      );
    }
  }
  // Never touch anything under .git (object store, hooks, config).
  const segments = resolvedOut.split(path.sep);
  if (segments.includes('.git')) {
    fail(
      `handbook: refusing to empty output path that contains a .git segment: ${resolvedOut}`,
    );
  }

  if (fs.existsSync(resolvedOut)) {
    fs.rmSync(resolvedOut, { recursive: true, force: true });
  }
}

/**
 * Fail if two exclusive file writes would land on the same outputPath.
 * Silent overwrite is worse than a hard stop: the manifest would still
 * list every source while only the last writer survives on disk.
 *
 * index.html is excluded: store fields (HTML-only section) intentionally
 * share that single generated overview page as their outputPath — they do
 * not each write a separate file. Every other category must have a unique
 * path per source.
 */
function assertNoOutputCollisions(artifacts) {
  const byPath = new Map();
  for (const a of artifacts) {
    if (!a.outputPath || a.outputPath === 'index.html') continue;
    if (!byPath.has(a.outputPath)) byPath.set(a.outputPath, []);
    byPath.get(a.outputPath).push(a.sourcePath);
  }
  const collisions = [];
  for (const [outPath, sources] of byPath.entries()) {
    const unique = Array.from(new Set(sources)).sort(sortStrings);
    if (unique.length > 1) {
      collisions.push({ outPath, sources: unique });
    }
  }
  collisions.sort((a, b) => sortStrings(a.outPath, b.outPath));
  if (collisions.length > 0) {
    const lines = collisions.map((c) => {
      return (
        `  ${c.outPath}\n` +
        c.sources.map((s) => `    - ${s}`).join('\n')
      );
    });
    fail(
      'handbook output collision: multiple sources claim the same output path ' +
        '(would silently overwrite). Resolve the naming conflict before rebuilding:\n' +
        lines.join('\n'),
    );
  }
}

function assertValidPng(filePath, minBytes = MIN_PNG_BYTES) {
  let st;
  try {
    st = fs.statSync(filePath);
  } catch (err) {
    fail(`handbook PNG guard: cannot stat ${filePath}: ${err.message}`);
  }
  if (st.size <= minBytes) {
    fail(
      `handbook PNG guard: ${filePath} is ${st.size} bytes (must be > ${minBytes}). ` +
        'Possible incomplete checkout or LFS pointer.',
    );
  }
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(8);
  try {
    fs.readSync(fd, buf, 0, 8, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (!buf.equals(PNG_MAGIC)) {
    fail(
      `handbook PNG guard: ${filePath} does not start with PNG magic bytes. ` +
        'Possible incomplete checkout or LFS pointer.',
    );
  }
}

// Directory basenames skipped at any depth during markdown discovery.
// blue_modules holds vendored upstream READMEs (explicit issue exclusion);
// ios/android/windows/macos/vendor hold platform and third-party docs that
// are not product documentation for this handbook.
const SKIP_MD_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  '_handbook-deps',
  'build',
  'dist',
  'coverage',
  'blue_modules',
  'ios',
  'android',
  'windows',
  'macos',
  'vendor',
]);

/**
 * Recursive scan of repoRoot for *.md (case-insensitive). Skips well-known
 * dependency/build dirs, any dot-directory, and the exact path docs/handbook
 * (handbook self-docs / local build output — not repo documentation).
 * Returns repo-relative posix paths, sorted.
 */
function listMarkdownFiles(rootDir) {
  const results = [];
  function walk(absDir, relDir) {
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of entries) {
      const name = d.name;
      const relPath = relDir ? path.posix.join(relDir, name) : name;
      if (d.isDirectory()) {
        if (name.startsWith('.')) continue;
        if (SKIP_MD_DIR_NAMES.has(name)) continue;
        // Exact path only — not every directory named "handbook".
        if (relPath === 'docs/handbook') continue;
        walk(path.join(absDir, name), relPath);
      } else if (d.isFile() && name.toLowerCase().endsWith('.md')) {
        results.push(relPath);
      }
    }
  }
  walk(rootDir, '');
  return results.sort(sortStrings);
}

/** Deterministic title from filename when metadata.docs has no override. */
function defaultDocTitle(relSrc) {
  const base = path.posix.basename(relSrc).replace(/\.md$/i, '');
  const words = base.split(/[-_]+/).filter(Boolean);
  if (words.length === 0) return base;
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function titleFromFilename(filename) {
  return filename.replace(/\.png$/i, '');
}

/**
 * Human-readable caption + optional step badge for a screenshot file.
 * Order: metadata.captions[stem] wins; else strip leading NN- and humanize.
 * Filename stem always remains available for the monospace technical line.
 */
function deriveScreenshotCaption(filename, groupMeta) {
  const stem = filename.replace(/\.png$/i, '');
  const captions =
    groupMeta && groupMeta.captions && typeof groupMeta.captions === 'object'
      ? groupMeta.captions
      : null;
  // Metadata caption wins over derivation when present and non-empty.
  if (captions && typeof captions[stem] === 'string' && captions[stem].trim()) {
    const m = /^(\d{2})-(.+)$/.exec(stem);
    return { badge: m ? m[1] : null, caption: captions[stem].trim(), stem };
  }
  const m = /^(\d{2})-(.+)$/.exec(stem);
  if (m) {
    const rest = m[2].replace(/[-_]+/g, ' ').trim();
    const caption =
      rest.length === 0 ? stem : rest.charAt(0).toUpperCase() + rest.slice(1);
    return { badge: m[1], caption, stem };
  }
  const rest = stem.replace(/[-_]+/g, ' ').trim();
  const caption =
    rest.length === 0 ? stem : rest.charAt(0).toUpperCase() + rest.slice(1);
  return { badge: null, caption, stem };
}

/**
 * Relative prefix from an output path back to the handbook root
 * (docs/foo.html → '../', docs/infra/x.html → '../../', index.html → '').
 */
function relativeToRoot(outputPath) {
  const dir = path.posix.dirname(outputPath);
  if (!dir || dir === '.') return '';
  const depth = dir.split('/').filter(Boolean).length;
  return '../'.repeat(depth);
}

function slugify(key) {
  return (
    String(key)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'item'
  );
}

// ---------------------------------------------------------------------------
// Shared design tokens + base rules (index AND doc pages — single source).
// ---------------------------------------------------------------------------
const SHARED_CSS = `
:root {
  --bg: #eef2f7;
  --surface: #ffffff;
  --surface-2: #f5f7fa;
  --surface-3: #e6ecf4;
  --line: #dce3ec;
  --line-strong: #c2cddc;
  --ink: #0a1f33;
  --ink-2: #33465f;
  --ink-3: #5a6c84;
  --ink-4: #7d8ca1;
  --brand: #f5516c;
  --brand-ink: #c0294a;
  --brand-soft: rgba(245, 81, 108, 0.10);
  --navy: #0a355c;
  --link: #0a4f8f;
  --focus: #0a4f8f;
  --shadow-1: 0 1px 2px rgba(10, 31, 51, 0.06), 0 4px 12px rgba(10, 31, 51, 0.04);
  --shadow-2: 0 2px 6px rgba(10, 31, 51, 0.08), 0 12px 28px rgba(10, 31, 51, 0.08);
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --mono: "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  --topbar-h: 60px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0a1420;
    --surface: #101d2c;
    --surface-2: #16273a;
    --surface-3: #1d3149;
    --line: #22384f;
    --line-strong: #31506e;
    --ink: #e9eff7;
    --ink-2: #bccbdb;
    --ink-3: #93a4b9;
    --ink-4: #75879d;
    --brand: #ff7089;
    --brand-ink: #ff8fa2;
    --brand-soft: rgba(255, 112, 137, 0.14);
    --navy: #7fb0e6;
    --link: #7fb0e6;
    --focus: #7fb0e6;
    --shadow-1: 0 1px 2px rgba(0, 0, 0, 0.25);
    --shadow-2: 0 2px 8px rgba(0, 0, 0, 0.30);
  }
}
:root[data-theme="dark"] {
  --bg: #0a1420;
  --surface: #101d2c;
  --surface-2: #16273a;
  --surface-3: #1d3149;
  --line: #22384f;
  --line-strong: #31506e;
  --ink: #e9eff7;
  --ink-2: #bccbdb;
  --ink-3: #93a4b9;
  --ink-4: #75879d;
  --brand: #ff7089;
  --brand-ink: #ff8fa2;
  --brand-soft: rgba(255, 112, 137, 0.14);
  --navy: #7fb0e6;
  --link: #7fb0e6;
  --focus: #7fb0e6;
  --shadow-1: 0 1px 2px rgba(0, 0, 0, 0.25);
  --shadow-2: 0 2px 8px rgba(0, 0, 0, 0.30);
}
:root[data-theme="light"] {
  --bg: #eef2f7;
  --surface: #ffffff;
  --surface-2: #f5f7fa;
  --surface-3: #e6ecf4;
  --line: #dce3ec;
  --line-strong: #c2cddc;
  --ink: #0a1f33;
  --ink-2: #33465f;
  --ink-3: #5a6c84;
  --ink-4: #7d8ca1;
  --brand: #f5516c;
  --brand-ink: #c0294a;
  --brand-soft: rgba(245, 81, 108, 0.10);
  --navy: #0a355c;
  --link: #0a4f8f;
  --focus: #0a4f8f;
  --shadow-1: 0 1px 2px rgba(10, 31, 51, 0.06), 0 4px 12px rgba(10, 31, 51, 0.04);
  --shadow-2: 0 2px 6px rgba(10, 31, 51, 0.08), 0 12px 28px rgba(10, 31, 51, 0.08);
}
*, *::before, *::after { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--font);
  font-size: 16px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
body.is-locked { overflow: hidden; }
a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; }
a:focus-visible, button:focus-visible, summary:focus-visible, input:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
code, pre {
  font-family: var(--mono);
}
code {
  font-size: 0.875em;
  background: var(--surface-2);
  padding: 0.1em 0.35em;
  border-radius: 4px;
  border: 1px solid var(--line);
  color: var(--ink);
}
.skip-link {
  position: absolute;
  left: -9999px;
  top: 0;
  z-index: 1000;
  background: var(--navy);
  color: #fff;
  padding: 10px 16px;
  border-radius: 0 0 var(--radius-sm) 0;
  font-weight: 600;
}
.skip-link:focus {
  left: 0;
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
.site-chrome {
  position: sticky;
  top: 0;
  z-index: 100;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
}
.topbar {
  height: var(--topbar-h);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 20px;
  background: var(--surface);
}
.topbar-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  color: inherit;
  text-decoration: none;
  flex: 1 1 auto;
  min-width: 0;
}
.topbar-brand:hover { text-decoration: none; }
.topbar-brand img {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  display: block;
  flex: 0 0 auto;
  object-fit: cover;
}
.topbar-titles {
  line-height: 1.25;
  flex: 0 0 auto;
}
.topbar-titles .wordmark {
  display: block;
  font-weight: 650;
  font-size: 15px;
  color: var(--ink);
  white-space: nowrap;
}
.topbar-titles .submark {
  display: block;
  font-size: 12.5px;
  color: var(--ink-3);
  white-space: nowrap;
}
.topbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
}
/* Desktop (≥720): single topbar row — brand | search | actions */
.search-wrap {
  position: relative;
  flex: 0 0 auto;
  width: 300px;
  max-width: 32vw;
  margin-left: auto;
}
.search-wrap[hidden] {
  display: none !important;
}
.search-status {
  position: absolute;
  left: 16px;
  right: 16px;
  top: 100%;
  margin: 0;
  padding: 6px 12px;
  font-size: 13px;
  line-height: 1.35;
  color: var(--ink-2);
  background: var(--surface);
  border: 1px solid var(--line);
  border-top: 0;
  border-radius: 0 0 var(--radius-sm) var(--radius-sm);
  box-shadow: var(--shadow-1);
  z-index: 101;
  pointer-events: none;
}
.search-status:empty,
.search-status[hidden] {
  display: none !important;
  padding: 0;
  border: 0;
  box-shadow: none;
}
.icon-btn {
  appearance: none;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  color: var(--ink-2);
  cursor: pointer;
  width: 44px;
  height: 44px;
  min-width: 44px;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: color 180ms, background 180ms, border-color 180ms;
}
.icon-btn:hover {
  background: var(--surface-3);
  border-color: var(--line-strong);
  color: var(--ink);
}
.icon-btn svg { width: 20px; height: 20px; display: block; }
.icon-btn .icon-moon { display: none; }
:root[data-theme="dark"] .icon-btn .icon-sun { display: none; }
:root[data-theme="dark"] .icon-btn .icon-moon { display: block; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .icon-btn .icon-sun { display: none; }
  :root:not([data-theme="light"]) .icon-btn .icon-moon { display: block; }
}
.search-wrap input[type="search"] {
  width: 100%;
  height: 40px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--ink);
  font: inherit;
  font-size: 14px;
  padding: 0 12px;
  transition: border-color 180ms, background 180ms;
}
.search-wrap input[type="search"]:focus {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
  border-color: var(--focus);
  background: var(--surface);
}
.search-wrap input[type="search"]::-webkit-search-cancel-button { -webkit-appearance: none; }
.topbar-nav-btn {
  appearance: none;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  color: var(--ink-2);
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  height: 44px;
  min-height: 44px;
  min-width: 44px;
  padding: 0 14px;
  transition: color 180ms, background 180ms, border-color 180ms;
}
.topbar-nav-btn:hover {
  background: var(--surface-3);
  color: var(--ink);
}
/* Narrow: brand + actions on row 1; search full-width second row */
@media (max-width: 719px) {
  .topbar {
    flex-wrap: wrap;
    height: auto;
    min-height: var(--topbar-h);
    padding-bottom: 10px;
    row-gap: 0;
  }
  .topbar-brand {
    order: 1;
    flex: 1 1 auto;
  }
  .topbar-actions {
    order: 2;
    margin-left: 0;
  }
  .search-wrap {
    order: 3;
    flex: 1 1 100%;
    width: 100%;
    max-width: none;
    margin-left: 0;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--line);
  }
  .topbar-nav-btn {
    padding: 0;
    width: 44px;
    font-size: 0;
  }
  .topbar-nav-btn::before {
    content: "≡";
    font-size: 18px;
    font-weight: 700;
    line-height: 1;
  }
}
.topbar-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--link);
  white-space: nowrap;
  min-height: 44px;
  padding: 0 8px;
}
.topbar-back:hover { text-decoration: underline; }
.crumbs {
  font-size: 13px;
  color: var(--ink-3);
  margin: 0 0 18px;
}
.crumbs a { color: var(--ink-2); }
.crumbs .sep { margin: 0 6px; color: var(--ink-4); }
.footer {
  margin-top: 56px;
  padding-top: 24px;
  border-top: 1px solid var(--line);
  font-size: 13px;
  color: var(--ink-3);
}
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
`;

const INDEX_CSS = SHARED_CSS + `
.wrap {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 40px;
  max-width: 1320px;
  margin: 0 auto;
  padding: 28px 28px 64px;
}
.sidebar {
  position: sticky;
  top: calc(var(--topbar-h) + 16px);
  align-self: start;
  max-height: calc(100vh - var(--topbar-h) - 32px);
  overflow-y: auto;
  padding-right: 8px;
}
.sidebar-panel {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: 16px 14px;
}
.toc-label {
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-4);
  margin: 0 0 10px;
}
.toc { margin: 0; }
.toc ol { list-style: none; padding: 0; margin: 0; }
.toc > ol > li { margin: 2px 0; }
.toc a {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 7px 10px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  color: var(--ink-2);
  text-decoration: none;
  border-left: 3px solid transparent;
  transition: background 160ms, color 160ms, border-color 160ms;
}
.toc a:hover {
  background: var(--surface-2);
  color: var(--ink);
  text-decoration: none;
}
.toc a[aria-current="true"] {
  background: var(--brand-soft);
  color: var(--brand-ink);
  border-left-color: var(--brand);
  font-weight: 650;
}
.toc .spec-num {
  display: inline-block;
  min-width: 22px;
  font-variant-numeric: tabular-nums;
  color: var(--ink-4);
  font-size: 12px;
}
.toc .sub {
  list-style: none;
  padding: 2px 0 6px 18px;
  margin: 0;
}
.toc .sub a {
  font-size: 13px;
  padding: 5px 10px;
  color: var(--ink-3);
}
.toc .sub a .count {
  margin-left: auto;
  font-size: 12px;
  color: var(--ink-4);
  font-variant-numeric: tabular-nums;
}
.toc-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 12px 0 0;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
.toc-actions button {
  appearance: none;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  color: var(--ink-2);
  cursor: pointer;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  min-height: 36px;
  padding: 6px 12px;
  transition: background 160ms, border-color 160ms, color 160ms;
}
.toc-actions button:hover {
  background: var(--surface-3);
  border-color: var(--line-strong);
  color: var(--ink);
}
main { min-width: 0; }
.hero h1 {
  margin: 0 0 14px;
  font-size: 34px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.2;
  color: var(--ink);
}
.lede {
  font-size: 18px;
  color: var(--ink-2);
  margin: 0 0 28px;
  max-width: 70ch;
}
.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  overflow: hidden;
  margin: 0 0 24px;
}
.stats .stat {
  flex: 1 1 110px;
  padding: 16px 18px;
  border-right: 1px solid var(--line);
  min-width: 100px;
}
.stats .stat:last-child { border-right: 0; }
.stats .stat .n {
  display: block;
  font-size: 22px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--ink);
  line-height: 1.2;
  letter-spacing: -0.01em;
  overflow-wrap: anywhere;
}
.stats .stat .l {
  display: block;
  margin-top: 4px;
  font-size: 12.5px;
  color: var(--ink-3);
}
.stats .stat.stat-sha {
  flex: 1 1 140px;
  min-width: 0;
}
.stats .stat.stat-sha .n {
  font-size: 16px;
  font-family: var(--mono);
  font-weight: 650;
  letter-spacing: 0;
}
.callout {
  background: var(--surface);
  border: 1px solid var(--line);
  border-left: 3px solid var(--navy);
  padding: 14px 18px;
  margin: 0 0 36px;
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  max-width: 70ch;
}
.callout p {
  margin: 0;
  color: var(--ink-2);
  font-size: 14px;
}
.callout b { color: var(--ink); }
hr.sep {
  border: 0;
  border-top: 1px solid var(--line);
  margin: 40px 0;
}
details.spec {
  margin: 0 0 56px;
  scroll-margin-top: calc(var(--topbar-h) + 64px);
}
details.spec > summary {
  list-style: none;
  cursor: pointer;
  user-select: none;
  padding: 4px 0;
}
details.spec > summary::-webkit-details-marker { display: none; }
.spec-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 20px;
  margin-bottom: 8px;
}
.spec-head .lhs { min-width: 0; }
.spec-head h2 {
  margin: 0 0 6px;
  font-size: 22px;
  font-weight: 650;
  letter-spacing: -0.01em;
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--ink);
}
.spec-head .badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 34px;
  height: 26px;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--surface-3);
  color: var(--ink-3);
  font-size: 12.5px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.spec-head .chevron {
  width: 16px;
  height: 16px;
  color: var(--ink-4);
  flex: 0 0 auto;
  transition: transform 180ms, color 160ms;
}
details.spec[open] .spec-head .chevron {
  transform: rotate(90deg);
  color: var(--brand);
}
.spec-head .file {
  font-family: var(--mono);
  font-size: 12.5px;
  color: var(--ink-3);
  overflow-wrap: anywhere;
}
.spec-head .rhs {
  text-align: right;
  font-size: 13px;
  color: var(--ink-3);
  white-space: nowrap;
}
.spec-head .rhs b { color: var(--ink); font-weight: 650; }
@media (max-width: 600px) {
  .spec-head {
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }
  .spec-head .rhs {
    text-align: left;
    white-space: normal;
  }
  .stats .stat.stat-sha {
    flex: 1 1 100%;
    border-right: 0;
    border-top: 1px solid var(--line);
  }
  .stats .stat.stat-sha .n {
    font-size: 14px;
  }
}
.spec-intro {
  color: var(--ink-2);
  margin: 12px 0 22px;
  max-width: 70ch;
  font-size: 16px;
}
.group-block {
  margin: 0 0 36px;
  scroll-margin-top: calc(var(--topbar-h) + 16px);
}
.group-block[hidden],
.shot-card[hidden],
details.spec[hidden],
.doc-list li[hidden] {
  display: none !important;
}
/* Copy button sits NEXT TO the group heading, never inside it (a11y name). */
.group-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0 0 8px;
  flex-wrap: wrap;
}
.group-head h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 650;
  color: var(--ink);
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  scroll-margin-top: calc(var(--topbar-h) + 16px);
}
.group-head h3 .gcount {
  font-size: 13px;
  font-weight: 500;
  color: var(--ink-4);
}
.group-desc {
  margin: 0 0 18px;
  max-width: 70ch;
  color: var(--ink-2);
  font-size: 15px;
}
a.name.permalink {
  text-decoration: none;
  color: inherit;
}
a.name.permalink:hover {
  text-decoration: underline;
  color: var(--brand-ink);
}
.copy-link {
  appearance: none;
  background: transparent;
  border: 1px solid transparent;
  padding: 2px 6px;
  font: inherit;
  font-size: 11.5px;
  line-height: 1;
  color: var(--ink-3);
  cursor: pointer;
  border-radius: 4px;
  flex: 0 0 auto;
}
.copy-link:hover {
  color: var(--brand-ink);
  background: var(--surface);
  border-color: var(--line);
}
.copy-link[data-copied='true'] {
  color: var(--brand-ink);
  background: var(--surface);
  border-color: var(--brand);
}
.shot-grid {
  display: grid;
  gap: 22px;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
}
.shot-card {
  margin: 0;
  background: transparent;
  scroll-margin-top: calc(var(--topbar-h) + 12px);
}
.shot-card > a.shot-img {
  display: block;
  color: inherit;
  text-decoration: none;
  cursor: pointer;
  border-radius: var(--radius-lg);
  transition: opacity 160ms;
}
.shot-card > a.shot-img:hover { text-decoration: none; }
.shot-card .frame {
  aspect-ratio: 9 / 19.5;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-1);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 10px;
  transition: border-color 180ms, box-shadow 180ms;
}
.shot-card > a.shot-img:hover .frame {
  border-color: var(--line-strong);
  box-shadow: var(--shadow-2);
}
.shot-card > a.shot-img:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 3px;
}
.shot-card img {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
  display: block;
  border-radius: 8px;
}
.shot-card figcaption {
  margin-top: 10px;
  padding: 0 2px;
}
.shot-card .cap-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  flex-wrap: wrap;
}
.shot-card .num-badge {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 22px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--surface-3);
  color: var(--ink-2);
  font-size: 11.5px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.shot-card .cap-row a.name.permalink {
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
  line-height: 1.35;
  flex: 1 1 auto;
  min-width: 0;
}
.shot-card .cap-file {
  margin-top: 4px;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--ink-3);
  overflow-wrap: anywhere;
}
.asset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 16px;
}
.asset-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: 14px;
  text-align: center;
  transition: border-color 160ms, box-shadow 160ms;
}
.asset-card:hover {
  border-color: var(--line-strong);
  box-shadow: var(--shadow-1);
}
.asset-card a {
  display: block;
  color: inherit;
  text-decoration: none;
}
.asset-card a:hover { text-decoration: none; }
.asset-card a:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}
.asset-card .frame {
  aspect-ratio: 4 / 3;
  background:
    linear-gradient(45deg, var(--surface-3) 25%, transparent 25%),
    linear-gradient(-45deg, var(--surface-3) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--surface-3) 75%),
    linear-gradient(-45deg, transparent 75%, var(--surface-3) 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  background-color: var(--surface-2);
  border-radius: var(--radius-sm);
  border: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
}
.asset-card img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.asset-card .an {
  margin-top: 10px;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--ink-2);
  overflow-wrap: anywhere;
}
.store-platform { margin-bottom: 36px; }
.store-platform h3 {
  margin: 0 0 14px;
  font-size: 18px;
  color: var(--ink);
}
.store-locale {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: 18px 20px;
  margin-bottom: 14px;
}
.store-locale h4 {
  margin: 0 0 14px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 650;
}
.locale-chip {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--surface-3);
  color: var(--ink-2);
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 600;
}
.store-locale dl {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.store-row {
  display: grid;
  grid-template-columns: minmax(120px, 200px) 1fr;
  gap: 8px 18px;
  align-items: start;
}
.store-row[hidden] { display: none !important; }
.store-locale dt {
  font-size: 13px;
  color: var(--ink-3);
  font-weight: 650;
}
.store-locale dd {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--ink);
  font-size: 15px;
}
.store-locale dd.empty { color: var(--ink-4); }
.doc-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.doc-list li {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  margin-bottom: 10px;
  transition: border-color 160ms, box-shadow 160ms;
}
.doc-list li:hover {
  border-color: var(--line-strong);
  box-shadow: var(--shadow-1);
}
.doc-list a {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  min-height: 52px;
  color: var(--ink);
  text-decoration: none;
}
.doc-list a:hover { text-decoration: none; }
.doc-list a:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
  border-radius: var(--radius-md);
}
.doc-list .doc-title { font-weight: 650; font-size: 15px; }
.doc-list .doc-path {
  font-family: var(--mono);
  font-size: 12.5px;
  color: var(--ink-3);
}
.doc-list .chev {
  color: var(--ink-4);
  flex: 0 0 auto;
}
.search-empty {
  background: var(--surface);
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius-md);
  padding: 28px 20px;
  text-align: center;
  color: var(--ink-2);
  margin: 12px 0 28px;
}
.lightbox {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(7, 20, 32, 0.88);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .lightbox {
    background: rgba(2, 8, 14, 0.92);
  }
}
:root[data-theme="dark"] .lightbox {
  background: rgba(2, 8, 14, 0.92);
}
.lightbox[hidden] { display: none !important; }
.lightbox-dialog {
  background: var(--surface);
  color: var(--ink);
  border-radius: var(--radius-lg);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-2);
  width: min(92vw, 380px);
  max-width: min(92vw, 380px);
  max-height: min(94vh, 100%);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.lightbox-bar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--line);
}
.lightbox-meta { min-width: 0; }
.lightbox-title {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
  color: var(--ink);
}
.lightbox-file {
  margin: 4px 0 0;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--ink-3);
  overflow-wrap: anywhere;
}
.lightbox-count {
  margin: 6px 0 0;
  font-size: 12.5px;
  color: var(--ink-4);
}
.lightbox-body {
  display: grid;
  grid-template-columns: 44px 1fr 44px;
  align-items: center;
  gap: 4px;
  padding: 10px 8px;
  background: var(--surface-2);
  min-height: 0;
}
.lightbox-stage {
  grid-column: 2;
  grid-row: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  overflow: auto;
}
.lightbox-stage img {
  max-width: 100%;
  max-height: min(68vh, 720px);
  width: auto;
  height: auto;
  object-fit: contain;
  display: block;
  margin: 0 auto;
}
.lightbox-arrow {
  appearance: none;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  color: var(--ink-2);
  cursor: pointer;
  font: inherit;
  font-size: 18px;
  font-weight: 700;
  min-height: 44px;
  min-width: 44px;
  padding: 0;
  transition: background 160ms, border-color 160ms, color 160ms;
  grid-row: 1;
}
.lightbox-arrow:hover {
  background: var(--surface-3);
  color: var(--ink);
}
#lightbox-prev { grid-column: 1; }
#lightbox-next { grid-column: 3; }
.lightbox-arrow .label-full { display: none; }
.lightbox-arrow .label-short { display: inline; }
@media (max-width: 560px) {
  .lightbox-dialog {
    width: min(94vw, 360px);
    max-width: min(94vw, 360px);
  }
  .lightbox-body {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto auto;
    padding: 10px;
    gap: 8px;
  }
  .lightbox-stage {
    grid-column: 1 / -1;
    grid-row: 1;
  }
  #lightbox-prev { grid-column: 1; grid-row: 2; }
  #lightbox-next { grid-column: 2; grid-row: 2; }
  .lightbox-arrow {
    width: 100%;
    font-size: 14px;
    font-weight: 600;
    padding: 0 10px;
  }
  .lightbox-arrow .label-full { display: inline; }
  .lightbox-arrow .label-short { display: none; }
}
@media (max-width: 1023px) {
  .wrap {
    grid-template-columns: 1fr;
    padding: 18px 16px 48px;
    gap: 20px;
  }
  .sidebar {
    position: static;
    max-height: none;
    order: 2;
    display: none;
  }
  body.sidebar-open .sidebar { display: block; }
  main { order: 1; }
  .hero h1 { font-size: 28px; }
  .stats .stat { border-right: 0; border-bottom: 1px solid var(--line); }
  .store-row { grid-template-columns: 1fr; gap: 2px; }
}
@media (min-width: 1024px) {
  .topbar-nav-btn { display: none; }
}
@media (max-width: 480px) {
  .topbar { padding: 0 12px 10px; gap: 8px; }
  .topbar-titles .wordmark { font-size: 13.5px; }
}
.toc li[hidden] { display: none !important; }
`;

const DOC_CSS = SHARED_CSS + `
.doc-wrap {
  max-width: 72ch;
  margin: 0 auto;
  padding: 28px 22px 64px;
}
.doc-body {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: 28px 28px 36px;
  box-shadow: var(--shadow-1);
}
.doc-body > :first-child { margin-top: 0; }
.doc-body h1 {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.015em;
  line-height: 1.25;
  margin: 0 0 18px;
  color: var(--ink);
}
.doc-body h2 {
  font-size: 22px;
  font-weight: 650;
  margin: 36px 0 12px;
  padding-top: 18px;
  border-top: 1px solid var(--line);
  color: var(--ink);
  scroll-margin-top: calc(var(--topbar-h) + 12px);
}
.doc-body h3 {
  font-size: 18px;
  font-weight: 650;
  margin: 28px 0 10px;
  color: var(--ink);
  scroll-margin-top: calc(var(--topbar-h) + 12px);
}
.doc-body h4, .doc-body h5, .doc-body h6 {
  font-size: 16px;
  font-weight: 650;
  margin: 22px 0 8px;
  color: var(--ink);
}
.doc-body p, .doc-body li {
  color: var(--ink-2);
  max-width: 70ch;
}
.doc-body a { color: var(--link); }
.doc-body a:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
.doc-body ul, .doc-body ol { padding-left: 1.35em; }
.doc-body li { margin: 0.35em 0; }
.doc-body blockquote {
  margin: 18px 0;
  padding: 10px 16px;
  border-left: 3px solid var(--brand);
  background: var(--brand-soft);
  color: var(--ink-2);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}
.doc-body hr {
  border: 0;
  border-top: 1px solid var(--line);
  margin: 28px 0;
}
.doc-body img {
  max-width: 100%;
  height: auto;
  border-radius: var(--radius-sm);
  border: 1px solid var(--line);
}
.doc-body pre {
  margin: 16px 0;
  padding: 0;
  background: transparent;
  border: 0;
  overflow: visible;
}
.doc-body pre code,
.doc-body .code-scroll {
  display: block;
  overflow-x: auto;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 14px 16px;
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--ink);
}
.doc-body table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14.5px;
  margin: 0;
}
.doc-body .table-scroll {
  overflow-x: auto;
  margin: 16px 0;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface);
}
.doc-body th, .doc-body td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
  text-align: left;
  vertical-align: top;
}
.doc-body th {
  background: var(--surface-2);
  color: var(--ink);
  font-weight: 650;
}
.doc-body tr:nth-child(even) td { background: var(--surface-2); }
.doc-body tr:last-child td { border-bottom: 0; }
@media (max-width: 640px) {
  .doc-wrap { padding: 16px 12px 48px; }
  .doc-body { padding: 18px 16px 28px; }
}
`;

function svgChevron() {
  return (
    '<svg class="chevron" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" d="M6.2 3.2a.75.75 0 0 1 1.06 0l4 4a.75.75 0 0 1 0 1.06l-4 4A.75.75 0 1 1 6.2 11.2L9.44 8 6.2 4.76a.75.75 0 0 1 0-1.06z"/>' +
    '</svg>'
  );
}

function svgSunMoon() {
  return (
    '<svg class="icon-sun" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" d="M12 18a6 6 0 1 1 0-12 6 6 0 0 1 0 12zm0 3.25a.75.75 0 0 0 .75-.75v-1a.75.75 0 0 0-1.5 0v1c0 .41.34.75.75.75zm0-16.5a.75.75 0 0 0 .75-.75v-1a.75.75 0 0 0-1.5 0v1c0 .41.34.75.75.75zm9 7.5a.75.75 0 0 0-.75-.75h-1a.75.75 0 0 0 0 1.5h1c.41 0 .75-.34.75-.75zm-16.5 0a.75.75 0 0 0-.75-.75h-1a.75.75 0 0 0 0 1.5h1c.41 0 .75-.34.75-.75zm12.78 5.78a.75.75 0 0 0 0-1.06l-.7-.7a.75.75 0 1 0-1.06 1.06l.7.7c.3.3.77.3 1.06 0zm-10.6-10.6a.75.75 0 0 0 0-1.06l-.7-.7A.75.75 0 1 0 5.3 6.48l.7.7c.3.3.77.3 1.06 0zm10.6 0c.3-.3.3-.77 0-1.06l-.7-.7a.75.75 0 1 0-1.06 1.06l.7.7c.3.3.77.3 1.06 0zM7.18 18.28a.75.75 0 0 0 0-1.06l-.7-.7a.75.75 0 1 0-1.06 1.06l.7.7c.3.3.77.3 1.06 0z"/>' +
    '</svg>' +
    '<svg class="icon-moon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" d="M16.5 2.25a.75.75 0 0 1 .68.44 8.25 8.25 0 1 1-11.4 11.4.75.75 0 0 1 .98-.98 6.5 6.5 0 0 0 8.54-8.54.75.75 0 0 1 .44-.68 8.2 8.2 0 0 1 .76-.16z"/>' +
    '</svg>'
  );
}

function buildTopbar(opts) {
  const prefix = opts.prefix || '';
  const logoHref = escapeHtml(encodeHtmlPath(prefix + 'assets/icon.png'));
  const homeHref = escapeHtml(encodeHtmlPath(prefix + 'index.html'));
  const showSearch = !!opts.showSearch;
  const showSidebarToggle = !!opts.showSidebarToggle;
  const showBack = !!opts.showBack;
  let actions = '';
  if (showSidebarToggle) {
    actions +=
      '<button type="button" class="topbar-nav-btn" id="sidebar-toggle" hidden ' +
      'aria-expanded="false" aria-controls="handbook-sidebar">Inhalt</button>';
  }
  if (showBack) {
    actions +=
      `<a class="topbar-back" href="${homeHref}">← Zum Handbuch</a>`;
  }
  actions +=
    '<button type="button" class="icon-btn" id="theme-toggle" hidden ' +
    'aria-label="Darstellung umschalten" aria-pressed="false">' +
    svgSunMoon() +
    '</button>';
  // Search lives in the topbar row on ≥720px; CSS wraps it to a second row under 720px.
  let searchHtml = '';
  let statusHtml = '';
  if (showSearch) {
    searchHtml =
      '<div class="search-wrap" id="search-wrap" hidden>' +
      '<input type="search" id="handbook-search" placeholder="Suchen…" ' +
      'aria-label="Handbuch durchsuchen" autocomplete="off" spellcheck="false">' +
      '</div>';
    statusHtml =
      '<p class="search-status" id="search-status" role="status" aria-live="polite" hidden></p>';
  }
  return (
    `<div class="site-chrome">` +
    `<header class="topbar">` +
    `<a class="topbar-brand" href="${homeHref}">` +
    `<img src="${logoHref}" alt="DFX BTC Taro Wallet" width="30" height="30">` +
    `<span class="topbar-titles">` +
    `<span class="wordmark">DFX BTC Taro Wallet</span>` +
    `<span class="submark">Handbuch</span>` +
    `</span></a>` +
    searchHtml +
    `<div class="topbar-actions">${actions}</div>` +
    `</header>` +
    statusHtml +
    `</div>`
  );
}

function buildHead(opts) {
  const prefix = opts.prefix || '';
  const iconHref = escapeHtml(encodeHtmlPath(prefix + 'assets/icon.png'));
  const desc = escapeHtml(
    opts.description ||
      'Handbuch der DFX BTC Taro Wallet: Screenshots, Store-Listing, Assets und Dokumentation.',
  );
  const title = escapeHtml(opts.title);
  const css = opts.css;
  const colorScheme =
    '<meta name="color-scheme" content="light dark">\n' +
    '<meta name="theme-color" content="#eef2f7" media="(prefers-color-scheme: light)">\n' +
    '<meta name="theme-color" content="#0a1420" media="(prefers-color-scheme: dark)">\n';
  return (
    `<!DOCTYPE html>\n<html lang="de">\n<head>\n` +
    `<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    colorScheme +
    `<meta name="description" content="${desc}">\n` +
    `<link rel="icon" type="image/png" href="${iconHref}">\n` +
    `<title>${title}</title>\n` +
    `<style>${css}\n</style>\n` +
    `</head>\n`
  );
}

function buildHandbookJs() {
  // Deterministic external script (no timestamps). Tolerates missing index-only
  // elements so the same file can load on doc pages for the theme toggle.
  return [
    '(function () {',
    "  var THEME_KEY = 'handbook-theme';",
    '  function $(id) { return document.getElementById(id); }',
    '  function qs(sel, root) { return (root || document).querySelector(sel); }',
    '  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }',
    '',
    '  function applyTheme(theme) {',
    '    var root = document.documentElement;',
    "    if (theme === 'dark' || theme === 'light') {",
    "      root.setAttribute('data-theme', theme);",
    '    } else {',
    "      root.removeAttribute('data-theme');",
    '      theme = null;',
    '    }',
    "    var btn = $('theme-toggle');",
    '    if (btn) {',
    "      var pressed = theme === 'dark' || (!theme && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);",
    "      btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');",
    "      btn.setAttribute('aria-label', pressed ? 'Helles Design aktivieren' : 'Dunkles Design aktivieren');",
    '    }',
    '  }',
    '',
    '  function initTheme() {',
    "    var btn = $('theme-toggle');",
    '    if (!btn) return;',
    '    btn.hidden = false;',
    '    var stored = null;',
    '    try { stored = localStorage.getItem(THEME_KEY); } catch (e) {}',
    "    if (stored === 'dark' || stored === 'light') applyTheme(stored);",
    '    else applyTheme(null);',
    "    btn.addEventListener('click', function () {",
    "      var cur = document.documentElement.getAttribute('data-theme');",
    "      var systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;",
    '      var next;',
    "      if (cur === 'dark') next = 'light';",
    "      else if (cur === 'light') next = 'dark';",
    "      else next = systemDark ? 'light' : 'dark';",
    '      applyTheme(next);',
    '      try { localStorage.setItem(THEME_KEY, next); } catch (e) {}',
    '    });',
    '  }',
    '',
    '  function openTargetFromHash() {',
    "    var hash = location.hash ? location.hash.slice(1) : '';",
    '    if (!hash) return;',
    '    var el = document.getElementById(hash);',
    '    if (!el) return;',
    "    var details = el.closest ? el.closest('details.spec') : null;",
    "    if (!details && el.tagName === 'DETAILS') details = el;",
    '    if (details) details.open = true;',
    "    if (typeof el.scrollIntoView === 'function') {",
    "      el.scrollIntoView({ block: 'start' });",
    '    }',
    '  }',
    '',
    '  function initTocActions() {',
    "    var expand = $('toc-expand-all');",
    "    var collapse = $('toc-collapse-all');",
    "    var actions = $('toc-actions');",
    '    if (actions && (expand || collapse)) actions.hidden = false;',
    '    if (expand) {',
    "      expand.addEventListener('click', function () {",
    "        qsa('details.spec').forEach(function (d) { d.open = true; });",
    '      });',
    '    }',
    '    if (collapse) {',
    "      collapse.addEventListener('click', function () {",
    "        qsa('details.spec').forEach(function (d) { d.open = false; });",
    '      });',
    '    }',
    '  }',
    '',
    '  function initSidebarToggle() {',
    "    var btn = $('sidebar-toggle');",
    "    var side = $('handbook-sidebar');",
    '    if (!btn || !side) return;',
    '    btn.hidden = false;',
    "    btn.addEventListener('click', function () {",
    "      var open = document.body.classList.toggle('sidebar-open');",
    "      btn.setAttribute('aria-expanded', open ? 'true' : 'false');",
    '    });',
    '  }',
    '',
    '  function initScrollspy() {',
    '    if (!window.IntersectionObserver) return;',
    "    var links = qsa('nav.toc a[href^=\"#\"]');",
    '    if (!links.length) return;',
    '    var map = {};',
    '    links.forEach(function (a) {',
    "      var id = a.getAttribute('href').slice(1);",
    '      if (id) map[id] = a;',
    '    });',
    '    var ids = Object.keys(map);',
    '    if (!ids.length) return;',
    '    var visible = {};',
    '    function setCurrent(id) {',
    '      links.forEach(function (a) {',
    "        if (a.getAttribute('href') === '#' + id) {",
    "          a.setAttribute('aria-current', 'true');",
    '        } else {',
    "          a.removeAttribute('aria-current');",
    '        }',
    '      });',
    '    }',
    '    var io = new IntersectionObserver(function (entries) {',
    '      entries.forEach(function (en) {',
    '        if (en.isIntersecting) visible[en.target.id] = true;',
    '        else delete visible[en.target.id];',
    '      });',
    '      var active = null;',
    '      for (var i = 0; i < ids.length; i++) {',
    '        if (visible[ids[i]]) { active = ids[i]; break; }',
    '      }',
    '      if (active) setCurrent(active);',
    '    }, { rootMargin: "-20% 0px -60% 0px", threshold: [0, 0.1, 0.5] });',
    '    ids.forEach(function (id) {',
    '      var el = document.getElementById(id);',
    '      if (el) io.observe(el);',
    '    });',
    '  }',
    '',
    '  function normalize(s) {',
    "    return String(s || '').toLowerCase().replace(/\\s+/g, ' ').trim();",
    '  }',
    '',
    '  function initSearch() {',
    "    var wrap = $('search-wrap');",
    "    var input = $('handbook-search');",
    '    if (!wrap || !input) return;',
    '    wrap.hidden = false;',
    "    var status = $('search-status');",
    "    var empty = $('search-empty');",
    "    var shots = qsa('[data-search=\"shot\"]');",
    "    var docs = qsa('[data-search=\"doc\"]');",
    "    var store = qsa('[data-search=\"store-field\"]');",
    "    var groups = qsa('[data-search=\"group\"]');",
    "    var sections = qsa('details.spec');",
    "    var secCounts = qsa('[data-sec-count]');",
    "    var tocGroups = qsa('nav.toc a[data-toc-group]');",
    '    var totalShots = shots.length;',
    '    var totalGroups = groups.length;',
    '    var openState = {};',
    '    sections.forEach(function (s) { openState[s.id] = s.open; });',
    '    var baseSec = {};',
    '    secCounts.forEach(function (el) {',
    "      baseSec[el.getAttribute('data-sec-count')] = el.textContent;",
    '    });',
    '    var baseToc = {};',
    '    tocGroups.forEach(function (a) {',
    "      var c = qs('.count', a);",
    "      if (c) baseToc[a.getAttribute('data-toc-group')] = c.textContent;",
    '    });',
    '',
    '    function setHidden(el, hide) {',
    '      if (hide) el.setAttribute("hidden", "");',
    '      else el.removeAttribute("hidden");',
    '    }',
    '',
    '    function setStatus(text) {',
    '      if (!status) return;',
    '      if (!text) {',
    '        status.textContent = "";',
    '        status.hidden = true;',
    '      } else {',
    '        status.hidden = false;',
    '        status.textContent = text;',
    '      }',
    '    }',
    '',
    '    function updateCounts(active, hitShots, hitGroups, hitDocs, hitStore) {',
    '      secCounts.forEach(function (el) {',
    "        var kind = el.getAttribute('data-sec-count');",
    '        if (!active) {',
    '          el.textContent = baseSec[kind] || el.textContent;',
    '          return;',
    '        }',
    "        if (kind === 'screenshots') {",
    "          el.textContent = hitShots + ' / ' + totalShots + ' Screenshots · ' + hitGroups + ' / ' + totalGroups + ' Gruppen';",
    "        } else if (kind === 'documentation') {",
    "          el.textContent = hitDocs + ' / ' + docs.length + ' Dokumente';",
    "        } else if (kind === 'store-listing') {",
    "          el.textContent = hitStore + ' / ' + store.length + ' Felder';",
    '        }',
    '      });',
    '      tocGroups.forEach(function (a) {',
    "        var gid = a.getAttribute('data-toc-group');",
    "        var g = document.getElementById(gid);",
    "        var c = qs('.count', a);",
    '        var li = a.closest ? a.closest("li") : null;',
    '        if (!active) {',
    '          if (c) c.textContent = baseToc[gid] || c.textContent;',
    '          if (li) setHidden(li, false);',
    '          return;',
    '        }',
    '        var n = 0;',
    "        if (g) n = qsa('[data-search=\"shot\"]', g).filter(function (s) { return !s.hasAttribute('hidden'); }).length;",
    '        if (c) c.textContent = n + " / " + (baseToc[gid] || n);',
    '        if (li) setHidden(li, n === 0);',
    '      });',
    '    }',
    '',
    '    function reset() {',
    '      shots.forEach(function (el) { setHidden(el, false); });',
    '      docs.forEach(function (el) { setHidden(el, false); });',
    '      store.forEach(function (el) { setHidden(el, false); });',
    '      groups.forEach(function (el) { setHidden(el, false); });',
    '      sections.forEach(function (s) {',
    '        setHidden(s, false);',
    '        if (openState.hasOwnProperty(s.id)) s.open = openState[s.id];',
    '      });',
    '      setStatus("");',
    '      if (empty) empty.hidden = true;',
    '      updateCounts(false, 0, 0, 0, 0);',
    '    }',
    '',
    '    function run() {',
    '      var q = normalize(input.value);',
    '      if (!q) { reset(); return; }',
    '      var hitShots = 0;',
    '      shots.forEach(function (el) {',
    "        var hay = normalize(el.getAttribute('data-search-text'));",
    '        var ok = hay.indexOf(q) !== -1;',
    '        setHidden(el, !ok);',
    '        if (ok) hitShots++;',
    '      });',
    '      var hitDocs = 0;',
    '      docs.forEach(function (el) {',
    "        var hay = normalize(el.getAttribute('data-search-text'));",
    '        var ok = hay.indexOf(q) !== -1;',
    '        setHidden(el, !ok);',
    '        if (ok) hitDocs++;',
    '      });',
    '      var hitStore = 0;',
    '      store.forEach(function (el) {',
    "        var hay = normalize(el.getAttribute('data-search-text'));",
    '        var ok = hay.indexOf(q) !== -1;',
    '        setHidden(el, !ok);',
    '        if (ok) hitStore++;',
    '      });',
    '      var hitGroups = 0;',
    '      groups.forEach(function (g) {',
    "        var visible = qsa('[data-search=\"shot\"]', g).some(function (s) { return !s.hasAttribute('hidden'); });",
    '        setHidden(g, !visible);',
    '        if (visible) hitGroups++;',
    '      });',
    '      sections.forEach(function (sec) {',
    "        var any = qsa('[data-search]', sec).some(function (el) {",
    "          if (el.getAttribute('data-search') === 'group') return false;",
    '          return !el.hasAttribute("hidden");',
    '        });',
    "        if (!any) any = qsa('[data-search=\"group\"]', sec).some(function (el) { return !el.hasAttribute('hidden'); });",
    '        setHidden(sec, !any);',
    '        if (any) sec.open = true;',
    '      });',
    "      setStatus(hitShots + ' von ' + totalShots + ' Screenshots');",
    '      updateCounts(true, hitShots, hitGroups, hitDocs, hitStore);',
    '      var anyDoc = hitDocs > 0;',
    '      var anyStore = hitStore > 0;',
    '      if (empty) empty.hidden = !(hitShots === 0 && !anyDoc && !anyStore);',
    '    }',
    '',
    "    input.addEventListener('input', run);",
    "    input.addEventListener('keydown', function (ev) {",
    "      if (ev.key === 'Escape') {",
    "        input.value = '';",
    '        reset();',
    '        input.blur();',
    '      }',
    '    });',
    '  }',
    '',
    '  function initLightbox() {',
    "    var root = $('lightbox');",
    '    if (!root) return;',
    "    var img = $('lightbox-img');",
    "    var titleEl = $('lightbox-title');",
    "    var fileEl = $('lightbox-file');",
    "    var countEl = $('lightbox-count');",
    "    var btnClose = $('lightbox-close');",
    "    var btnPrev = $('lightbox-prev');",
    "    var btnNext = $('lightbox-next');",
    '    var index = 0;',
    '    var lastFocus = null;',
    '    var groupCards = [];',
    '',
    '    function groupOf(card) {',
    "      return card.getAttribute('data-group') || '';",
    '    }',
    '',
    '    function collectGroup(card) {',
    '      var g = groupOf(card);',
    '      if (!g) return [];',
    "      return qsa('.shot-card').filter(function (el) {",
    "        return el.getAttribute('data-group') === g && !el.hasAttribute('hidden');",
    '      });',
    '    }',
    '',
    '    function show(i) {',
    '      if (!groupCards.length) return;',
    '      index = (i + groupCards.length) % groupCards.length;',
    '      var card = groupCards[index];',
    "      var a = qs('a.shot-img', card) || qs('a', card);",
    "      var cap = card.getAttribute('data-caption') || '';",
    "      var file = card.getAttribute('data-file') || '';",
    "      var href = a ? a.getAttribute('href') : '';",
    '      if (img) {',
    '        img.src = href;',
    '        img.alt = cap;',
    '      }',
    '      if (titleEl) titleEl.textContent = cap;',
    '      if (fileEl) fileEl.textContent = file;',
    '      if (countEl) countEl.textContent = (index + 1) + " von " + groupCards.length;',
    '    }',
    '',
    '    function trapFocus(ev) {',
    "      if (ev.key !== 'Tab' || root.hidden) return;",
    "      var focusables = qsa('button, [href], input, [tabindex]:not([tabindex=\"-1\"])', root).filter(function (el) { return !el.disabled && el.offsetParent !== null; });",
    '      if (!focusables.length) return;',
    '      var first = focusables[0];',
    '      var last = focusables[focusables.length - 1];',
    '      if (ev.shiftKey && document.activeElement === first) {',
    '        ev.preventDefault();',
    '        last.focus();',
    '      } else if (!ev.shiftKey && document.activeElement === last) {',
    '        ev.preventDefault();',
    '        first.focus();',
    '      }',
    '    }',
    '',
    '    function open(card) {',
    "      lastFocus = card.querySelector('a.shot-img') || card.querySelector('a') || card;",
    '      groupCards = collectGroup(card);',
    '      index = groupCards.indexOf(card);',
    '      if (index < 0) index = 0;',
    '      root.hidden = false;',
    "      document.body.classList.add('is-locked');",
    '      show(index);',
    '      if (btnClose) btnClose.focus();',
    '    }',
    '',
    '    function close() {',
    '      root.hidden = true;',
    "      document.body.classList.remove('is-locked');",
    '      if (img) img.removeAttribute("src");',
    '      if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();',
    '    }',
    '',
    "    document.addEventListener('click', function (ev) {",
    '      var t = ev.target;',
    '      if (!t || !t.closest) return;',
    "      if (t.closest('.copy-link') || t.closest('a.name.permalink')) return;",
    "      var a = t.closest('.shot-card a.shot-img');",
    '      if (!a) return;',
    "      var card = a.closest('.shot-card');",
    '      if (!card) return;',
    '      ev.preventDefault();',
    '      open(card);',
    '    });',
    '',
    '    if (btnClose) btnClose.addEventListener("click", close);',
    '    if (btnPrev) btnPrev.addEventListener("click", function () { show(index - 1); });',
    '    if (btnNext) btnNext.addEventListener("click", function () { show(index + 1); });',
    "    root.addEventListener('click', function (ev) { if (ev.target === root) close(); });",
    "    document.addEventListener('keydown', function (ev) {",
    '      if (root.hidden) return;',
    "      if (ev.key === 'Escape') { ev.preventDefault(); close(); }",
    "      else if (ev.key === 'ArrowLeft') { ev.preventDefault(); show(index - 1); }",
    "      else if (ev.key === 'ArrowRight') { ev.preventDefault(); show(index + 1); }",
    '      else trapFocus(ev);',
    '    });',
    '  }',
    '',
    '  function initCopyLinks() {',
    '    function fallbackCopy(text) {',
    "      var ta = document.createElement('textarea');",
    '      ta.value = text;',
    "      ta.setAttribute('readonly', '');",
    "      ta.style.position = 'fixed';",
    "      ta.style.opacity = '0';",
    '      document.body.appendChild(ta);',
    '      ta.select();',
    '      var ok = false;',
    "      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }",
    '      document.body.removeChild(ta);',
    '      return ok;',
    '    }',
    "    qsa('.copy-link').forEach(function (btn) {",
    '      var origText = btn.textContent;',
    '      var resetTimer = null;',
    "      btn.addEventListener('click', function () {",
    "        var target = btn.getAttribute('data-target');",
    '        if (!target) return;',
    "        var url = location.origin + location.pathname + '#' + target;",
    '        var done = function (ok) {',
    "          btn.textContent = ok ? '\\u2713 Kopiert' : '\\u2717 Nicht kopiert';",
    "          if (ok) btn.setAttribute('data-copied', 'true');",
    '          if (resetTimer) clearTimeout(resetTimer);',
    '          resetTimer = setTimeout(function () {',
    '            btn.textContent = origText;',
    "            btn.removeAttribute('data-copied');",
    '            resetTimer = null;',
    '          }, 1200);',
    "          if (location.hash !== '#' + target) location.hash = target;",
    '        };',
    '        if (navigator.clipboard && navigator.clipboard.writeText) {',
    '          navigator.clipboard.writeText(url).then(',
    '            function () { done(true); },',
    '            function () { done(fallbackCopy(url)); }',
    '          );',
    '        } else {',
    '          done(fallbackCopy(url));',
    '        }',
    '      });',
    '    });',
    '  }',
    '',
    "  document.addEventListener('DOMContentLoaded', function () {",
    '    initTheme();',
    '    initTocActions();',
    '    initSidebarToggle();',
    '    initScrollspy();',
    '    initSearch();',
    '    initLightbox();',
    '    initCopyLinks();',
    '    openTargetFromHash();',
    '  });',
    "  window.addEventListener('hashchange', openTargetFromHash);",
    '})();',
    '',
  ].join('\n');
}

/** Wrap tables for horizontal scroll; keep pre scrollable inside itself. */
function enhanceDocBodyHtml(html) {
  let out = String(html);
  out = out.replace(
    /<table\b[\s\S]*?<\/table>/gi,
    (m) => '<div class="table-scroll">' + m + '</div>',
  );
  return out;
}


/**
 * Register an anchor id and remember where it came from. `seen` maps id →
 * source labels; assertNoAnchorCollisions() turns any id claimed twice into a
 * build failure.
 *
 * Suffixing the loser instead (a-1, a-2, …) was the first attempt and is wrong
 * here: "first" would mean first in sort order, not oldest, and ' ' and '_'
 * sort before '-' under sortStrings. Adding `07_sprache.png` next to an
 * existing `07-sprache.png` would hand the newcomer the incumbent's bare id and
 * push the incumbent to `-1` — so a permalink copied from the page yesterday
 * would open a different screenshot today, silently. A red build asking the
 * author to rename the new file is the honest outcome; the handbook has ~50
 * screens and can afford unique slugs. Same treatment as two sources claiming
 * one output path.
 */
function claimAnchorId(seen, id, source) {
  if (!seen.has(id)) seen.set(id, []);
  seen.get(id).push(source);
  return id;
}

/** Fail the build if any anchor id was claimed by more than one source. */
function assertNoAnchorCollisions(seen) {
  const collisions = [];
  for (const [id, sources] of seen.entries()) {
    const unique = Array.from(new Set(sources)).sort(sortStrings);
    if (unique.length > 1) collisions.push({ id, sources: unique });
  }
  if (collisions.length === 0) return;
  collisions.sort((a, b) => sortStrings(a.id, b.id));
  const lines = collisions.map(
    (c) => `  #${c.id}\n` + c.sources.map((s) => `    - ${s}`).join('\n'),
  );
  fail(
    'handbook anchor collision: several screenshots or groups claim the same ' +
      'permalink target, so a copied link would open the wrong screen. ' +
      'Resolve the naming conflict before rebuilding:\n' +
      lines.join('\n'),
  );
}

/**
 * Copy-link button for an anchor. The anchor alone is not enough: without a
 * visible permalink a reader can only obtain the URL of a single screen by
 * reading the page source. Behaviour (clipboard with execCommand fallback,
 * confirmation, hash update) lives in handbook.js so the CSP stays at
 * script-src 'self'. Button label is German — so is the handbook.
 */
function copyLinkButton(anchorId) {
  return (
    `<button class="copy-link" type="button" ` +
    `data-target="${escapeHtml(anchorId)}" ` +
    `title="Direkt-Link kopieren" aria-label="Direkt-Link kopieren">` +
    `\u{1F517} Link</button>`
  );
}

/**
 * Recursive PNG scan. Skips directories whose basename starts with '.'.
 * Non-PNG files are ignored (no error). Returns sorted list of
 * { abs, relPosix } where relPosix is relative to rootDir.
 */
function listPngRecursive(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  const results = [];
  function walk(absDir, relDir) {
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    // Deterministic walk order
    entries = entries.slice().sort((a, b) => sortStrings(a.name, b.name));
    for (const d of entries) {
      const name = d.name;
      const relPath = relDir ? path.posix.join(relDir, name) : name;
      if (d.isDirectory()) {
        if (name.startsWith('.')) continue;
        walk(path.join(absDir, name), relPath);
      } else if (d.isFile() && name.toLowerCase().endsWith('.png')) {
        results.push({ abs: path.join(absDir, name), relPosix: relPath });
      }
    }
  }
  walk(rootDir, '');
  return results.sort((a, b) => sortStrings(a.relPosix, b.relPosix));
}

// Matches any absolute URI scheme (RFC 3986 §3.1: ALPHA *( ALPHA / DIGIT /
// "+" / "-" / "." ) ":"), e.g. "https:", "mailto:", "data:", "javascript:",
// "vbscript:", "file:", "tel:", and anything not yet invented. A generic
// scheme check instead of an enumeration of known-bad prefixes so nothing
// can be missed (fixes CodeQL "Incomplete URL scheme check").
const ABSOLUTE_URI_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

function collectRelativeRefs(html) {
  const refs = [];
  // Only match real attribute names, after start-of-string, whitespace or '<'.
  // A word boundary alone also matches after '-' and ':', so data-src,
  // xlink:href and ng-src would be checked as if a browser resolved them.
  // Alternation per quote style so a double-quoted value may contain apostrophes
  // (e.g. href="docs/Bank's%20Guide.md" from marked link parsing).
  const re = /(?:^|[\s<])(?:src|href)=(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1] !== undefined ? m[1] : m[2];
    if (
      ABSOLUTE_URI_SCHEME_RE.test(raw) ||
      raw.startsWith('//') ||
      raw.startsWith('#')
    ) {
      continue;
    }
    // Browser order: decode HTML entities first (a literal '#' inside an entity
    // like &#39; must not be mistaken for the fragment separator), THEN strip
    // fragment/query, THEN percent-decode (done later by the caller via
    // decodeHtmlPath). Percent-encoding must stay untouched here so a literal
    // %23 in a filename is still not mistaken for a fragment separator.
    const cleaned = decodeHtmlEntities(raw).split('#')[0].split('?')[0];
    if (cleaned) refs.push(cleaned);
  }
  return refs;
}

/**
 * Map a repo-relative markdown path to its handbook HTML output path.
 * Schema from the services reference: strip a leading docs/ prefix, replace
 * .md with .html, then place under docs/.
 *   README.md                  → docs/README.html
 *   docs/release-pipeline.md   → docs/release-pipeline.html
 *   infrastructure/Readme.md   → docs/infrastructure/Readme.html
 */
function docOutputPath(relSrc) {
  const outInner = (
    relSrc.startsWith('docs/') ? relSrc.slice(5) : relSrc
  ).replace(/\.md$/i, '.html');
  return path.posix.join('docs', outInner);
}

/**
 * Resolve a relative URL against a POSIX directory (like a browser would for
 * a page at dir/page.html linking to href).
 */
function resolvePosix(fromDir, relHref) {
  const joined = path.posix.normalize(path.posix.join(fromDir || '.', relHref));
  // Drop a leading "./" after normalize for cleaner keys
  return joined.startsWith('./') ? joined.slice(2) : joined;
}

/**
 * Strip active HTML/script vectors from marked output before link rewriting.
 * marked does not sanitize by default; without this, any repo *.md is shipped
 * to handbook.taro.dfx.swiss with scripts and javascript: URLs intact.
 * CSP is a second layer; this cleans the HTML itself.
 */
function stripDangerousHtml(html) {
  let out = String(html);
  // Remove script/iframe/object/embed blocks (content discarded).
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  out = out.replace(/<script\b[^>]*\/>/gi, '');
  out = out.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '');
  out = out.replace(/<iframe\b[^>]*\/>/gi, '');
  out = out.replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, '');
  out = out.replace(/<object\b[^>]*\/>/gi, '');
  out = out.replace(/<embed\b[^>]*\/?>/gi, '');
  // Drop inline event handlers (onerror=, onclick=, …).
  out = out.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // Neutralize dangerous URL schemes in href/src (keep data:image/*).
  out = out.replace(
    /\b(href|src)\s*=\s*(["'])([^"']*)\2/gi,
    (full, attr, q, url) => {
      const trimmed = String(url).trim();
      const lower = trimmed.toLowerCase();
      if (
        lower.startsWith('javascript:') ||
        lower.startsWith('vbscript:') ||
        (lower.startsWith('data:') && !/^data:image\//i.test(trimmed))
      ) {
        return attr + '=' + q + q;
      }
      return full;
    },
  );
  return out;
}

/**
 * After marked renders markdown, local links that target files not copied into
 * the handbook output would fail the integrity check. This repo's docs link to
 * scripts, platform trees, etc. that are intentionally out of scope.
 *
 * Behaviour (documented in docs/handbook/README.md):
 * 0. Strip script/iframe/object/embed, on* handlers, and javascript:/vbscript:/
 *    non-image data: URLs (defence in depth with CSP).
 * 1. Relative *.md links that resolve to a discovered handbook doc are
 *    rewritten to the corresponding HTML output path.
 * 2. Any other relative src/href that does not resolve under the output
 *    directory is stripped to plain text (label kept, link removed) and
 *    logged once per occurrence on stderr.
 * Absolute URIs (except neutralized schemes above) and pure fragment links
 * are left alone.
 */
function sanitizeDocHtml(html, docOutRel, discoveredMdToOut) {
  html = stripDangerousHtml(html);
  const pageDir = path.posix.dirname(docOutRel);
  // Source directory of the original .md (repo-relative) for resolving
  // relative .md links against the repo tree, not the output tree.
  // Invert docOutputPath: docs/FOO.html may come from FOO.md or docs/FOO.md.
  // We pass sourceRel separately via discovered map reverse lookup.
  let sourceRel = null;
  for (const [md, out] of discoveredMdToOut.entries()) {
    if (out === docOutRel) {
      sourceRel = md;
      break;
    }
  }
  const sourceDir = sourceRel ? path.posix.dirname(sourceRel) : '.';
  const sourceDirNorm = sourceDir === '.' ? '' : sourceDir;

  // Track logged keys so each distinct (page,ref) is reported once.
  const logged = new Set();

  function logOnce(ref) {
    const key = docOutRel + '\0' + ref;
    if (logged.has(key)) return;
    logged.add(key);
    console.error(
      `handbook: stripped unresolved local link in ${docOutRel}: ${ref}`,
    );
  }

  function tryRewriteMdLink(rawHref) {
    const decoded = decodeHtmlPath(
      decodeHtmlEntities(rawHref).split('#')[0].split('?')[0],
    );
    if (!decoded || ABSOLUTE_URI_SCHEME_RE.test(decoded) || decoded.startsWith('//')) {
      return null;
    }
    if (!/\.md$/i.test(decoded)) return null;
    // Resolve against the source markdown's directory.
    const absMd = resolvePosix(sourceDirNorm || '.', decoded);
    const targetOut = discoveredMdToOut.get(absMd);
    if (!targetOut) return null;
    // Relative path from this HTML page's directory to the target HTML.
    let rel = path.posix.relative(pageDir, targetOut);
    if (!rel) rel = path.posix.basename(targetOut);
    // Preserve fragment if present
    const frag = decodeHtmlEntities(rawHref).includes('#')
      ? '#' + decodeHtmlEntities(rawHref).split('#').slice(1).join('#')
      : '';
    return encodeHtmlPath(rel) + frag;
  }

  function targetExists(rawHref) {
    const decoded = decodeHtmlPath(
      decodeHtmlEntities(rawHref).split('#')[0].split('?')[0],
    );
    if (!decoded) return true; // empty after strip — ignore
    if (
      ABSOLUTE_URI_SCHEME_RE.test(decoded) ||
      decoded.startsWith('//') ||
      decoded.startsWith('#')
    ) {
      return true;
    }
    // Candidate under the output tree relative to the page dir
    const underPage = resolvePosix(pageDir, decoded);
    // Also allow absolute-from-handbook-root style (no leading /)
    return (
      fs.existsSync(path.join(sanitizeDocHtml._outDir, underPage)) ||
      fs.existsSync(path.join(sanitizeDocHtml._outDir, decoded))
    );
  }

  // Rewrite or strip <a href="...">…</a>
  html = html.replace(
    /<a\s+([^>]*?)href=(?:"([^"]*)"|'([^']*)')([^>]*)>([\s\S]*?)<\/a>/gi,
    (full, pre, dHref, sHref, post, inner) => {
      const href = dHref !== undefined ? dHref : sHref;
      if (
        ABSOLUTE_URI_SCHEME_RE.test(href) ||
        href.startsWith('//') ||
        href.startsWith('#')
      ) {
        return full;
      }
      const rewritten = tryRewriteMdLink(href);
      if (rewritten !== null) {
        const q = dHref !== undefined ? '"' : "'";
        return `<a ${pre}href=${q}${rewritten}${q}${post}>${inner}</a>`;
      }
      if (targetExists(href)) return full;
      logOnce(decodeHtmlEntities(href).split('#')[0].split('?')[0]);
      return inner;
    },
  );

  // Replace remote absolute <img> (http/https/protocol-relative) with alt text —
  // CSP img-src is 'self' data: only. Keep data:image/* and fragment-only.
  // Strip unresolved relative <img> the same way (label kept, src removed).
  html = html.replace(
    /<img\s+([^>]*?)src=(?:"([^"]*)"|'([^']*)')([^>]*?)\/?>/gi,
    (full, pre, dSrc, sSrc, post) => {
      const src = dSrc !== undefined ? dSrc : sSrc;
      const decodedSrc = decodeHtmlEntities(src).split('#')[0].split('?')[0];
      const altMatch = full.match(/\balt=(?:"([^"]*)"|'([^']*)')/i);
      const alt = altMatch
        ? altMatch[1] !== undefined
          ? altMatch[1]
          : altMatch[2]
        : '';
      const altOut = alt ? escapeHtml(decodeHtmlEntities(alt)) : '';
      // data:image is CSP-legal and may be intentional; leave alone.
      if (/^data:image\//i.test(String(src).trim())) {
        return full;
      }
      if (
        ABSOLUTE_URI_SCHEME_RE.test(src) ||
        src.startsWith('//')
      ) {
        console.error(
          `handbook: replaced remote image in ${docOutRel}: ${decodedSrc || src}`,
        );
        return altOut;
      }
      if (src.startsWith('#')) {
        return full;
      }
      if (targetExists(src)) return full;
      logOnce(decodedSrc);
      return altOut;
    },
  );

  return html;
}
// Mutable binding so sanitizeDocHtml can see outDir without threading it
// through every call site that only needs docOutRel (set in main before use).
sanitizeDocHtml._outDir = '';

/**
 * Collect store-listing text fields under a locale directory.
 * field name = path relative to locale dir without .txt.
 * Skips directories named "images" (binary screenshots).
 */
function collectStoreFields(localeAbs, localeRelPosix) {
  const fields = [];
  function walk(absDir, relDir) {
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    entries = entries.slice().sort((a, b) => sortStrings(a.name, b.name));
    for (const d of entries) {
      const name = d.name;
      if (d.isDirectory()) {
        if (name.startsWith('.')) continue;
        if (name === 'images') continue;
        walk(
          path.join(absDir, name),
          relDir ? path.posix.join(relDir, name) : name,
        );
      } else if (d.isFile() && name.toLowerCase().endsWith('.txt')) {
        const fieldRel = relDir
          ? path.posix.join(relDir, name)
          : name;
        const fieldName = fieldRel.replace(/\.txt$/i, '');
        const content = fs.readFileSync(path.join(absDir, name), 'utf8').trim();
        fields.push({
          field: fieldName,
          content,
          sourcePath: path.posix.join(localeRelPosix, fieldRel),
        });
      }
    }
  }
  walk(localeAbs, '');
  return fields.sort((a, b) => sortStrings(a.field, b.field));
}

function main() {
  const outArg = process.argv[2];
  if (!outArg) {
    fail('Usage: node scripts/handbook/build.js <output-dir>');
  }

  const scriptDir = __dirname;
  const repoRoot = process.env.HANDBOOK_REPO_ROOT
    ? path.resolve(process.env.HANDBOOK_REPO_ROOT)
    : path.resolve(scriptDir, '../..');
  const outDir = path.resolve(outArg);
  sanitizeDocHtml._outDir = outDir;
  const gitSha = process.env.GIT_SHA || process.env.HANDBOOK_GIT_SHA || 'unknown';

  // Clear previous output first (stale HTML / foreign files must not survive).
  // Guards refuse dangerous targets; see prepareOutputDir.
  prepareOutputDir(outDir, repoRoot);

  const metadataPath = path.join(scriptDir, 'metadata.json');
  let metadata = {};
  if (fs.existsSync(metadataPath)) {
    metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  }
  const screenshotsMeta =
    (metadata && metadata.screenshots && typeof metadata.screenshots === 'object'
      ? metadata.screenshots
      : {}) || {};
  const docsMeta = (metadata && metadata.docs) || {};

  const artifacts = [];
  const screenshotEntries = [];

  // -------------------------------------------------------------------------
  // Source A — Screenshots under SOURCE_SCREENSHOTS_REL/**/*.png
  // Group key = POSIX-relative directory under screenshots root; files
  // directly in the root get group "allgemein". Nested dirs keep full path
  // (e.g. settings/dfx). Discovery only — copy after collision check.
  // -------------------------------------------------------------------------
  const screenshotsRoot = path.join(repoRoot, SOURCE_SCREENSHOTS_REL);
  const screenshotPngs = listPngRecursive(screenshotsRoot);
  for (const { abs, relPosix } of screenshotPngs) {
    assertValidPng(abs);
    const dirPart = path.posix.dirname(relPosix);
    const group = !dirPart || dirPart === '.' ? 'allgemein' : dirPart;
    const filename = path.posix.basename(relPosix);
    const relOut = path.posix.join('screenshots', relPosix);
    const entry = {
      category: 'screenshot',
      outputPath: relOut,
      sourcePath: path.posix.join(SOURCE_SCREENSHOTS_REL, relPosix),
      title: titleFromFilename(filename),
      group,
      _abs: abs,
    };
    screenshotEntries.push(entry);
    artifacts.push({
      category: entry.category,
      outputPath: entry.outputPath,
      sourcePath: entry.sourcePath,
      title: entry.title,
      group: entry.group,
    });
  }

  screenshotEntries.sort((a, b) => {
    const g = sortStrings(a.group, b.group);
    if (g !== 0) return g;
    return sortStrings(a.title, b.title);
  });

  if (screenshotEntries.length < MIN_SCREENSHOTS) {
    fail(
      `handbook floor guard: found ${screenshotEntries.length} screenshots, ` +
        `need at least MIN_SCREENSHOTS=${MIN_SCREENSHOTS}. ` +
        `Check ${SOURCE_SCREENSHOTS_REL}/**/*.png ` +
        `(scanned: ${screenshotsRoot}).`,
    );
  }

  // -------------------------------------------------------------------------
  // Source B — Markdown docs (recursive discovery)
  // -------------------------------------------------------------------------
  const discoveredDocs = listMarkdownFiles(repoRoot);
  const discoveredMdToOut = new Map();
  const docSpecs = discoveredDocs.map((relSrc) => {
    const out = docOutputPath(relSrc);
    discoveredMdToOut.set(relSrc, out);
    const title =
      (docsMeta[relSrc] && docsMeta[relSrc].title) || defaultDocTitle(relSrc);
    return { src: relSrc, out, title };
  });
  if (docSpecs.length < MIN_DOCS) {
    fail(
      `handbook floor guard: found ${docSpecs.length} docs, ` +
        `need at least MIN_DOCS=${MIN_DOCS}. ` +
        'Check recursive *.md discovery from repo root (excludes node_modules, ' +
        '.git, _handbook-deps, build, dist, coverage, blue_modules, ios, android, ' +
        'windows, macos, vendor, docs/handbook, dot-dirs). ' +
        `Scanned: ${repoRoot}`,
    );
  }
  for (const d of docSpecs) {
    artifacts.push({
      category: 'doc',
      outputPath: d.out,
      sourcePath: d.src,
      title: d.title,
      group: null,
    });
  }

  // -------------------------------------------------------------------------
  // Source C — Store listing (Android + iOS fastlane metadata)
  // -------------------------------------------------------------------------
  const androidMetaRoot = path.join(repoRoot, SOURCE_ANDROID_META_REL);
  const iosMetaRoot = path.join(repoRoot, SOURCE_IOS_META_REL);
  if (!fs.existsSync(androidMetaRoot)) {
    fail(
      `handbook: missing Android store-metadata root ${androidMetaRoot} ` +
        '(broken checkout — both platform roots are required).',
    );
  }
  if (!fs.existsSync(iosMetaRoot)) {
    fail(
      `handbook: missing iOS store-metadata root ${iosMetaRoot} ` +
        '(broken checkout — both platform roots are required).',
    );
  }

  const storeEntries = []; // { platform, locale, field, content, sourcePath }

  // Android: one locale dir per subdirectory
  {
    const locales = localeDirsUnder(androidMetaRoot, SOURCE_ANDROID_META_REL);
    for (const locale of locales) {
      const localeAbs = path.join(androidMetaRoot, locale);
      const localeRel = path.posix.join(SOURCE_ANDROID_META_REL, locale);
      const fields = collectStoreFields(localeAbs, localeRel);
      for (const f of fields) {
        storeEntries.push({
          platform: 'android',
          locale,
          field: f.field,
          content: f.content,
          sourcePath: f.sourcePath,
        });
      }
    }
  }

  // iOS: global *.txt directly under metadata/, then locale subdirs
  {
    const iosRootRel = SOURCE_IOS_META_REL;
    const globalFields = [];
    const entries = fs
      .readdirSync(iosMetaRoot, { withFileTypes: true })
      .slice()
      .sort((a, b) => sortStrings(a.name, b.name));
    for (const d of entries) {
      if (d.isFile() && d.name.toLowerCase().endsWith('.txt')) {
        const fieldName = d.name.replace(/\.txt$/i, '');
        const content = fs
          .readFileSync(path.join(iosMetaRoot, d.name), 'utf8')
          .trim();
        globalFields.push({
          field: fieldName,
          content,
          sourcePath: path.posix.join(iosRootRel, d.name),
        });
      }
    }
    globalFields.sort((a, b) => sortStrings(a.field, b.field));
    for (const f of globalFields) {
      storeEntries.push({
        platform: 'ios',
        locale: 'global',
        field: f.field,
        content: f.content,
        sourcePath: f.sourcePath,
      });
    }

    const locales = localeDirsUnder(iosMetaRoot, iosRootRel);
    for (const locale of locales) {
      const localeAbs = path.join(iosMetaRoot, locale);
      const localeRel = path.posix.join(iosRootRel, locale);
      const fields = collectStoreFields(localeAbs, localeRel);
      for (const f of fields) {
        storeEntries.push({
          platform: 'ios',
          locale,
          field: f.field,
          content: f.content,
          sourcePath: f.sourcePath,
        });
      }
    }
  }

  if (storeEntries.length < MIN_STORE_FIELDS) {
    fail(
      `handbook floor guard: found ${storeEntries.length} store fields, ` +
        `need at least MIN_STORE_FIELDS=${MIN_STORE_FIELDS}. ` +
        `Check ${SOURCE_ANDROID_META_REL}/ and ${SOURCE_IOS_META_REL}/.`,
    );
  }

  for (const s of storeEntries) {
    artifacts.push({
      category: 'store',
      outputPath: 'index.html',
      sourcePath: s.sourcePath,
      title: `${s.platform}/${s.locale}/${s.field}`,
      group: `${s.platform}/${s.locale}`,
    });
  }

  // -------------------------------------------------------------------------
  // Source D — App assets: SOURCE_DFX_ASSETS_REL/**/*.png + img/icon*.png
  // -------------------------------------------------------------------------
  const assetSpecs = [];
  const dfxDir = path.join(repoRoot, SOURCE_DFX_ASSETS_REL);
  for (const { abs, relPosix } of listPngRecursive(dfxDir)) {
    assertValidPng(abs, MIN_ASSET_PNG_BYTES);
    const src = path.posix.join(SOURCE_DFX_ASSETS_REL, relPosix);
    const out = path.posix.join('assets/dfx', relPosix);
    assetSpecs.push({ abs, src, out, title: path.posix.basename(relPosix) });
  }
  // Icon files: directory scan of img/ with icon*.png filter (not a hard-coded list)
  const imgDir = path.join(repoRoot, SOURCE_IMG_REL);
  if (fs.existsSync(imgDir)) {
    const iconNames = fs
      .readdirSync(imgDir, { withFileTypes: true })
      .filter(
        (d) =>
          d.isFile() &&
          d.name.toLowerCase().endsWith('.png') &&
          /^icon/i.test(d.name),
      )
      .map((d) => d.name)
      .sort(sortStrings);
    for (const name of iconNames) {
      const abs = path.join(imgDir, name);
      assertValidPng(abs, MIN_ASSET_PNG_BYTES);
      assetSpecs.push({
        abs,
        src: path.posix.join(SOURCE_IMG_REL, name),
        out: path.posix.join('assets', name),
        title: name,
      });
    }
  }
  assetSpecs.sort((a, b) => sortStrings(a.out, b.out));

  if (assetSpecs.length < MIN_ASSETS) {
    fail(
      `handbook floor guard: found ${assetSpecs.length} assets, ` +
        `need at least MIN_ASSETS=${MIN_ASSETS}. ` +
        `Check ${SOURCE_DFX_ASSETS_REL}/**/*.png and ${SOURCE_IMG_REL}/icon*.png.`,
    );
  }

  for (const a of assetSpecs) {
    artifacts.push({
      category: 'asset',
      outputPath: a.out,
      sourcePath: a.src,
      title: a.title,
      group: null,
    });
  }

  // Collision check over the full artifact list before any write: two
  // sources must never map to the same exclusive output file (docs path
  // collapse, accidental screenshot/asset path overlap, …). index.html is
  // skipped inside assertNoOutputCollisions (shared store overview).
  assertNoOutputCollisions(artifacts);

  // -------------------------------------------------------------------------
  // Write discovered files (output dir is empty at this point).
  // -------------------------------------------------------------------------
  for (const entry of screenshotEntries) {
    const dest = path.join(outDir, ...entry.outputPath.split('/'));
    copyFile(entry._abs, dest);
    delete entry._abs;
  }

  for (const a of assetSpecs) {
    copyFile(a.abs, path.join(outDir, a.out));
  }

  // Render markdown docs (after assets/screenshots are on disk so relative
  // image links that target handbook output can resolve during sanitize).
  const renderedDocs = [];
  for (const d of docSpecs) {
    const src = path.join(repoRoot, d.src);
    if (!fs.existsSync(src)) {
      fail(`handbook: missing markdown source ${d.src}`);
    }
    const md = fs.readFileSync(src, 'utf8');
    let body = markedParse(md);
    body = sanitizeDocHtml(body, d.out, discoveredMdToOut);
    body = enhanceDocBodyHtml(body);
    const prefix = relativeToRoot(d.out);
    const jsHref = escapeHtml(encodeHtmlPath(prefix + 'handbook.js'));
    const page =
      buildHead({
        title: d.title + ' — DFX BTC Taro Wallet Handbuch',
        description:
          d.title +
          ' — Dokumentation der DFX BTC Taro Wallet.',
        prefix,
        css: DOC_CSS,
      }) +
      '<body>\n' +
      '<a class="skip-link" href="#doc-content">Zum Inhalt</a>\n' +
      buildTopbar({ prefix, showBack: true }) +
      '<div class="doc-wrap">\n' +
      '<nav class="crumbs" aria-label="Brotkrume">' +
      `<a href="${escapeHtml(encodeHtmlPath(prefix + 'index.html'))}">Handbuch</a>` +
      '<span class="sep">/</span>Dokumentation<span class="sep">/</span>' +
      `<span>${escapeHtml(d.title)}</span></nav>\n` +
      `<article class="doc-body" id="doc-content">\n${body}\n</article>\n` +
      `<footer class="footer">Quelle: <code>${escapeHtml(d.src)}</code>` +
      ` · Stand: <code>${escapeHtml(gitSha)}</code></footer>\n` +
      '</div>\n' +
      `<script src="${jsHref}"></script>\n` +
      '</body>\n</html>\n';
    const dest = path.join(outDir, d.out);
    ensureDir(path.dirname(dest));
    fs.writeFileSync(dest, page, 'utf8');
    renderedDocs.push({ ...d, body });
  }

  // -------------------------------------------------------------------------
  // Group screenshots for index.html
  // -------------------------------------------------------------------------
  const groups = new Map();
  for (const e of screenshotEntries) {
    if (!groups.has(e.group)) groups.set(e.group, []);
    groups.get(e.group).push(e);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => sortStrings(a.title, b.title));
  }
  const groupKeys = Array.from(groups.keys()).sort(sortStrings);

  // Orphan metadata: screenshots.* without a matching group → warning only
  for (const key of Object.keys(screenshotsMeta).sort(sortStrings)) {
    if (!groups.has(key)) {
      console.error(
        `handbook warning: metadata.json screenshots entry "${key}" has no matching screenshots (orphan).`,
      );
    }
  }
  // Orphan captions: screenshots.<group>.captions.<stem> without a matching file.
  for (const key of Object.keys(screenshotsMeta).sort(sortStrings)) {
    const meta = screenshotsMeta[key];
    if (!meta || !meta.captions || typeof meta.captions !== 'object') continue;
    const fileStems = new Set((groups.get(key) || []).map((e) => e.title));
    for (const stem of Object.keys(meta.captions).sort(sortStrings)) {
      if (!fileStems.has(stem)) {
        console.error(
          `handbook warning: metadata.json screenshots.${key}.captions entry "${stem}" has no matching screenshot (orphan).`,
        );
      }
    }
  }
  // Symmetric orphan warning for docs title overrides without a discovered file.
  const discoveredDocSet = new Set(discoveredDocs);
  for (const key of Object.keys(docsMeta).sort(sortStrings)) {
    if (!discoveredDocSet.has(key)) {
      console.error(
        `handbook warning: metadata.json docs entry "${key}" has no matching document (orphan).`,
      );
    }
  }

  // Enrich screenshot entries with caption/badge for HTML + search.
  for (const e of screenshotEntries) {
    const meta = screenshotsMeta[e.group];
    // titleFromFilename already stripped .png; re-add for deriveScreenshotCaption.
    const derived = deriveScreenshotCaption(e.title + '.png', meta);
    e.caption = derived.caption;
    e.badge = derived.badge;
    e.stem = derived.stem;
  }

  // -------------------------------------------------------------------------
  // Build index.html
  // -------------------------------------------------------------------------
  let tocItems = [];
  let sectionsHtml = '';
  let sectionNum = 0;

  function pushSection(id, numLabel, title, fileHint, countLabel, intro, bodyHtml) {
    sectionNum += 1;
    const n = String(sectionNum).padStart(2, '0');
    tocItems.push({ id, n, title, children: [] });
    const num = numLabel || n;
    const countHtml = countLabel
      ? `<b class="sec-count" data-sec-count="${escapeHtml(id)}">${escapeHtml(countLabel)}</b>`
      : '';
    sectionsHtml +=
      `<details class="spec" id="${escapeHtml(id)}" open>` +
      `<summary><div class="spec-head"><div class="lhs">` +
      `<h2><span class="badge">${escapeHtml(num)}</span>${escapeHtml(title)}${svgChevron()}</h2>` +
      (fileHint ? `<div class="file">${escapeHtml(fileHint)}</div>` : '') +
      `</div><div class="rhs">${countHtml}</div></div></summary>` +
      (intro ? `<p class="spec-intro">${intro}</p>` : '') +
      bodyHtml +
      `</details>`;
  }

  // Screenshots (by group)
  {
    // Anchor ids become user-facing with the permalink buttons: a reader can
    // copy one and send it on. slugify() is lossy, so two different sources can
    // land on the same id (e.g. the group dirs `05-karte/dfx` and `05-karte-dfx`,
    // or `99-fee ok.png` next to `99-fee-ok.png`). getElementById always returns
    // the first match, so the copied link would silently point at the wrong
    // screen. Collect every id with its source and fail the build on a clash.
    const anchorIds = new Map();
    let allShotsBody = '';
    for (const gKey of groupKeys) {
      const list = groups.get(gKey);
      const meta = screenshotsMeta[gKey];
      const title = meta && meta.title ? meta.title : gKey;
      const desc =
        meta && meta.description
          ? escapeHtml(meta.description)
          : `Screenshot-Gruppe <code>${escapeHtml(gKey)}</code> (Auto-Discovery).`;
      const groupId = claimAnchorId(
        anchorIds,
        'group-' + slugify(gKey),
        'screenshot group ' + gKey,
      );
      // group-block has no id — the permalink id lives on the h3 only so ids stay unique.
      let cards = `<div class="group-block" data-search="group">`;
      cards +=
        `<div class="group-head">` +
        `<h3 id="${escapeHtml(groupId)}">` +
        `<a class="name permalink" href="#${escapeHtml(groupId)}">${escapeHtml(title)}</a>` +
        ` <span class="gcount">${list.length} Bilder</span>` +
        `</h3>` +
        copyLinkButton(groupId) +
        `</div>`;
      cards += `<p class="group-desc">${desc}</p>`;
      cards += '<div class="shot-grid">';
      for (const e of list) {
        // Use e.title (stem) for slug stability with collision fixtures and #217.
        const cardId = claimAnchorId(
          anchorIds,
          'shot-' + slugify(e.group + '-' + e.title),
          e.sourcePath,
        );
        const shotHref = escapeHtml(encodeHtmlPath(e.outputPath));
        const searchText = escapeHtml(
          [e.caption, e.stem, title, e.group].join(' '),
        );
        const badgeHtml = e.badge
          ? `<span class="num-badge">${escapeHtml(e.badge)}</span>`
          : '';
        // Image link separate from caption so the permalink is not nested in <a href=png>.
        // Copy button sits next to the title, never inside a heading.
        cards +=
          `<figure class="shot-card" id="${escapeHtml(cardId)}" data-search="shot" ` +
          `data-search-text="${searchText}" data-group="${escapeHtml(e.group)}" ` +
          `data-caption="${escapeHtml(e.caption)}" data-file="${escapeHtml(e.stem)}">` +
          `<a class="shot-img" href="${shotHref}">` +
          `<div class="frame"><img src="${shotHref}" alt="${escapeHtml(e.caption)}" loading="lazy"></div>` +
          `</a>` +
          `<figcaption><div class="cap-row">${badgeHtml}` +
          `<a class="name permalink" href="#${escapeHtml(cardId)}">${escapeHtml(e.caption)}</a>` +
          copyLinkButton(cardId) +
          `</div>` +
          `<div class="cap-file">${escapeHtml(e.stem)}</div></figcaption></figure>`;
      }
      cards += '</div></div>';
      allShotsBody += cards;
    }
    assertNoAnchorCollisions(anchorIds);
    pushSection(
      'screenshots',
      null,
      'Screenshots',
      'docs/handbook/screenshots/',
      `${screenshotEntries.length} Screenshots · ${groupKeys.length} Gruppen`,
      'PNG-Screenshots, gruppiert nach Unterverzeichnis. Lesbare Bildunterschriften stammen aus <code>metadata.json</code> (<code>captions</code>) oder werden aus dem Dateinamen abgeleitet.',
      allShotsBody,
    );
    const shotToc = tocItems.find((t) => t.id === 'screenshots');
    if (shotToc) {
      for (const gKey of groupKeys) {
        const list = groups.get(gKey);
        const meta = screenshotsMeta[gKey];
        const title = meta && meta.title ? meta.title : gKey;
        shotToc.children.push({
          id: 'group-' + slugify(gKey),
          title,
          count: list.length,
        });
      }
    }
  }

  // Store listing
  {
    const byPlatform = new Map();
    for (const s of storeEntries) {
      if (!byPlatform.has(s.platform)) byPlatform.set(s.platform, new Map());
      const byLocale = byPlatform.get(s.platform);
      if (!byLocale.has(s.locale)) byLocale.set(s.locale, []);
      byLocale.get(s.locale).push(s);
    }
    const platformOrder = ['android', 'ios'];
    let storeBody = '';
    for (const platform of platformOrder) {
      if (!byPlatform.has(platform)) continue;
      const byLocale = byPlatform.get(platform);
      const localeKeys = Array.from(byLocale.keys()).sort(sortStrings);
      localeKeys.sort((a, b) => {
        if (a === 'global') return -1;
        if (b === 'global') return 1;
        return sortStrings(a, b);
      });
      storeBody += `<div class="store-platform"><h3>${escapeHtml(
        platform === 'android' ? 'Android (Play Store)' : 'iOS (App Store)',
      )}</h3>`;
      for (const locale of localeKeys) {
        const fields = byLocale.get(locale).slice().sort((a, b) =>
          sortStrings(a.field, b.field),
        );
        storeBody +=
          `<div class="store-locale"><h4><span class="locale-chip">${escapeHtml(locale)}</span></h4><dl>`;
        for (const f of fields) {
          const empty = !f.content;
          const searchText = escapeHtml([f.field, f.content, locale, platform].join(' '));
          storeBody +=
            `<div class="store-row" data-search="store-field" data-search-text="${searchText}">` +
            `<dt>${escapeHtml(f.field)}</dt>` +
            `<dd class="${empty ? 'empty' : ''}">${empty ? '—' : escapeHtml(f.content)}</dd></div>`;
        }
        storeBody += '</dl></div>';
      }
      storeBody += '</div>';
    }
    pushSection(
      'store-listing',
      null,
      'Store-Listing',
      'android/fastlane/metadata · ios/fastlane/metadata',
      `${storeEntries.length} Felder`,
      'Klartext-Metadaten der Store-Listings (Android und iOS). Neue Locales und Felder erscheinen automatisch.',
      storeBody,
    );
  }

  // App assets
  {
    let ag = '<div class="asset-grid">';
    for (const a of assetSpecs) {
      const assetHref = escapeHtml(encodeHtmlPath(a.out));
      ag +=
        `<div class="asset-card"><a href="${assetHref}">` +
        `<div class="frame"><img src="${assetHref}" alt="${escapeHtml(a.title)}" loading="lazy"></div>` +
        `<div class="an">${escapeHtml(a.title)}</div></a></div>`;
    }
    ag += '</div>';
    pushSection(
      'assets',
      null,
      'App-Assets',
      'img/dfx/** · img/icon*.png',
      `${assetSpecs.length} Dateien`,
      'Committete DFX-Marken- und Icon-Assets der BTC-Taro-Wallet.',
      ag,
    );
  }

  // Documentation list
  {
    let docsBody = '<ul class="doc-list">';
    const sortedDocs = renderedDocs
      .slice()
      .sort((a, b) => sortStrings(a.title, b.title));
    for (const d of sortedDocs) {
      const searchText = escapeHtml([d.title, d.src].join(' '));
      docsBody +=
        `<li data-search="doc" data-search-text="${searchText}">` +
        `<a href="${escapeHtml(encodeHtmlPath(d.out))}">` +
        `<span><span class="doc-title">${escapeHtml(d.title)}</span> ` +
        `<span class="doc-path">${escapeHtml(d.src)}</span></span>` +
        `<span class="chev" aria-hidden="true">›</span></a></li>`;
    }
    docsBody += '</ul>';
    pushSection(
      'documentation',
      null,
      'Dokumentation',
      'README · CONTRIBUTING · docs/*',
      `${renderedDocs.length} Dokumente`,
      'Gerenderte Markdown-Dokumentation aus dem Repository (via <code>marked</code>).',
      docsBody,
    );
  }

  let tocHtml = '<ol>';
  for (const t of tocItems) {
    tocHtml +=
      `<li><a href="#${escapeHtml(t.id)}"><span class="spec-num">${escapeHtml(t.n)}</span>` +
      `${escapeHtml(t.title)}</a>`;
    if (t.children && t.children.length) {
      tocHtml += '<ol class="sub">';
      for (const c of t.children) {
        tocHtml +=
          `<li><a href="#${escapeHtml(c.id)}" data-toc-group="${escapeHtml(c.id)}">` +
          `${escapeHtml(c.title)}` +
          `<span class="count">${c.count}</span></a></li>`;
      }
      tocHtml += '</ol>';
    }
    tocHtml += '</li>';
  }
  tocHtml += '</ol>';

  const shaShort =
    gitSha === 'unknown' ? 'unknown' : gitSha.length > 12 ? gitSha.slice(0, 12) : gitSha;

  const indexHtml =
    buildHead({
      title: 'DFX BTC Taro Wallet — Handbuch',
      description:
        'Handbuch der DFX BTC Taro Wallet: Screenshots, Store-Listing, Assets und Dokumentation.',
      prefix: '',
      css: INDEX_CSS,
    }) +
    '<body>\n' +
    '<a class="skip-link" href="#main-content">Zum Inhalt</a>\n' +
    buildTopbar({ prefix: '', showSearch: true, showSidebarToggle: true }) +
    '\n<div class="wrap">\n' +
    '<aside class="sidebar" id="handbook-sidebar">\n' +
    '<div class="sidebar-panel">\n' +
    '<div class="toc-label">Inhalt</div>\n' +
    `<nav class="toc" aria-label="Inhaltsverzeichnis">${tocHtml}</nav>\n` +
    '<div class="toc-actions" id="toc-actions" hidden>' +
    '<button type="button" id="toc-expand-all">Alle öffnen</button>' +
    '<button type="button" id="toc-collapse-all">Alle schliessen</button>' +
    '</div>\n' +
    '</div></aside>\n' +
    '<main id="main-content">\n' +
    '<header class="hero">\n' +
    '<h1>DFX BTC Taro Wallet — Handbuch</h1>\n' +
    '<p class="lede">Screenshots, Store-Listing-Texte, App-Assets und Markdown-Dokumentation der BTC-Taro-Wallet an einem Ort. Die Seite wird bei jedem Build aus dem Repository erzeugt — neue Dateien erscheinen automatisch.</p>\n' +
    '<div class="stats" role="group" aria-label="Kennzahlen">' +
    `<div class="stat"><span class="n">${screenshotEntries.length}</span><span class="l">Screenshots</span></div>` +
    `<div class="stat"><span class="n">${groupKeys.length}</span><span class="l">Gruppen</span></div>` +
    `<div class="stat"><span class="n">${renderedDocs.length}</span><span class="l">Dokumente</span></div>` +
    `<div class="stat"><span class="n">${storeEntries.length}</span><span class="l">Store-Felder</span></div>` +
    `<div class="stat"><span class="n">${assetSpecs.length}</span><span class="l">Assets</span></div>` +
    `<div class="stat stat-sha"><span class="n">${escapeHtml(shaShort)}</span><span class="l">Stand</span></div>` +
    '</div>\n' +
    '<div class="callout"><p><b>Auto-Discovery.</b> Es gibt keine handgepflegte Mapping-Tabelle. Das Build-Script scannt <code>docs/handbook/screenshots/</code>, Store-Metadaten, <code>img/dfx/</code> und Docs und erzeugt diese Seite deterministisch.</p></div>\n' +
    '<div class="search-empty" id="search-empty" hidden>Keine Treffer für diese Suche.</div>\n' +
    '</header>\n' +
    sectionsHtml +
    '<footer class="footer">' +
    'Diese Seite ist generiert und spiegelt den Repository-Stand ' +
    `<code>${escapeHtml(gitSha)}</code> wider. Quelle: ` +
    '<code>scripts/handbook/build.js</code>.' +
    '</footer>\n' +
    '</main>\n</div>\n' +
    '<div class="lightbox" id="lightbox" hidden role="dialog" aria-modal="true" aria-label="Screenshot-Ansicht">' +
    '<div class="lightbox-dialog">' +
    '<div class="lightbox-bar">' +
    '<div class="lightbox-meta">' +
    '<p class="lightbox-title" id="lightbox-title"></p>' +
    '<p class="lightbox-file" id="lightbox-file"></p>' +
    '<p class="lightbox-count" id="lightbox-count"></p>' +
    '</div>' +
    '<button type="button" class="icon-btn" id="lightbox-close" aria-label="Schliessen">' +
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M6.4 5.3a.75.75 0 0 0-1.1 1.1L10.9 12l-5.6 5.6a.75.75 0 1 0 1.1 1.1L12 13.1l5.6 5.6a.75.75 0 1 0 1.1-1.1L13.1 12l5.6-5.6a.75.75 0 1 0-1.1-1.1L12 10.9 6.4 5.3z"/></svg>' +
    '</button></div>' +
    '<div class="lightbox-body">' +
    '<button type="button" class="lightbox-arrow" id="lightbox-prev" aria-label="Vorheriges Bild">' +
    '<span class="label-short" aria-hidden="true">‹</span>' +
    '<span class="label-full">← Zurück</span></button>' +
    '<div class="lightbox-stage"><img id="lightbox-img" alt=""></div>' +
    '<button type="button" class="lightbox-arrow" id="lightbox-next" aria-label="Nächstes Bild">' +
    '<span class="label-short" aria-hidden="true">›</span>' +
    '<span class="label-full">Weiter →</span></button>' +
    '</div></div></div>\n' +
    '<script src="handbook.js"></script>\n' +
    '</body>\n</html>\n';

  ensureDir(outDir);
  const indexPath = path.join(outDir, 'index.html');
  fs.writeFileSync(indexPath, indexHtml, 'utf8');
  const handbookJs = buildHandbookJs();
  const handbookJsPath = path.join(outDir, 'handbook.js');
  fs.writeFileSync(handbookJsPath, handbookJs, 'utf8');
  artifacts.push({
    category: 'asset',
    outputPath: 'handbook.js',
    sourcePath: 'scripts/handbook/build.js',
    title: 'handbook.js',
    group: null,
  });

  // Stable artifact order for deterministic manifest
  artifacts.sort((a, b) => {
    const c = sortStrings(a.category, b.category);
    if (c !== 0) return c;
    const o = sortStrings(a.outputPath, b.outputPath);
    if (o !== 0) return o;
    return sortStrings(a.title, b.title);
  });

  const manifest = {
    generatedFrom: gitSha,
    artifacts,
    counts: {
      screenshots: screenshotEntries.length,
      docs: renderedDocs.length,
      store: storeEntries.length,
      assets: assetSpecs.length,
    },
  };
  const manifestPath = path.join(outDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  // Integrity: every artifact outputPath must exist on disk
  // (paths from the artifacts list — unescaped originals, not re-parsed HTML).
  // index.html is a real file for store entries that only live in the overview.
  for (const a of artifacts) {
    const full = path.join(outDir, a.outputPath);
    if (!fs.existsSync(full)) {
      fail(
        `handbook integrity check failed (manifest): missing ${a.outputPath}` +
          ` (sourcePath=${a.sourcePath}, title=${a.title})`,
      );
    }
  }

  // Integrity: local src/href in rendered markdown docs must resolve.
  // Unresolvable links were already stripped by sanitizeDocHtml; anything
  // remaining that does not exist is a hard failure.
  for (const d of renderedDocs) {
    const html = fs.readFileSync(path.join(outDir, d.out), 'utf8');
    const refs = collectRelativeRefs(html);
    for (const rawRef of refs) {
      // Entity decoding already happened in collectRelativeRefs (before the
      // fragment/query split); only percent-decoding remains here.
      const ref = decodeHtmlPath(rawRef);
      const underOut = path.join(path.dirname(path.join(outDir, d.out)), ref);
      if (
        !ref.startsWith('/') &&
        !fs.existsSync(underOut) &&
        !fs.existsSync(path.join(outDir, ref))
      ) {
        fail(`handbook integrity check failed (${d.out}): missing ${ref}`);
      }
    }
  }

  console.error(
    `handbook: wrote ${screenshotEntries.length} screenshots, ` +
      `${renderedDocs.length} docs, ${storeEntries.length} store fields, ` +
      `${assetSpecs.length} assets → ${outDir}`,
  );
}

main();
