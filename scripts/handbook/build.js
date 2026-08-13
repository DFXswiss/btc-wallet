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
// Content locales: today de/en/fr/it. Exceeding the floor is never an error;
// falling short always is — a missing language file is never a valid state.
// No buffer: MIN_CONTENT_LOCALES is exact identity of the product languages.
const MIN_CONTENT_LOCALES = 4;
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
  if (a === b || b.startsWith(a + path.sep)) {
    return true;
  }
  // macOS APFS and Windows NTFS default to case-insensitive, case-preserving
  // paths. A spelling that differs only in letter case is the same directory.
  // Linux is case-sensitive by default; folding there would treat distinct
  // paths as identical and block legitimate output dirs.
  if (process.platform !== 'linux') {
    const aFolded = a.toLowerCase();
    const bFolded = b.toLowerCase();
    return aFolded === bFolded || bFolded.startsWith(aFolded + path.sep);
  }
  return false;
}

/**
 * Empty the output directory before writing so a rebuild never leaves stale
 * files from a previous run (deleted markdown still present as HTML, old
 * discovery trees, leftover foreign files). The CLI accepts an arbitrary
 * path, so rmdir must never touch the repo (any path inside the tree is a
 * potential source — listMarkdownFiles walks from repoRoot), discovery source
 * roots (clearer messages), .git, the filesystem root or the home directory.
 * A wrong argument would otherwise be catastrophic.
 *
 * Missing outDir is fine (nothing to clear); writers recreate it.
 * Legitimate targets live outside the repo (CI/Docker: /out, /tmp/…).
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
  // Kept for a precise message; the generic in-repo guard below is the
  // complete protection (covers subdirs and sources not listed here).
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
  // Any path inside the repository is a potential source (screenshots subdirs,
  // scripts/handbook, content templates, metadata, …). Refuse generically so
  // a second hand-maintained allowlist cannot drift from discovery.
  if (isSameOrAncestor(resolvedRoot, resolvedOut)) {
    fail(
      'handbook: refusing to empty output path inside the repository: ' +
        `${resolvedOut} (repo root: ${resolvedRoot}). ` +
        'Write to a directory outside the repo (e.g. /tmp/handbook-out).',
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
        // scripts/handbook holds the build tooling and vendored pod README, not product docs.
        if (relPath === 'docs/handbook' || relPath === 'scripts/handbook') continue;
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
function deriveScreenshotCaption(filename, groupMeta, contentCaption) {
  const stem = filename.replace(/\.png$/i, '');
  const mNum = /^(\d{2})-(.+)$/.exec(stem);
  const badge = mNum ? mNum[1] : null;
  // 1) content locale captions win
  if (contentCaption && typeof contentCaption.title === 'string' && contentCaption.title.trim()) {
    return {
      badge,
      caption: contentCaption.title.trim(),
      text:
        typeof contentCaption.text === 'string' ? contentCaption.text.trim() : '',
      stem,
    };
  }
  // 2) metadata.json captions
  const captions =
    groupMeta && groupMeta.captions && typeof groupMeta.captions === 'object'
      ? groupMeta.captions
      : null;
  if (captions && typeof captions[stem] === 'string' && captions[stem].trim()) {
    return { badge, caption: captions[stem].trim(), text: '', stem };
  }
  // 3) derive from filename
  if (mNum) {
    const rest = mNum[2].replace(/[-_]+/g, ' ').trim();
    const caption =
      rest.length === 0 ? stem : rest.charAt(0).toUpperCase() + rest.slice(1);
    return { badge, caption, text: '', stem };
  }
  const rest = stem.replace(/[-_]+/g, ' ').trim();
  const caption =
    rest.length === 0 ? stem : rest.charAt(0).toUpperCase() + rest.slice(1);
  return { badge: null, caption, text: '', stem };
}

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

function loadPodAssets(scriptDir) {
  const podDir = path.join(scriptDir, 'pod');
  const tokensPath = path.join(podDir, 'tokens.css');
  if (!fs.existsSync(tokensPath)) {
    fail('handbook: missing Design Pod tokens at scripts/handbook/pod/tokens.css');
  }
  const tokensCss = fs.readFileSync(tokensPath, 'utf8');
  const logoDark = fs.readFileSync(path.join(podDir, 'logo-dark.svg'), 'utf8').trim();
  const logoWhite = fs.readFileSync(path.join(podDir, 'logo-white.svg'), 'utf8').trim();
  const fontDir = path.join(podDir, 'fonts');
  const fonts = [
    'Inter-Regular.woff2',
    'Inter-SemiBold.woff2',
    'Inter-Bold.woff2',
    'SourceCodePro-Regular.woff2',
    'Inter-LICENSE.txt',
    'SourceCodePro-LICENSE.md',
  ];
  for (const f of fonts) {
    if (!fs.existsSync(path.join(fontDir, f))) {
      fail(`handbook: missing Design Pod font scripts/handbook/pod/fonts/${f}`);
    }
  }
  return { tokensCss, logoDark, logoWhite, fonts, fontDir };
}

/**
 * Load scripts/handbook/content/*.json. Returns { contentDir, files, locales }.
 * Broken files fail hard (named); empty/missing set is handled by the floor.
 */
function loadContentLocales(scriptDir) {
  const contentDir = path.join(scriptDir, 'content');
  if (!fs.existsSync(contentDir)) {
    return { contentDir, files: [], locales: [] };
  }
  const files = fs
    .readdirSync(contentDir)
    .filter((n) => n.toLowerCase().endsWith('.json'))
    .sort(sortStrings);
  const locales = [];
  for (const file of files) {
    const abs = path.join(contentDir, file);
    const raw = fs.readFileSync(abs, 'utf8');
    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      fail(`handbook: invalid JSON in content/${file}: ${err.message}`);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      fail(`handbook: content/${file} must be a JSON object`);
    }
    if (typeof data.locale !== 'string' || !data.locale.trim()) {
      fail(
        `handbook: content/${file} missing required string field "locale"`,
      );
    }
    if (!Array.isArray(data.chapters)) {
      fail(
        `handbook: content/${file} missing required array field "chapters"`,
      );
    }
    locales.push({
      locale: data.locale.trim(),
      label: data.label || data.locale.trim(),
      meta: data.meta || {},
      ui: data.ui || {},
      chapters: data.chapters,
      captions:
        data.captions && typeof data.captions === 'object' ? data.captions : {},
      groupTitles:
        data.groupTitles && typeof data.groupTitles === 'object'
          ? data.groupTitles
          : {},
      sourcePath: path.posix.join('scripts/handbook/content', file),
    });
  }
  locales.sort((a, b) => sortStrings(a.locale, b.locale));
  return { contentDir, files, locales };
}

function buildFontFaceCss(prefix) {
  const p = (f) => escapeHtml(encodeHtmlPath(prefix + 'assets/fonts/' + f));
  return (
    '@font-face{font-family:Inter;font-style:normal;font-weight:400;font-display:swap;' +
    `src:url('${p('Inter-Regular.woff2')}') format('woff2');}` +
    '@font-face{font-family:Inter;font-style:normal;font-weight:600;font-display:swap;' +
    `src:url('${p('Inter-SemiBold.woff2')}') format('woff2');}` +
    '@font-face{font-family:Inter;font-style:normal;font-weight:700;font-display:swap;' +
    `src:url('${p('Inter-Bold.woff2')}') format('woff2');}` +
    '@font-face{font-family:"Source Code Pro";font-style:normal;font-weight:400;font-display:swap;' +
    `src:url('${p('SourceCodePro-Regular.woff2')}') format('woff2');}`
  );
}

