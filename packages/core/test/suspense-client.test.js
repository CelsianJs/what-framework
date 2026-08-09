// Tests for client-side Suspense + lazy(): a thrown thenable must reach the
// nearest Suspense boundary, swap in the fallback, and re-render on resolve.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Set up DOM globals before importing framework modules
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.SVGElement = dom.window.SVGElement;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.queueMicrotask = global.queueMicrotask || ((fn) => Promise.resolve().then(fn));

const { h } = await import('../src/h.js');
const { mount } = await import('../src/dom.js');
const { lazy, Suspense } = await import('../src/components.js');

function getContainer() {
  const el = document.getElementById('app');
  el.textContent = '';
  return el;
}

async function flush() {
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 0));
  }
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('client Suspense + lazy', () => {
  it('shows the fallback while a lazy child is loading', async () => {
    const container = getContainer();
    const d = deferred();
    const Lazy = lazy(() => d.promise);

    mount(h(Suspense, { fallback: h('span', null, 'loading') }, h(Lazy)), container);
    await flush();

    assert.match(container.textContent, /loading/);
  });

  it('renders the real content once the lazy promise resolves', async () => {
    const container = getContainer();
    const d = deferred();
    const Lazy = lazy(() => d.promise);

    mount(h(Suspense, { fallback: h('span', null, 'loading') }, h(Lazy)), container);
    await flush();
    assert.match(container.textContent, /loading/);

    d.resolve({ default: () => h('p', null, 'loaded') });
    await flush();

    assert.match(container.textContent, /loaded/);
    assert.ok(!/loading/.test(container.textContent));
    assert.ok(container.querySelector('p'));
  });

  it('routes a suspension through an intermediate component', async () => {
    const container = getContainer();
    const d = deferred();
    const Lazy = lazy(() => d.promise);
    const Middle = () => h('div', null, h(Lazy));

    mount(h(Suspense, { fallback: h('span', null, 'loading') }, h(Middle)), container);
    await flush();
    assert.match(container.textContent, /loading/);

    d.resolve({ default: () => h('p', null, 'deep') });
    await flush();
    assert.match(container.textContent, /deep/);
  });

  it('resolves nested Suspense boundaries independently', async () => {
    const container = getContainer();
    const outer = deferred();
    const inner = deferred();
    const OuterLazy = lazy(() => outer.promise);
    const InnerLazy = lazy(() => inner.promise);

    mount(
      h(Suspense, { fallback: h('span', null, 'outer-loading') },
        h(OuterLazy),
        h(Suspense, { fallback: h('span', null, 'inner-loading') }, h(InnerLazy)),
      ),
      container,
    );
    await flush();
    assert.match(container.textContent, /outer-loading/);

    outer.resolve({ default: () => h('p', null, 'outer-done') });
    await flush();
    assert.match(container.textContent, /outer-done/);
    assert.match(container.textContent, /inner-loading/);

    inner.resolve({ default: () => h('p', null, 'inner-done') });
    await flush();
    assert.match(container.textContent, /outer-done/);
    assert.match(container.textContent, /inner-done/);
  });

  it('does not hang or throw when the lazy loader rejects', async () => {
    const container = getContainer();
    const d = deferred();
    const Lazy = lazy(() => d.promise);

    const origError = console.error;
    const origWarn = console.warn;
    console.error = () => {};
    console.warn = () => {};
    try {
      mount(h(Suspense, { fallback: h('span', null, 'loading') }, h(Lazy)), container);
      await flush();
      assert.match(container.textContent, /loading/);

      d.reject(new Error('chunk load failed'));
      await flush();

      assert.ok(!/loading/.test(container.textContent), 'fallback should be cleared');
    } finally {
      console.error = origError;
      console.warn = origWarn;
    }
  });

  it('renders a bounded number of times when a thrown thenable rejects', async () => {
    const container = getContainer();
    let renders = 0;
    const d = deferred();
    d.promise.catch(() => {});

    function Failing() {
      renders++;
      throw d.promise;
    }

    const origError = console.error;
    const origWarn = console.warn;
    console.error = () => {};
    console.warn = () => {};
    try {
      mount(h(Suspense, { fallback: h('span', null, 'loading') }, h(Failing)), container);
      await flush();
      d.reject(new Error('boom'));
      await flush();
      await flush();
    } finally {
      console.error = origError;
      console.warn = origWarn;
    }

    assert.ok(renders >= 1 && renders <= 3, `expected 1..3 renders, got ${renders} (0 would pass vacuously, many means a livelock)`);
  });
});
