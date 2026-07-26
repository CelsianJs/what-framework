import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRevalidateWebhook } from '../src/webhook.js';

function fakeEngine() {
  const calls = { paths: [], tags: [] };
  return {
    calls,
    revalidatePath: async (p) => { calls.paths.push(p); return ['k']; },
    revalidateTag: async (t) => { calls.tags.push(t); return ['k']; },
  };
}

const SECRET = 'super-secret-value';

describe('createRevalidateWebhook', () => {
  it('revalidates paths with a valid secret', async () => {
    const engine = fakeEngine();
    const hook = createRevalidateWebhook(engine, { secret: SECRET });
    const res = await hook({ headers: { 'x-what-revalidate-secret': SECRET }, body: { paths: ['/blog', '/'] } });
    assert.equal(res.status, 200);
    assert.deepEqual(engine.calls.paths, ['/blog', '/']);
  });

  it('revalidates tags with a valid secret', async () => {
    const engine = fakeEngine();
    const hook = createRevalidateWebhook(engine, { secret: SECRET });
    const res = await hook({ headers: { 'x-what-revalidate-secret': SECRET }, body: { tags: ['posts'] } });
    assert.equal(res.status, 200);
    assert.deepEqual(engine.calls.tags, ['posts']);
  });

  it('rejects a wrong secret with 401', async () => {
    const engine = fakeEngine();
    const hook = createRevalidateWebhook(engine, { secret: SECRET });
    const res = await hook({ headers: { 'x-what-revalidate-secret': 'wrong-secret-value' }, body: { tags: ['x'] } });
    assert.equal(res.status, 401);
    assert.equal(engine.calls.tags.length, 0);
  });

  it('rejects a missing secret with 401', async () => {
    const engine = fakeEngine();
    const hook = createRevalidateWebhook(engine, { secret: SECRET });
    const res = await hook({ headers: {}, body: { tags: ['x'] } });
    assert.equal(res.status, 401);
  });

  it('rejects a malformed body with 400', async () => {
    const engine = fakeEngine();
    const hook = createRevalidateWebhook(engine, { secret: SECRET });
    const res = await hook({ headers: { 'x-what-revalidate-secret': SECRET }, body: null });
    assert.equal(res.status, 400);
  });

  it('rejects a secret of the wrong length without leaking that length', async () => {
    const engine = fakeEngine();
    const hook = createRevalidateWebhook(engine, { secret: SECRET });
    for (const wrong of ['s', SECRET.slice(0, -1), SECRET + 'x']) {
      assert.equal((await hook({ headers: { 'x-what-revalidate-secret': wrong }, body: { tags: ['x'] } })).status, 401);
    }
  });

  it('ignores `regenerate` in the request body (operator policy wins)', async () => {
    const seen = [];
    const engine = { revalidatePath: async (p, o) => { seen.push(o); return []; }, revalidateTag: async () => [] };
    const hook = createRevalidateWebhook(engine, { secret: SECRET });
    await hook({ headers: { 'x-what-revalidate-secret': SECRET }, body: { paths: ['/a'], regenerate: true } });
    assert.deepEqual(seen, [{ regenerate: false }]);
  });

  it('caps the batch so one request cannot force thousands of renders', async () => {
    const engine = fakeEngine();
    const hook = createRevalidateWebhook(engine, { secret: SECRET });
    const paths = Array.from({ length: 101 }, (_, i) => `/p${i}`);
    const res = await hook({ headers: { 'x-what-revalidate-secret': SECRET }, body: { paths } });
    assert.equal(res.status, 400);
    assert.equal(engine.calls.paths.length, 0, 'nothing was revalidated');

    const ok = await hook({ headers: { 'x-what-revalidate-secret': SECRET }, body: { paths: paths.slice(0, 60), tags: ['a'] } });
    assert.equal(ok.status, 200);
  });
});
