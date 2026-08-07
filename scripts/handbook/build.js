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
const MIN_SCREENSHOTS = 35;
const MIN_DOCS = 8;
const MIN_STORE_FIELDS = 12;
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

const SORT_LOCALE = 'en';

function sortStrings(a, b) {
  return a.localeCompare(b, SORT_LOCALE);
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

function slugify(key) {
  return (
    String(key)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'item'
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

  // Strip unresolved <img src="..."> — keep alt text if present.
  html = html.replace(
    /<img\s+([^>]*?)src=(?:"([^"]*)"|'([^']*)')([^>]*?)\/?>/gi,
    (full, pre, dSrc, sSrc, post) => {
      const src = dSrc !== undefined ? dSrc : sSrc;
      if (
        ABSOLUTE_URI_SCHEME_RE.test(src) ||
        src.startsWith('//') ||
        src.startsWith('#')
      ) {
        return full;
      }
      if (targetExists(src)) return full;
      logOnce(decodeHtmlEntities(src).split('#')[0].split('?')[0]);
      const altMatch = full.match(/\balt=(?:"([^"]*)"|'([^']*)')/i);
      const alt = altMatch
        ? altMatch[1] !== undefined
          ? altMatch[1]
          : altMatch[2]
        : '';
      return alt ? escapeHtml(decodeHtmlEntities(alt)) : '';
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
    const locales = fs
      .readdirSync(androidMetaRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name)
      .sort(sortStrings);
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

    const locales = entries
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name)
      .sort(sortStrings);
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
    const page =
      '<!DOCTYPE html>\n<html lang="de">\n<head>\n<meta charset="utf-8">\n' +
      `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
      `<title>${escapeHtml(d.title)} — DFX BTC Taro Wallet Handbuch</title>\n` +
      '<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;' +
      'max-width:860px;margin:32px auto;padding:0 20px;line-height:1.55;color:#0a1f33;}' +
      'pre{overflow:auto;background:#f3f4f7;padding:12px;border-radius:6px;}' +
      'code{font-family:SF Mono,Menlo,Consolas,monospace;font-size:0.9em;}' +
      'img{max-width:100%;height:auto;}a{color:#0A355C;}</style>\n</head>\n<body>\n' +
      body +
      '\n</body>\n</html>\n';
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
  // Symmetric orphan warning for docs title overrides without a discovered file.
  const discoveredDocSet = new Set(discoveredDocs);
  for (const key of Object.keys(docsMeta).sort(sortStrings)) {
    if (!discoveredDocSet.has(key)) {
      console.error(
        `handbook warning: metadata.json docs entry "${key}" has no matching document (orphan).`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Build index.html
  // -------------------------------------------------------------------------
  const css = `
      :root {
        --bg: #e8eef5;
        --surface: #ffffff;
        --surface-2: #f3f4f7;
        --line: #d6dbe2;
        --line-2: #b8c4d8;
        --ink: #072440;
        --ink-2: #0A355C;
        --ink-3: #65728A;
        --ink-4: #9AA5B8;
        --brand: #F5516C;
        --brand-blue: #5A81BB;
        --content-width: 960px;
      }
      * { box-sizing: border-box; }
      html { scroll-behavior: smooth; }
      body {
        margin: 0;
        background: var(--bg);
        color: var(--ink);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        font-size: 14.5px;
        line-height: 1.55;
        -webkit-font-smoothing: antialiased;
      }
      a { color: var(--brand-blue); text-decoration: none; }
      a:hover { text-decoration: underline; }
      code {
        font-family: 'SF Mono', Menlo, Consolas, monospace;
        font-size: 0.88em;
        background: var(--surface-2);
        padding: 1.5px 5px;
        border-radius: 3px;
        border: 1px solid var(--line);
        color: var(--ink);
      }
      .wrap {
        display: grid;
        grid-template-columns: 240px 1fr;
        gap: 32px;
        max-width: 1280px;
        margin: 0 auto;
        padding: 32px;
      }
      @media (max-width: 900px) {
        .wrap { grid-template-columns: 1fr; }
        aside { position: static !important; height: auto !important; }
      }
      aside {
        position: sticky;
        top: 32px;
        align-self: start;
        height: calc(100vh - 64px);
        overflow-y: auto;
        padding-right: 12px;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 600;
        font-size: 15px;
        color: var(--ink);
        margin-bottom: 4px;
      }
      .brand .dot {
        display: inline-block;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--brand);
      }
      .brand-sub {
        font-size: 12.5px;
        color: var(--ink-3);
        margin: 0 0 20px 0;
      }
      .toc-label {
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ink-4);
        margin: 18px 0 8px;
      }
      .toc ol { list-style: none; padding: 0; margin: 0; }
      .toc li { margin: 2px 0; }
      .toc a {
        display: block;
        padding: 4px 6px;
        border-radius: 3px;
        font-size: 13px;
        color: var(--ink-2);
      }
      .toc a:hover {
        background: var(--surface-2);
        text-decoration: none;
        color: var(--ink);
      }
      .toc .spec-num {
        display: inline-block;
        min-width: 22px;
        font-variant-numeric: tabular-nums;
        color: var(--ink-4);
        font-size: 11.5px;
        margin-right: 8px;
      }
      main { max-width: var(--content-width); }
      .hero h1 {
        margin: 0 0 14px 0;
        font-size: 30px;
        font-weight: 700;
        letter-spacing: -0.01em;
      }
      .lede {
        font-size: 16px;
        color: var(--ink-2);
        margin: 0 0 18px 0;
      }
      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 18px;
        font-size: 13px;
        color: var(--ink-3);
      }
      .meta b { color: var(--ink); font-weight: 600; }
      hr.sep {
        border: 0;
        border-top: 1px solid var(--line);
        margin: 48px 0;
      }
      details.spec {
        margin: 0 0 72px;
        scroll-margin-top: 24px;
      }
      details.spec > summary {
        list-style: none;
        cursor: pointer;
        user-select: none;
        padding: 6px 0 4px;
      }
      details.spec > summary::-webkit-details-marker { display: none; }
      details.spec > summary:focus-visible {
        outline: 2px solid var(--brand);
        outline-offset: 4px;
        border-radius: 4px;
      }
      details.spec > summary:hover .spec-head .lhs h2 { color: var(--brand); }
      .spec-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        gap: 24px;
        margin-bottom: 14px;
      }
      .spec-head .lhs h2 {
        margin: 0 0 4px 0;
        font-size: 22px;
        font-weight: 600;
        letter-spacing: -0.005em;
        display: inline-flex;
        align-items: baseline;
        gap: 10px;
        transition: color 0.15s;
      }
      .spec-head .lhs h2::before {
        content: '▸';
        display: inline-block;
        width: 12px;
        font-size: 14px;
        color: var(--ink-4);
        transition: transform 0.18s ease-out, color 0.15s;
        transform: translateY(-1px);
      }
      details.spec[open] .spec-head .lhs h2::before {
        transform: translateY(-1px) rotate(90deg);
        color: var(--brand);
      }
      .spec-head .lhs h2 .num {
        display: inline-block;
        min-width: 38px;
        color: var(--ink-4);
        font-variant-numeric: tabular-nums;
        font-weight: 500;
      }
      .spec-head .file {
        font-family: 'SF Mono', Menlo, Consolas, monospace;
        font-size: 12.5px;
        color: var(--ink-3);
      }
      .spec-head .rhs {
        text-align: right;
        font-size: 12.5px;
        color: var(--ink-3);
      }
      .spec-head .rhs b { color: var(--ink); font-weight: 600; }
      .spec-intro {
        color: var(--ink-2);
        margin: 14px 0 24px;
      }
      .tests {
        display: grid;
        gap: 22px;
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      }
      .test {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 8px;
        overflow: hidden;
        scroll-margin-top: 20px;
      }
      .test:target {
        outline: 2px solid var(--brand);
        outline-offset: -1px;
      }
      .test .head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        border-bottom: 1px solid var(--line);
        background: var(--surface-2);
      }
      .test .name {
        font-family: 'SF Mono', Menlo, Consolas, monospace;
        font-size: 12px;
        font-weight: 600;
        color: var(--ink);
        word-break: break-all;
      }
      .test .img {
        background: var(--surface-2);
        display: flex;
        justify-content: center;
        padding: 14px;
      }
      .test .img img {
        max-width: 100%;
        height: auto;
        border-radius: 6px;
        box-shadow: 0 2px 8px rgba(7, 36, 64, 0.12);
      }
      .callout {
        border-left: 3px solid var(--brand);
        background: rgba(245, 81, 108, 0.06);
        padding: 14px 18px;
        margin: 24px 0;
        border-radius: 0 4px 4px 0;
      }
      .callout.info {
        border-color: var(--brand-blue);
        background: rgba(90, 129, 187, 0.08);
      }
      .callout p {
        margin: 0;
        color: var(--ink-2);
        font-size: 13.5px;
      }
      .callout b { color: var(--ink); }
      .toc-actions { margin: 6px 0 16px; }
      .toc-actions button {
        appearance: none;
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 4px;
        color: var(--ink-2);
        cursor: pointer;
        font: inherit;
        font-size: 12px;
        padding: 5px 10px;
        margin-right: 6px;
        transition: background 0.15s, border-color 0.15s, color 0.15s;
      }
      .toc-actions button:hover {
        background: var(--surface-2);
        border-color: var(--line-2);
        color: var(--ink);
      }
      .asset-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        gap: 16px;
      }
      .asset-card {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 16px;
        text-align: center;
      }
      .asset-card img {
        max-width: 120px;
        max-height: 80px;
        height: auto;
      }
      .asset-card .an {
        margin-top: 10px;
        font-family: 'SF Mono', Menlo, Consolas, monospace;
        font-size: 12px;
        color: var(--ink-2);
        word-break: break-all;
      }
      .store-platform { margin-bottom: 36px; }
      .store-platform h3 {
        margin: 0 0 12px 0;
        font-size: 18px;
        color: var(--ink);
      }
      .store-locale {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 16px 18px;
        margin-bottom: 16px;
      }
      .store-locale h4 {
        margin: 0 0 12px 0;
        font-size: 14px;
        font-family: 'SF Mono', Menlo, Consolas, monospace;
        color: var(--ink-2);
      }
      .store-locale dl {
        margin: 0;
        display: grid;
        grid-template-columns: minmax(120px, 200px) 1fr;
        gap: 8px 16px;
      }
      .store-locale dt {
        font-family: 'SF Mono', Menlo, Consolas, monospace;
        font-size: 12px;
        color: var(--ink-3);
        font-weight: 600;
      }
      .store-locale dd {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        color: var(--ink);
        font-size: 13.5px;
      }
      .doc-list {
        list-style: none;
        padding: 0;
        margin: 0;
      }
      .doc-list li {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 8px;
        margin-bottom: 10px;
      }
      .doc-list a {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        color: var(--ink);
        text-decoration: none;
      }
      .doc-list a:hover {
        background: var(--surface-2);
        text-decoration: none;
      }
      .doc-list .doc-title { font-weight: 600; }
      .doc-list .doc-path {
        font-family: 'SF Mono', Menlo, Consolas, monospace;
        font-size: 12px;
        color: var(--ink-3);
      }
      .footer {
        margin-top: 48px;
        padding-top: 24px;
        border-top: 1px solid var(--line);
        font-size: 12.5px;
        color: var(--ink-3);
      }
  `;

  // TOC/hash helper as external file so CSP can use script-src 'self'
  // without 'unsafe-inline'. Deterministic contents (no timestamps).
  const handbookJs =
    '(function () {\n' +
    '  function openTargetFromHash() {\n' +
    "    var hash = location.hash ? location.hash.slice(1) : '';\n" +
    '    if (!hash) return;\n' +
    '    // IDs may start with a digit — use getElementById, not querySelector.\n' +
    '    var el = document.getElementById(hash);\n' +
    '    if (!el) return;\n' +
    "    var details = el.closest ? el.closest('details.spec') : null;\n" +
    "    if (!details && el.tagName === 'DETAILS') details = el;\n" +
    '    if (details) details.open = true;\n' +
    "    if (typeof el.scrollIntoView === 'function') {\n" +
    "      el.scrollIntoView({ block: 'start' });\n" +
    '    }\n' +
    '  }\n' +
    "  document.addEventListener('DOMContentLoaded', openTargetFromHash);\n" +
    "  window.addEventListener('hashchange', openTargetFromHash);\n" +
    "  document.addEventListener('click', function (ev) {\n" +
    '    var t = ev.target;\n' +
    '    if (!t || !t.getAttribute) return;\n' +
    "    if (t.id === 'toc-expand-all') {\n" +
    "      document.querySelectorAll('details.spec').forEach(function (d) { d.open = true; });\n" +
    '    }\n' +
    "    if (t.id === 'toc-collapse-all') {\n" +
    "      document.querySelectorAll('details.spec').forEach(function (d) { d.open = false; });\n" +
    '    }\n' +
    '  });\n' +
    '})();\n';

  let tocItems = [];
  let sectionsHtml = '';
  let sectionNum = 0;

  function pushSection(id, numLabel, title, fileHint, countLabel, intro, bodyHtml) {
    sectionNum += 1;
    const n = String(sectionNum).padStart(2, '0');
    tocItems.push({ id, n, title });
    sectionsHtml += `
      <details class="spec" id="${escapeHtml(id)}" open>
        <summary>
          <div class="spec-head">
            <div class="lhs">
              <h2><span class="num">${escapeHtml(numLabel || n)}</span>${escapeHtml(title)}</h2>
              ${fileHint ? `<div class="file">${escapeHtml(fileHint)}</div>` : ''}
            </div>
            <div class="rhs">${countLabel ? `<b>${escapeHtml(countLabel)}</b>` : ''}</div>
          </div>
        </summary>
        ${intro ? `<p class="spec-intro">${intro}</p>` : ''}
        ${bodyHtml}
      </details>`;
  }

  // Screenshots (by group). With MIN_SCREENSHOTS ≥ 1 the floor guard aborts
  // before we reach HTML generation when the set is empty, so a "no screenshots"
  // empty-state branch would be dead code — render groups only.
  {
    let allShotsBody = '';
    for (const gKey of groupKeys) {
      const list = groups.get(gKey);
      const meta = screenshotsMeta[gKey];
      const title = meta && meta.title ? meta.title : gKey;
      const desc =
        meta && meta.description
          ? escapeHtml(meta.description)
          : `Screenshot-Gruppe <code>${escapeHtml(gKey)}</code> (Auto-Discovery).`;
      let cards = `<h3 id="group-${escapeHtml(slugify(gKey))}">${escapeHtml(title)}</h3>`;
      cards += `<p class="spec-intro">${desc}</p>`;
      cards += '<div class="tests">';
      for (const e of list) {
        const cardId = 'shot-' + slugify(e.group + '-' + e.title);
        const shotHref = escapeHtml(encodeHtmlPath(e.outputPath));
        cards +=
          `<div class="test" id="${escapeHtml(cardId)}">` +
          `<div class="head"><span class="name">${escapeHtml(e.title)}</span></div>` +
          `<div class="img"><a href="${shotHref}">` +
          `<img src="${shotHref}" alt="${escapeHtml(e.title)}" loading="lazy"></a></div>` +
          `</div>`;
      }
      cards += '</div>';
      allShotsBody += cards;
    }
    pushSection(
      'screenshots',
      null,
      'Screenshots',
      'docs/handbook/screenshots/',
      `${screenshotEntries.length} Screenshots · ${groupKeys.length} Gruppen`,
      'PNG-Screenshots, gruppiert nach Unterverzeichnis. Dateiname = Bildunterschrift und Sortierschlüssel (Konvention <code>NN-kurzname.png</code> empfohlen, nicht erzwungen).',
      allShotsBody,
    );
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
      // Keep "global" first for iOS if present
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
        storeBody += `<div class="store-locale"><h4>${escapeHtml(locale)}</h4><dl>`;
        for (const f of fields) {
          storeBody +=
            `<dt>${escapeHtml(f.field)}</dt>` +
            `<dd>${escapeHtml(f.content)}</dd>`;
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
        `<img src="${assetHref}" alt="${escapeHtml(a.title)}" loading="lazy"></a>` +
        `<div class="an">${escapeHtml(a.title)}</div></div>`;
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
      docsBody +=
        `<li><a href="${escapeHtml(encodeHtmlPath(d.out))}">` +
        `<span class="doc-title">${escapeHtml(d.title)}</span>` +
        `<span class="doc-path">${escapeHtml(d.src)}</span></a></li>`;
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
      `${escapeHtml(t.title.replace(/&amp;/g, '&'))}</a></li>`;
  }
  tocHtml += '</ol>';

  const indexHtml =
    `<!DOCTYPE html>\n<html lang="de">\n<head>\n` +
    `<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>DFX BTC Taro Wallet — Handbuch</title>\n` +
    `<style>${css}\n</style>\n` +
    `</head>\n<body>\n` +
    `<div class="wrap">\n` +
    `<aside>\n` +
    `<div class="brand"><span class="dot"></span> DFX BTC Taro</div>\n` +
    `<p class="brand-sub">Wallet-Handbuch</p>\n` +
    `<div class="toc-label">Inhalt</div>\n` +
    `<div class="toc-actions">` +
    `<button type="button" id="toc-expand-all">Alle öffnen</button>` +
    `<button type="button" id="toc-collapse-all">Alle schliessen</button>` +
    `</div>\n` +
    `<nav class="toc">${tocHtml}</nav>\n` +
    `</aside>\n` +
    `<main>\n` +
    `<header class="hero">\n` +
    `<h1>DFX BTC Taro Wallet — Handbuch</h1>\n` +
    `<p class="lede">Screenshots, Store-Listing-Texte, App-Assets und Markdown-Dokumentation der BTC-Taro-Wallet an einem Ort. Die Seite wird bei jedem Build aus dem Repository erzeugt — neue Dateien erscheinen automatisch.</p>\n` +
    `<div class="callout info"><p><b>Auto-Discovery.</b> Es gibt keine handgepflegte Mapping-Tabelle. Das Build-Script scannt <code>docs/handbook/screenshots/</code>, Store-Metadaten, <code>img/dfx/</code> und Docs und erzeugt diese Seite deterministisch.</p></div>\n` +
    `<div class="meta">` +
    `<span>Repo: <b>DFXswiss/btc-wallet</b></span>` +
    `<span>Stand: <b>${escapeHtml(gitSha)}</b></span>` +
    `<span>Screenshots: <b>${screenshotEntries.length}</b></span>` +
    `<span>Store-Felder: <b>${storeEntries.length}</b></span>` +
    `<span>Assets: <b>${assetSpecs.length}</b></span>` +
    `<span>Dokumente: <b>${renderedDocs.length}</b></span>` +
    `</div>\n` +
    `</header>\n` +
    `<hr class="sep">\n` +
    sectionsHtml +
    `<footer class="footer">` +
    `Diese Seite ist generiert und spiegelt den Repository-Stand ` +
    `<code>${escapeHtml(gitSha)}</code> wider. Quelle: ` +
    `<code>scripts/handbook/build.js</code>.` +
    `</footer>\n` +
    `</main>\n</div>\n` +
    `<script src="handbook.js"></script>\n` +
    `</body>\n</html>\n`;

  ensureDir(outDir);
  const indexPath = path.join(outDir, 'index.html');
  fs.writeFileSync(indexPath, indexHtml, 'utf8');
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
