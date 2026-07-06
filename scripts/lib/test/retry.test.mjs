import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { retryWithBackoff } from '../retry.mjs';

function fakeSleep(record) {
  return async (ms) => {
    record.push(ms);
  };
}

describe('retryWithBackoff', () => {
  it('returns the result on first success without sleeping or retrying', async () => {
    const sleeps = [];
    let calls = 0;
    const result = await retryWithBackoff(
      async (attempt) => {
        calls += 1;
        assert.equal(attempt, 1);
        return 'ok';
      },
      { sleep: fakeSleep(sleeps) },
    );
    assert.equal(result, 'ok');
    assert.equal(calls, 1);
    assert.deepEqual(sleeps, []);
  });

  it('retries with the configured backoff and succeeds once the task recovers', async () => {
    const sleeps = [];
    const retries = [];
    let calls = 0;
    const result = await retryWithBackoff(
      async (attempt) => {
        calls += 1;
        if (attempt < 3) throw new Error(`fail ${attempt}`);
        return 'recovered';
      },
      {
        attempts: 5,
        delaysMs: [10, 20, 30, 40],
        sleep: fakeSleep(sleeps),
        onRetry: (info) => retries.push(info),
      },
    );
    assert.equal(result, 'recovered');
    assert.equal(calls, 3);
    assert.deepEqual(sleeps, [10, 20]);
    assert.deepEqual(
      retries.map((r) => [r.attempt, r.attempts, r.delayMs, r.error.message]),
      [
        [1, 5, 10, 'fail 1'],
        [2, 5, 20, 'fail 2'],
      ],
    );
  });

  it('throws the final error after exhausting all attempts, without an extra sleep', async () => {
    const sleeps = [];
    let calls = 0;
    await assert.rejects(
      () =>
        retryWithBackoff(
          async () => {
            calls += 1;
            throw new Error(`boom ${calls}`);
          },
          { attempts: 3, delaysMs: [5, 5], sleep: fakeSleep(sleeps) },
        ),
      /boom 3/,
    );
    assert.equal(calls, 3);
    // Only 2 sleeps: no sleep after the final, non-retried attempt.
    assert.deepEqual(sleeps, [5, 5]);
  });

  it('reuses the last delay entry when there are more retries than delay entries', async () => {
    const sleeps = [];
    let calls = 0;
    await assert.rejects(() =>
      retryWithBackoff(
        async () => {
          calls += 1;
          throw new Error('always fails');
        },
        { attempts: 4, delaysMs: [100], sleep: fakeSleep(sleeps) },
      ),
    );
    assert.equal(calls, 4);
    assert.deepEqual(sleeps, [100, 100, 100]);
  });

  it('runs exactly once and never sleeps when attempts is 1', async () => {
    const sleeps = [];
    let calls = 0;
    await assert.rejects(() =>
      retryWithBackoff(
        async () => {
          calls += 1;
          throw new Error('single shot');
        },
        { attempts: 1, sleep: fakeSleep(sleeps) },
      ),
    );
    assert.equal(calls, 1);
    assert.deepEqual(sleeps, []);
  });

  it('rejects a non-positive-integer attempts option', async () => {
    await assert.rejects(
      () => retryWithBackoff(async () => 'unreachable', { attempts: 0 }),
      /attempts must be a positive integer/,
    );
  });
});
