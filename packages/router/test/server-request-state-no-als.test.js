// The per-request route state without an async context provider (an edge
// runtime with no AsyncLocalStorage): every read inside the render's own
// slices (a layout, the page before an await, a <Suspense> boundary that
// renders later) shows its own request, and a read after an await shows no
// route state at all, never another request's.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderInterleaved } from './interleaved-renders.js';

delete process.getBuiltinModule;
delete globalThis.AsyncLocalStorage;

const { h, Suspense } = await import('what-core');
const { query } = await import('what-core/data');
const server = await import('../../server/src/index.js');
const { Router, route, useParams, useSearch, useRoute, beforeNavigate, navigate } = await import('../src/index.js');

describe('<Router> state on the server without AsyncLocalStorage', () => {
  it('shows each render its own route state, or none after an await, never another request\'s', async () => {
    const { results, client } = await renderInterleaved({ server, h, Suspense, query, Router, route, useParams, useSearch, useRoute });
    for (const { i, foreign, fields } of results) {
      assert.deepEqual(foreign, [], `render ${i} shows another request's route state`);
      assert.deepEqual(fields, { layout: 'own', before: 'own', after: 'none', later: 'own' }, `render ${i}`);
    }
    assert.deepEqual(client, { url: '/', path: '/', hash: '', params: {}, query: {} });
  });
});

describe('a server process without AsyncLocalStorage never navigates', () => {
  it('keeps no hook subscribed after an await, and a navigate() after one leaves later renders alone', async () => {
    let ran = 0;
    const Page = async () => {
      await Promise.resolve();
      beforeNavigate(() => { ran++; });
      void navigate('/dashboard');
      return h('p', null, 'page');
    };
    const routes = [
      { path: '/', component: Page },
      { path: '/dashboard', loading: () => h('p', null, 'dashboard loading'), component: () => h('p', null, 'dashboard') },
      { path: '/products', component: () => h('p', null, 'products') },
    ];
    for (let i = 0; i < 5; i++) await server.renderToStringAsync(h(Router, { routes }), { request: new Request('http://app.test/') });
    const { body } = await server.renderToStringAsync(h(Router, { routes }), { request: new Request('http://app.test/products') });
    assert.match(body, /products/);
    assert.doesNotMatch(body, /loading/);
    await navigate('/elsewhere');
    assert.equal(ran, 0, 'a hook a render subscribed ran on a later navigate()');
    assert.equal(route.isNavigating, false);
  });
});
