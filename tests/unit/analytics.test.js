const assert = require('assert');

// tests/setup.js globally stubs this module out for every other unit test
// (jest.fn() with a placeholder ENUM) - undo that here to test the real thing.
jest.unmock('../../blue_modules/analytics');

jest.mock('../../BlueApp', () => ({
  isDoNotTrackEnabled: jest.fn().mockResolvedValue(false),
}));

const mockSentryOptions = { enabled: true };
jest.mock('@sentry/react-native', () => ({
  getClient: jest.fn(() => ({ getOptions: () => mockSentryOptions })),
  captureException: jest.fn(),
}));

describe('blue_modules/analytics', () => {
  beforeEach(() => {
    mockSentryOptions.enabled = true;
    jest.clearAllMocks();
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

  it('logError forwards an Error instance to Sentry.captureException unchanged', () => {
    const A = require('../../blue_modules/analytics');
    const Sentry = require('@sentry/react-native');
    const err = new Error('boom');

    A.logError(err);

    assert.strictEqual(Sentry.captureException.mock.calls.length, 1);
    assert.strictEqual(Sentry.captureException.mock.calls[0][0], err);
  });

  it('logError wraps a non-Error value in an Error before forwarding', () => {
    const A = require('../../blue_modules/analytics');
    const Sentry = require('@sentry/react-native');

    A.logError('plain string error');

    assert.strictEqual(Sentry.captureException.mock.calls.length, 1);
    const forwarded = Sentry.captureException.mock.calls[0][0];
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
