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
});
