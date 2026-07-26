import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFilesystemStore } from '../src/stores/filesystem-store.js';

const entry = (over = {}) => ({ html: '<p>x</p>', head: '', state: null, tags: [], path: '/p', ...over });

let dir;
before(async () => { dir = await mkdtemp(join(tmpdir(), 'whatcache-')); });
after(async () => { await rm(dir, { recursive: true, force: true }); });

describe('filesystem store', () => {
  it('set/get round-trips', async () => {
    const s = createFilesystemStore({ dir });
    await s.set('k1', entry({ html: '<h1>fs</h1>' }));
    const e = await s.get('k1');
    assert.equal(e.html, '<h1>fs</h1>');
  });

  it('persists across a new store instance (restart simulation)', async () => {
    const s1 = createFilesystemStore({ dir });
    await s1.set('persist', entry({ html: '<b>kept</b>' }));
    const s2 = createFilesystemStore({ dir });
    const e = await s2.get('persist');
    assert.equal(e.html, '<b>kept</b>');
  });

  it('get returns null for a missing key', async () => {
    const s = createFilesystemStore({ dir });
    assert.equal(await s.get('does-not-exist'), null);
  });

  it('deleteByTag removes tagged entries and returns their keys', async () => {
    const s = createFilesystemStore({ dir });
    await s.set('ta', entry({ tags: ['grp'] }));
    await s.set('tb', entry({ tags: ['grp'] }));
    const deleted = await s.deleteByTag('grp');
    assert.equal(deleted.length, 2);
    assert.equal(await s.get('ta'), null);
  });

  it('deleteByPath removes path variants', async () => {
    const s = createFilesystemStore({ dir });
    await s.set('pa', entry({ path: '/listing' }));
    await s.set('pb', entry({ path: '/listing' }));
    const deleted = await s.deleteByPath('/listing');
    assert.equal(deleted.length, 2);
  });

  it('concurrent writes of different variants stay in the path index', async () => {
    // Two workers caching ?page=1 and ?page=2 of the same route used to race on
    // one shared index file, orphaning whichever entry lost the rename.
    const s = createFilesystemStore({ dir: join(dir, 'race') });
    const keys = Array.from({ length: 12 }, (_, i) => `/feed?page=${i}`);
    await Promise.all(keys.map((k) => s.set(k, entry({ path: '/feed', tags: ['feed'] }))));
    const deleted = await s.deleteByPath('/feed');
    assert.equal(deleted.length, keys.length, 'every variant is still reachable by path');
    assert.deepEqual(await s.keys(), []);
  });

  it('concurrent writes of different variants stay in the tag index', async () => {
    const s = createFilesystemStore({ dir: join(dir, 'race-tags') });
    const keys = Array.from({ length: 12 }, (_, i) => `/post/${i}`);
    await Promise.all(keys.map((k, i) => s.set(k, entry({ path: `/post/${i}`, tags: ['posts'] }))));
    assert.equal((await s.deleteByTag('posts')).length, keys.length);
  });

  it('keys() and clear() work', async () => {
    const s = createFilesystemStore({ dir: join(dir, 'sub') });
    await s.set('a', entry());
    await s.set('b', entry());
    assert.equal((await s.keys()).length, 2);
    await s.clear();
    assert.deepEqual(await s.keys(), []);
  });
});
