const assert = require('assert');

// tests/setup.js globally stubs this module out for every other unit test
// (jest.fn() with a placeholder ENUM) - undo that here to test the real thing.
jest.unmock('../../blue_modules/analytics');

jest.mock('../../BlueApp', () => ({
  isDoNotTrackEnabled: jest.fn().mockResolvedValue(false),
}));

// The resolved integration list sits on the options whether or not the client is
// enabled; what init() skips for a disabled client is *installing* them.
const RESOLVED_INTEGRATIONS = [{ name: 'CaptureConsole' }, { name: 'ReactNativeErrorHandlers' }, { name: 'Dedupe' }];
const mockSentryOptions = { enabled: true, integrations: RESOLVED_INTEGRATIONS };
// What the client actually has installed - legitimately empty for a user who
// launched with Do Not Track on.
let mockInstalled = [];
jest.mock('@sentry/react-native', () => ({
  getClient: jest.fn(() => ({ getOptions: () => mockSentryOptions })),
  addIntegration: jest.fn(integration => {
    if (!mockInstalled.some(i => i.name === integration.name)) mockInstalled.push(integration);
  }),
  setUser: jest.fn(),
  captureException: jest.fn(),
}));

describe('blue_modules/analytics', () => {
  beforeEach(() => {
    mockSentryOptions.enabled = true;
    mockInstalled = [];
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // App.js imports captureConsoleIntegration from @sentry/core, which only resolves to
  // the same instance the SDK uses while both stay on one hoisted copy. A second copy
  // would make the integration's own client check never match and it would stop filing
  // issues with no error anywhere, so pin drift has to fail here instead.
  it('@sentry/core is pinned to exactly what @sentry/react-native depends on', () => {
    const ours = require('../../package.json').dependencies['@sentry/core'];
    const theirs = require('@sentry/react-native/package.json').dependencies['@sentry/core'];
    assert.strictEqual(ours, theirs);
  });

  it('setOptOut(true) disables the Sentry client (opting out must actually stop event delivery)', () => {
    const A = require('../../blue_modules/analytics');
    A.setOptOut(true);
    assert.strictEqual(mockSentryOptions.enabled, false);
  });

  it('setOptOut(false) re-enables the Sentry client', () => {
    const A = require('../../blue_modules/analytics');
    mockSentryOptions.enabled = false;
    A.setOptOut(false);
    assert.strictEqual(mockSentryOptions.enabled, true);
  });

  // logError deliberately does NOT call captureException: App.js's captureConsole
  // integration turns console.error into the issue, so capturing here too would
  // file everything twice. It must hand that integration an Error, not a string -
  // that is what makes it capture an exception with a stack instead of a message.
  // The id goes on the scope *user*, not a scope attribute: attributes reach logs only,
  // while the user reaches both logs and error events. Without it the native layer fills
  // in its own install id for error events, which is a different value than the one the
  // About screen shows, so a log row cannot be joined to the error or to a support request.
  it('setOptOut(false) identifies the device', () => {
    const A = require('../../blue_modules/analytics');
    const Sentry = require('@sentry/react-native');
    A.setOptOut(false);
    assert.deepStrictEqual(Sentry.setUser.mock.calls[0][0], { id: 'uniqueId' });
  });

  it('setOptOut(true) clears the device identity', () => {
    const A = require('../../blue_modules/analytics');
    const Sentry = require('@sentry/react-native');
    A.setOptOut(true);
    assert.strictEqual(Sentry.setUser.mock.calls[0][0], null);
  });

  // Sentry.init() skips integration setup entirely when the client is disabled, and
  // flipping `enabled` afterwards installs nothing. A user who launches with Do Not
  // Track on and then turns it off must get the WHOLE resolved list - not just console
  // capture, but the uncaught-error handlers and the frame rewriting source maps need.
  it('setOptOut(false) installs the integrations init skipped while opted out', () => {
    const A = require('../../blue_modules/analytics');
    const Sentry = require('@sentry/react-native');
    A.setOptOut(false);
    // joined rather than compared as arrays: jest hands the mock's calls back from
    // another realm, so deepStrictEqual fails the prototype check on identical content
    const installed = Sentry.addIntegration.mock.calls.map(c => c[0].name).join(',');
    assert.strictEqual(installed, 'CaptureConsole,ReactNativeErrorHandlers,Dedupe');
  });

  it('installs nothing while opted out', () => {
    const A = require('../../blue_modules/analytics');
    const Sentry = require('@sentry/react-native');
    A.setOptOut(true);
    assert.strictEqual(Sentry.addIntegration.mock.calls.length, 0);
  });

  it('logError forwards an Error instance to console.error unchanged', () => {
    const A = require('../../blue_modules/analytics');
    const Sentry = require('@sentry/react-native');
    const err = new Error('boom');
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    A.logError(err);

    assert.strictEqual(consoleError.mock.calls.length, 1);
    assert.strictEqual(consoleError.mock.calls[0][0], err);
    assert.strictEqual(Sentry.captureException.mock.calls.length, 0);
  });

  it('logError wraps a non-Error value in an Error before forwarding', () => {
    const A = require('../../blue_modules/analytics');
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    A.logError('plain string error');

    assert.strictEqual(consoleError.mock.calls.length, 1);
    const forwarded = consoleError.mock.calls[0][0];
    assert.ok(forwarded instanceof Error);
    assert.strictEqual(forwarded.message, 'plain string error');
  });

  // Separate from the tests above: the module also applies the persisted Do Not
  // Track choice on load (before any explicit setOptOut call), which is what
  // actually closes the upstream gap - resets the module registry so the
  // top-level `BlueApp.isDoNotTrackEnabled().then(...)` runs fresh, then flushes
  // the microtask queue before asserting. Last in the file since resetModules()
  // affects the shared cache for any test declared after it.
  it('applies the persisted Do Not Track state to Sentry on module load', async () => {
    jest.resetModules();
    require('../../BlueApp').isDoNotTrackEnabled.mockResolvedValueOnce(true);

    require('../../blue_modules/analytics');
    await new Promise(process.nextTick);

    assert.strictEqual(mockSentryOptions.enabled, false);
  });
});
