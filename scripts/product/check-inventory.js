'use strict';

const fs = require('fs');
const path = require('path');

const ALLOWED_TIERS = new Set(['Critical', 'Critical (DFX)', 'Important', 'Nice']);
const CRITICAL_TIERS = new Set(['Critical', 'Critical (DFX)']);
const ID_RE = /^[A-Z]{1,2}-\d{2}$/;
const FEATURE_HEADING_RE = /^## ([A-Z]{1,2}-\d{2}) (.+)$/;
const FLOW_HEADING_RE = /^## (CF-\d{2}) (.+)$/;
const SCREEN_TAG_RE = /<[A-Za-z]+\.Screen\b/g;

// Screens that are registered but are not a user-facing capability.
// Every addition needs a reason string.
const IGNORED_ROUTES = new Map([['Navigation', 'wraps the root stack after unlock; not a screen']]);

function slugify(heading) {
  return String(heading)
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_]/g, '')
    .replace(/\s+/g, '-');
}

function splitCsv(value) {
  return String(value)
    .split(',')
    .map(s => s.trim())
    .filter(s => s && s !== '—');
}

function collectRoutes(repoRoot) {
  const navDir = path.join(repoRoot, 'navigation');
  const screens = new Set();
  const wrappers = new Set();
  if (!fs.existsSync(navDir)) {
    return { screens: [], wrappers: [] };
  }
  const files = fs
    .readdirSync(navDir)
    .filter(name => name.endsWith('.tsx'))
    .sort();
  for (const name of files) {
    const text = fs.readFileSync(path.join(navDir, name), 'utf8');
    for (const m of text.matchAll(SCREEN_TAG_RE)) {
      // Walk attributes with brace depth so `>` inside options={() => (...)} is not a tag end.
      let i = m.index + m[0].length;
      let depth = 0;
      let attrs = null;
      while (i < text.length) {
        const ch = text[i];
        if (ch === '{') depth += 1;
        else if (ch === '}') depth -= 1;
        else if (ch === '>' && depth === 0) {
          attrs = text.slice(m.index + m[0].length, i);
          break;
        }
        i += 1;
      }
      if (attrs === null) continue;
      const nameMatch = attrs.match(/\bname="([A-Za-z0-9_]+)"/);
      if (!nameMatch) continue;
      const route = nameMatch[1];
      const componentMatch = attrs.match(/\bcomponent=\{([A-Za-z0-9_]+)\}/);
      const component = componentMatch ? componentMatch[1] : '';
      // Root name, or component ending in Stack/StackScreen, marks a stack wrapper.
      if (route.endsWith('Root') || component.endsWith('Stack') || component.endsWith('StackScreen')) {
        wrappers.add(route);
      } else {
        screens.add(route);
      }
    }
  }
  return {
    screens: [...screens].sort(),
    wrappers: [...wrappers].sort(),
  };
}

function parseReadme(markdown) {
  const rows = [];
  const malformed = [];
  const lines = String(markdown).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('|')) continue;
    const cells = line.split('|').map(c => c.trim());
    // Leading/trailing empties from edge pipes: | a | b | → ['', 'a', 'b', '']
    const start = cells[0] === '' ? 1 : 0;
    const end = cells[cells.length - 1] === '' ? cells.length - 1 : cells.length;
    const cols = cells.slice(start, end);
    const id = cols[0];
    if (!id || !ID_RE.test(id)) continue;
    if (cols.length !== 6) {
      malformed.push({ id, line: i + 1 });
      continue;
    }
    const capability = cols[1];
    const entry = cols[2];
    const tier = cols[3];
    const flows = splitCsv(cols[4]);
    let details = null;
    const linkMatch = cols[5].match(/\]\(([^)]+)\)/);
    if (linkMatch) {
      const target = linkMatch[1];
      const hash = target.indexOf('#');
      if (hash === -1) {
        details = { file: target, anchor: '' };
      } else {
        details = { file: target.slice(0, hash), anchor: target.slice(hash + 1) };
      }
    }
    rows.push({
      id,
      capability,
      entry,
      tier,
      flows,
      details,
      line: i + 1,
    });
  }
  return { rows, malformed };
}

