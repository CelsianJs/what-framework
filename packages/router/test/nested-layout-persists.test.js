// A route layout shared by sibling routes stays mounted while the visitor
// moves between them, as the globalLayout does: its state, its DOM and what
// the visitor typed into it survive, and only the page inside it changes.
//
// Own file: the router keeps module-scoped URL state.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/dashboard' });

const { h, mount, signal, useEffect } = await import('what-core');
const { nestedRoutes, navigate, Router } = await import('../src/index.js');

const flush = (ms = 20) => new Promise((r) => setTimeout(r, ms));

describe('a nested layout persists across its child routes', () => {
  it('keeps the layout instance, its state and its DOM when moving between siblings', async () => {
    let built = 0;
    function DashboardLayout({ children }) {
      built++;
      const clicks = signal(0);
      return h('div', { id: 'layout' },
        h('button', { id: 'bump', onClick: () => clicks((c) => c + 1) }, () => `clicks ${clicks()}`),
        h('main', null, children));
    }
    const routes = nestedRoutes('/dashboard', [
      { path: '/', component: () => h('h1', null, 'Dashboard') },
      { path: '/settings', component: () => h('h1', null, 'Settings') },
    ], { layout: DashboardLayout });

    mount(h(Router, { routes }), '#app');
    await flush();
    const layoutEl = document.getElementById('layout');
    document.getElementById('bump').click();
    await flush();
    assert.equal(document.getElementById('bump').textContent, 'clicks 1');

    await navigate('/dashboard/settings');
    await flush();
    assert.equal(document.querySelector('h1').textContent, 'Settings');
    assert.equal(built, 1, 'the layout is built once for both child routes');
    assert.equal(document.getElementById('layout'), layoutEl, 'the layout keeps its DOM');
    assert.equal(document.getElementById('bump').textContent, 'clicks 1', 'the layout keeps its state');
  });

  it('keeps the layout when its params change, and its JSX reads the new ones', async () => {
    let built = 0;
    const once = [];
    const loaded = [];
    function ProjectLayout(props) {
      built++;
      once.push(props.params.id);
      useEffect(() => { loaded.push(props.params.id); });
      return h('section', { id: 'project' }, h('h2', null, () => `project ${props.params.id}`), h('input', { id: 'note' }), props.children);
    }
    const routes = nestedRoutes('/projects/:id', [
      { path: '/', component: () => h('p', null, 'overview') },
      { path: '/files', component: () => h('p', null, 'files') },
    ], { layout: ProjectLayout });

    await navigate('/projects/1');
    mount(h(Router, { routes }), '#app');
    await flush();
    const section = document.getElementById('project');
    document.getElementById('note').value = 'typed';
    await navigate('/projects/1/files');
    await flush();
    await navigate('/projects/2/files');
    await flush();
    assert.equal(built, 1, 'a change of params keeps the layout');
    assert.equal(document.getElementById('project'), section, 'the layout keeps its DOM');
    assert.equal(document.getElementById('note').value, 'typed', 'and what was typed into it');
    assert.equal(document.querySelector('#project h2').textContent, 'project 2', 'JSX that reads props.params follows them');
    assert.equal(document.querySelector('#project p').textContent, 'files');
    assert.deepEqual(once, ['1'], 'a read in the body is a read once, as in any component');
    assert.deepEqual(loaded, ['1', '2'], 'an effect that reads props.params runs again when they change');
  });

  it('keeps the layout when the query changes, and its JSX reads the new query', async () => {
    let built = 0;
    function TabsLayout(props) {
      built++;
      return h('div', { id: 'tabs' }, h('span', { id: 'tab' }, () => `tab ${props.query.tab ?? 'none'}`), h('input', { id: 'search' }), props.children);
    }
    const routes = nestedRoutes('/tabs', [
      { path: '/', component: (p) => h('p', { id: 'page' }, `page ${p.query.tab}`) },
    ], { layout: TabsLayout });

    await navigate('/tabs?tab=1');
    mount(h(Router, { routes }), '#app');
    await flush();
    const el = document.getElementById('tabs');
    document.getElementById('search').value = 'abc';
    await navigate('/tabs?tab=2');
    await flush();
    assert.equal(built, 1, 'a change of query keeps the layout');
    assert.equal(document.getElementById('tabs'), el);
    assert.equal(document.getElementById('search').value, 'abc');
    assert.equal(document.getElementById('tab').textContent, 'tab 2');
    assert.equal(document.getElementById('page').textContent, 'page 2', 'the page is given the new query');
  });

  it('keeps the query for a URL whose query did not change, a repeated key included', async () => {
    const seen = [];
    function FilterLayout(props) {
      useEffect(() => { seen.push(props.query.tag); });
      return h('div', null, props.children);
    }
    const routes = nestedRoutes('/filters', [
      { path: '/', component: () => h('p', null, 'list') },
      { path: '/grid', component: () => h('p', null, 'grid') },
    ], { layout: FilterLayout });

    await navigate('/filters?tag=a&tag=b');
    mount(h(Router, { routes }), '#app');
    await flush();
    await navigate('/filters/grid?tag=a&tag=b');
    await flush();
    assert.deepEqual(seen, [['a', 'b']], 'the same values in the same order: the effect does not run again');
    await navigate('/filters/grid?tag=b&tag=a');
    await flush();
    assert.deepEqual(seen, [['a', 'b'], ['b', 'a']], 'another order is another query');
    await navigate('/filters?tag=a,b&tag=c');
    await flush();
    await navigate('/filters?tag=a&tag=b,c');
    await flush();
    assert.deepEqual(seen.slice(2), [['a,b', 'c'], ['a', 'b,c']], 'values are compared one by one');
  });

  it('builds the layout again when the chain of layouts changes', async () => {
    const built = [];
    const A = (props) => { built.push('A'); return h('div', { id: 'a' }, props.children); };
    const B = (props) => { built.push('B'); return h('div', { id: 'b' }, props.children); };
    const routes = [
      ...nestedRoutes('/a', [{ path: '/', component: () => h('p', null, 'a') }], { layout: A }),
      ...nestedRoutes('/b', [{ path: '/', component: () => h('p', null, 'b') }], { layout: B }),
    ];
    await navigate('/a');
    mount(h(Router, { routes }), '#app');
    await flush();
    await navigate('/b');
    await flush();
    await navigate('/a');
    await flush();
    assert.deepEqual(built, ['A', 'B', 'A']);
    assert.equal(document.querySelector('#a p').textContent, 'a');
  });

  // React Router keeps a parent layout route mounted while its child routes
  // change, whatever their own layouts. Here /app's layout is rebuilt when
  // /app/x (chain [App, X]) moves to /app/y (chain [App, Y]), and its state
  // is gone (development reports ERR_REBUILT_COMPONENT for <App>).
  it('keeps the layout two chains share while the layouts inside it change', { todo: 'routed builds the whole chain again when any layout in it changes' }, async () => {
    const built = [];
    function App({ children }) {
      built.push('App');
      const clicks = signal(0);
      return h('div', { id: 'app-layout' }, h('button', { id: 'app-bump', onClick: () => clicks((c) => c + 1) }, () => `clicks ${clicks()}`), children);
    }
    const X = (props) => { built.push('X'); return h('section', null, props.children); };
    const Y = (props) => { built.push('Y'); return h('section', null, props.children); };
    const routes = [
      { path: '/app/_layout', layout: App, component: () => null },
      { path: '/app/x', component: () => h('p', null, 'x'), layout: X },
      { path: '/app/y', component: () => h('p', null, 'y'), layout: Y },
    ];
    await navigate('/app/x');
    mount(h(Router, { routes }), '#app');
    await flush();
    document.getElementById('app-bump').click();
    await flush();
    await navigate('/app/y');
    await flush();
    assert.deepEqual(built, ['App', 'X', 'Y']);
    assert.equal(document.getElementById('app-bump').textContent, 'clicks 1');
  });
});
