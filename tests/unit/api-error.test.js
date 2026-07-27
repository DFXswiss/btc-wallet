const assert = require('assert');

const { toError } = require('../../api/dfx/definitions/error');

// The DFX API layer rejects with the parsed error body rather than an Error, and Sentry
// files an issue from the first Error among the console arguments. Everything below is
// about what the resulting issue looks like: an un-normalized body produces one stackless
// issue titled "... [object Object]" for every failure.
describe('api/dfx/definitions/error toError', () => {
  it('titles an API error body with the context and its message', () => {
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
  it('keeps the context for a rejection that is already an Error, and links the original', () => {
    const cause = new TypeError('Network request failed');
    const error = toError('receivePos: payment status poll failed', cause);

    assert.strictEqual(error.message, 'receivePos: payment status poll failed: Network request failed');
    assert.strictEqual(error.cause, cause);
    assert.strictEqual(error.name, 'ApiError');
  });

  it('never renders an object as [object Object]', () => {
    for (const shape of [{}, { statusCode: 500 }, { unexpected: 'shape' }]) {
      assert.ok(!toError('ctx', shape).message.includes('[object Object]'), `leaked for ${JSON.stringify(shape)}`);
    }
  });

  it('keeps a primitive rejection readable', () => {
    assert.strictEqual(toError('ctx', 'plain string').message, 'ctx: plain string');
    assert.strictEqual(toError('ctx', undefined).message, 'ctx');
  });
});
