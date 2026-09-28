/**
 * Unit tests for scripts/product/check-inventory.js.
 *
 * Fixture describe builds a synthetic docs/product + navigation tree and
 * asserts the checker; repository describe runs against this checkout so CI
 * fails on inventory drift.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const {
  checkInventory,
  collectRoutes,
  parseReadme,
  parseFeatureFiles,
  parseFlows,
  slugify,
  IGNORED_ROUTES,
} = require('../../scripts/product/check-inventory');

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function validFixtureFiles() {
  return {
    'navigation/Demo.tsx': [
      "import React from 'react';",
      'export function DemoStack() {',
      '  return (',
      '    <>',
      '      <Stack.Screen name="DemoHome" component={DemoHome} />',
      '      <Stack.Screen name="DemoRoot" component={DemoStackInner} />',
      '      <Stack.Screen',
      '        name="DemoSettings"',
      '        component={DemoSettings}',
      '      />',
      '    </>',
      '  );',
      '}',
      '',
    ].join('\n'),
    'docs/product/README.md': [
      '# Product feature inventory',
      '',
      '| ID | Capability | Entry point | Tier | Flows | Details |',
      '| --- | --- | --- | --- | --- | --- |',
      '| D-01 | Demo home | Home | Critical | CF-01 | [details](features/demo.md#d-01-demo-home) |',
      '| D-02 | Demo settings | Settings | Important | — | [details](features/demo.md#d-02-demo-settings) |',
      '',
    ].join('\n'),
    'docs/product/features/demo.md': [
      '# Demo',
      '',
      'Synthetic area for checker fixtures.',
      '',
      '## D-01 Demo home',
      '',
      '**Routes:** DemoHome',
      '**Entry:** Home',
      '**Tier:** Critical',
      '',
      '**Behavior.** Fixture only.',
      '',
      '## D-02 Demo settings',
      '',
      '**Routes:** DemoSettings',
      '**Entry:** Settings',
      '**Tier:** Important',
      '',
      '**Behavior.** Fixture only.',
      '',
    ].join('\n'),
    'docs/product/critical-flows.md': [
      '# Critical flows',
      '',
      '## CF-01 Demo critical',
      '',
      '**Covers:** D-01',
      '**Tier:** Critical',
      '**Funding:** none',
      '**Steps.**',
      '1. Open DemoHome.',
      '**Expected.** Screen loads.',
      '**Automation.** None.',
      '',
    ].join('\n'),
  };
}

function writeFixture(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    writeText(path.join(root, rel), content);
  }
}

describe('product inventory checker (fixtures)', () => {
  let tmpRoot;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'product-inventory-'));
  });

  afterAll(() => {
    if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function freshFixture(mutate) {
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'case-'));
    const files = validFixtureFiles();
    if (mutate) mutate(files);
    writeFixture(dir, files);
    return dir;
  }

  it('accepts a consistent synthetic inventory', () => {
    const dir = freshFixture();
    const { errors, stats } = checkInventory(dir);
    assert.deepStrictEqual(errors, []);
    assert.strictEqual(stats.routes, 2);
    assert.strictEqual(stats.wrappers, 1);
    assert.strictEqual(stats.entries, 2);
    assert.strictEqual(stats.rows, 2);
    assert.strictEqual(stats.flows, 1);

    const routes = collectRoutes(dir);
    assert.deepStrictEqual(routes.screens, ['DemoHome', 'DemoSettings']);
    assert.deepStrictEqual(routes.wrappers, ['DemoRoot']);
    assert.strictEqual(slugify('D-01 Demo home'), 'd-01-demo-home');
    assert.ok(IGNORED_ROUTES.has('Navigation'));
  });

  it('reports an unclaimed route', () => {
    const dir = freshFixture(files => {
      files['docs/product/features/demo.md'] = files['docs/product/features/demo.md'].replace(
        '**Routes:** DemoSettings',
        '**Routes:** none',
      );
    });
    const { errors } = checkInventory(dir);
    assert.ok(errors.includes('route DemoSettings registered in navigation but not claimed by any feature entry'), errors.join('\n'));
  });

  it('reports a route claimed twice', () => {
    const dir = freshFixture(files => {
      files['docs/product/features/demo.md'] = files['docs/product/features/demo.md'].replace(
        '**Routes:** DemoSettings',
        '**Routes:** DemoHome, DemoSettings',
      );
    });
    const { errors } = checkInventory(dir);
    assert.ok(errors.includes('route DemoHome claimed by more than one entry: D-01, D-02'), errors.join('\n'));
  });

  it('reports a claimed stack wrapper', () => {
    const dir = freshFixture(files => {
      files['docs/product/features/demo.md'] = files['docs/product/features/demo.md'].replace(
        '**Routes:** DemoHome',
        '**Routes:** DemoHome, DemoRoot',
      );
    });
    const { errors } = checkInventory(dir);
    assert.ok(errors.includes('route DemoRoot is a stack wrapper, list the screens instead'), errors.join('\n'));
  });

  it('reports a navigation directory without screen routes', () => {
    const dir = freshFixture(files => {
      files['navigation/Demo.tsx'] = 'export {};\n';
    });
    const { errors } = checkInventory(dir);
    assert.ok(errors.includes('navigation: no screen routes found under navigation/'), errors.join('\n'));
  });

  it('reports a navigation directory whose only screen is ignored', () => {
    const dir = freshFixture(files => {
      files['navigation/Demo.tsx'] = '<Stack.Screen name="Navigation" component={RootStack} />\n';
    });
    const { errors } = checkInventory(dir);
    assert.ok(errors.includes('navigation: no screen routes found under navigation/'), errors.join('\n'));
  });

  it('reports a feature entry without a README row', () => {
    const dir = freshFixture(files => {
      files['docs/product/features/demo.md'] += ['', '## D-03 Orphan entry', '', '**Routes:** none', '**Tier:** Nice', ''].join('\n');
    });
    const { errors } = checkInventory(dir);
    assert.ok(errors.includes('feature D-03: not in README'), errors.join('\n'));
  });

  it('reports a Critical README row without flow coverage', () => {
    const dir = freshFixture(files => {
      files['docs/product/critical-flows.md'] = [
        '# Critical flows',
        '',
        '## CF-01 Demo critical',
        '',
        '**Covers:** D-02',
        '**Tier:** Critical',
        '',
      ].join('\n');
      files['docs/product/README.md'] = files['docs/product/README.md']
        .replace('| Critical | CF-01 |', '| Critical | — |')
        .replace('| Important | — |', '| Important | CF-01 |');
    });
    const { errors } = checkInventory(dir);
    assert.ok(errors.includes('readme D-01: Critical row not covered by any flow'), errors.join('\n'));
  });

  it('reports a Flows column mismatch', () => {
    const dir = freshFixture(files => {
      files['docs/product/README.md'] = files['docs/product/README.md'].replace('| Critical | CF-01 |', '| Critical | CF-99 |');
    });
    const { errors } = checkInventory(dir);
    assert.ok(errors.includes('readme D-01: Flows column [CF-99] does not match covering flows [CF-01]'), errors.join('\n'));
  });

  it('reports a wrong details anchor', () => {
    const dir = freshFixture(files => {
      files['docs/product/README.md'] = files['docs/product/README.md'].replace(
        'features/demo.md#d-01-demo-home',
        'features/demo.md#wrong-anchor',
      );
    });
    const { errors } = checkInventory(dir);
    assert.ok(errors.includes("readme D-01: details anchor 'wrong-anchor' does not match 'd-01-demo-home'"), errors.join('\n'));
  });

  it('reports a tier mismatch between README and feature entry', () => {
    const dir = freshFixture(files => {
      files['docs/product/features/demo.md'] = files['docs/product/features/demo.md'].replace('**Tier:** Important', '**Tier:** Nice');
    });
    const { errors } = checkInventory(dir);
    assert.ok(errors.includes("feature D-02: tier 'Nice' does not match README tier 'Important'"), errors.join('\n'));
  });

  it('exposes parsers used by the checker', () => {
    const dir = freshFixture();
    const rows = parseReadme(fs.readFileSync(path.join(dir, 'docs/product/README.md'), 'utf8'));
    const entries = parseFeatureFiles(path.join(dir, 'docs/product/features'));
    const flows = parseFlows(fs.readFileSync(path.join(dir, 'docs/product/critical-flows.md'), 'utf8'));
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(flows.length, 1);
    assert.deepStrictEqual(entries[0].routes, ['DemoHome']);
    assert.deepStrictEqual(flows[0].covers, ['D-01']);
  });
});

describe('product inventory (repository)', () => {
  it('has no inventory drift', () => {
    const { errors, stats } = checkInventory(REPO_ROOT);
    assert.strictEqual(errors.length, 0, errors.join('\n'));
    assert.ok(stats.routes > 0, 'expected routes > 0');
    assert.ok(stats.entries > 0, 'expected entries > 0');
    assert.ok(stats.flows > 0, 'expected flows > 0');
  });
});
