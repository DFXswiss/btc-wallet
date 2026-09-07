/**
 * Regression contract for the generated handbook mobile navigation.
 *
 * The private Playwright probe verifies viewport geometry and interaction
 * against built pages. This fast unit check keeps the source contract from
 * regressing back to document-flow ordering or a fixed header guess.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SCRIPT = path.resolve(__dirname, '../../scripts/handbook/build.js');

describe('unit - handbook mobile sidebar contract', () => {
  it('emits the viewport-anchored mobile sidebar contract', function () {
    const source = fs.readFileSync(SCRIPT, 'utf8');
    const mobileBlock = source.match(/@media \(max-width: 1023px\) \{([\s\S]*?)\n\}\n@media \(min-width: 1024px\)/);
    assert.ok(mobileBlock, 'mobile media block must remain discoverable');
    assert.match(
      mobileBlock[1],
      /position: fixed;[\s\S]*top: var\(--site-chrome-height, 0px\);/,
      'mobile sidebar must be viewport anchored below measured chrome',
    );
    assert.match(mobileBlock[1], /right: 16px;[\s\S]*bottom: 16px;[\s\S]*left: 16px;/);
    assert.match(mobileBlock[1], /display: none;[\s\S]*body\.sidebar-open \.sidebar \{ display: block; \}/);
    assert.match(mobileBlock[1], /main \{ order: initial; \}/, 'main must not push the drawer below the document');
    const handlerStart = source.indexOf('function initSidebarToggle()');
    const handlerEnd = source.indexOf('function initScrollspy()', handlerStart);
    assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, 'sidebar handler must remain discoverable');
    const handler = source.slice(handlerStart, handlerEnd);
    assert.match(handler, /ResizeObserver\(syncChromeHeight\)/, 'wrapped mobile chrome needs live measurement');
    assert.match(handler, /ev\.key === 'Escape'[\s\S]*closeSidebar\(\)/);
    assert.match(handler, /qsa\('a\[href\]', side\)[\s\S]*closeSidebar/);
  });
});
