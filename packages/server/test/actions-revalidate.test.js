// Server-side revalidation: a server action that declares { revalidate } /
// { revalidateTags } triggers the registered cache handler after it resolves.
// The registry indirection keeps what-server decoupled from what-cache.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { action, handleActionRequest } from '../src/actions.js';
import { setRevalidationHandler } from '../src/revalidation-registry.js';

describe('action server-side revalidation', () => {
  let calls;
  beforeEach(() => {
    calls = { paths: [], tags: [] };
    setRevalidationHandler({
      revalidatePath: async (p) => calls.paths.push(p),
      revalidateTag: async (t) => calls.tags.push(t),
    });
  });

  it('fires revalidatePath for each declared path after the action succeeds', async () => {
    action(async () => ({ ok: true }), { id: 'rev-path', revalidate: ['/blog', '/'] });
    const r = await handleActionRequest({ headers: {} }, 'rev-path', [], { skipCsrf: true });
    assert.equal(r.status, 200);
    assert.deepEqual(calls.paths, ['/blog', '/']);
  });

  it('fires revalidateTag for each declared tag', async () => {
    action(async () => ({ ok: true }), { id: 'rev-tag', revalidateTags: ['posts'] });
    await handleActionRequest({ headers: {} }, 'rev-tag', [], { skipCsrf: true });
    assert.deepEqual(calls.tags, ['posts']);
  });

  it('does not revalidate when the action throws', async () => {
    action(async () => { throw new Error('fail'); }, { id: 'rev-fail', revalidate: ['/x'] });
    const r = await handleActionRequest({ headers: {} }, 'rev-fail', [], { skipCsrf: true });
    assert.equal(r.status, 500);
    assert.deepEqual(calls.paths, []);
  });

  it('no-ops safely when no handler is registered', async () => {
    setRevalidationHandler(null);
    action(async () => ({ ok: true }), { id: 'rev-none', revalidate: ['/x'] });
    const r = await handleActionRequest({ headers: {} }, 'rev-none', [], { skipCsrf: true });
    assert.equal(r.status, 200); // no throw
  });
});
