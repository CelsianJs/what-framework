// Regression for the severed owner chain found while speccing route-level code
// splitting (2026-08-09 parity work).
//
// The reactive fn-child effect in dom.js re-runs long after the synchronous
// render that created it, when the component stack is empty. Everything it built
// on a re-run therefore got `parentCtx = null`, and the two mechanisms that walk
// that chain both went blind:
//
//   - suspend() found no Suspense boundary, so a lazy() component reached by a
//     state change threw its pending promise as an uncaught error and left the
//     region permanently empty.
//   - the ErrorBoundary lookup found nothing, so a throw from a component
//     rendered after any state change escaped the boundary wrapping it.
//
// Both worked on first paint. They only failed once the app was interactive,
// which is why no first-render test caught either one.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
  pretendToBeVisual: true,
});
global.window = dom.window;
global.document = dom.window.document;

const { h, mount, signal, lazy, Suspense, ErrorBoundary } = await import('../src/index.js');

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const app = () => document.getElementById('app');

function Boom() { throw new Error('kaboom'); }
const Fine = () => h('p', {}, 'fine');

describe('ErrorBoundary survives a state change', () => {
  beforeEach(() => { app().innerHTML = ''; });

  it('catches a throw on first paint', async () => {
    mount(h(ErrorBoundary, { fallback: h('p', {}, 'CAUGHT') }, h(Boom, {})), '#app');
    await tick();
    assert.equal(app().textContent, 'CAUGHT');
  });

  // This is the case that regressed: identical boundary, identical throw, but the
  // failing component is created by a re-render rather than the first render.
  it('catches a throw from a component rendered after a signal update', async () => {
    const view = signal('ok', 'view');
    mount(
      h(ErrorBoundary, { fallback: h('p', {}, 'CAUGHT') },
        () => (view() === 'ok' ? h(Fine, {}) : h(Boom, {}))),
      '#app',
    );
    await tick();
    assert.equal(app().textContent, 'fine');

    view('boom');
    await tick();
    assert.equal(app().textContent, 'CAUGHT', 'the boundary must still be reachable after a re-render');
  });

  it('recovers when the state changes back', async () => {
    const view = signal('boom', 'view');
    mount(
      h(ErrorBoundary, { fallback: h('p', {}, 'CAUGHT') },
        () => (view() === 'ok' ? h(Fine, {}) : h(Boom, {}))),
      '#app',
    );
    await tick();
    assert.equal(app().textContent, 'CAUGHT');
  });
});

describe('Suspense survives a state change', () => {
  beforeEach(() => { app().innerHTML = ''; });

  it('shows the fallback for a lazy component reached by a signal update, then the content', async () => {
    let resolveIt;
    const Lazy = lazy(() => new Promise((res) => {
      resolveIt = () => res({ default: () => h('h1', {}, 'LAZY') });
    }));

    const show = signal(false, 'show');
    mount(
      h(Suspense, { fallback: h('p', {}, 'loading') },
        () => (show() ? h(Lazy, {}) : h('h1', {}, 'HOME'))),
      '#app',
    );
    await tick();
    assert.equal(app().textContent, 'HOME');

    // Before the fix this left the region empty forever and logged an uncaught
    // promise, which is exactly what route-level code splitting would hit.
    show(true);
    await tick();
    assert.equal(app().textContent, 'loading', 'the boundary must catch the suspension');

    resolveIt();
    await tick(60);
    assert.equal(app().textContent, 'LAZY', 'the resolved component must replace the fallback');
  });
});
