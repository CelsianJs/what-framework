// A <Suspense> or <ErrorBoundary> placed as the whole value of a reactive
// region (a route's page, a ternary's branch) changes what stands between its
// markers after the region recorded its nodes: the revealed children replace
// the fallback, an error's fallback replaces the children. Switching the
// region away removes all of it.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

let env;
let W;
before(async () => {
  env = installDOM();
  W = await import('../src/index.js');
});
after(() => env.cleanup());

const drain = () => new Promise((resolve) => setTimeout(resolve, 20));

async function switchAway(makePage) {
  const { h, mount, signal } = W;
  const host = document.createElement('div');
  const which = signal('page');
  const stop = mount(h('div', null, () => (which() === 'page' ? makePage() : h('h1', null, 'home'))), host);
  await drain();
  const shown = host.textContent;
  which('home');
  await drain();
  const after = host.textContent;
  stop();
  return [shown, after];
}

describe('a boundary that is a region\'s whole value', () => {
  it('<Suspense> whose async value revealed the children is removed with the region', async () => {
    const { h, computed, Suspense } = W;
    function Page() {
      const user = computed(() => Promise.resolve('Ada'));
      return h(Suspense, { fallback: h('p', null, 'loading') }, h('p', null, () => user()));
    }
    assert.deepEqual(await switchAway(() => h(Page)), ['Ada', 'home']);
  });

  it('<Suspense> around a lazy component is removed with the region', async () => {
    const { h, lazy, Suspense } = W;
    const Heavy = lazy(() => Promise.resolve({ default: () => h('p', null, 'heavy') }));
    assert.deepEqual(await switchAway(() => h(Suspense, { fallback: h('p', null, 'loading') }, h(Heavy))), ['heavy', 'home']);
  });

  it('<ErrorBoundary> showing its fallback is removed with the region', async () => {
    const { h, ErrorBoundary, useEffect } = W;
    function Broken() {
      useEffect(() => { throw new Error('boom'); });
      return h('p', null, 'content');
    }
    const page = () => h(ErrorBoundary, { fallback: ({ error }) => h('p', null, 'failed: ' + error.message) }, h(Broken));
    assert.deepEqual(await switchAway(page), ['failed: boom', 'home']);
  });
});
