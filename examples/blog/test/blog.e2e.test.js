// End-to-end proof of the full stack: boots the real Node adapter with the blog
// routes and exercises SSR + loader + getStaticPaths + ISR (MISS->HIT) + a
// server action that revalidates the cached home page.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { toNodeListener } from 'what-framework/server';
import { createHandler } from '../server.js';

let server, base;
before(async () => {
  server = http.createServer(toNodeListener(createHandler()));
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

async function get(path) {
  const res = await fetch(base + path);
  return { status: res.status, cache: res.headers.get('x-what-cache'), cc: res.headers.get('cache-control'), body: await res.text() };
}

describe('blog e2e', () => {
  it('SSRs the home page with loader data + SSR <head>', async () => {
    const r = await get('/');
    assert.equal(r.status, 200);
    assert.match(r.body, /What Blog/);
    assert.match(r.body, /Hello, World/);            // loader data
    assert.match(r.body, /<title>What Blog<\/title>/); // SSR head
    assert.match(r.body, /id="__what_data"/);          // hydration payload
  });

  it('ISR: first hit MISS, second hit HIT with s-maxage', async () => {
    await get('/blog/why-signals');             // prime
    const first = await get('/blog/hello-world'); // distinct key -> MISS
    assert.equal(first.cache, 'MISS');
    const second = await get('/blog/hello-world');
    assert.equal(second.cache, 'HIT');
    assert.match(second.cc, /s-maxage=60/);
    assert.match(second.body, /The first post/);
  });

  it('getStaticPaths fallback:blocking renders an unbuilt slug on first hit', async () => {
    // Not in the initial set until created; with blocking fallback a miss renders.
    const r = await get('/blog/why-signals');
    assert.equal(r.status, 200);
    assert.match(r.body, /Why Signals/);
  });

  it('a server action creates a post and revalidates the home cache', async () => {
    await get('/');                                  // cache home (HIT next)
    const cachedAgain = await get('/');
    assert.equal(cachedAgain.cache, 'HIT');

    const res = await fetch(base + '/__what_action', {
      method: 'POST',
      headers: { 'x-what-action': 'createPost', 'content-type': 'application/json' },
      body: JSON.stringify({ args: [{ title: 'Fresh Post', body: 'new content' }] }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, slug: 'fresh-post' });

    // revalidatePath('/') purged the home cache -> next hit re-renders (MISS) and
    // includes the new post.
    const afterAction = await get('/');
    assert.equal(afterAction.cache, 'MISS');
    assert.match(afterAction.body, /Fresh Post/);
  });
});
