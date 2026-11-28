// A change of query alone keeps a route's page mounted, so a component under
// the page that read the query in its body (the page's `query` prop,
// `route.query`, `useSearch()`) keeps the first value. Development reports it
// as ERR_PROP_READ_ONCE, naming the component and the fix, the first time
// the query changes under it; a read in JSX, an effect or a handler, a
// layout's read and a page built again for other params are not reported.
//
// Own file: the router keeps module-scoped URL state.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' });

const { h, mount, useEffect } = await import('what-core');
const { _$keyed, _$memo } = await import('what-core/render');
const { subscribeDiagnostics } = await import('what-core/internal');
const { Router, Link, navigate, useSearch, route } = await import('../src/index.js');

const flush = (ms = 20) => new Promise((r) => setTimeout(r, ms));

let reports = [];
let off = null;
let unmount = null;
beforeEach(() => {
  reports = [];
  off = subscribeDiagnostics((event) => { if (event.code === 'ERR_PROP_READ_ONCE') reports.push(event); });
});
afterEach(() => {
  off();
  if (unmount) unmount();
  unmount = null;
});

async function start(url, routes) {
  await navigate(url, { transition: false });
  const app = document.getElementById('app');
  app.textContent = '';
  unmount = mount(h(Router, { routes }), app);
  await flush();
}

describe('a read of the query in the body of a kept page', () => {
  it('is reported for the page the first time the query changes, with the fix', async () => {
    function Products(props) {
      const page = Number(props.query.page ?? 1);
      return h('p', { id: 'products' }, `page ${page}`);
    }
    await start('/products?page=1', [{ path: '/products', component: Products }]);
    await navigate('/products/?page=1');
    await flush();
    assert.deepEqual(reports, [], 'nothing is reported while the query stays, on another URL of the same page too');
    await navigate('/products?page=2');
    await flush();
    assert.equal(document.getElementById('products').textContent, 'page 1', 'the read kept its first value');
    assert.equal(reports.length, 1);
    assert.equal(reports[0].data.name, 'query');
    assert.equal(reports[0].data.component, 'Products');
    assert.match(reports[0].message, /<Products> runs: the page of \/products stays mounted when only the query changes/);
    assert.match(reports[0].message, /queryKey: \(\) =>/, 'the message names the fix');
    await navigate('/products?page=3');
    await flush();
    assert.equal(reports.length, 1, 'once for each page');
  });

  it('is reported for a component under the page that read useSearch() in its body', async () => {
    function Pager() {
      const { page } = useSearch();
      return h('span', { id: 'pager' }, `pager ${page}`);
    }
    const Feed = () => h('section', null, h(Pager, {}));
    await start('/feed?page=1', [{ path: '/feed', component: Feed }]);
    await navigate('/feed?page=2');
    await flush();
    assert.deepEqual(reports.map((r) => r.data.component), ['Pager']);
  });

  it('is not reported for reads in JSX, an effect or a handler, a layout\'s read or a page built again for its params', async () => {
    const seen = [];
    function Live(props) {
      useEffect(() => { seen.push(props.query.q); });
      return h('button', { id: 'live', onClick: () => seen.push(route.query.q) }, () => `q ${props.query.q}`);
    }
    function Item(props) {
      const sort = props.query.sort;
      return h('p', { id: 'item' }, `${props.params.id} ${sort}`);
    }
    function Shell(props) {
      const first = route.query.q;
      return h('div', { 'data-first': first }, props.children);
    }
    await start('/live?q=a', [
      { path: '/live', component: Live, layout: Shell },
      { path: '/item/:id', component: Item },
    ]);
    await navigate('/live?q=b');
    await flush();
    document.getElementById('live').click();
    assert.equal(document.getElementById('live').textContent, 'q b');
    assert.deepEqual(seen, ['a', 'b', 'b']);
    await navigate('/item/1?sort=asc');
    await flush();
    await navigate('/item/2?sort=desc');
    await flush();
    assert.equal(document.getElementById('item').textContent, '2 desc');
    assert.deepEqual(reports, []);
  });

  it('is not reported for a component the change disposes: under a key it changes, in a branch it closes', async () => {
    // `{query.edit ? <Edit key={query.edit} /> : null}` as compiled JSX
    // builds it (what-core render.js _$keyed).
    function Edit() {
      const first = route.query.edit;
      return h('b', { id: 'edit' }, `edit ${first}`);
    }
    function Issues(props) {
      const open = _$memo(() => !!props.query.edit);
      return h('main', null, () => (open() ? _$keyed(() => props.query.edit, () => h(Edit, {})) : null));
    }
    const edit = () => document.getElementById('edit')?.textContent ?? null;
    await start('/issues?edit=1', [{ path: '/issues', component: Issues }]);
    await navigate('/issues?edit=2');
    await flush();
    assert.equal(edit(), 'edit 2', 'a new key builds a new one, which reads the new query');
    await navigate('/issues');
    await flush();
    assert.equal(edit(), null);
    assert.deepEqual(reports, [], 'neither the one the key replaced nor the one the branch removed read anything that stays');
    await navigate('/issues?edit=3');
    await flush();
    await navigate('/issues?edit=3&page=2');
    await flush();
    assert.equal(edit(), 'edit 3');
    assert.deepEqual(reports.map((r) => r.data.component), ['Edit'], 'one the change keeps, under the same key, is reported');
  });

  it("is not reported for a <Link> given live props read from the query, which follow it", async () => {
    // As compiled JSX passes them: `href={hrefFor(query.page)}` and the rest
    // are getters on the link's props.
    const Pages = (props) => h('nav', null, h(Link, {
      __proto__: null,
      id: 'next',
      get href() { return `/pages?page=${Number(props.query.page) + 1}`; },
      get class() { return `pager-${props.query.page}`; },
      get 'data-at'() { return props.query.page; },
    }, 'Next'));
    await start('/pages?page=1', [{ path: '/pages', component: Pages }]);
    const link = () => document.getElementById('next');
    assert.equal(link().getAttribute('href'), '/pages?page=2');
    await navigate('/pages?page=2');
    await flush();
    assert.equal(link().getAttribute('href'), '/pages?page=3', 'the href follows the query');
    assert.match(link().className, /\bpager-2\b/, 'the class follows the query');
    assert.equal(link().getAttribute('data-at'), '2', 'an attribute it passes on follows the query');
    assert.deepEqual(reports.map((r) => r.data.component), [], 'the link reads none of them while it is built');
  });
});