function parseFeatureFiles(dir) {
  const entries = [];
  if (!fs.existsSync(dir)) return entries;
  const files = fs
    .readdirSync(dir)
    .filter(name => name.endsWith('.md'))
    .sort();
  for (const basename of files) {
    const relFile = path.posix.join('features', basename);
    const text = fs.readFileSync(path.join(dir, basename), 'utf8');
    const lines = text.split(/\r?\n/);
    let i = 0;
    while (i < lines.length) {
      const heading = lines[i].match(FEATURE_HEADING_RE);
      if (!heading) {
        i += 1;
        continue;
      }
      const id = heading[1];
      const name = heading[2];
      const startLine = i + 1;
      i += 1;
      const blockLines = [];
      while (i < lines.length && !lines[i].startsWith('## ')) {
        blockLines.push(lines[i]);
        i += 1;
      }
      const block = blockLines.join('\n');
      let routes = null;
      let tier = null;
      let sources = [];
      const routesMatch = block.match(/^\*\*Routes:\*\*\s*(.*)$/m);
      if (routesMatch) {
        const raw = routesMatch[1].trim();
        routes = raw === 'none' ? [] : splitCsv(raw);
      }
      const tierMatch = block.match(/^\*\*Tier:\*\*\s*(.*)$/m);
      if (tierMatch) {
        tier = tierMatch[1].trim() || null;
      }
      const sourcesMatch = block.match(/^\*\*Source\.\*\*\s*(.*)$/m);
      if (sourcesMatch) {
        sources = sourcesMatch[1].split(',').map(s => s.trim().replace(/\.$/, ''));
      }
      entries.push({
        id,
        name,
        file: relFile,
        anchor: slugify(`${id} ${name}`),
        routes,
        tier,
        sources,
        line: startLine,
      });
    }
  }
  return entries;
}

function parseFlows(markdown) {
  const flows = [];
  const lines = String(markdown).split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const heading = lines[i].match(FLOW_HEADING_RE);
    if (!heading) {
      i += 1;
      continue;
    }
    const id = heading[1];
    const name = heading[2];
    const startLine = i + 1;
    i += 1;
    const blockLines = [];
    while (i < lines.length && !lines[i].startsWith('## ')) {
      blockLines.push(lines[i]);
      i += 1;
    }
    const block = blockLines.join('\n');
    let covers = [];
    let tier = null;
    const coversMatch = block.match(/^\*\*Covers:\*\*\s*(.*)$/m);
    if (coversMatch) {
      covers = splitCsv(coversMatch[1]);
    }
    const tierMatch = block.match(/^\*\*Tier:\*\*\s*(.*)$/m);
    if (tierMatch) {
      tier = tierMatch[1].trim() || null;
    }
    flows.push({ id, name, covers, tier, line: startLine });
  }
  return flows;
}

