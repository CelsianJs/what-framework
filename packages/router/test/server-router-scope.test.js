// A server <Router> under a DOM shim (jsdom), where `location` exists but is
// not the request: each Router reads its own route state, in its pages, its
// middleware and its preload, and a relative navigate() resolves against the
// URL the render shows.
//   - Two sibling Routers that show URLs of their own keep them, also after a
//     streamed boundary of the first resumes (neither writes the request's).
//   - A nested Router's middleware and preload read its URL and params
//     through `route`, as its pages do: the preparation provides its state.
//   - navigate('next') on /docs/current redirects to /docs/next, where the
//     browser would go.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { withResolvers } from '../../../test-utils/with-resolvers.js';

installDOM('<main></main>', { url: 'http://localhost/' });
const { h, Suspense } = await import('what-core');
const { query } = await import('what-core/data');
const { renderToStringAsync, renderToStream, createResponse } = await import('../../server/src/index.js');
const { navigate, Router, route } = await import('../src/index.js');

describe('a server Router reads its own route state', () => {
  it('two sibling Routers keep their own URLs across a streamed boundary', async () => {
    const gate = withResolvers();
    const First = () => {
      query('scope-first-router', () => gate.promise)();
      return 'first:' + route.path + ':' + route.params.id;
    };
    const one = [{ path: '/a/:id', component: () => h(Suspense, { fallback: 'wait' }, h(First)) }];
    const two = [{ path: '/b/:id', component: () => 'second:' + route.path + ':' + route.params.id }];
    let html = '';
    for await (const chunk of renderToStream(h('main', null, h(Router, { routes: one, url: '/a/1' }), h(Router, { routes: two, url: '/b/2' })))) {
      html += chunk;
      if (html.includes('second:')) gate.resolve();
    }
    assert.match(html, /first:\/a\/1:1/);
    assert.match(html, /second:\/b\/2:2/);
  });

  it('a nested Router\'s middleware and preload see its URL', async () => {
    const seen = [];
    const inner = [{
      path: '/panel/:id',
      middleware: [() => { seen.push(['middleware', route.path, route.params.id]); }],
      preload: () => { seen.push(['preload', route.path, route.params.id]); },
      component: () => { seen.push(['component', route.path, route.params.id]); return 'panel'; },
    }];
    const routes = [{ path: '/app/:id', component: () => h(Router, { routes: inner, url: '/panel/2' }) }];
    await renderToStringAsync(h(Router, { routes }), { request: new Request('http://localhost/app/1') });
    assert.deepEqual(seen, ['middleware', 'preload', 'component'].map((phase) => [phase, '/panel/2', '2']));
  });

  it('a relative navigate() resolves against the URL the render shows', async () => {
    for (const [to, location] of [['next', '/docs/next'], ['../up?x=1', '/up?x=1'], ['?page=2', '/docs/current?page=2'], ['/abs', '/abs']]) {
      const response = createResponse();
      const routes = [{ path: '/docs/current', component: () => { void navigate(to); return 'current'; } }];
      await renderToStringAsync(h(Router, { routes }), { request: new Request('http://localhost/docs/current'), response });
      assert.deepEqual([response.status, response.location], [302, location], to);
    }
  });
});
