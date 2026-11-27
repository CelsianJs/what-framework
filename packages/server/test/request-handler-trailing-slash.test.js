// The request handler matches a request's path as the client router does: a
// trailing slash is ignored, except on the root. '/about/' renders the route
// written '/about', with the params of '/about', and the cache keeps one entry
// for both URLs. Before, '/about/' answered 404, and a catch-all's param kept
// the slash ('a/').

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { h } from 'what-core';
import { createCacheEngine, createMemoryStore } from 'what-isr';
import { createRequestHandler } from '../src/index.js';

const routes = [
  { path: '/', component: () => h('p', null, 'home'), mode: 'server' },
  { path: '/about', component: () => h('p', null, 'about'), mode: 'server' },
  { path: '/users/:id', component: ({ id }) => h('p', null, `user ${id}`), mode: 'server' },
  { path: '/docs/*', component: ({ rest }) => h('p', null, `doc [${rest}]`), mode: 'server' },
];

async function get(handler, path) {
  const response = await handler(new Request('http://app.test' + path));
  return { status: response.status, body: await response.text(), cache: response.headers.get('x-what-cache') };
}

describe('createRequestHandler and a trailing slash', () => {
  it('renders the route a path without its trailing slash matches', async () => {
    const handler = createRequestHandler({ routes, csrf: false });
    for (const [path, text] of [['/about/', 'about'], ['/users/7/', 'user 7'], ['/docs/a/b/', 'doc [a/b]'], ['/', 'home']]) {
      const { status, body } = await get(handler, path);
      assert.equal(status, 200, path);
      assert.ok(body.includes(text), `${path} renders ${text}`);
    }
    assert.equal((await get(handler, '/app/about/')).status, 404);
  });

  it('matches below a base path the same way', async () => {
    const handler = createRequestHandler({ routes, basePath: '/app/', csrf: false });
    assert.ok((await get(handler, '/app/about/')).body.includes('about'));
    assert.ok((await get(handler, '/app/')).body.includes('home'));
  });

  it('serves both URLs of a cached page from one entry', async () => {
    let renders = 0;
    const cached = [{ path: '/docs/*', mode: 'static', page: { mode: 'static', revalidate: 60 }, component: () => null }];
    const handler = createRequestHandler({
      routes: cached,
      csrf: false,
      cache: createCacheEngine({ store: createMemoryStore() }),
      render: async (match) => {
        renders++;
        return { html: `${match.path} [${match.params.rest}]`, status: 200 };
      },
    });
    const first = await get(handler, '/docs/guide/');
    assert.equal(first.body, '/docs/guide [guide]');
    const second = await get(handler, '/docs/guide');
    assert.equal(second.cache, 'HIT');
    assert.equal(second.body, '/docs/guide [guide]');
    assert.equal(renders, 1);
  });
});
