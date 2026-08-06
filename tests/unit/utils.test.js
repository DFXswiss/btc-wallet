const assert = require('assert');

const { Utils } = require('../../helpers/utils');

describe('helpers/utils Utils.withRetry', () => {
  it('returns the result on the first try without retrying', async () => {
    let calls = 0;
    const result = await Utils.withRetry(async () => {
      calls++;
      return 'ok';
    });
    assert.strictEqual(result, 'ok');
    assert.strictEqual(calls, 1);
  });

  // This is the whole point of the wrapper: a caller about to sign a transaction should not
  // see a transient network blip as a hard failure.
  it('retries after a failure and returns the eventual success', async () => {
    let calls = 0;
    const result = await Utils.withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error('transient');
        return 'ok';
      },
      3,
      1,
    );
    assert.strictEqual(result, 'ok');
    assert.strictEqual(calls, 3);
  });

  // Once every attempt is exhausted the caller has to find out - this is what lets
  // fetchUtxo() callers abort signing instead of proceeding on stale data.
  it('rethrows the last error once every attempt is exhausted', async () => {
    let calls = 0;
    const error = new Error('still failing');
    await assert.rejects(
      Utils.withRetry(
        async () => {
          calls++;
          throw error;
        },
        3,
        1,
      ),
      err => err === error,
    );
    assert.strictEqual(calls, 3);
  });

  it('does not retry at all when attempts is 1', async () => {
    let calls = 0;
    const error = new Error('boom');
    await assert.rejects(
      Utils.withRetry(
        async () => {
          calls++;
          throw error;
        },
        1,
        1,
      ),
      err => err === error,
    );
    assert.strictEqual(calls, 1);
  });
});
