// A route layout shared by sibling routes stays mounted while the visitor
// moves between them, as the globalLayout does: its state, its DOM and what
// the visitor typed into it survive, and only the page inside it changes.
//
// Own file: the router keeps module-scoped URL state.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/dashboard' });

const { h, mount, signal, useEffect, ErrorBoundary, Suspense } = await import('what-core');
const { query } = await import('what-core/data');
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

  // As React Router keeps a parent layout route mounted while its child
  // routes change, whatever their own layouts: /app/x (chain [App, X]) to
  // /app/y (chain [App, Y]) keeps App and builds Y in place of X.
  it('keeps the layout two chains share while the layouts inside it change', async () => {
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

  // A layout that counts its builds and keeps a count of clicks, as state that
  // a rebuild would lose.
  function counted(name, built, tag = 'div') {
    const Layout = (props) => {
      built.push(name);
      const clicks = signal(0);
      return h(tag, { 'data-layout': name },
        h('button', { 'data-bump': name, onClick: () => clicks((c) => c + 1) }, () => `${name} ${clicks()}`),
        props.children);
    };
    Object.defineProperty(Layout, 'name', { value: name });
    return Layout;
  }
  const layoutEl = (name) => document.querySelector(`[data-layout="${name}"]`);
  const bump = (name) => document.querySelector(`[data-bump="${name}"]`).click();
  const clicksOf = (name) => document.querySelector(`[data-bump="${name}"]`).textContent;

  it('keeps each shared level of a three-level chain while moving between siblings at every level', async () => {
    const built = [];
    const [Org, Team, Billing, Alpha, Beta, Invoices, Home] = ['Org', 'Team', 'Billing', 'Alpha', 'Beta', 'Invoices', 'Home'].map((n) => counted(n, built));
    const page = (text) => () => h('p', { id: 'page' }, text);
    const routes = [
      { path: '/org/_layout', layout: Org, component: () => null },
      { path: '/org/team/_layout', layout: Team, component: () => null },
      { path: '/org/billing/_layout', layout: Billing, component: () => null },
      { path: '/org/team/alpha', component: page('alpha'), layout: Alpha },
      { path: '/org/team/beta', component: page('beta'), layout: Beta },
      { path: '/org/team/list', component: page('list') },
      { path: '/org/team/grid', component: page('grid') },
      { path: '/org/billing/invoices', component: page('invoices'), layout: Invoices },
      { path: '/home', component: page('home'), layout: Home },
    ];
    await navigate('/org/team/alpha');
    mount(h(Router, { routes }), '#app');
    await flush();
    assert.deepEqual(built, ['Org', 'Team', 'Alpha']);
    const org = layoutEl('Org');
    const team = layoutEl('Team');
    bump('Org');
    bump('Team');
    await flush();

    // The innermost level: Alpha to Beta under the same Org and Team.
    await navigate('/org/team/beta');
    await flush();
    assert.deepEqual(built, ['Org', 'Team', 'Alpha', 'Beta']);
    assert.equal(layoutEl('Org'), org);
    assert.equal(layoutEl('Team'), team);
    assert.equal(layoutEl('Alpha'), null);
    assert.equal(document.querySelector('[data-layout="Beta"] #page').textContent, 'beta');
    assert.equal(clicksOf('Team'), 'Team 1', 'the middle layout keeps its state');

    // The page only: two routes with the chain [Org, Team] and no layout of their own.
    await navigate('/org/team/list');
    await flush();
    await navigate('/org/team/grid');
    await flush();
    assert.deepEqual(built, ['Org', 'Team', 'Alpha', 'Beta']);
    assert.equal(document.querySelector('[data-layout="Team"] > #page').textContent, 'grid');

    // The middle level: Team to Billing under the same Org, and back.
    await navigate('/org/billing/invoices');
    await flush();
    assert.deepEqual(built.slice(4), ['Billing', 'Invoices']);
    assert.equal(layoutEl('Org'), org);
    assert.equal(layoutEl('Team'), null);
    assert.equal(clicksOf('Org'), 'Org 1', 'the outer layout keeps its state');
    await navigate('/org/team/alpha');
    await flush();
    assert.deepEqual(built.slice(6), ['Team', 'Alpha']);
    assert.equal(clicksOf('Team'), 'Team 0', 'a layout built again starts afresh');
    assert.equal(layoutEl('Org'), org);

    // The outermost level: another chain altogether.
    await navigate('/home');
    await flush();
    assert.deepEqual(built.slice(8), ['Home']);
    assert.equal(layoutEl('Org'), null);
    await navigate('/org/team/beta');
    await flush();
    assert.deepEqual(built.slice(9), ['Org', 'Team', 'Beta']);
    assert.equal(clicksOf('Org'), 'Org 0');
  });

  it('keeps an outer layout whose own params change, with live params, and the inner layout under it', async () => {
    const built = [];
    const seen = [];
    function OrgLayout(props) {
      built.push('Org');
      return h('section', { 'data-layout': 'Org' }, h('h2', null, () => `org ${props.params.id}`), props.children);
    }
    const Settings = counted('Settings', built);
    const People = counted('People', built);
    const routes = [
      { path: '/orgs/:id/_layout', layout: OrgLayout, component: () => null },
      { path: '/orgs/:id/settings', layout: Settings, component: (p) => { seen.push(p.params.id); return h('p', { id: 'page' }, `settings of ${p.params.id}`); } },
      { path: '/orgs/:id/people', layout: People, component: () => h('p', { id: 'page' }, 'people') },
    ];
    await navigate('/orgs/1/settings');
    mount(h(Router, { routes }), '#app');
    await flush();
    const org = layoutEl('Org');
    const settings = layoutEl('Settings');
    bump('Settings');
    await navigate('/orgs/2/settings');
    await flush();
    assert.deepEqual(built, ['Org', 'Settings'], 'a change of params keeps both layouts, as React Router keeps their elements');
    assert.equal(layoutEl('Org'), org);
    assert.equal(layoutEl('Settings'), settings);
    assert.equal(clicksOf('Settings'), 'Settings 1');
    assert.equal(document.querySelector('[data-layout="Org"] h2').textContent, 'org 2', 'the outer layout reads the new params');
    assert.equal(document.getElementById('page').textContent, 'settings of 2');
    assert.deepEqual(seen, ['1', '2'], 'the page is built for each id');
    await navigate('/orgs/2/people');
    await flush();
    assert.deepEqual(built, ['Org', 'Settings', 'People']);
    assert.equal(layoutEl('Org'), org);
  });

  it('keeps the shared layouts on back and forward', async () => {
    const built = [];
    const [Shop, Cart, Wish] = ['Shop', 'Cart', 'Wish'].map((n) => counted(n, built));
    const routes = [
      { path: '/shop/_layout', layout: Shop, component: () => null },
      { path: '/shop/cart', layout: Cart, component: () => h('p', { id: 'page' }, 'cart') },
      { path: '/shop/wish', layout: Wish, component: () => h('p', { id: 'page' }, 'wish') },
    ];
    await navigate('/shop/cart');
    mount(h(Router, { routes }), '#app');
    await flush();
    const shop = layoutEl('Shop');
    bump('Shop');
    await navigate('/shop/wish');
    await flush();
    history.back();
    await flush(50);
    assert.equal(location.pathname, '/shop/cart');
    assert.equal(document.getElementById('page').textContent, 'cart');
    history.forward();
    await flush(50);
    assert.equal(document.getElementById('page').textContent, 'wish');
    assert.deepEqual(built, ['Shop', 'Cart', 'Wish', 'Cart', 'Wish']);
    assert.equal(layoutEl('Shop'), shop);
    assert.equal(clicksOf('Shop'), 'Shop 1');
  });

  it('keeps a shared layout whose error boundary caught a page, and shows the next page once it resets', async () => {
    const built = [];
    let resetIt = null;
    function Guarded(props) {
      built.push('Guarded');
      const clicks = signal(0);
      return h('div', { 'data-layout': 'Guarded' },
        h('button', { 'data-bump': 'Guarded', onClick: () => clicks((c) => c + 1) }, () => `Guarded ${clicks()}`),
        h(ErrorBoundary, { fallback: ({ error, reset }) => { resetIt = reset; return h('p', { id: 'caught' }, error.message); } }, props.children));
    }
    const One = counted('One', built);
    const Two = counted('Two', built);
    const routes = [
      { path: '/eb/_layout', layout: Guarded, component: () => null },
      { path: '/eb/ok', layout: One, component: () => h('p', { id: 'page' }, 'ok') },
      { path: '/eb/boom', layout: Two, component: () => { throw new Error('page failed'); } },
      { path: '/eb/fine', component: () => h('p', { id: 'page' }, 'fine') },
    ];
    await navigate('/eb/ok');
    mount(h(Router, { routes }), '#app');
    await flush();
    const guarded = layoutEl('Guarded');
    bump('Guarded');
    await navigate('/eb/boom');
    await flush();
    assert.equal(document.getElementById('caught').textContent, 'page failed', 'the layout\'s boundary caught the page');
    assert.equal(layoutEl('Guarded'), guarded);
    await navigate('/eb/fine');
    await flush();
    resetIt();
    await flush();
    assert.equal(document.querySelector('[data-layout="Guarded"] #page').textContent, 'fine');
    assert.equal(document.getElementById('caught'), null);
    assert.equal(layoutEl('Guarded'), guarded);
    assert.equal(clicksOf('Guarded'), 'Guarded 1');
    assert.deepEqual(built, ['Guarded', 'One', 'Two']);
    await navigate('/eb/ok');
    await flush();
    assert.equal(document.querySelector('[data-layout="One"] #page').textContent, 'ok');
    assert.equal(layoutEl('Guarded'), guarded);
  });

  it('keeps a shared layout with a <Suspense> around its children while the next page waits for its data', async () => {
    const built = [];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    function Framed(props) {
      built.push('Framed');
      return h('div', { 'data-layout': 'Framed' }, h(Suspense, { fallback: h('em', { id: 'wait' }, 'loading') }, props.children));
    }
    const Slow = () => {
      const q = query(['slow-page'], async () => { await gate; return { title: 'slow' }; });
      return h('p', { id: 'page' }, () => q().title);
    };
    const Quick = counted('Quick', built);
    const Patient = counted('Patient', built);
    const routes = [
      { path: '/sus/_layout', layout: Framed, component: () => null },
      { path: '/sus/fast', layout: Quick, component: () => h('p', { id: 'page' }, 'fast') },
      { path: '/sus/slow', layout: Patient, component: Slow },
    ];
    await navigate('/sus/fast');
    mount(h(Router, { routes }), '#app');
    await flush();
    const framed = layoutEl('Framed');
    const going = navigate('/sus/slow');
    await flush();
    assert.equal(layoutEl('Framed'), framed);
    release();
    await going;
    await flush();
    assert.equal(document.querySelector('[data-layout="Patient"] #page').textContent, 'slow');
    assert.equal(document.getElementById('wait'), null);
    assert.equal(layoutEl('Framed'), framed);
    assert.equal(layoutEl('Quick'), null);
    assert.deepEqual(built, ['Framed', 'Quick', 'Patient']);
  });
});
