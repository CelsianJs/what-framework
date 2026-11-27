// A navigation that changes only the hash (`navigate('/settings#teams')` while
// on /settings, a `location.hash = 'x'`, back/forward between two hashes of one
// page) is a fragment navigation, as the browser treats one: the page stays
// mounted with its local state, the URL and route.hash move, and the target
// element scrolls into view. Before, the router rendered the route again for
// it, so the page lost its state (ERR_REBUILT_COMPONENT in the Vura dashboard's
// Settings and Deployment Detail pages).
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

const { window } = installDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' });
window.scrollTo = () => {};

const { h } = await import('../../core/src/h.js');
const { mount } = await import('../../core/src/dom.js');
const { signal } = await import('../../core/src/reactive.js');
const { subscribeDiagnostics } = await import('../../core/src/index.js');
const { Router, navigate, route, beforeNavigate, afterNavigate } = await import('../src/index.js');

async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

let unmount = null;
let mounts = 0;
let preloads = 0;
let middlewareRuns = 0;
const scrolled = [];

function Settings() {
  mounts++;
  const draft = signal('');
  return h('div', { id: 'settings' },
    h('input', { id: 'draft', value: () => draft(), oninput: (e) => draft(e.target.value) }),
    h('span', { id: 'hash' }, () => route.hash),
    h('section', { id: 'teams' }, 'Teams'),
    h('section', { id: 'tokens' }, 'Tokens'),
    h('section', { id: 'café' }, 'Café'),
    h('section', { id: 'my section' }, 'Spaced'),
    h('section', { id: 'a.b' }, 'Dotted'),
  );
}

const routes = [
  { path: '/', component: () => h('p', { id: 'home' }, 'home') },
  { path: '/settings', component: Settings, preload: () => { preloads++; return null; }, middleware: [() => { middlewareRuns++; return true; }] },
  { path: '/other', component: () => h('p', { id: 'other' }, 'other') },
];

async function start(url) {
  if (unmount) unmount();
  history.replaceState(null, '', url);
  await navigate(url, { replace: true, transition: false });
  const app = document.getElementById('app');
  app.textContent = '';
  unmount = mount(h(Router, { routes }), app);
  await flush();
  for (const id of ['teams', 'tokens', 'café', 'my section', 'a.b']) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView = () => scrolled.push(id);
  }
  mounts = preloads = middlewareRuns = 0;
  scrolled.length = 0;
}

function typeDraft(text) {
  const input = document.getElementById('draft');
  input.value = text;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  return input;
}