function checkInventory(repoRoot) {
  const productDir = path.join(repoRoot, 'docs', 'product');
  const readmePath = path.join(productDir, 'README.md');
  const flowsPath = path.join(productDir, 'critical-flows.md');
  const featuresDir = path.join(productDir, 'features');

  if (!fs.existsSync(readmePath)) {
    throw new Error(`missing ${path.relative(repoRoot, readmePath) || 'docs/product/README.md'}`);
  }
  if (!fs.existsSync(flowsPath)) {
    throw new Error(`missing ${path.relative(repoRoot, flowsPath) || 'docs/product/critical-flows.md'}`);
  }
  if (!fs.existsSync(featuresDir) || !fs.statSync(featuresDir).isDirectory()) {
    throw new Error('missing docs/product/features/');
  }

  const { screens, wrappers } = collectRoutes(repoRoot);
  const { rows, malformed } = parseReadme(fs.readFileSync(readmePath, 'utf8'));
  const entries = parseFeatureFiles(featuresDir);
  const flows = parseFlows(fs.readFileSync(flowsPath, 'utf8'));
  const errors = [];

  const actionable = screens.filter(screen => !IGNORED_ROUTES.has(screen));
  if (!actionable.length) {
    errors.push('navigation: no screen routes found under navigation/');
  }

  const screensSet = new Set(screens);
  const wrappersSet = new Set(wrappers);
  const rowById = new Map();
  const entryById = new Map();
  const flowById = new Map();

  for (const bad of malformed) {
    errors.push(`readme line ${bad.line}: malformed table row for ${bad.id}`);
  }

  // --- README ---
  for (const row of rows) {
    if (rowById.has(row.id)) {
      errors.push(`readme ${row.id}: duplicate ID`);
    } else {
      rowById.set(row.id, row);
    }
    if (!ALLOWED_TIERS.has(row.tier)) {
      errors.push(`readme ${row.id}: invalid tier '${row.tier}'`);
    }
  }

  // --- Features ---
  for (const entry of entries) {
    if (entryById.has(entry.id)) {
      errors.push(`feature ${entry.id}: duplicate entry`);
    } else {
      entryById.set(entry.id, entry);
    }
    if (entry.routes === null) {
      errors.push(`feature ${entry.id}: Routes line missing`);
    }
    if (entry.tier === null) {
      errors.push(`feature ${entry.id}: Tier line missing`);
    }
    for (const source of entry.sources) {
      if (!fs.existsSync(path.join(repoRoot, source))) {
        errors.push(`feature ${entry.id}: source path not found: ${source}`);
      }
    }
  }

  for (const row of rows) {
    const entry = entryById.get(row.id);
    if (!entry) {
      errors.push(`readme ${row.id}: no feature entry`);
    }
    if (row.details === null) {
      errors.push(`readme ${row.id}: details link missing`);
    } else if (entry) {
      if (row.details.file !== entry.file) {
        errors.push(`readme ${row.id}: details file '${row.details.file}' does not match entry file '${entry.file}'`);
      }
      if (row.details.anchor !== entry.anchor) {
        errors.push(`readme ${row.id}: details anchor '${row.details.anchor}' does not match '${entry.anchor}'`);
      }
    }
  }

  for (const entry of entries) {
    const row = rowById.get(entry.id);
    if (!row) {
      errors.push(`feature ${entry.id}: not in README`);
      continue;
    }
    if (entry.tier !== null && entry.tier !== row.tier) {
      errors.push(`feature ${entry.id}: tier '${entry.tier}' does not match README tier '${row.tier}'`);
    }
  }

  // --- Routes ---
  const claimedBy = new Map();
  for (const entry of entries) {
    if (!entry.routes) continue;
    for (const route of entry.routes) {
      if (!claimedBy.has(route)) claimedBy.set(route, []);
      claimedBy.get(route).push(entry.id);
    }
  }
  for (const list of claimedBy.values()) list.sort();

  for (const screen of screens) {
    if (IGNORED_ROUTES.has(screen)) continue;
    const claimants = claimedBy.get(screen) || [];
    if (claimants.length === 0) {
      errors.push(`route ${screen} registered in navigation but not claimed by any feature entry`);
    } else if (claimants.length > 1) {
      errors.push(`route ${screen} claimed by more than one entry: ${claimants.join(', ')}`);
    }
  }

  for (const route of [...claimedBy.keys()].sort()) {
    const claimants = claimedBy.get(route);
    if (IGNORED_ROUTES.has(route)) {
      errors.push(`route ${route} is ignored but claimed by feature entry: ${claimants.join(', ')}`);
    } else if (screensSet.has(route)) {
      // registered as a leaf screen somewhere: fine even if a wrapper shares the name
    } else if (wrappersSet.has(route)) {
      errors.push(`route ${route} is a stack wrapper, list the screens instead`);
    } else {
      errors.push(`route ${route} claimed but not registered in navigation: ${claimants.join(', ')}`);
    }
  }

  // --- Flows ---
  const coveringFlowsByRow = new Map();
  for (const flow of flows) {
    if (flowById.has(flow.id)) {
      errors.push(`flow ${flow.id}: duplicate ID`);
    } else {
      flowById.set(flow.id, flow);
    }
    if (!flow.covers.length) {
      errors.push(`flow ${flow.id}: empty Covers`);
    }
    if (flow.tier === null || !CRITICAL_TIERS.has(flow.tier)) {
      errors.push(`flow ${flow.id}: invalid tier '${flow.tier === null ? '' : flow.tier}'`);
    }
    for (const coverId of flow.covers) {
      if (!rowById.has(coverId)) {
        errors.push(`flow ${flow.id}: covers unknown id ${coverId}`);
      }
      if (!coveringFlowsByRow.has(coverId)) coveringFlowsByRow.set(coverId, []);
      coveringFlowsByRow.get(coverId).push(flow.id);
    }
  }
  for (const list of coveringFlowsByRow.values()) list.sort();

  for (const row of rows) {
    const covering = coveringFlowsByRow.get(row.id) || [];
    if (CRITICAL_TIERS.has(row.tier) && covering.length === 0) {
      errors.push(`readme ${row.id}: Critical row not covered by any flow`);
    }
    const expected = [...row.flows].sort();
    const actual = [...covering].sort();
    if (expected.join(',') !== actual.join(',')) {
      errors.push(`readme ${row.id}: Flows column [${expected.join(', ')}] does not match covering flows [${actual.join(', ')}]`);
    }
  }

  return {
    errors,
    stats: {
      routes: screens.length,
      wrappers: wrappers.length,
      entries: entries.length,
      rows: rows.length,
      flows: flows.length,
    },
  };
}

module.exports = {
  checkInventory,
  collectRoutes,
  parseReadme,
  parseFeatureFiles,
  parseFlows,
  slugify,
  IGNORED_ROUTES,
};

if (require.main === module) {
  const repoRoot = path.resolve(__dirname, '../..');
  const { errors, stats } = checkInventory(repoRoot);
  if (errors.length) {
    for (const err of errors) {
      process.stderr.write(`inventory: ${err}\n`);
    }
    process.exit(1);
  }
  process.stdout.write(`inventory ok: ${stats.routes} routes, ${stats.entries} entries, ${stats.flows} flows\n`);
  process.exit(0);
}
