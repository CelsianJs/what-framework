// One <ErrorBoundary> over two kinds of failed async values: a query() entry
// (the data layer's node, fetched by the cache's flights) and an async
// computed (the engine's own run). reset() retries the source of every error
// it caught, so both fetch again once, and what it did not catch (a value that
// did not fail, a query on another key) is not fetched again.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

let env;
let W;
let D;
before(async () => {
  env = installDOM();
  W = await import('../src/index.js');
  D = await import('../src/data.js');
});
after(() => env.cleanup());

const drain = async () => {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setImmediate(resolve));
};

describe('ErrorBoundary reset() over a failed query and a failed async computed', () => {
  it('retries both, once each, and nothing that did not fail', async () => {
    const { computed, h, mount, Suspense, ErrorBoundary } = W;
    const host = document.createElement('div');
    const fetches = { user: 0, stats: 0, steady: 0 };
    const user = D.query('reset:user', async () => {
      if (++fetches.user === 1) throw new Error('user down');
      return 'Ada';
    }, { retry: 1 });
    const stats = computed(async () => {
      if (++fetches.stats === 1) throw new Error('stats down');
      return 42;
    });
    const steady = D.query('reset:steady', async () => { fetches.steady++; return 'ok'; }, { retry: 1 });
    let reset = null;
    const caught = [];
    const stop = mount(h(ErrorBoundary, {
      fallback: ({ error, reset: retry }) => {
        reset = retry;
        caught.push(error.message);
        return h('p', null, 'failed: ' + error.message);
      },
    }, h(Suspense, { fallback: h('p', null, 'loading') },
      h('p', null, () => user()),
      h('p', null, () => String(stats())),
      h('p', null, () => steady()))), host);
    try {
      await drain();
      assert.match(host.textContent, /^failed: (user|stats) down$/);
      assert.equal(typeof reset, 'function');
      reset();
      await drain();
      assert.equal(host.textContent, 'Ada42ok');
      assert.deepEqual(fetches, { user: 2, stats: 2, steady: 1 });
    } finally {
      stop();
      D.clearCache();
    }
  });
});