describe('hash-only navigation', () => {
  beforeEach(() => start('/settings'));

  it('keeps the page mounted, updates the URL and hash, and scrolls to the target', async () => {
    const input = typeDraft('typed');
    const reports = [];
    const off = subscribeDiagnostics((event) => { if (event.code === 'ERR_REBUILT_COMPONENT') reports.push(event); });
    const length = history.length;

    await navigate('/settings#teams', { transition: false });
    await flush();
    off();

    assert.equal(mounts, 0, 'the page did not run again');
    assert.equal(document.getElementById('draft'), input, 'the same input node is on screen');
    assert.equal(input.value, 'typed', 'its local state survived');
    assert.equal(location.hash, '#teams');
    assert.equal(route.url, '/settings#teams');
    assert.equal(route.hash, '#teams');
    assert.equal(document.getElementById('hash').textContent, '#teams', 'readers of route.hash update');
    assert.deepEqual(scrolled, ['teams'], 'the target scrolled into view');
    assert.equal(history.length, length + 1, 'a fragment navigation adds a history entry, as a link does');
    assert.equal(preloads, 0, 'no preload for a fragment navigation');
    assert.equal(middlewareRuns, 0, 'no middleware for a fragment navigation');
    assert.deepEqual(reports, []);
  });

  it('scrolls to the element whose id the hash percent-decodes to, as the browser finds it', async () => {
    // The URL holds '#café' as '#caf%C3%A9' and '#my section' as '#my%20section'.
    for (const [to, id] of [['#café', 'café'], ['#my section', 'my section'], ['#my%20section', 'my section'], ['#a.b', 'a.b']]) {
      scrolled.length = 0;
      await navigate(to, { transition: false });
      await flush();
      assert.deepEqual(scrolled, [id], to);
    }
  });

  it('honors replace, and moves between hashes and back to no hash without a rebuild', async () => {
    const input = typeDraft('kept');
    const length = history.length;
    await navigate('/settings#teams', { replace: true, transition: false });
    await navigate('/settings#tokens', { replace: true, transition: false });
    await navigate('/settings', { replace: true, transition: false });
    await flush();
    assert.equal(history.length, length);
    assert.equal(mounts, 0);
    assert.equal(document.getElementById('draft'), input);
    assert.equal(input.value, 'kept');
    assert.equal(route.url, '/settings');
    assert.equal(route.hash, '');
    assert.deepEqual(scrolled, ['teams', 'tokens']);
  });

  it('a relative "#hash" target is a fragment navigation too', async () => {
    const input = typeDraft('kept');
    await navigate('#tokens', { transition: false });
    await flush();
    assert.equal(mounts, 0);
    assert.equal(document.getElementById('draft'), input);
    assert.equal(route.url, '/settings#tokens');
    assert.deepEqual(scrolled, ['tokens']);
  });

  it('the browser moving the hash (location.hash, back/forward) keeps the page', async () => {
    const input = typeDraft('kept');
    window.location.hash = 'tokens';
    await flush();
    assert.equal(route.url, '/settings#tokens');
    assert.equal(document.getElementById('hash').textContent, '#tokens');
    history.back();
    await flush();
    assert.equal(route.url, '/settings');
    assert.equal(mounts, 0, 'neither the hash change nor back rebuilt the page');
    assert.equal(document.getElementById('draft'), input);
    assert.equal(input.value, 'kept');
  });

  it('beforeNavigate is not consulted for a fragment navigation; a page navigation still rebuilds', async () => {
    const seen = [];
    const offBefore = beforeNavigate((to) => { seen.push(to); return true; });
    const after = [];
    const offAfter = afterNavigate((to) => after.push(to));
    await navigate('/settings#teams', { transition: false });
    assert.deepEqual(seen, []);
    await navigate('/other', { transition: false });
    await navigate('/settings#tokens', { transition: false });
    await flush();
    offBefore();
    offAfter();
    assert.deepEqual(seen, ['/other', '/settings#tokens'], 'a navigation to another page consults the guards');
    assert.deepEqual(after, ['/other', '/settings#tokens']);
    assert.equal(mounts, 1, 'coming back from another page mounts the page again');
    assert.equal(preloads, 1);
  });

  it('a fragment navigation supersedes a page navigation still preparing', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const off = beforeNavigate(() => gate);
    const pending = navigate('/other', { transition: false });
    off();
    await navigate('/settings#teams', { transition: false });
    release(true);
    await pending;
    await flush();
    assert.equal(route.url, '/settings#teams', 'the newer navigation wins');
    assert.equal(document.getElementById('other'), null);
    assert.equal(route.isNavigating, false);
    assert.equal(mounts, 0);
  });

  it('a query change is a page navigation, not a fragment one', async () => {
    await navigate('/settings?tab=1#teams', { transition: false });
    await flush();
    assert.equal(route.url, '/settings?tab=1#teams');
    assert.equal(mounts, 1);
  });

  it('keeps the entry\'s history.state when it replaces it, unless the caller passes state', async () => {
    history.replaceState({ draft: 'retain' }, '');
    await navigate(location.pathname + location.search + location.hash);
    assert.deepEqual(history.state, { draft: 'retain' }, 'the exact current URL leaves the state alone');
    await navigate('#teams', { transition: false });
    assert.deepEqual(history.state, { draft: 'retain' }, "a '#hash' target replaces the entry, state kept");
    await navigate('/settings#tokens', { replace: true, transition: false });
    assert.deepEqual(history.state, { draft: 'retain' }, 'replace: true keeps it too');
    await navigate('/settings#tokens', { state: { tab: 'tokens' } });
    assert.deepEqual(history.state, { tab: 'tokens' }, 'state the caller passes wins');
    await navigate('/settings#teams', { transition: false });
    assert.equal(history.state, null, 'a new entry starts with no state, as in the browser');
    assert.equal(mounts, 0);
  });
});