/** Handbook layout CSS — only var(--…) colors from the pod; no hex literals. */
const HANDBOOK_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  font-size: var(--fs-base);
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
body.is-locked { overflow: hidden; }
a { color: var(--primary); text-decoration: none; }
a:hover { text-decoration: underline; }
/* Focus ring: keyboard navigation — not a selection marker. Keep on every control. */
a:focus-visible, button:focus-visible, summary:focus-visible, input:focus-visible,
.lang-switch a:focus-visible, .toc a:focus-visible, .shot-card a:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
code, pre { font-family: var(--font-mono); }
code {
  font-size: 0.875em;
  background: var(--surface-2);
  padding: 0.1em 0.35em;
  border-radius: var(--r-sm);
  border: 1px solid var(--border);
  color: var(--text);
}
.skip-link {
  position: absolute;
  left: -9999px;
  top: 0;
  z-index: 1000;
  background: var(--primary);
  color: var(--primary-text);
  padding: 10px 16px;
  border-radius: 0 0 var(--r-sm) 0;
  font-weight: var(--fw-semibold);
}
.skip-link:focus { left: 0; }
.site-chrome {
  position: sticky;
  top: 0;
  z-index: 100;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.topbar {
  height: 60px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 20px;
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
.topbar-brand .logo-wrap {
  height: 28px;
  width: auto;
  flex: 0 0 auto;
  line-height: 0;
}
/* Sizing only — never set display here (would override theme show/hide). */
.topbar-brand .logo-wrap svg {
  height: 28px;
  width: auto;
}
/* Exactly one logo visible per theme; default (no class yet) shows dark mark. */
.logo-white { display: none; }
.theme-light .logo-dark { display: block; }
.theme-light .logo-white { display: none; }
.theme-dark .logo-dark { display: none; }
.theme-dark .logo-white { display: block; }
.topbar-titles { line-height: 1.25; flex: 0 0 auto; }
.topbar-titles .wordmark {
  display: block;
  font-weight: var(--fw-semibold);
  font-size: var(--fs-sm);
  color: var(--text);
  white-space: nowrap;
}
.topbar-titles .submark {
  display: block;
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  white-space: nowrap;
}
.lang-switch {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}
.lang-switch a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  min-height: 36px;
  padding: 0 10px;
  border-radius: var(--r-pill);
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
  color: var(--text-secondary);
  text-decoration: none;
  text-transform: uppercase;
  border: 0;
  background: transparent;
}
.lang-switch a:hover {
  background: var(--surface-2);
  color: var(--text);
  text-decoration: none;
}
/* Active language: filled surface, not a red edge mark. */
.lang-switch a[aria-current="true"] {
  background: var(--brand-navy);
  color: var(--primary-text);
  text-decoration: none;
  box-shadow: none;
}
.theme-dark .lang-switch a[aria-current="true"] {
  background: var(--surface-2);
  color: var(--text);
}
.topbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
}
.search-wrap {
  position: relative;
  flex: 0 0 auto;
  width: 300px;
  max-width: 32vw;
  margin-left: auto;
}
.search-wrap[hidden] { display: none !important; }
.search-wrap input[type="search"] {
  width: 100%;
  height: 40px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--surface-2);
  color: var(--text);
  font: inherit;
  font-size: var(--fs-sm);
  padding: 0 12px;
}
.search-status {
  position: absolute;
  left: 16px;
  right: 16px;
  top: 100%;
  margin: 0;
  padding: 6px 12px;
  font-size: var(--fs-sm);
  line-height: 1.35;
  color: var(--text-secondary);
  background: var(--surface);
  border: 1px solid var(--border);
  border-top: 0;
  border-radius: 0 0 var(--r-sm) var(--r-sm);
  box-shadow: var(--sh-sm);
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
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  color: var(--text-secondary);
  cursor: pointer;
  width: 44px;
  height: 44px;
  min-width: 44px;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.icon-btn:hover {
  background: var(--surface-2);
  border-color: var(--border-strong, var(--border));
  color: var(--text);
}
.icon-btn svg { width: 20px; height: 20px; display: block; }
.icon-btn .icon-moon { display: none; }
.theme-dark .icon-btn .icon-sun { display: none; }
.theme-dark .icon-btn .icon-moon { display: block; }
.topbar-nav-btn {
  appearance: none;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  color: var(--text-secondary);
  cursor: pointer;
  font: inherit;
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  height: 44px;
  min-height: 44px;
  min-width: 44px;
  padding: 0 14px;
}
.topbar-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--primary);
  white-space: nowrap;
  min-height: 44px;
  padding: 0 8px;
}
.crumbs {
  font-size: var(--fs-sm);
  color: var(--text-secondary);
  margin: 0 0 18px;
}
.crumbs a { color: var(--text-secondary); }
.crumbs .sep { margin: 0 6px; color: var(--text-secondary); }
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
  top: 76px;
  align-self: start;
  max-height: calc(100vh - 92px);
  overflow-y: auto;
  padding-right: 8px;
}
.sidebar-panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 16px 14px;
}
.toc-label {
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-secondary);
  margin: 0 0 10px;
}
.toc ol { list-style: none; padding: 0; margin: 0; }
.toc > ol > li { margin: 2px 0; }
.toc a {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 7px 10px;
  border-radius: var(--r-sm);
  font-size: var(--fs-sm);
  font-weight: var(--fw-regular);
  color: var(--text-secondary);
  text-decoration: none;
}
.toc a:hover {
  background: var(--surface-2);
  color: var(--text);
  text-decoration: none;
}
/* Active TOC entry: surface fill + heavier weight (not color alone). */
.toc a[aria-current="true"] {
  background: var(--surface-2);
  color: var(--text);
  font-weight: var(--fw-semibold);
  text-decoration: none;
}
.toc .spec-num {
  display: inline-block;
  min-width: 22px;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
  font-size: var(--fs-xs);
}
.toc .sub { list-style: none; padding: 2px 0 6px 18px; margin: 0; }
.toc .sub a { font-size: var(--fs-sm); padding: 5px 10px; color: var(--text-secondary); }
.toc .sub a .count {
  margin-left: auto;
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.toc-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 12px 0 0;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
.toc-actions button {
  appearance: none;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  color: var(--text-secondary);
  cursor: pointer;
  font: inherit;
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
  min-height: 36px;
  padding: 6px 12px;
}
.toc li[hidden] { display: none !important; }
main { min-width: 0; }
.hero h1 {
  margin: 0 0 14px;
  font-size: var(--fs-2xl);
  font-weight: var(--fw-bold);
  letter-spacing: -0.02em;
  line-height: 1.2;
  color: var(--text);
}
.lede {
  font-size: var(--fs-lg);
  color: var(--text-secondary);
  margin: 0 0 32px;
  max-width: 70ch;
}
/* Developer area keeps the tiled stat strip. */
.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  overflow: hidden;
  margin: 0 0 24px;
}
.stats .stat {
  flex: 1 1 110px;
  padding: 16px 18px;
  border-right: 1px solid var(--border);
  min-width: 100px;
}
.stats .stat:last-child { border-right: 0; }
.stats .stat .n {
  display: block;
  font-size: var(--fs-xl);
  font-weight: var(--fw-bold);
  font-variant-numeric: tabular-nums;
  color: var(--text);
  line-height: 1.2;
  overflow-wrap: anywhere;
}
.stats .stat .l {
  display: block;
  margin-top: 4px;
  font-size: var(--fs-xs);
  color: var(--text-secondary);
}
.stats .stat.stat-sha { flex: 1 1 140px; min-width: 0; }
.stats .stat.stat-sha .n {
  font-size: var(--fs-base);
  font-family: var(--font-mono);
  font-weight: var(--fw-semibold);
}
.callout {
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 3px solid var(--primary);
  padding: 14px 18px;
  margin: 0 0 36px;
  border-radius: 0 var(--r-sm) var(--r-sm) 0;
  max-width: 70ch;
}
.callout p { margin: 0; color: var(--text-secondary); font-size: var(--fs-sm); }
.callout b { color: var(--text); }
details.spec {
  margin: 0 0 56px;
  scroll-margin-top: 76px;
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
  font-size: var(--fs-xl);
  font-weight: var(--fw-semibold);
  letter-spacing: -0.01em;
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--text);
}
.spec-head .badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 34px;
  height: 26px;
  padding: 0 8px;
  border-radius: var(--r-pill);
  background: var(--surface-2);
  color: var(--text-secondary);
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
  font-variant-numeric: tabular-nums;
}
.spec-head .chevron {
  width: 16px;
  height: 16px;
  color: var(--text-secondary);
  flex: 0 0 auto;
  transition: transform 0.15s ease;
}
/* Chevron stays quiet; rotation marks open state, not a red accent. */
details.spec[open] .spec-head .chevron {
  color: var(--text-secondary);
  transform: rotate(90deg);
}
/* Developer sections still place .sec-count in .rhs (count labels). */
.spec-head .file {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}
.spec-head .rhs {
  text-align: right;
  font-size: var(--fs-sm);
  color: var(--text-secondary);
  white-space: nowrap;
}
.spec-head .rhs b { color: var(--text); font-weight: var(--fw-semibold); }
.spec-intro {
  color: var(--text-secondary);
  margin: 12px 0 22px;
  max-width: 70ch;
  font-size: var(--fs-base);
}
.chapter-summary {
  margin: 0 0 10px;
  color: var(--text-secondary);
  font-size: var(--fs-base);
  max-width: 70ch;
}
.group-block {
  margin: 0 0 36px;
  scroll-margin-top: 76px;
}
.group-block[hidden],
.shot-card[hidden],
details.spec[hidden],
.doc-list li[hidden] {
  display: none !important;
}
.group-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0 0 8px;
  flex-wrap: wrap;
}
.group-head h3 {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: var(--fw-semibold);
  color: var(--text);
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  scroll-margin-top: 76px;
}
.group-head h3 .gcount {
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  color: var(--text-secondary);
}
.group-desc {
  margin: 0 0 18px;
  max-width: 70ch;
  color: var(--text-secondary);
  font-size: var(--fs-sm);
}
a.name.permalink {
  text-decoration: none;
  color: inherit;
}
a.name.permalink:hover {
  text-decoration: underline;
  color: var(--accent, var(--primary));
}
.copy-link {
  appearance: none;
  background: transparent;
  border: 1px solid transparent;
  padding: 2px 6px;
  font: inherit;
  font-size: var(--fs-xs);
  line-height: 1;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: var(--r-sm);
  flex: 0 0 auto;
}
.copy-link:hover {
  color: var(--accent, var(--primary));
  background: var(--surface);
  border-color: var(--border);
}
.copy-link[data-copied='true'] {
  color: var(--accent, var(--primary));
  background: var(--surface);
  border-color: var(--accent, var(--primary));
}
.shot-grid {
  display: grid;
  gap: 22px;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  align-items: start;
}
.shot-card {
  margin: 0;
  background: transparent;
  border: 0;
  scroll-margin-top: 72px;
}
/* Single-group chapters hang the group id here (no visible heading). */
.group-anchor {
  scroll-margin-top: 76px;
}
.shot-card > a.shot-img {
  display: block;
  color: inherit;
  text-decoration: none;
  cursor: pointer;
  border-radius: var(--r-lg);
}
.shot-card > a.shot-img:hover { text-decoration: none; }
/* Image sits on the page surface: no tile chrome, soft shadow only. */
.shot-card .frame {
  aspect-ratio: 9 / 19.5;
  background: transparent;
  border: 0;
  border-radius: var(--r-lg);
  box-shadow: var(--sh-md);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 0;
}
.shot-card > a.shot-img:hover .frame {
  box-shadow: var(--sh-md), var(--sh-sm);
}
.shot-card > a.shot-img:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.shot-card img {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
  display: block;
  border-radius: var(--r-lg);
  border: 0;
}
.shot-card figcaption { margin-top: 10px; padding: 0 2px; }
.shot-card .cap-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: nowrap;
}
.shot-card .num-badge {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: baseline;
  justify-content: center;
  min-width: 1.75em;
  height: auto;
  padding: 0;
  border-radius: 0;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  font-variant-numeric: tabular-nums;
  line-height: 1.35;
}
.shot-card .cap-row a.name.permalink {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--text);
  line-height: 1.35;
  flex: 1 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
}
.shot-card .cap-text {
  margin: 6px 0 0;
  font-size: var(--fs-sm);
  color: var(--text-secondary);
  line-height: 1.45;
  max-width: 70ch;
}
.asset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 16px;
}
.asset-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 14px;
  text-align: center;
}
.asset-card a { display: block; color: inherit; text-decoration: none; }
.asset-card .frame {
  aspect-ratio: 4 / 3;
  background: var(--surface-2);
  border-radius: var(--r-sm);
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
}
.asset-card img { max-width: 100%; max-height: 100%; object-fit: contain; }
.asset-card .an {
  margin-top: 10px;
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}
.store-platform { margin-bottom: 36px; }
.store-platform h3 { margin: 0 0 14px; font-size: var(--fs-lg); color: var(--text); }
.store-locale {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 18px 20px;
  margin-bottom: 14px;
}
.store-locale h4 { margin: 0 0 14px; display: inline-flex; }
.locale-chip {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: var(--r-pill);
  background: var(--surface-2);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
}
.store-locale dl { margin: 0; display: flex; flex-direction: column; gap: 10px; }
.store-row {
  display: grid;
  grid-template-columns: minmax(120px, 200px) 1fr;
  gap: 8px 18px;
  align-items: start;
}
.store-row[hidden] { display: none !important; }
.store-locale dt { font-size: var(--fs-sm); color: var(--text-secondary); font-weight: var(--fw-semibold); }
.store-locale dd {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--text);
  font-size: var(--fs-sm);
}
.store-locale dd.empty { color: var(--text-secondary); }
.doc-list { list-style: none; padding: 0; margin: 0; }
.doc-list li {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  margin-bottom: 10px;
}
.doc-list a {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  min-height: 52px;
  color: var(--text);
  text-decoration: none;
}
.doc-list a:hover { text-decoration: none; background: var(--surface-2); }
.doc-list .doc-title { font-weight: var(--fw-semibold); font-size: var(--fs-sm); }
.doc-list .doc-path {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--text-secondary);
}
.doc-list .chev { color: var(--text-secondary); flex: 0 0 auto; }
.search-empty {
  background: var(--surface);
  border: 1px dashed var(--border);
  border-radius: var(--r-md);
  padding: 28px 20px;
  text-align: center;
  color: var(--text-secondary);
  margin: 12px 0 28px;
}
.footer {
  margin-top: 56px;
  padding-top: 24px;
  border-top: 1px solid var(--border);
  font-size: var(--fs-sm);
  color: var(--text-secondary);
}
.lightbox {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: var(--bg-deep, var(--bg));
  opacity: 0.96;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.lightbox[hidden] { display: none !important; }
.lightbox-dialog {
  background: var(--surface);
  color: var(--text);
  border-radius: var(--r-lg);
  border: 1px solid var(--border);
  box-shadow: var(--sh-md);
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
  border-bottom: 1px solid var(--border);
}
.lightbox-meta { min-width: 0; }
.lightbox-title { margin: 0; font-size: var(--fs-sm); font-weight: var(--fw-semibold); color: var(--text); }
.lightbox-count { margin: 6px 0 0; font-size: var(--fs-xs); color: var(--text-secondary); }
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
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  color: var(--text-secondary);
  cursor: pointer;
  font: inherit;
  font-size: 18px;
  font-weight: var(--fw-bold);
  min-height: 44px;
  min-width: 44px;
  padding: 0;
  grid-row: 1;
}
#lightbox-prev { grid-column: 1; }
#lightbox-next { grid-column: 3; }
.lightbox-arrow .label-full { display: none; }
.lightbox-arrow .label-short { display: inline; }
.doc-wrap {
  max-width: 72ch;
  margin: 0 auto;
  padding: 28px 22px 64px;
}
.doc-body {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 28px 28px 36px;
  box-shadow: var(--sh-sm);
}
.doc-body > :first-child { margin-top: 0; }
.doc-body h1 {
  font-size: var(--fs-2xl);
  font-weight: var(--fw-bold);
  margin: 0 0 18px;
  color: var(--text);
}
.doc-body h2 {
  font-size: var(--fs-xl);
  font-weight: var(--fw-semibold);
  margin: 36px 0 12px;
  padding-top: 18px;
  border-top: 1px solid var(--border);
  color: var(--text);
  scroll-margin-top: 76px;
}
.doc-body h3 {
  font-size: var(--fs-lg);
  font-weight: var(--fw-semibold);
  margin: 28px 0 10px;
  color: var(--text);
}
.doc-body p, .doc-body li { color: var(--text-secondary); max-width: 70ch; }
.doc-body a { color: var(--primary); }
.doc-body pre {
  margin: 16px 0;
  padding: 0;
  background: transparent;
  border: 0;
  overflow: visible;
}
.doc-body pre code {
  display: block;
  overflow-x: auto;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 14px 16px;
  font-size: var(--fs-sm);
  line-height: 1.5;
  color: var(--text);
}
.doc-body .table-scroll {
  overflow-x: auto;
  margin: 16px 0;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--surface);
}
.doc-body table { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); margin: 0; }
.doc-body th, .doc-body td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}
.doc-body th { background: var(--surface-2); color: var(--text); font-weight: var(--fw-semibold); }
.doc-body tr:nth-child(even) td { background: var(--surface-2); }
.doc-body img { max-width: 100%; height: auto; border-radius: var(--r-sm); border: 1px solid var(--border); }
.doc-body blockquote {
  margin: 18px 0;
  padding: 10px 16px;
  border-left: 3px solid var(--accent, var(--primary));
  background: var(--primary-soft, var(--surface-2));
  color: var(--text-secondary);
  border-radius: 0 var(--r-sm) var(--r-sm) 0;
}
@media (max-width: 719px) {
  .topbar { flex-wrap: wrap; height: auto; min-height: 60px; padding-bottom: 10px; }
  .topbar-brand { order: 1; flex: 1 1 auto; }
  .lang-switch { order: 2; }
  .topbar-actions { order: 3; margin-left: 0; }
  .search-wrap {
    order: 4;
    flex: 1 1 100%;
    width: 100%;
    max-width: none;
    margin-left: 0;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--border);
  }
  .topbar-nav-btn { padding: 0; width: 44px; font-size: 0; }
  .topbar-nav-btn::before { content: "≡"; font-size: 18px; font-weight: 700; line-height: 1; }
}
@media (max-width: 1023px) {
  .wrap { grid-template-columns: 1fr; padding: 18px 16px 48px; gap: 20px; }
  .sidebar { position: static; max-height: none; order: 2; display: none; }
  body.sidebar-open .sidebar { display: block; }
  main { order: 1; }
  .stats .stat { border-right: 0; border-bottom: 1px solid var(--border); }
  .store-row { grid-template-columns: 1fr; gap: 2px; }
}
@media (min-width: 1024px) {
  .topbar-nav-btn { display: none; }
}
@media (max-width: 600px) {
  .spec-head { flex-direction: column; align-items: flex-start; gap: 6px; }
  .spec-head .rhs { text-align: left; white-space: normal; }
  .stats .stat.stat-sha { flex: 1 1 100%; border-right: 0; border-top: 1px solid var(--border); }
}
@media (max-width: 560px) {
  .lightbox-body {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto auto;
    padding: 10px;
    gap: 8px;
  }
  .lightbox-stage { grid-column: 1 / -1; grid-row: 1; }
  #lightbox-prev { grid-column: 1; grid-row: 2; }
  #lightbox-next { grid-column: 2; grid-row: 2; }
  .lightbox-arrow { width: 100%; font-size: var(--fs-sm); font-weight: var(--fw-semibold); }
  .lightbox-arrow .label-full { display: inline; }
  .lightbox-arrow .label-short { display: none; }
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

function prepareInlineLogo(svg, className) {
  let s = String(svg).trim();
  // Ensure root svg has class and aria-hidden for decorative use beside wordmark.
  s = s.replace(
    /^<svg\b([^>]*)>/i,
    '<svg class="' + className + '" aria-hidden="true" focusable="false"$1>',
  );
  return s;
}

function buildPageCss(tokensCss, prefix) {
  return tokensCss + '\n' + buildFontFaceCss(prefix) + '\n' + HANDBOOK_CSS;
}

function buildHead(opts) {
  const prefix = opts.prefix || '';
  const iconHref = escapeHtml(encodeHtmlPath(prefix + 'assets/icon.png'));
  const desc = escapeHtml(opts.description || '');
  const title = escapeHtml(opts.title || '');
  const lang = escapeHtml(opts.lang || 'de');
  const themeClass = opts.themeClass || 'theme-light';
  const hreflangs = opts.hreflangs || [];
  let alt = '';
  for (const h of hreflangs) {
    alt +=
      `<link rel="alternate" hreflang="${escapeHtml(h.lang)}" href="${escapeHtml(h.href)}">\n`;
  }
  const scriptTag = opts.scriptSrc
    ? `<script src="${escapeHtml(encodeHtmlPath(opts.scriptSrc))}"></script>\n`
    : '';
  return (
    `<!DOCTYPE html>\n<html lang="${lang}" class="${escapeHtml(themeClass)}">\n<head>\n` +
    `<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<meta name="color-scheme" content="light">\n` +
    `<meta name="description" content="${desc}">\n` +
    `<link rel="icon" type="image/png" href="${iconHref}">\n` +
    alt +
    `<title>${title}</title>\n` +
    `<style>\n${opts.css}\n</style>\n` +
    scriptTag +
    `</head>\n`
  );
}

function buildLangSwitch(locales, currentLocale, prefix, ariaLabel) {
  // prefix is '' on de home and '../' on en|fr|it homes — enough for sibling links.
  let html =
    `<nav class="lang-switch" aria-label="${escapeHtml(ariaLabel || 'Language')}">`;
  for (const loc of locales) {
    const href =
      loc.locale === 'de'
        ? prefix + 'index.html'
        : prefix + loc.locale + '/index.html';
    const cur = loc.locale === currentLocale ? ' aria-current="true"' : '';
    html +=
      `<a href="${escapeHtml(encodeHtmlPath(href))}"${cur}>` +
      `${escapeHtml(loc.locale)}</a>`;
  }
  html += '</nav>';
  return html;
}

function buildTopbar(opts) {
  const prefix = opts.prefix || '';
  const homeHref = escapeHtml(encodeHtmlPath(prefix + (opts.homePath || 'index.html')));
  const logoDark = opts.logoDark || '';
  const logoWhite = opts.logoWhite || '';
  const ui = opts.ui || {};
  const showSearch = !!opts.showSearch;
  const showSidebarToggle = !!opts.showSidebarToggle;
  const showBack = !!opts.showBack;
  const locales = opts.locales || [];
  const currentLocale = opts.currentLocale || 'de';

  let actions = '';
  if (showSidebarToggle) {
    actions +=
      `<button type="button" class="topbar-nav-btn" id="sidebar-toggle" hidden ` +
      `aria-expanded="false" aria-controls="handbook-sidebar">${escapeHtml(ui.menu || 'Menu')}</button>`;
  }
  if (showBack) {
    actions +=
      `<a class="topbar-back" href="${homeHref}">${escapeHtml(ui.backToHandbook || '←')}</a>`;
  }
  actions +=
    `<button type="button" class="icon-btn" id="theme-toggle" hidden ` +
    `aria-label="${escapeHtml(ui.theme || 'Theme')}" aria-pressed="false">` +
    svgSunMoon() +
    '</button>';

  let searchHtml = '';
  let statusHtml = '';
  if (showSearch) {
    searchHtml =
      `<div class="search-wrap" id="search-wrap" hidden>` +
      `<input type="search" id="handbook-search" placeholder="${escapeHtml(ui.search || '')}" ` +
      `aria-label="${escapeHtml(ui.searchLabel || ui.search || 'Search')}" autocomplete="off" spellcheck="false">` +
      `</div>`;
    statusHtml =
      `<p class="search-status" id="search-status" role="status" aria-live="polite" hidden></p>`;
  }

  const lang =
    locales.length > 1
      ? buildLangSwitch(
          locales,
          currentLocale,
          prefix,
          ui.language || 'Language',
        )
      : '';

  return (
    `<div class="site-chrome">` +
    `<header class="topbar">` +
    `<a class="topbar-brand" href="${homeHref}">` +
    `<span class="logo-wrap">${logoDark}${logoWhite}</span>` +
    `<span class="topbar-titles">` +
    `<span class="wordmark">BTC Taro Wallet</span>` +
    `<span class="submark">${escapeHtml(ui.breadcrumbHome || 'Handbook')}</span>` +
    `</span></a>` +
    lang +
    searchHtml +
    `<div class="topbar-actions">${actions}</div>` +
    `</header>` +
    statusHtml +
    `</div>`
  );
}

function buildHandbookJs() {
  return [
    '(function () {',
    "  var THEME_KEY = 'handbook-theme';",
    '  // Apply theme immediately (script loads from <head>, before paint of body).',
    '  (function applyThemeEarly() {',
    '    var root = document.documentElement;',
    "    root.classList.remove('theme-light', 'theme-dark');",
    '    var stored = null;',
    '    try { stored = localStorage.getItem(THEME_KEY); } catch (e) {}',
    "    if (stored === 'dark' || stored === 'light') {",
    "      root.classList.add('theme-' + stored);",
    '    } else {',
    '      // Default is light; ignore prefers-color-scheme until the user chooses.',
    "      root.classList.add('theme-light');",
    '    }',
    '  })();',
    '',
    '  function $(id) { return document.getElementById(id); }',
    '  function qs(sel, root) { return (root || document).querySelector(sel); }',
    '  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }',
    '',
    '  function applyTheme(theme) {',
    '    var root = document.documentElement;',
    "    root.classList.remove('theme-light', 'theme-dark');",
    "    if (theme === 'dark') root.classList.add('theme-dark');",
    "    else if (theme === 'light') root.classList.add('theme-light');",
    '    else {',
    "      root.classList.add('theme-light');",
    '      theme = null;',
    '    }',
    "    var btn = $('theme-toggle');",
    '    if (btn) {',
    "      var pressed = root.classList.contains('theme-dark');",
    "      btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');",
    '    }',
    '  }',
    '',
    '  function initTheme() {',
    "    var btn = $('theme-toggle');",
    '    if (!btn) return;',
    '    btn.hidden = false;',
    "    var pressed = document.documentElement.classList.contains('theme-dark');",
    "    btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');",
    "    btn.addEventListener('click', function () {",
    "      var isDark = document.documentElement.classList.contains('theme-dark');",
    "      var next = isDark ? 'light' : 'dark';",
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
    "    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' });",
    '  }',
    '',
    '  function initTocActions() {',
    "    var expand = $('toc-expand-all');",
    "    var collapse = $('toc-collapse-all');",
    "    var actions = $('toc-actions');",
    '    if (actions && (expand || collapse)) actions.hidden = false;',
    '    if (expand) expand.addEventListener("click", function () { qsa("details.spec").forEach(function (d) { d.open = true; }); });',
    '    if (collapse) collapse.addEventListener("click", function () { qsa("details.spec").forEach(function (d) { d.open = false; }); });',
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
    "        if (a.getAttribute('href') === '#' + id) a.setAttribute('aria-current', 'true');",
    "        else a.removeAttribute('aria-current');",
    '      });',
    '    }',
    '    var io = new IntersectionObserver(function (entries) {',
    '      entries.forEach(function (en) {',
    '        if (en.isIntersecting) visible[en.target.id] = true;',
    '        else delete visible[en.target.id];',
    '      });',
    '      var active = null;',
    '      for (var i = 0; i < ids.length; i++) { if (visible[ids[i]]) { active = ids[i]; break; } }',
    '      if (active) setCurrent(active);',
    '    }, { rootMargin: "-20% 0px -60% 0px", threshold: [0, 0.1, 0.5] });',
    '    ids.forEach(function (id) { var el = document.getElementById(id); if (el) io.observe(el); });',
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
    "    secCounts.forEach(function (el) { baseSec[el.getAttribute('data-sec-count')] = el.textContent; });",
    '    var baseToc = {};',
    '    tocGroups.forEach(function (a) {',
    "      var c = qs('.count', a);",
    "      if (c) baseToc[a.getAttribute('data-toc-group')] = c.textContent;",
    '    });',
    "    var statusTpl = status && status.getAttribute('data-template') || '{n} / {total}';",
    '',
    '    function setHidden(el, hide) {',
    '      if (hide) el.setAttribute("hidden", "");',
    '      else el.removeAttribute("hidden");',
    '    }',
    '    function setStatus(text) {',
    '      if (!status) return;',
    '      if (!text) { status.textContent = ""; status.hidden = true; }',
    '      else { status.hidden = false; status.textContent = text; }',
    '    }',
    '    function updateCounts(active, hitShots, hitGroups, hitDocs, hitStore) {',
    '      secCounts.forEach(function (el) {',
    "        var kind = el.getAttribute('data-sec-count');",
    '        if (!active) { el.textContent = baseSec[kind] || el.textContent; return; }',
    "        if (kind === 'screenshots' || kind.indexOf('chapter-') === 0) {",
    "          el.textContent = hitShots + ' / ' + totalShots;",
    "        } else if (kind === 'documentation') {",
    "          el.textContent = hitDocs + ' / ' + docs.length;",
    "        } else if (kind === 'store-listing') {",
    "          el.textContent = hitStore + ' / ' + store.length;",
    '        }',
    '      });',
    '      tocGroups.forEach(function (a) {',
    "        var gid = a.getAttribute('data-toc-group');",
    "        var c = qs('.count', a);",
    '        var li = a.closest ? a.closest("li") : null;',
    '        if (!active) {',
    '          if (c) c.textContent = baseToc[gid] || c.textContent;',
    '          if (li) setHidden(li, false);',
    '          return;',
    '        }',
    '        var n = 0;',
    '        var groupBlock = null;',
    "        qsa('[data-search=\"group\"]').forEach(function (gb) {",
    "          var h = qs('h3', gb);",
    '          if (h && h.id === gid) groupBlock = gb;',
    '        });',
    "        if (groupBlock) n = qsa('[data-search=\"shot\"]', groupBlock).filter(function (s) { return !s.hasAttribute('hidden'); }).length;",
    '        if (c) c.textContent = n + " / " + (baseToc[gid] || n);',
    '        if (li) setHidden(li, n === 0);',
    '      });',
    '    }',
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
    "      var msg = statusTpl.replace('{n}', String(hitShots)).replace('{total}', String(totalShots));",
    '      setStatus(msg);',
    '      updateCounts(true, hitShots, hitGroups, hitDocs, hitStore);',
    '      if (empty) empty.hidden = !(hitShots === 0 && hitDocs === 0 && hitStore === 0);',
    '    }',
    "    input.addEventListener('input', run);",
    "    input.addEventListener('keydown', function (ev) {",
    "      if (ev.key === 'Escape') { input.value = ''; reset(); input.blur(); }",
    '    });',
    '  }',
    '',
    '  function initLightbox() {',
    "    var root = $('lightbox');",
    '    if (!root) return;',
    "    var img = $('lightbox-img');",
    "    var titleEl = $('lightbox-title');",
    "    var countEl = $('lightbox-count');",
    "    var btnClose = $('lightbox-close');",
    "    var btnPrev = $('lightbox-prev');",
    "    var btnNext = $('lightbox-next');",
    '    var index = 0;',
    '    var lastFocus = null;',
    '    var groupCards = [];',
    "    function groupOf(card) { return card.getAttribute('data-group') || ''; }",
    '    function collectGroup(card) {',
    '      var g = groupOf(card);',
    '      if (!g) return [];',
    "      return qsa('.shot-card').filter(function (el) {",
    "        return el.getAttribute('data-group') === g && !el.hasAttribute('hidden');",
    '      });',
    '    }',
    '    function show(i) {',
    '      if (!groupCards.length) return;',
    '      index = (i + groupCards.length) % groupCards.length;',
    '      var card = groupCards[index];',
    "      var a = qs('a.shot-img', card) || qs('a', card);",
    "      var cap = card.getAttribute('data-caption') || '';",
    "      var href = a ? a.getAttribute('href') : '';",
    '      if (img) { img.src = href; img.alt = cap; }',
    '      if (titleEl) titleEl.textContent = cap;',
    '      if (countEl) {',
    "        var tpl = countEl.getAttribute('data-template') || '{n} / {total}';",
    "        countEl.textContent = tpl.replace('{n}', String(index + 1)).replace('{total}', String(groupCards.length));",
    '      }',
    '    }',
    '    function trapFocus(ev) {',
    "      if (ev.key !== 'Tab' || root.hidden) return;",
    "      var focusables = qsa('button, [href], input, [tabindex]:not([tabindex=\"-1\"])', root).filter(function (el) { return !el.disabled && el.offsetParent !== null; });",
    '      if (!focusables.length) return;',
    '      var first = focusables[0];',
    '      var last = focusables[focusables.length - 1];',
    '      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }',
    '      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }',
    '    }',
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
    '    function close() {',
    '      root.hidden = true;',
    "      document.body.classList.remove('is-locked');",
    '      if (img) img.removeAttribute("src");',
    '      if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();',
    '    }',
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
    "          var okT = btn.getAttribute('data-copied-label') || '\\u2713';",
    "          var badT = btn.getAttribute('data-failed-label') || '\\u2717';",
    '          btn.textContent = ok ? okT : badT;',
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
  // Only match real attribute names, after start-of-string, whitespace, '/' or '<'.
  // A word boundary alone also matches after '-' and ':', so data-src,
  // xlink:href and ng-src would be checked as if a browser resolved them.
  // Alternation per quote style (and unquoted) so a double-quoted value may
  // contain apostrophes (e.g. href="docs/Bank's%20Guide.md") and so unquoted
  // values are not skipped by integrity checks.
  const re = /(?:^|[\s/<])(?:src|href)=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3];
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
 * Fail closed when open/close counts for active blocks disagree. A non-greedy
 * `<tag>…</tag>` replace would otherwise delete everything up to the next
 * closer in the document (silent content loss, green build).
 */
function assertBalancedDangerBlocks(html) {
  for (const tag of ['script', 'iframe', 'object']) {
    let opens = 0;
    const openRe = new RegExp('<' + tag + '\\b([^>]*)>', 'gi');
    let m;
    while ((m = openRe.exec(html)) !== null) {
      const attrs = m[1] || '';
      if (/\/\s*$/.test(attrs)) continue; // self-closing
      opens += 1;
    }
    const closeMatches = html.match(new RegExp('</' + tag + '\\s*>', 'gi'));
    const closes = closeMatches ? closeMatches.length : 0;
    if (opens !== closes) {
      fail(
        `handbook sanitizer: unbalanced <${tag}> blocks ` +
          `(${opens} open, ${closes} close). Refusing to strip across content ` +
          'boundaries — fix the markdown source.',
      );
    }
  }
}

/**
 * Strip active HTML/script vectors from marked output before link rewriting.
 * marked does not sanitize by default; without this, any repo *.md is shipped
 * to handbook.taro.dfx.swiss with scripts and javascript: URLs intact.
 * CSP is a second layer; this cleans the HTML itself.
 *
 * Attribute separators: HTML allows `/` as well as whitespace between
 * attributes (`<img/onerror=…>`). Values may be unquoted. Both must be
 * covered — whitespace-only / quote-only patterns miss live vectors.
 */
function stripDangerousHtml(html) {
  let out = String(html);
  assertBalancedDangerBlocks(out);
  // Remove script/iframe/object/embed blocks (content discarded).
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  out = out.replace(/<script\b[^>]*\/>/gi, '');
  out = out.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '');
  out = out.replace(/<iframe\b[^>]*\/>/gi, '');
  out = out.replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, '');
  out = out.replace(/<object\b[^>]*\/>/gi, '');
  out = out.replace(/<embed\b[^>]*\/?>/gi, '');
  // Navigation / document chrome not needed in handbook body, and not covered
  // by CSP alone (meta refresh has no directive; form-action is separate).
  out = out.replace(/<meta\b[^>]*\/?>/gi, '');
  out = out.replace(/<base\b[^>]*\/?>/gi, '');
  out = out.replace(/<link\b[^>]*\/?>/gi, '');
  out = out.replace(/<form\b[^>]*>[\s\S]*?<\/form>/gi, '');
  out = out.replace(/<\/?form\b[^>]*\/?>/gi, '');
  // Drop inline event handlers (onerror=, onclick=, …). `/` is a valid
  // attribute separator in HTML, not only whitespace.
  out = out.replace(/[\s/]+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // Neutralize dangerous URL schemes in href/src (keep data:image/*).
  // Quoted and unquoted attribute values.
  out = out.replace(
    /\b(href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (full, attr, dQuoted, sQuoted, unquoted) => {
      const url =
        dQuoted !== undefined
          ? dQuoted
          : sQuoted !== undefined
            ? sQuoted
            : unquoted;
      const trimmed = String(url).trim();
      const lower = trimmed.toLowerCase();
      if (
        lower.startsWith('javascript:') ||
        lower.startsWith('vbscript:') ||
        (lower.startsWith('data:') && !/^data:image\//i.test(trimmed))
      ) {
        if (dQuoted !== undefined) return attr + '=""';
        if (sQuoted !== undefined) return attr + "=''";
        return attr + '=""';
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
 * 0. Strip script/iframe/object/embed/meta/form/base/link, on* handlers
 *    (whitespace or `/` separators, quoted or unquoted values), and
 *    javascript:/vbscript:/non-image data: URLs; fail on unbalanced
 *    script/iframe/object (defence in depth with CSP + form-action).
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

  // Rewrite or strip <a href=…>…</a> (whitespace or `/` after tag name;
  // quoted or unquoted href).
  html = html.replace(
    /<a[\s/]+([^>]*?)href=(?:"([^"]*)"|'([^']*)'|([^\s>]+))([^>]*)>([\s\S]*?)<\/a>/gi,
    (full, pre, dHref, sHref, uHref, post, inner) => {
      const href =
        dHref !== undefined ? dHref : sHref !== undefined ? sHref : uHref;
      if (
        ABSOLUTE_URI_SCHEME_RE.test(href) ||
        href.startsWith('//') ||
        href.startsWith('#')
      ) {
        return full;
      }
      const rewritten = tryRewriteMdLink(href);
      if (rewritten !== null) {
        const q = dHref !== undefined ? '"' : sHref !== undefined ? "'" : '"';
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
  // `/` is a valid attribute separator (not only whitespace); src/alt may be
  // unquoted.
  html = html.replace(
    /<img[\s/]+([^>]*?)src=(?:"([^"]*)"|'([^']*)'|([^\s>]+))([^>]*?)\/?>/gi,
    (full, pre, dSrc, sSrc, uSrc, post) => {
      const src = dSrc !== undefined ? dSrc : sSrc !== undefined ? sSrc : uSrc;
      const decodedSrc = decodeHtmlEntities(src).split('#')[0].split('?')[0];
      const altMatch = full.match(/\balt=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const alt = altMatch
        ? altMatch[1] !== undefined
          ? altMatch[1]
          : altMatch[2] !== undefined
            ? altMatch[2]
            : altMatch[3]
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
  // Content + metadata: optional HANDBOOK_DATA_DIR (tests) else next to this script.
  // Pod assets always stay next to build.js (vendored fonts/tokens).
  const handbookDir = process.env.HANDBOOK_DATA_DIR
    ? path.resolve(process.env.HANDBOOK_DATA_DIR)
    : scriptDir;
  const repoRoot = process.env.HANDBOOK_REPO_ROOT
    ? path.resolve(process.env.HANDBOOK_REPO_ROOT)
    : path.resolve(scriptDir, '../..');
  const outDir = path.resolve(outArg);
  sanitizeDocHtml._outDir = outDir;
  const gitSha = process.env.GIT_SHA || process.env.HANDBOOK_GIT_SHA || 'unknown';

  prepareOutputDir(outDir, repoRoot);

  const metadataPath = path.join(handbookDir, 'metadata.json');
  let metadata = {};
  if (fs.existsSync(metadataPath)) {
    metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  }
  const screenshotsMeta =
    (metadata && metadata.screenshots && typeof metadata.screenshots === 'object'
      ? metadata.screenshots
      : {}) || {};
  const docsMeta = (metadata && metadata.docs) || {};

  const pod = loadPodAssets(scriptDir);
  const logoDark = prepareInlineLogo(pod.logoDark, 'logo-dark');
  const logoWhite = prepareInlineLogo(pod.logoWhite, 'logo-white');

  const contentLoad = loadContentLocales(handbookDir);
  const contentLocales = contentLoad.locales;
  if (contentLocales.length < MIN_CONTENT_LOCALES) {
    const fileList =
      contentLoad.files.length === 0
        ? '(none)'
        : contentLoad.files.join(', ');
    fail(
      `handbook floor guard: found ${contentLocales.length} content locales, ` +
        `need at least MIN_CONTENT_LOCALES=${MIN_CONTENT_LOCALES}. ` +
        `path=${contentLoad.contentDir} files=[${fileList}]`,
    );
  }

  const artifacts = [];
  const screenshotEntries = [];

  // Source A — Screenshots
  const screenshotsRoot = path.join(repoRoot, SOURCE_SCREENSHOTS_REL);
  const screenshotPngs = listPngRecursive(screenshotsRoot);
  for (const { abs, relPosix } of screenshotPngs) {
    assertValidPng(abs);
    const dirPart = path.posix.dirname(relPosix);
    const group = !dirPart || dirPart === '.' ? 'allgemein' : dirPart;
    const filename = path.posix.basename(relPosix);
    const relOut = path.posix.join('screenshots', relPosix);
    const stem = titleFromFilename(filename);
    const entry = {
      category: 'screenshot',
      outputPath: relOut,
      sourcePath: path.posix.join(SOURCE_SCREENSHOTS_REL, relPosix),
      title: stem,
      stem,
      group,
      key: group + '/' + stem,
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

  const shotByKey = new Map();
  for (const e of screenshotEntries) {
    shotByKey.set(e.key, e);
  }
  const shotsByGroup = new Map();
  for (const e of screenshotEntries) {
    if (!shotsByGroup.has(e.group)) shotsByGroup.set(e.group, []);
    shotsByGroup.get(e.group).push(e);
  }
  for (const list of shotsByGroup.values()) {
    list.sort((a, b) => sortStrings(a.title, b.title));
  }

  // Source B — Markdown docs
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
        `need at least MIN_DOCS=${MIN_DOCS}.`,
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

  // Source C — Store
  const androidMetaRoot = path.join(repoRoot, SOURCE_ANDROID_META_REL);
  const iosMetaRoot = path.join(repoRoot, SOURCE_IOS_META_REL);
  if (!fs.existsSync(androidMetaRoot)) {
    fail(`handbook: missing Android store-metadata root ${androidMetaRoot}`);
  }
  if (!fs.existsSync(iosMetaRoot)) {
    fail(`handbook: missing iOS store-metadata root ${iosMetaRoot}`);
  }

  const storeEntries = [];
  {
    const locales = localeDirsUnder(androidMetaRoot, SOURCE_ANDROID_META_REL);
    for (const locale of locales) {
      const localeAbs = path.join(androidMetaRoot, locale);
      const localeRel = path.posix.join(SOURCE_ANDROID_META_REL, locale);
      for (const f of collectStoreFields(localeAbs, localeRel)) {
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
  {
    const iosRootRel = SOURCE_IOS_META_REL;
    const entries = fs
      .readdirSync(iosMetaRoot, { withFileTypes: true })
      .slice()
      .sort((a, b) => sortStrings(a.name, b.name));
    const globalFields = [];
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
      for (const f of collectStoreFields(localeAbs, localeRel)) {
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
        `need at least MIN_STORE_FIELDS=${MIN_STORE_FIELDS}.`,
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

  // Source D — Assets
  const assetSpecs = [];
  const dfxDir = path.join(repoRoot, SOURCE_DFX_ASSETS_REL);
  for (const { abs, relPosix } of listPngRecursive(dfxDir)) {
    assertValidPng(abs, MIN_ASSET_PNG_BYTES);
    assetSpecs.push({
      abs,
      src: path.posix.join(SOURCE_DFX_ASSETS_REL, relPosix),
      out: path.posix.join('assets/dfx', relPosix),
      title: path.posix.basename(relPosix),
    });
  }
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
        `need at least MIN_ASSETS=${MIN_ASSETS}.`,
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

  // Early collision check (screenshots/docs/store/assets) — before marked render
  // so floor/collision tests need no markdown dependency.
  assertNoOutputCollisions(artifacts);

  // Write binary assets
  for (const entry of screenshotEntries) {
    copyFile(entry._abs, path.join(outDir, ...entry.outputPath.split('/')));
    delete entry._abs;
  }
  for (const a of assetSpecs) {
    copyFile(a.abs, path.join(outDir, a.out));
  }
  // Fonts
  for (const f of pod.fonts) {
    const dest = path.join(outDir, 'assets', 'fonts', f);
    copyFile(path.join(pod.fontDir, f), dest);
    artifacts.push({
      category: 'asset',
      outputPath: path.posix.join('assets/fonts', f),
      sourcePath: path.posix.join('scripts/handbook/pod/fonts', f),
      title: f,
      group: null,
    });
  }

  // Orphan metadata warnings
  for (const key of Object.keys(screenshotsMeta).sort(sortStrings)) {
    if (!shotsByGroup.has(key)) {
      console.error(
        `handbook warning: metadata.json screenshots entry "${key}" has no matching screenshots (orphan).`,
      );
    }
  }
  for (const key of Object.keys(screenshotsMeta).sort(sortStrings)) {
    const meta = screenshotsMeta[key];
    if (!meta || !meta.captions || typeof meta.captions !== 'object') continue;
    const fileStems = new Set((shotsByGroup.get(key) || []).map((e) => e.stem));
    for (const stem of Object.keys(meta.captions).sort(sortStrings)) {
      if (!fileStems.has(stem)) {
        console.error(
          `handbook warning: metadata.json screenshots.${key}.captions entry "${stem}" has no matching screenshot (orphan).`,
        );
      }
    }
  }
  const discoveredDocSet = new Set(discoveredDocs);
  for (const key of Object.keys(docsMeta).sort(sortStrings)) {
    if (!discoveredDocSet.has(key)) {
      console.error(
        `handbook warning: metadata.json docs entry "${key}" has no matching document (orphan).`,
      );
    }
  }

  // Resolve chapter assignment (same structure all locales — check once on de or first)
  function resolveChapters(content) {
    const assignment = new Map(); // key -> chapterId
    const chapterPlans = [];
    function claimKey(k, id) {
      if (assignment.has(k)) {
        fail(
          `handbook chapter collision: screenshot "${k}" is assigned to both ` +
            `chapter "${assignment.get(k)}" and chapter "${id}"`,
        );
      }
      assignment.set(k, id);
    }
    for (const ch of content.chapters) {
      const id = ch.id || slugify(ch.title || 'chapter');
      const seen = new Set();
      // Single images first (no group heading); then full groups (with heading).
      const imageKeys = [];
      for (const img of ch.images || []) {
        if (!shotByKey.has(img)) {
          console.error(
            `handbook warning: chapter "${id}" references missing image "${img}"`,
          );
          continue;
        }
        if (seen.has(img)) continue;
        seen.add(img);
        imageKeys.push(img);
        claimKey(img, id);
      }
      const groupBlocks = [];
      for (const g of ch.groups || []) {
        const list = (shotsByGroup.get(g) || []).slice();
        if (list.length === 0) {
          console.error(
            `handbook warning: chapter "${id}" references missing group "${g}"`,
          );
          continue;
        }
        const keys = [];
        for (const e of list) {
          if (seen.has(e.key)) continue;
          seen.add(e.key);
          keys.push(e.key);
          claimKey(e.key, id);
        }
        if (keys.length > 0) {
          groupBlocks.push({ group: g, keys });
        }
      }
      const ordered = imageKeys.concat(
        groupBlocks.reduce((acc, b) => acc.concat(b.keys), []),
      );
      chapterPlans.push({
        id,
        title: ch.title || id,
        summary: ch.summary || '',
        intro: ch.intro || '',
        keys: ordered,
        imageKeys,
        groupBlocks,
      });
    }
    // Unassigned → more screens (cluster by directory; show group headings)
    const unassigned = screenshotEntries
      .map((e) => e.key)
      .filter((k) => !assignment.has(k))
      .sort(sortStrings);
    if (unassigned.length) {
      for (const k of unassigned) {
        console.error(
          `handbook warning: screenshot "${k}" is not assigned to any chapter; ` +
            `placing under moreScreens`,
        );
        assignment.set(k, '__more__');
      }
      const groupBlocks = [];
      let i = 0;
      while (i < unassigned.length) {
        const e0 = shotByKey.get(unassigned[i]);
        const g = e0 ? e0.group : 'allgemein';
        const keys = [];
        while (i < unassigned.length) {
          const e = shotByKey.get(unassigned[i]);
          if (!e || e.group !== g) break;
          keys.push(e.key);
          i += 1;
        }
        groupBlocks.push({ group: g, keys });
      }
      chapterPlans.push({
        id: 'more-screens',
        title: content.ui.moreScreens || 'More screens',
        summary: '',
        intro: '',
        keys: unassigned,
        imageKeys: [],
        groupBlocks,
        isMore: true,
      });
    }
    return { chapterPlans, assignment };
  }

  function uiLabel(ui, key, fallback) {
    if (ui && typeof ui[key] === 'string' && ui[key].trim()) {
      return ui[key].trim();
    }
    console.error(
      `handbook warning: missing ui.${key} in content locale, using fallback "${fallback}"`,
    );
    return fallback;
  }

  // Developer sections HTML (locale-independent content; labels localized)
  function buildDeveloperBody(ui) {
    let sectionsHtml = '';
    let sectionNum = 0;
    const tocItems = [];

    function pushSection(id, title, countLabel, intro, bodyHtml) {
      sectionNum += 1;
      const n = String(sectionNum).padStart(2, '0');
      tocItems.push({ id, n, title });
      const countHtml = countLabel
        ? `<b class="sec-count" data-sec-count="${escapeHtml(id)}">${escapeHtml(countLabel)}</b>`
        : '';
      sectionsHtml +=
        `<details class="spec" id="${escapeHtml(id)}">` +
        `<summary><div class="spec-head"><div class="lhs">` +
        `<h2><span class="badge">${escapeHtml(n)}</span>${escapeHtml(title)}${svgChevron()}</h2>` +
        `</div><div class="rhs">${countHtml}</div></div></summary>` +
        (intro ? `<p class="spec-intro">${intro}</p>` : '') +
        bodyHtml +
        `</details>`;
    }

    // Store
    {
      const byPlatform = new Map();
      for (const s of storeEntries) {
        if (!byPlatform.has(s.platform)) byPlatform.set(s.platform, new Map());
        const byLocale = byPlatform.get(s.platform);
        if (!byLocale.has(s.locale)) byLocale.set(s.locale, []);
        byLocale.get(s.locale).push(s);
      }
      let storeBody = '';
      for (const platform of ['android', 'ios']) {
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
          const fields = byLocale
            .get(locale)
            .slice()
            .sort((a, b) => sortStrings(a.field, b.field));
          storeBody +=
            `<div class="store-locale"><h4><span class="locale-chip">${escapeHtml(locale)}</span></h4><dl>`;
          for (const f of fields) {
            const empty = !f.content;
            const searchText = escapeHtml(
              [f.field, f.content, locale, platform].join(' '),
            );
            storeBody +=
              `<div class="store-row" data-search="store-field" data-search-text="${searchText}">` +
              `<dt>${escapeHtml(f.field)}</dt>` +
              `<dd class="${empty ? 'empty' : ''}">${
                empty ? '—' : escapeHtml(f.content)
              }</dd></div>`;
          }
          storeBody += '</dl></div>';
        }
        storeBody += '</div>';
      }
      pushSection(
        'store-listing',
        uiLabel(ui, 'devStore', 'Store texts'),
        `${storeEntries.length}`,
        '',
        storeBody,
      );
    }

    // Assets
    {
      let ag = '<div class="asset-grid">';
      for (const a of assetSpecs) {
        const assetHref = escapeHtml(encodeHtmlPath(a.out));
        ag +=
          `<div class="asset-card"><a href="__PREFIX__${assetHref}">` +
          `<div class="frame"><img src="__PREFIX__${assetHref}" alt="${escapeHtml(a.title)}" loading="lazy"></div>` +
          `<div class="an">${escapeHtml(a.title)}</div></a></div>`;
      }
      ag += '</div>';
      pushSection(
        'assets',
        uiLabel(ui, 'devAssets', 'App image files'),
        `${assetSpecs.length}`,
        '',
        ag,
      );
    }

    // Docs
    {
      let docsBody = '<ul class="doc-list">';
      const sortedDocs = renderedDocs
        .slice()
        .sort((a, b) => sortStrings(a.title, b.title));
      for (const d of sortedDocs) {
        const searchText = escapeHtml([d.title, d.src].join(' '));
        docsBody +=
          `<li data-search="doc" data-search-text="${searchText}">` +
          `<a href="__PREFIX__${escapeHtml(encodeHtmlPath(d.out))}">` +
          `<span><span class="doc-title">${escapeHtml(d.title)}</span> ` +
          `<span class="doc-path">${escapeHtml(d.src)}</span></span>` +
          `<span class="chev" aria-hidden="true">›</span></a></li>`;
      }
      docsBody += '</ul>';
      pushSection(
        'documentation',
        uiLabel(ui, 'devDocs', 'Technical documentation'),
        `${renderedDocs.length}`,
        '',
        docsBody,
      );
    }

    return { sectionsHtml, tocItems };
  }

  // Docs render first so relative paths exist for integrity during sanitize
  const renderedDocs = [];
  for (const d of docSpecs) {
    const src = path.join(repoRoot, d.src);
    if (!fs.existsSync(src)) fail(`handbook: missing markdown source ${d.src}`);
    const md = fs.readFileSync(src, 'utf8');
    let body = markedParse(md);
    body = sanitizeDocHtml(body, d.out, discoveredMdToOut);
    body = enhanceDocBodyHtml(body);
    const prefix = relativeToRoot(d.out);
    const css = buildPageCss(pod.tokensCss, prefix);
    // de content for doc chrome labels if available
    const deContent =
      contentLocales.find((c) => c.locale === 'de') || contentLocales[0];
    const page =
      buildHead({
        title: d.title + ' — DFX BTC Taro Wallet',
        description: d.title + ' — DFX BTC Taro Wallet',
        prefix,
        css,
        lang: 'de',
        themeClass: 'theme-light',
        scriptSrc: prefix + 'handbook.js',
      }) +
      '<body>\n' +
      `<a class="skip-link" href="#doc-content">${escapeHtml(
        deContent.ui.skipToContent || 'Skip',
      )}</a>\n` +
      buildTopbar({
        prefix,
        showBack: true,
        logoDark,
        logoWhite,
        ui: deContent.ui,
        locales: contentLocales,
        currentLocale: 'de',
        homePath: 'index.html',
      }) +
      '<div class="doc-wrap">\n' +
      `<nav class="crumbs" aria-label="breadcrumb">` +
      `<a href="${escapeHtml(encodeHtmlPath(prefix + 'index.html'))}">${escapeHtml(
        deContent.ui.breadcrumbHome || 'Handbook',
      )}</a>` +
      `<span class="sep">/</span>${escapeHtml(d.title)}</nav>\n` +
      `<article class="doc-body" id="doc-content">\n${body}\n</article>\n` +
      `<footer class="footer"><code>${escapeHtml(d.src)}</code> · <code>${escapeHtml(
        gitSha,
      )}</code></footer>\n` +
      '</div>\n' +
      '</body>\n</html>\n';
    const dest = path.join(outDir, d.out);
    ensureDir(path.dirname(dest));
    fs.writeFileSync(dest, page, 'utf8');
    renderedDocs.push({ ...d, body });
  }

  // handbook.js once
  const handbookJs = buildHandbookJs();
  fs.writeFileSync(path.join(outDir, 'handbook.js'), handbookJs, 'utf8');
  artifacts.push({
    category: 'asset',
    outputPath: 'handbook.js',
    sourcePath: 'scripts/handbook/build.js',
    title: 'handbook.js',
    group: null,
  });

  // Hreflang map
  function pagePathForLocale(locale) {
    return locale === 'de' ? 'index.html' : locale + '/index.html';
  }

  const shaShort =
    gitSha === 'unknown' ? 'unknown' : gitSha.length > 12 ? gitSha.slice(0, 12) : gitSha;

  // Chapter assignment is identical across locales (same groups/images ids);
  // resolve once so orphan warnings fire once, then overlay locale titles.
  const structureContent =
    contentLocales.find((c) => c.locale === 'de') || contentLocales[0];
  const { chapterPlans: baseChapterPlans } = resolveChapters(structureContent);

  // Generate each locale page
  for (const content of contentLocales) {
    // Rebuild chapter plans with this locale's titles/intros by id.
    const byId = new Map(
      (content.chapters || []).map((ch) => [ch.id || slugify(ch.title || ''), ch]),
    );
    // Warn when plan chapter ids and locale chapter ids diverge (both directions).
    for (const plan of baseChapterPlans) {
      if (plan.isMore) continue;
      if (!byId.has(plan.id)) {
        console.error(
          `handbook warning: chapter id "${plan.id}" missing in content ` +
            `locale "${content.locale}"; using structure-language title`,
        );
      }
    }
    for (const id of byId.keys()) {
      if (!baseChapterPlans.some((p) => p.id === id)) {
        console.error(
          `handbook warning: content locale "${content.locale}" defines ` +
            `chapter id "${id}" which is not in the chapter plan; it is ignored`,
        );
      }
    }
    const chapterPlans = baseChapterPlans.map((plan) => {
      if (plan.isMore) {
        return Object.assign({}, plan, {
          title: content.ui.moreScreens || plan.title,
        });
      }
      const src = byId.get(plan.id);
      if (!src) return plan;
      return Object.assign({}, plan, {
        title: src.title || plan.title,
        summary: src.summary || '',
        intro: src.intro || '',
      });
    });
    const prefix = content.locale === 'de' ? '' : '../';
    const outPath = pagePathForLocale(content.locale);
    const ui = content.ui;
    const anchorIds = new Map();

    // captions for this locale
    function captionFor(entry) {
      const cc = content.captions[entry.key];
      return deriveScreenshotCaption(
        entry.stem + '.png',
        screenshotsMeta[entry.group],
        cc,
      );
    }

    /**
     * Group title: content.groupTitles[g] → metadata.json → directory name.
     * When the title is shown (showHeading), warn once per group+locale if the
     * locale file did not provide groupTitles[g].
     */
    function resolveGroupTitle(groupKey, locContent, showHeading) {
      const titles = locContent.groupTitles || {};
      const fromLocale = titles[groupKey];
      if (typeof fromLocale === 'string' && fromLocale.trim()) {
        return fromLocale.trim();
      }
      const gMeta = screenshotsMeta[groupKey];
      if (gMeta && typeof gMeta.title === 'string' && gMeta.title.trim()) {
        if (showHeading) {
          console.error(
            `handbook warning: missing groupTitles["${groupKey}"] in locale ` +
              `"${locContent.locale}", using metadata.json title`,
          );
        }
        return gMeta.title.trim();
      }
      if (showHeading) {
        console.error(
          `handbook warning: missing groupTitles["${groupKey}"] in locale ` +
            `"${locContent.locale}", using directory name`,
        );
      }
      return groupKey;
    }

    let chaptersHtml = '';
    const tocItems = [];
    let chapterNum = 0;

    function renderShotCard(e, gTitle) {
      const cap = captionFor(e);
      const cardId = claimAnchorId(
        anchorIds,
        'shot-' + slugify(e.group + '-' + e.title),
        e.sourcePath,
      );
      const shotHref = escapeHtml(encodeHtmlPath(prefix + e.outputPath));
      const searchText = escapeHtml(
        [cap.caption, cap.text, e.stem, gTitle, e.group].join(' '),
      );
      const badgeHtml = cap.badge
        ? `<span class="num-badge">${escapeHtml(cap.badge)}</span>`
        : '';
      const textHtml = cap.text
        ? `<p class="cap-text">${escapeHtml(cap.text)}</p>`
        : '';
      return (
        `<figure class="shot-card" id="${escapeHtml(cardId)}" data-search="shot" ` +
        `data-search-text="${searchText}" data-group="${escapeHtml(e.group)}" ` +
        `data-caption="${escapeHtml(cap.caption)}" data-file="${escapeHtml(e.stem)}">` +
        `<a class="shot-img" href="${shotHref}">` +
        `<div class="frame"><img src="${shotHref}" alt="${escapeHtml(cap.caption)}" loading="lazy"></div>` +
        `</a>` +
        `<figcaption><div class="cap-row">${badgeHtml}` +
        `<a class="name permalink" href="#${escapeHtml(cardId)}">${escapeHtml(cap.caption)}</a>` +
        copyLinkButton(cardId, ui) +
        `</div>${textHtml}</figcaption></figure>`
      );
    }

    for (const plan of chapterPlans) {
      chapterNum += 1;
      const n = String(chapterNum).padStart(2, '0');
      const chapterAnchor = claimAnchorId(
        anchorIds,
        'chapter-' + slugify(plan.id),
        'chapter ' + plan.id,
      );
      const children = [];
      let body = '';

      // Single-image assignments: no group heading (B3).
      const imageKeys = plan.imageKeys || [];
      if (imageKeys.length > 0) {
        body += `<div class="group-block" data-search="group">`;
        body += '<div class="shot-grid">';
        for (const k of imageKeys) {
          const e = shotByKey.get(k);
          if (!e) continue;
          body += renderShotCard(e, e.group);
        }
        body += '</div></div>';
      }

      // Full groups via chapters[].groups.
      // Heading only when the chapter has more than one group (or moreScreens).
      // Single-group chapters: no heading/description; keep group anchor + copy.
      const groupBlocks = plan.groupBlocks || [];
      const showGroupHeadings = groupBlocks.length > 1 || !!plan.isMore;
      // Single-group: hang group copy on the chapter chrome (not a second title).
      let singleGroupCopyHtml = '';

      for (const block of groupBlocks) {
        const g = block.group;
        const groupKeysList = block.keys
          .map((k) => shotByKey.get(k))
          .filter(Boolean);
        if (groupKeysList.length === 0) continue;
        const groupId = claimAnchorId(
          anchorIds,
          'group-' + slugify(g),
          'screenshot group ' + g,
        );
        const gTitle = resolveGroupTitle(g, content, showGroupHeadings);

        if (showGroupHeadings) {
          children.push({
            id: groupId,
            title: gTitle,
            count: groupKeysList.length,
          });
          body += `<div class="group-block" data-search="group">`;
          body +=
            `<div class="group-head">` +
            `<h3 id="${escapeHtml(groupId)}">` +
            `<a class="name permalink" href="#${escapeHtml(groupId)}">${escapeHtml(gTitle)}</a>` +
            ` <span class="gcount">${groupKeysList.length} ${escapeHtml(
              groupKeysList.length === 1
                ? uiLabel(ui, 'image', 'image')
                : uiLabel(ui, 'images', 'images'),
            )}</span>` +
            `</h3>` +
            copyLinkButton(groupId, ui) +
            `</div>`;
          // Customer pages: never show metadata group descriptions (one language).
          body += '<div class="shot-grid">';
          for (const e of groupKeysList) {
            body += renderShotCard(e, gTitle);
          }
          body += '</div></div>';
        } else {
          // One group only: attach anchor to the chapter (span + copy in chapter rhs).
          // No visible group title, no group description, no TOC child.
          singleGroupCopyHtml =
            `<span id="${escapeHtml(groupId)}" class="group-anchor"></span>` +
            copyLinkButton(groupId, ui);
          body += `<div class="group-block" data-search="group">`;
          body += '<div class="shot-grid">';
          for (const e of groupKeysList) {
            body += renderShotCard(e, gTitle);
          }
          body += '</div></div>';
        }
      }

      tocItems.push({
        id: chapterAnchor,
        n,
        title: plan.title,
        children,
      });

      // Customer chapters: no image-count line under the title (owner: redundant).
      chaptersHtml +=
        `<details class="spec" id="${escapeHtml(chapterAnchor)}" open>` +
        `<summary><div class="spec-head"><div class="lhs">` +
        `<h2><span class="badge">${escapeHtml(n)}</span>${escapeHtml(plan.title)}${svgChevron()}</h2>` +
        `</div><div class="rhs">${singleGroupCopyHtml}</div></div></summary>` +
        (plan.summary
          ? `<p class="chapter-summary">${escapeHtml(plan.summary)}</p>`
          : '') +
        (plan.intro ? `<p class="spec-intro">${escapeHtml(plan.intro)}</p>` : '') +
        body +
        `</details>`;
    }

    // Developer section (docs / store / assets / revision tiles live here, not in the hero)
    const dev = buildDeveloperBody(ui);
    let devHtml = dev.sectionsHtml.split('__PREFIX__').join(prefix);
    const devStatsHtml =
      `<div class="stats" role="group">` +
      `<div class="stat"><span class="n">${renderedDocs.length}</span><span class="l">${escapeHtml(
        uiLabel(ui, 'statDocs', 'Docs'),
      )}</span></div>` +
      `<div class="stat"><span class="n">${storeEntries.length}</span><span class="l">${escapeHtml(
        uiLabel(ui, 'statStore', 'Store'),
      )}</span></div>` +
      `<div class="stat"><span class="n">${assetSpecs.length}</span><span class="l">${escapeHtml(
        uiLabel(ui, 'statAssets', 'Assets'),
      )}</span></div>` +
      `<div class="stat stat-sha"><span class="n">${escapeHtml(
        shaShort,
      )}</span><span class="l">${escapeHtml(
        uiLabel(ui, 'statRevision', 'SHA'),
      )}</span></div>` +
      `</div>`;
    const devTocId = 'developer';
    const devSection =
      `<details class="spec" id="${escapeHtml(devTocId)}">` +
      `<summary><div class="spec-head"><div class="lhs">` +
      `<h2><span class="badge">${escapeHtml(String(chapterNum + 1).padStart(2, '0'))}</span>` +
      `${escapeHtml(ui.developerSection || 'Developer')}${svgChevron()}</h2>` +
      `</div></div></summary>` +
      (ui.developerIntro
        ? `<p class="spec-intro">${escapeHtml(ui.developerIntro)}</p>`
        : '') +
      devStatsHtml +
      devHtml +
      `</details>`;
    tocItems.push({
      id: devTocId,
      n: String(chapterNum + 1).padStart(2, '0'),
      title: ui.developerSection || 'Developer',
      children: [],
    });

    assertNoAnchorCollisions(anchorIds);

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

    const hreflangs = contentLocales.map((loc) => ({
      lang: loc.locale,
      href: encodeHtmlPath(
        (content.locale === 'de' ? '' : '../') + pagePathForLocale(loc.locale),
      ),
    }));
    hreflangs.push({
      lang: 'x-default',
      href: encodeHtmlPath(
        (content.locale === 'de' ? '' : '../') + 'index.html',
      ),
    });

    const css = buildPageCss(pod.tokensCss, prefix);
    const homePath = 'index.html';

    const page =
      buildHead({
        title: content.meta.title || 'BTC Taro Wallet',
        description: content.meta.description || '',
        prefix,
        css,
        lang: content.locale,
        themeClass: 'theme-light',
        hreflangs,
        scriptSrc: prefix + 'handbook.js',
      }) +
      '<body>\n' +
      `<a class="skip-link" href="#main-content">${escapeHtml(
        ui.skipToContent || 'Skip',
      )}</a>\n` +
      buildTopbar({
        prefix,
        showSearch: true,
        showSidebarToggle: true,
        logoDark,
        logoWhite,
        ui,
        locales: contentLocales,
        currentLocale: content.locale,
        homePath,
      }) +
      '\n<div class="wrap">\n' +
      `<aside class="sidebar" id="handbook-sidebar">\n` +
      `<div class="sidebar-panel">\n` +
      `<div class="toc-label">${escapeHtml(ui.contents || 'Contents')}</div>\n` +
      `<nav class="toc" aria-label="${escapeHtml(ui.contents || 'Contents')}">${tocHtml}</nav>\n` +
      `<div class="toc-actions" id="toc-actions" hidden>` +
      `<button type="button" id="toc-expand-all">${escapeHtml(
        ui.expandAll || 'Expand',
      )}</button>` +
      `<button type="button" id="toc-collapse-all">${escapeHtml(
        ui.collapseAll || 'Collapse',
      )}</button>` +
      `</div>\n</div></aside>\n` +
      `<main id="main-content">\n` +
      `<header class="hero">\n` +
      `<h1>${escapeHtml(content.meta.title || 'BTC Taro Wallet')}</h1>\n` +
      (content.meta.lede
        ? `<p class="lede">${escapeHtml(content.meta.lede)}</p>\n`
        : '') +
      `<div class="search-empty" id="search-empty" hidden>${escapeHtml(
        ui.searchEmpty || '',
      )}</div>\n` +
      `</header>\n` +
      chaptersHtml +
      devSection +
      `<footer class="footer">${escapeHtml(ui.generatedFrom || '')} ` +
      `<code>${escapeHtml(gitSha)}</code></footer>\n` +
      `</main>\n</div>\n` +
      `<div class="lightbox" id="lightbox" hidden role="dialog" aria-modal="true" aria-label="${escapeHtml(
        ui.openImage || 'Image',
      )}">` +
      `<div class="lightbox-dialog"><div class="lightbox-bar"><div class="lightbox-meta">` +
      `<p class="lightbox-title" id="lightbox-title"></p>` +
      `<p class="lightbox-count" id="lightbox-count" data-template="${escapeHtml(        ui.imageCounter || '{n} / {total}',
      )}"></p>` +
      `</div>` +
      `<button type="button" class="icon-btn" id="lightbox-close" aria-label="${escapeHtml(
        ui.close || 'Close',
      )}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M6.4 5.3a.75.75 0 0 0-1.1 1.1L10.9 12l-5.6 5.6a.75.75 0 1 0 1.1 1.1L12 13.1l5.6 5.6a.75.75 0 1 0 1.1-1.1L13.1 12l5.6-5.6a.75.75 0 1 0-1.1-1.1L12 10.9 6.4 5.3z"/></svg></button></div>` +
      `<div class="lightbox-body">` +
      `<button type="button" class="lightbox-arrow" id="lightbox-prev" aria-label="${escapeHtml(
        ui.previous || 'Prev',
      )}"><span class="label-short" aria-hidden="true">‹</span><span class="label-full">${escapeHtml(
        ui.previous || 'Prev',
      )}</span></button>` +
      `<div class="lightbox-stage"><img id="lightbox-img" alt=""></div>` +
      `<button type="button" class="lightbox-arrow" id="lightbox-next" aria-label="${escapeHtml(
        ui.next || 'Next',
      )}"><span class="label-short" aria-hidden="true">›</span><span class="label-full">${escapeHtml(
        ui.next || 'Next',
      )}</span></button>` +
      `</div></div></div>\n` +
      `</body>\n</html>\n`;

    // Function form: escapeHtml may yield $' / $& which String.replace would treat
    // as replacement patterns when the second argument is a string.
    const searchStatusNeedle =
      'id="search-status" role="status" aria-live="polite" hidden>';
    const searchStatusReplacement =
      `id="search-status" role="status" aria-live="polite" hidden data-template="${escapeHtml(
        ui.searchStatus || '{n} / {total}',
      )}">`;
    const pageFinal = page.replace(searchStatusNeedle, () => searchStatusReplacement);

    const dest = path.join(outDir, outPath);
    ensureDir(path.dirname(dest));
    fs.writeFileSync(dest, pageFinal, 'utf8');
    artifacts.push({
      category: 'page',
      outputPath: outPath,
      sourcePath: content.sourcePath || 'scripts/handbook/content',
      title: content.meta.title || content.locale,
      group: content.locale,
    });
  }

  // Collision check after fonts, handbook.js and locale pages are on the list.
  assertNoOutputCollisions(artifacts);

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
      pages: contentLocales.length,
    },
  };
  fs.writeFileSync(
    path.join(outDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  );

  for (const a of artifacts) {
    const full = path.join(outDir, a.outputPath);
    if (!fs.existsSync(full)) {
      fail(
        `handbook integrity check failed (manifest): missing ${a.outputPath}` +
          ` (sourcePath=${a.sourcePath}, title=${a.title})`,
      );
    }
  }

  for (const d of renderedDocs) {
    const html = fs.readFileSync(path.join(outDir, d.out), 'utf8');
    const refs = collectRelativeRefs(html);
    for (const rawRef of refs) {
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

  // Integrity for locale pages
  for (const content of contentLocales) {
    const outPath = pagePathForLocale(content.locale);
    const html = fs.readFileSync(path.join(outDir, outPath), 'utf8');
    const refs = collectRelativeRefs(html);
    for (const rawRef of refs) {
      const ref = decodeHtmlPath(rawRef);
      const underOut = path.join(path.dirname(path.join(outDir, outPath)), ref);
      if (
        !ref.startsWith('/') &&
        !fs.existsSync(underOut) &&
        !fs.existsSync(path.join(outDir, ref))
      ) {
        fail(`handbook integrity check failed (${outPath}): missing ${ref}`);
      }
    }
  }

  console.error(
    `handbook: wrote ${screenshotEntries.length} screenshots, ` +
      `${renderedDocs.length} docs, ${storeEntries.length} store fields, ` +
      `${assetSpecs.length} assets, ${contentLocales.length} pages → ${outDir}`,
  );
}

// Extend copyLinkButton for UI labels
function copyLinkButton(anchorId, ui) {
  ui = ui || {};
  return (
    `<button class="copy-link" type="button" ` +
    `data-target="${escapeHtml(anchorId)}" ` +
    `data-copied-label="${escapeHtml(ui.copied || 'OK')}" ` +
    `data-failed-label="${escapeHtml(ui.copyFailed || 'X')}" ` +
    `title="${escapeHtml(ui.copyLink || 'Copy link')}" ` +
    `aria-label="${escapeHtml(ui.copyLink || 'Copy link')}">` +
    `\u{1F517}</button>`
  );
}

main();
