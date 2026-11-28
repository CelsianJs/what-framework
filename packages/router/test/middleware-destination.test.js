// Route middleware is told where a navigation is going: its context carries the
// destination's whole URL (path + search + hash) beside its path, params and
// query, while `route` still reads the page being left. And a key the query
// repeats (`?tag=a&tag=b`) is an array of its values everywhere a parsed query
// reaches (middleware, preload, the page's props, route.query, parseQuery).
// Before, the middleware context had no `url` (a guard that redirects to a
// login page could not send the user back to the exact URL they asked for).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' });
window.scrollTo = () => {};

const { h } = await import('../../core/src/h.js');
const { mount } = await import('../../core/src/dom.js');
const { untrack } = await import('../../core/src/reactive.js');
const server = await import('../../server/src/index.js');
const { Router, navigate, route, parseQuery } = await import('../src/index.js');

const tick = () => new Promise((r) => setTimeout(r, 0));

function routesSeeing(seen) {
  return [
    { path: '/', component: () => h('p', null, 'home') },
    {
      path: '/private',
      middleware: [(context) => {
        seen.middleware = { url: context.url, path: context.path, query: { ...context.query }, current: untrack(() => route.url) };
        return true;
      }],
      preload: ({ query, url }) => { seen.preload = { query: { ...query }, url }; return null; },
      component: ({ query }) => {
        seen.props = { ...query };
        seen.route = { ...route.query };
        return h('p', { id: 'private' }, 'private');
      },
    },
  ];
}

describe('middleware destination', () => {
  it('gives middleware the full destination URL, and repeated query keys as arrays', async () => {
    const seen = {};
    await navigate('/', { replace: true, transition: false });
    const app = document.getElementById('app');
    const unmount = mount(h(Router, { routes: routesSeeing(seen) }), app);
    try {
      await navigate('/private?tag=a&tag=b&one=1#marker', { transition: false });
      await tick();
      assert.ok(app.querySelector('#private'));
      assert.deepEqual(seen.middleware, {
        url: '/private?tag=a&tag=b&one=1#marker',
        path: '/private',
        query: { tag: ['a', 'b'], one: '1' },
        current: '/',
      });
      assert.deepEqual(seen.preload, { query: { tag: ['a', 'b'], one: '1' }, url: '/private?tag=a&tag=b&one=1#marker' });
      assert.deepEqual(seen.props, { tag: ['a', 'b'], one: '1' });
      assert.deepEqual(seen.route, { tag: ['a', 'b'], one: '1' });
    } finally {
      unmount();
    }
  });

  it('gives middleware the URL a server render shows', async () => {
    const seen = {};
    const { body } = await server.renderToStringAsync(h(Router, { routes: routesSeeing(seen), url: '/private?tag=x&tag=y#top' }));
    assert.match(body, /private/);
    assert.equal(seen.middleware.url, '/private?tag=x&tag=y#top');
    assert.deepEqual(seen.middleware.query, { tag: ['x', 'y'] });
  });

  it('parseQuery keeps every value of a repeated key, in order', () => {
    assert.deepEqual({ ...parseQuery('?tag=a&tag=b&tag=c&x=1') }, { tag: ['a', 'b', 'c'], x: '1' });
  });
});
