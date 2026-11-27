// A lazy() component whose download failed shows the error to its boundary
// once, and the next render downloads it again: an error boundary's reset
// ("Try again"), or the component rendered again later. A download only a
// prefetch started (what-router's hover) is no render's to show, so the first
// render after it downloads again; one a navigation waited on is shown by the
// page it renders. A chunk that failed on a network blip, or one a deploy
// replaced, is not lost until a reload.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();

const { h } = await import('../src/h.js');
const { mount } = await import('../src/dom.js');
const { lazy, Suspense, ErrorBoundary } = await import('../src/components.js');
const { signal } = await import('../src/reactive.js');

function container() {
  const el = document.getElementById('app');
  el.textContent = '';
  return el;
}

async function flush() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}

// A loader that fails while `failing` is true, counting its calls.
function flaky() {
  const out = { calls: 0, failing: true };
  out.component = lazy(() => {
    out.calls++;
    return out.failing
      ? Promise.reject(new Error(`chunk failed (${out.calls})`))
      : Promise.resolve({ default: () => h('p', { id: 'page' }, 'PAGE') });
  });
  return out;
}

const quiet = async (fn) => {
  const { error, warn } = console;
  console.error = () => {};
  console.warn = () => {};
  try { await fn(); } finally { console.error = error; console.warn = warn; }
};

describe('lazy() after a failed download', () => {
  it('an error boundary\'s reset downloads it again and shows it', async () => {
    const el = container();
    const chunk = flaky();
    let retry = null;
    await quiet(async () => {
      mount(h(ErrorBoundary, {
        fallback: ({ error, reset }) => { retry = reset; return h('p', { id: 'failed' }, String(error.message)); },
      }, h(Suspense, { fallback: h('p', {}, 'loading') }, h(chunk.component))), el);
      await flush();
      assert.equal(el.querySelector('#failed')?.textContent, 'chunk failed (1)');
      assert.equal(chunk.calls, 1);

      chunk.failing = false;
      retry();
      await flush();
    });
    assert.equal(chunk.calls, 2, 'the reset downloaded the chunk again');
    assert.equal(el.querySelector('#page')?.textContent, 'PAGE');
  });

  it('a retry that fails again shows the new error, and downloads nothing more on its own', async () => {
    const el = container();
    const chunk = flaky();
    let retry = null;
    await quiet(async () => {
      mount(h(ErrorBoundary, {
        fallback: ({ error, reset }) => { retry = reset; return h('p', { id: 'failed' }, String(error.message)); },
      }, h(Suspense, { fallback: h('p', {}, 'loading') }, h(chunk.component))), el);
      await flush();
      retry();
      await flush();
      await flush();
    });
    assert.equal(el.querySelector('#failed')?.textContent, 'chunk failed (2)');
    assert.equal(chunk.calls, 2);
  });

  it('rendered again later, it downloads again', async () => {
    const el = container();
    const chunk = flaky();
    const show = signal(true);
    await quiet(async () => {
      mount(h('div', {}, () => (show()
        ? h(ErrorBoundary, { fallback: () => h('p', { id: 'failed' }, 'failed') },
          h(Suspense, { fallback: h('p', {}, 'loading') }, h(chunk.component)))
        : h('p', {}, 'elsewhere'))), el);
      await flush();
      assert.equal(el.querySelector('#failed')?.textContent, 'failed');
      show(false);
      await flush();
      chunk.failing = false;
      show(true);
      await flush();
    });
    assert.equal(chunk.calls, 2);
    assert.equal(el.querySelector('#page')?.textContent, 'PAGE');
  });

  it('after a prefetch\'s download failed, the first render downloads again', async () => {
    const el = container();
    const chunk = flaky();
    await chunk.component._load(true);
    assert.equal(chunk.calls, 1);
    chunk.failing = false;
    await quiet(async () => {
      mount(h(ErrorBoundary, { fallback: ({ error }) => h('p', { id: 'failed' }, String(error.message)) },
        h(Suspense, { fallback: h('p', {}, 'loading') }, h(chunk.component))), el);
      await flush();
    });
    assert.equal(chunk.calls, 2);
    assert.equal(el.querySelector('#page')?.textContent, 'PAGE');
  });

  it('after a download a navigation waited on failed, the next render shows its error', async () => {
    const el = container();
    const chunk = flaky();
    const prefetched = chunk.component._load(true);
    await chunk.component._load();
    await prefetched;
    await quiet(async () => {
      mount(h(ErrorBoundary, { fallback: ({ error }) => h('p', { id: 'failed' }, String(error.message)) },
        h(Suspense, { fallback: h('p', {}, 'loading') }, h(chunk.component))), el);
      await flush();
    });
    assert.equal(chunk.calls, 1, 'one download, which the prefetch started and the navigation waited on');
    assert.equal(el.querySelector('#failed')?.textContent, 'chunk failed (1)');
  });

  it('once loaded, it is never downloaded again', async () => {
    const el = container();
    const chunk = flaky();
    chunk.failing = false;
    const show = signal(true);
    mount(h('div', {}, () => (show()
      ? h(Suspense, { fallback: h('p', {}, 'loading') }, h(chunk.component), h(chunk.component))
      : h('p', {}, 'elsewhere'))), el);
    await flush();
    assert.equal(el.querySelectorAll('#page').length, 2);
    for (let i = 0; i < 3; i++) {
      show(false);
      await flush();
      show(true);
      await flush();
    }
    assert.equal(el.querySelectorAll('#page').length, 2);
    assert.equal(chunk.calls, 1);
    assert.equal(chunk.component._load(), null, 'a navigation to it has nothing to wait for');
  });

  it('two instances waiting on one download both get its error', async () => {
    const el = container();
    const chunk = flaky();
    await quiet(async () => {
      mount(h('div', {},
        h(ErrorBoundary, { fallback: () => h('p', { class: 'failed' }, 'a') }, h(Suspense, { fallback: null }, h(chunk.component))),
        h(ErrorBoundary, { fallback: () => h('p', { class: 'failed' }, 'b') }, h(Suspense, { fallback: null }, h(chunk.component))),
      ), el);
      await flush();
    });
    assert.equal(el.querySelectorAll('.failed').length, 2);
    assert.equal(chunk.calls, 1);
  });
});
