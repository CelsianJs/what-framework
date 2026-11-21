// The page side of what_cache and what_invalidate_cache, against the real
// query cache: what the tools read is what-core's __getCacheSnapshot, and an
// invalidation goes through __invalidateFromDevtools.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

let env;
let internal;
let data;
let cacheSnapshot;
let invalidateCache;
before(async () => {
  env = installDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/inbox' });
  internal = await import('what-core/internal');
  data = await import('what-core/data');
  ({ cacheSnapshot, invalidateCache } = await import('../src/cache-commands.js'));
});
after(() => env.cleanup());

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const devtools = { preview: (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value))) };

describe('the query cache, as the MCP tools see it', () => {
  it('lists each key with its status, value, readers and last fetch', async () => {
    let n = 0;
    const q = data.useQuery({ queryKey: ['todos', 1], queryFn: async () => ({ n: ++n }), refetchOnWindowFocus: false });
    data.useSWR('/api/me', async () => { throw new Error('offline'); }, { revalidateOnFocus: false });
    await tick();
    const { entries } = cacheSnapshot(internal, devtools);
    const byKey = Object.fromEntries(entries.map((e) => [e.key, e]));
    assert.deepEqual(byKey['todos:1'].data, { n: 1 });
    assert.equal(byKey['todos:1'].status, 'success');
    assert.equal(byKey['todos:1'].observers, 1);
    assert.equal(byKey['todos:1'].lastFetch.ok, true);
    assert.deepEqual(byKey['todos:1'].paths, ['/inbox'], 'read on the page at /inbox');
    assert.equal(byKey['/api/me'].status, 'error');
    assert.equal(byKey['/api/me'].error, 'offline');
    assert.equal(q.data().n, 1);
  });

  it('invalidates a key, or an array prefix, and refetches what is on screen', async () => {
    let n = 0;
    const q = data.useQuery({ queryKey: ['inbox', 'unread'], queryFn: async () => ++n, refetchOnWindowFocus: false });
    await tick();
    assert.deepEqual(invalidateCache(internal, 'inbox:unread'), { invalidated: ['inbox:unread'] });
    await tick();
    assert.equal(q.data(), 2);
    assert.deepEqual(invalidateCache(internal, '["inbox"]'), { invalidated: ['inbox:unread'] });
    await tick();
    assert.equal(q.data(), 3);
    assert.deepEqual(invalidateCache(internal, 'nothing-here'), { invalidated: [] });
  });

  it('says so when the page has no query cache', () => {
    assert.match(invalidateCache({}, 'x').error, /no query cache/);
    assert.deepEqual(cacheSnapshot({}, devtools), { entries: [] });
  });
});
