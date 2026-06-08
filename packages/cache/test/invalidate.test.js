import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createCacheEngine } from '../src/isr.js';
import { createMemoryStore } from '../src/stores/memory-store.js';

function setup(cdn) {
  let n = 0;
  const render = async (route) => { n++; return { html: `<p>${route.path}#${n}</p>`, head: '', state: null, tags: route.config?.tags || [] }; };
  const store = createMemoryStore();
  const engine = createCacheEngine({ store, render, cdn });
  return { engine, store, renders: () => n };
}

describe('revalidatePath', () => {
  it('purges every query/vary variant of a path', async () => {
    const { engine, store } = setup();
    await engine.handle({ path: '/blog', query: { a: '1' }, config: { mode: 'static', revalidate: 60 } });
    await engine.handle({ path: '/blog', query: { a: '2' }, config: { mode: 'static', revalidate: 60 } });
    const deleted = await engine.revalidatePath('/blog');
    assert.equal(deleted.length, 2);
    assert.deepEqual(await store.keys(), []);
  });

  it('fans out to the CDN purge adapter', async () => {
    const purged = [];
    const cdn = { purge: async (urls) => purged.push(...urls) };
    const { engine } = setup(cdn);
    await engine.handle({ path: '/x', query: {}, config: { mode: 'static', revalidate: 60 } });
    await engine.revalidatePath('/x');
    assert.deepEqual(purged, ['/x']);
  });
});

describe('revalidateTag', () => {
  it('purges all entries carrying a tag and returns their keys', async () => {
    const { engine, store } = setup();
    await engine.handle({ path: '/a', query: {}, config: { mode: 'static', revalidate: 60, tags: ['posts'] } });
    await engine.handle({ path: '/b', query: {}, config: { mode: 'static', revalidate: 60, tags: ['posts'] } });
    await engine.handle({ path: '/c', query: {}, config: { mode: 'static', revalidate: 60, tags: ['other'] } });
    const deleted = await engine.revalidateTag('posts');
    assert.equal(deleted.length, 2);
    assert.equal((await store.keys()).length, 1, 'only the other-tagged entry remains');
  });

  it('fans out to the CDN tag-purge adapter', async () => {
    const purgedTags = [];
    const cdn = { purgeTags: async (tags) => purgedTags.push(...tags) };
    const { engine } = setup(cdn);
    await engine.handle({ path: '/a', query: {}, config: { mode: 'static', revalidate: 60, tags: ['posts'] } });
    await engine.revalidateTag('posts');
    assert.deepEqual(purgedTags, ['posts']);
  });
});
