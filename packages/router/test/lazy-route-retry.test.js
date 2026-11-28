// A lazy() route whose chunk failed to download is downloaded again on the
// next attempt, as a first visit is: the next navigation to it (also after a
// hover's download failed) keeps the page being left on screen while the
// chunk downloads, and the route's error page's reset ("Try again") keeps the
// error page on screen while it downloads, then shows the page, or the error
// page again with the new error. A hover's failed download is no render's to
// show: the component rendered anywhere after it downloads again. A chunk
// that loaded is never downloaded again.
//
// Its own file: the router keeps module-scoped URL state.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

const { window } = installDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' });
window.scrollTo = () => {};

const { h, mount, lazy, ErrorBoundary, Suspense } = await import('what-core');
const { Router, navigate, prefetch } = await import('../src/index.js');

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
async function flush() {
  for (let i = 0; i < 10; i++) await tick();
}
const app = () => document.getElementById('app');
const shown = () => app().textContent;

// A chunk whose download fails while `failing`, and is held until `land()`
// while `held`.
function chunk(name) {
  const out = { calls: 0, failing: true, held: false, land: null };
  out.component = lazy(() => {
    out.calls++;
    const settle = (resolve, reject) => (out.failing
      ? reject(new Error(`${name} failed (${out.calls})`))
      : resolve({ default: () => h('h1', {}, `${name} page`) }));
    if (!out.held) return new Promise(settle);
    return new Promise((resolve, reject) => { out.land = () => settle(resolve, reject); });
  });
  return out;
}

const guide = chunk('guide');
const intro = chunk('intro');
const hovered = chunk('hovered');
const card = chunk('card');
let retry = null;
const ErrorPage = ({ error, reset }) => {
  retry = reset;
  return h('p', { role: 'alert' }, `error: ${error.message}`);
};
let broken = 0;
const routes = [
  { path: '/', component: () => h('h1', {}, 'home') },
  { path: '/broken', component: lazy(() => { broken++; throw new Error(`no loader (${broken})`); }), error: ErrorPage },
  { path: '/guide', component: guide.component, error: ErrorPage },
  { path: '/intro', component: intro.component, error: ErrorPage },
  { path: '/hovered', component: hovered.component, error: ErrorPage },
  { path: '/card', component: card.component, error: ErrorPage },
];

const quiet = async (fn) => {
  const { error } = console;
  console.error = () => {};
  try { return await fn(); } finally { console.error = error; }
};

mount(h(Router, { routes }), '#app');
const aside = document.body.appendChild(document.createElement('aside'));

describe('a lazy() route whose chunk failed', () => {
  it('downloads it again on the next navigation, the page being left on screen meanwhile', async () => {
    await quiet(async () => {
      await navigate('/guide', { transition: false });
      await flush();
    });
    assert.equal(shown(), 'error: guide failed (1)');
    await navigate('/', { transition: false });
    await flush();

    guide.failing = false;
    guide.held = true;
    const going = navigate('/guide', { transition: false });
    await flush();
    assert.equal(guide.calls, 2, 'the navigation downloads it again');
    assert.equal(shown(), 'home', 'the page being left stays while it downloads');
    guide.land();
    await going;
    await flush();
    assert.equal(shown(), 'guide page');
    assert.equal(location.pathname, '/guide');

    await navigate('/', { transition: false });
    await navigate('/guide', { transition: false });
    await flush();
    assert.equal(shown(), 'guide page');
    assert.equal(guide.calls, 2, 'a chunk that loaded is never downloaded again');
  });

  it('downloads it again on its error page\'s reset, the error page on screen meanwhile', async () => {
    await quiet(async () => {
      await navigate('/intro', { transition: false });
      await flush();
    });
    assert.equal(shown(), 'error: intro failed (1)');

    intro.held = true;
    await quiet(async () => {
      retry();
      await flush();
      assert.equal(intro.calls, 2);
      assert.equal(shown(), 'error: intro failed (1)', 'the error page stays while it downloads');
      intro.land();
      await flush();
    });
    assert.equal(shown(), 'error: intro failed (2)', 'a retry that fails shows the new error');

    intro.failing = false;
    retry();
    await flush();
    assert.equal(intro.calls, 3);
    assert.equal(shown(), 'error: intro failed (2)');
    intro.land();
    await flush();
    assert.equal(shown(), 'intro page');
  });

  it('downloads it again on a navigation after a hover\'s download failed', async () => {
    await navigate('/', { transition: false });
    await flush();
    prefetch('/hovered');
    await flush();
    assert.equal(hovered.calls, 1);
    hovered.failing = false;
    hovered.held = true;
    const going = navigate('/hovered', { transition: false });
    await flush();
    assert.equal(hovered.calls, 2);
    assert.equal(shown(), 'home', 'the page being left stays while it downloads');
    hovered.land();
    await going;
    await flush();
    assert.equal(shown(), 'hovered page');
  });

  it('downloads it again on a render outside a route after a hover\'s download failed', async () => {
    prefetch('/card');
    await flush();
    assert.equal(card.calls, 1);
    card.failing = false;
    await quiet(async () => {
      mount(h(ErrorBoundary, { fallback: ({ error }) => h('p', {}, `error: ${error.message}`) },
        h(Suspense, { fallback: h('p', {}, 'loading') }, h(card.component))), aside);
      await flush();
    });
    assert.equal(card.calls, 2);
    assert.equal(aside.textContent, 'card page');
  });

  it('shows a loader that throws on its error page, and calls it again on the next navigation', async () => {
    await navigate('/', { transition: false });
    await quiet(async () => {
      await navigate('/broken', { transition: false });
      await flush();
    });
    assert.equal(shown(), 'error: no loader (1)');
    await navigate('/', { transition: false });
    await quiet(async () => {
      await navigate('/broken', { transition: false });
      await flush();
    });
    assert.equal(shown(), 'error: no loader (2)');
  });
});
