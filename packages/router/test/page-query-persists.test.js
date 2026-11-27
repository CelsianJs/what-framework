// A route's page stays mounted while only the query changes (`?page=2`,
// `?help=keys`), as React Router keeps the route's element: its state, its
// DOM and what the visitor typed survive, and its `query` and `data` props
// are live, so JSX that reads `props.query.page` shows the current URL's.
// Another route, or the same route with other params (`/items/1` to
// `/items/2`), builds the page again, for them.
//
// Own file: the router keeps module-scoped URL state.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' });

const { h, mount, signal, useEffect } = await import('what-core');
const { Router, navigate, route, useRoute, useSearch } = await import('../src/index.js');

const flush = (ms = 20) => new Promise((r) => setTimeout(r, ms));

let unmount = null;
async function start(url, routes, props = {}) {
  if (unmount) unmount();
  await navigate(url, { transition: false });
  const app = document.getElementById('app');
  app.textContent = '';
  unmount = mount(h(Router, { routes, ...props }), app);
  await flush();
}

function type(id, text) {
  const input = document.getElementById(id);
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return input;
}

describe('a page keeps its state when only the query changes', () => {
  it('keeps the page, its DOM and its state, and its query props follow the URL', async () => {
    let built = 0;
    const effects = [];
    function List(props) {
      built++;
      const draft = signal('');
      const r = useRoute();
      useEffect(() => { effects.push(props.query.page); });
      return h('section', { id: 'list' },
        h('input', { id: 'draft', value: () => draft(), oninput: (e) => draft(e.target.value) }),
        h('span', { id: 'prop' }, () => `page ${props.query.page ?? 1}`),
        h('span', { id: 'hook' }, () => `${r.query().page}/${route.query.page}/${useSearch().page}`));
    }
    await start('/list?page=1', [{ path: '/list', component: List }]);
    const section = document.getElementById('list');
    const input = type('draft', 'typed');
    await navigate('/list?page=2');
    await flush();
    assert.equal(built, 1, 'the page is built once');
    assert.equal(document.getElementById('list'), section, 'it keeps its DOM');
    assert.equal(document.getElementById('draft'), input);
    assert.equal(input.value, 'typed', 'and its state');
    assert.equal(document.getElementById('prop').textContent, 'page 2', 'JSX that reads props.query follows the URL');
    assert.equal(document.getElementById('hook').textContent, '2/2/2', 'useRoute(), route and useSearch() agree with it');
    assert.deepEqual(effects, ['1', '2'], 'an effect that reads props.query runs again');
    history.back();
    await flush(50);
    assert.equal(document.getElementById('prop').textContent, 'page 1', 'back to the last query keeps the page too');
    assert.equal(built, 1);
  });

  it('builds the page again for other params, and for another route', async () => {
    const built = [];
    const Item = (props) => { built.push(props.params.id); return h('p', { id: 'item' }, `item ${props.params.id}`); };
    await start('/items/1', [
      { path: '/items/:id', component: Item },
      { path: '/elsewhere', component: () => h('p', { id: 'item' }, 'elsewhere') },
    ]);
    await navigate('/items/1?sort=asc');
    await flush();
    assert.deepEqual(built, ['1']);
    await navigate('/items/2?sort=asc');
    await flush();
    assert.deepEqual(built, ['1', '2'], 'a page that read its params in its body shows the new ones');
    assert.equal(document.getElementById('item').textContent, 'item 2');
    await navigate('/elsewhere');
    await flush();
    await navigate('/items/2');
    await flush();
    assert.deepEqual(built, ['1', '2', '2']);
  });

  it('runs the preload again for the new query, and the page reads the new data', async () => {
    let built = 0;
    const loads = [];
    const routes = [{
      path: '/search',
      preload: ({ query }) => { loads.push(query.q); return { hits: `hits for ${query.q}` }; },
      component: (props) => { built++; return h('p', { id: 'hits' }, () => props.data.hits); },
    }];
    await start('/search?q=a', routes);
    assert.equal(document.getElementById('hits').textContent, 'hits for a');
    await navigate('/search?q=b');
    await flush();
    assert.deepEqual(loads, ['a', 'b']);
    assert.equal(document.getElementById('hits').textContent, 'hits for b');
    assert.equal(built, 1);
  });

  it('shows no `loading:` for a change of query, and the route\'s own for other params', async () => {
    let built = 0;
    let release;
    const routes = [{
      path: '/feed/:tab',
      loading: () => h('p', { id: 'loading' }, 'loading'),
      preload: () => new Promise((resolve) => { release = resolve; }),
      component: (props) => { built++; return h('p', { id: 'feed' }, () => `${props.params.tab} ${props.query.n}`); },
    }];
    const first = start('/feed/a?n=1', routes);
    await flush();
    release();
    await first;
    await flush();
    const feed = document.getElementById('feed');
    const going = navigate('/feed/a?n=2');
    await flush();
    assert.equal(document.getElementById('loading'), null, 'the page stays while the new query prepares');
    assert.equal(document.getElementById('feed'), feed);
    release();
    await going;
    await flush();
    assert.equal(document.getElementById('feed').textContent, 'a 2');
    assert.equal(document.getElementById('feed'), feed);
    const other = navigate('/feed/b?n=2');
    await flush();
    assert.ok(document.getElementById('loading'), 'other params show the route\'s `loading:` meanwhile');
    release();
    await other;
    await flush();
    assert.equal(document.getElementById('feed').textContent, 'b 2');
    assert.equal(built, 2);
  });

  it('follows the verdict of middleware that reads the query, and builds the page again once it admits it', async () => {
    let built = 0;
    const routes = [{
      path: '/admin',
      middleware: [({ query }) => query.role !== 'guest'],
      component: () => { built++; return h('p', { id: 'admin' }, 'admin'); },
    }];
    await start('/admin?role=root', routes, { fallback: () => h('p', { id: 'declined' }, 'declined') });
    await navigate('/admin?role=guest');
    await flush();
    assert.ok(document.getElementById('declined'));
    await navigate('/admin?role=root');
    await flush();
    assert.ok(document.getElementById('admin'));
    assert.equal(built, 2);
  });

  it('builds a page its route\'s error page replaced again on a change of query', async () => {
    let built = 0;
    const routes = [{
      path: '/fragile',
      error: ({ error }) => h('p', { id: 'error' }, error.message),
      component: (props) => {
        built++;
        if (props.query.bad) throw new Error('bad query');
        return h('p', { id: 'fragile' }, 'fine');
      },
    }];
    await start('/fragile?bad=1', routes);
    assert.equal(document.getElementById('error').textContent, 'bad query');
    await navigate('/fragile?bad=');
    await flush();
    assert.ok(document.getElementById('fragile'), 'the page is built again, as React Router clears a route\'s error on a navigation');
    await navigate('/fragile?other=1');
    await flush();
    assert.equal(built, 2, 'and then kept');
  });

  it('shows a preload that fails for the new query, then builds the page again for one that loads', async () => {
    let built = 0;
    const routes = [{
      path: '/report',
      preload: ({ query }) => { if (query.y === 'bad') throw new Error('no report'); return query.y; },
      error: ({ error }) => h('p', { id: 'error' }, error.message),
      component: (props) => { built++; return h('p', { id: 'report' }, () => `report ${props.data}`); },
    }];
    await start('/report?y=2025', routes);
    await navigate('/report?y=bad');
    await flush();
    assert.equal(document.getElementById('error').textContent, 'no report');
    await navigate('/report?y=2026');
    await flush();
    assert.equal(document.getElementById('report').textContent, 'report 2026');
    assert.equal(built, 2);
    if (unmount) unmount();
    unmount = null;
  });
});
