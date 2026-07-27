const assert = require('assert');

const { toError } = require('../../helpers/errors');

// The HTTP layers reject with the parsed error body rather than an Error, and Sentry files
// an issue from the first Error among the console arguments. Everything below is about what
// the resulting issue looks like: an un-normalized body is still grouped per call site, but
// its value reads "... [object Object]" whatever went wrong, and one status cannot be told
// from another.
describe('helpers/errors toError', () => {
  it('titles a DFX error body with the context and its message', () => {
    const error = toError('DFX session init failed', { statusCode: 401, message: 'Unauthorized' });
    assert.strictEqual(error.message, 'DFX session init failed: Unauthorized');
  });

  // Sentry ignores the message once a stack contributes and groups on the type, so the
  // status has to live in the name or a 400 and a 500 from one site become one issue.
  it('puts the status in the type so statuses stay separate issues', () => {
    assert.strictEqual(toError('ctx', { statusCode: 400, message: 'Bad' }).name, 'ApiError400');
    assert.strictEqual(toError('ctx', { statusCode: 500, message: 'Boom' }).name, 'ApiError500');
  });

  // Wrapped rather than returned as-is: the wrapper's stack points at the call site, which
  // is what keeps sites apart. `TypeError: Network request failed` carries no app frames,
  // so returning it unchanged would merge every site in the app into one issue.
  it('keeps the context for a rejection that is already an Error', () => {
    const cause = new TypeError('Network request failed');
    const error = toError('receivePos: payment status poll failed', cause);

    assert.strictEqual(error.message, 'receivePos: payment status poll failed: Network request failed');
  });

  // Not chained: the RN SDK's linked-errors integration appends, and Sentry titles an issue
  // from the LAST exception, so attaching the cause would put "TypeError: Network request
  // failed" back in the title and undo the attribution the wrapper exists to provide.
  it('does not chain the original, which would take over the issue title', () => {
    const error = toError('ctx', new TypeError('Network request failed'));
    assert.strictEqual(error.cause, undefined);
  });

  // An NFC or signing failure reaches the same helper and must not be filed as an ApiError.
  it('keeps a non-API cause its own type', () => {
    assert.strictEqual(toError('ctx', new TypeError('boom')).name, 'TypeError');
    assert.strictEqual(toError('ctx', new Error('boom')).name, 'Error');
  });

  // Not every backend answers with {statusCode, message}: the boltcard API is LNbits, which
  // replies {"detail": ...}. Dropping it here would leave the issue title carrying only the
  // context, with no trace of what actually failed.
  it('keeps a body that does not match the DFX shape', () => {
    assert.strictEqual(toError('ctx', { detail: 'card not found' }).message, 'ctx: {"detail":"card not found"}');
    assert.ok(toError('ctx', { type: 'AUTH_FAILED', code: '91ae' }).message.includes('AUTH_FAILED'));
  });

  it('never renders an object as [object Object]', () => {
    // the last shape is the trap: `message` present, but itself an object
    for (const shape of [{}, { statusCode: 500 }, { unexpected: 'shape' }, { statusCode: 400, message: { code: 'x' } }]) {
      assert.ok(!toError('ctx', shape).message.includes('[object Object]'), `leaked for ${JSON.stringify(shape)}`);
    }
  });

  it('keeps a primitive rejection readable and survives an unserializable one', () => {
    assert.strictEqual(toError('ctx', 'plain string').message, 'ctx: plain string');
    assert.strictEqual(toError('ctx', undefined).message, 'ctx');

    const circular = {};
    circular.self = circular;
    assert.strictEqual(toError('ctx', circular).message, 'ctx');
  });
});
