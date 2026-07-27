const assert = require('assert');

const { toError, reportError } = require('../../helpers/errors');

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

  it('never renders an object as [object Object], in the value or the type', () => {
    // both traps: `message` present but itself an object, and the same for `statusCode` -
    // the type is half the issue title, so an unguarded one puts it right back
    const shapes = [
      {},
      { statusCode: 500 },
      { unexpected: 'shape' },
      { statusCode: 400, message: { code: 'x' } },
      { statusCode: { a: 1 } },
    ];
    for (const shape of shapes) {
      const error = toError('ctx', shape);
      assert.ok(!error.message.includes('[object Object]'), `value leaked for ${JSON.stringify(shape)}`);
      assert.ok(!error.name.includes('[object Object]'), `type leaked for ${JSON.stringify(shape)}`);
    }
  });

  // Whatever came off the wire is bounded, whichever field it arrived in: an issue title is
  // not the place for a 5 kB error body.
  it('caps a long detail from either branch', () => {
    for (const shape of [{ detail: 'a'.repeat(5000) }, { statusCode: 500, message: 'b'.repeat(5000) }]) {
      const { message } = toError('ctx', shape);
      assert.ok(message.length <= 'ctx: '.length + 203, `not capped: ${message.length}`);
      assert.ok(message.endsWith('...'), 'truncation should be marked');
    }
  });

  it('keeps a primitive rejection readable and survives an unserializable one', () => {
    assert.strictEqual(toError('ctx', 'plain string').message, 'ctx: plain string');
    assert.strictEqual(toError('ctx', undefined).message, 'ctx');

    const circular = {};
    circular.self = circular;
    assert.strictEqual(toError('ctx', circular).message, 'ctx');
  });

  // The Error is built inside the helper, so without popping frames the culprit shown on
  // every issue in the app would be helpers/errors.ts rather than the code that failed.
  it('pops its own frames so the culprit is the call site', () => {
    assert.strictEqual(toError('ctx', 'boom').framesToPop, 1);
    // and it must not be serialized along with the error
    assert.ok(!Object.keys(toError('ctx', 'boom')).includes('framesToPop'));
  });
});

describe('helpers/errors reportError', () => {
  let calls;
  beforeEach(() => {
    calls = [];
    jest.spyOn(console, 'error').mockImplementation((...args) => calls.push(args));
  });
  afterEach(() => jest.restoreAllMocks());

  // Context first: the console-to-logs integration only builds a message template when the
  // first argument is a string. captureConsole still files the wrapper, because it takes the
  // first Error among the arguments rather than the first argument.
  it('logs the context first, then the wrapper, then the original', () => {
    const original = { statusCode: 404, message: 'Not found' };
    reportError('receivePos: poll failed', original);

    const [args] = calls;
    assert.strictEqual(args[0], 'receivePos: poll failed');
    assert.ok(args[1] instanceof Error);
    assert.strictEqual(args[1].name, 'ApiError404');
    assert.strictEqual(args[2], original);
    // what captureConsole would pick
    assert.strictEqual(
      args.find(a => a instanceof Error),
      args[1],
    );
  });

  it('pops the extra helper frame it adds', () => {
    reportError('ctx', new Error('boom'));
    assert.strictEqual(calls[0][1].framesToPop, 2);
  });
});
