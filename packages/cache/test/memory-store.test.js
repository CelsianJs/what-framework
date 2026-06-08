import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/stores/memory-store.js';

const entry = (over = {}) => ({ html: '<p>x</p>', head: '', state: null, tags: [], path: '/p', ...over });

describe('memory store', () => {
  it('set/get round-trips', async () => {
    const s = createMemoryStore();
    await s.set('k1', entry({ html: '<h1>hi</h1>' }));
    const e = await s.get('k1');
    assert.equal(e.html, '<h1>hi</h1>');
  });

  it('get returns null for a missing key', async () => {
    const s = createMemoryStore();
    assert.equal(await s.get('nope'), null);
  });

  it('delete removes an entry', async () => {
    const s = createMemoryStore();
    await s.set('k', entry());
    await s.delete('k');
    assert.equal(await s.get('k'), null);
  });

  it('deleteByTag removes all entries with that tag and returns their keys', async () => {
    const s = createMemoryStore();
    await s.set('a', entry({ tags: ['posts'] }));
    await s.set('b', entry({ tags: ['posts', 'home'] }));
    await s.set('c', entry({ tags: ['home'] }));
    const deleted = await s.deleteByTag('posts');
    assert.deepEqual(deleted.sort(), ['a', 'b']);
    assert.equal(await s.get('a'), null);
    assert.equal(await s.get('b'), null);
    assert.ok(await s.get('c'), 'untagged-by-posts entry survives');
  });

  it('deleteByPath removes all query/vary variants of a path', async () => {
    const s = createMemoryStore();
    await s.set('blog?a=1', entry({ path: '/blog' }));
    await s.set('blog?a=2', entry({ path: '/blog' }));
    await s.set('other', entry({ path: '/other' }));
    const deleted = await s.deleteByPath('/blog');
    assert.equal(deleted.length, 2);
    assert.ok(await s.get('other'));
  });

  it('evicts the oldest entry past maxEntries (LRU)', async () => {
    const s = createMemoryStore({ maxEntries: 2 });
    await s.set('a', entry());
    await s.set('b', entry());
    await s.get('a'); // touch a -> b is now oldest
    await s.set('c', entry());
    assert.equal(await s.get('b'), null, 'b (LRU) evicted');
    assert.ok(await s.get('a'));
    assert.ok(await s.get('c'));
  });

  it('clear empties everything incl. indexes', async () => {
    const s = createMemoryStore();
    await s.set('a', entry({ tags: ['t'] }));
    await s.clear();
    assert.deepEqual(await s.keys(), []);
    assert.deepEqual(await s.deleteByTag('t'), []);
  });

  it('keys() lists current keys', async () => {
    const s = createMemoryStore();
    await s.set('a', entry());
    await s.set('b', entry());
    assert.deepEqual((await s.keys()).sort(), ['a', 'b']);
  });
});
