// A navigation that a newer one supersedes stops waiting at once, so a
// preload that never settles keeps nothing of it: not its route, not its
// preparation, not the Router that is gone.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { installDOM } from '../../../test-utils/dom.js';

const { cleanup } = installDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
after(cleanup);

const { h, mount } = await import('what-core');
const { Router, navigate } = await import('../src/index.js');

async function collectedWithin(ref) {
  for (let attempt = 0; attempt < 12; attempt++) {
    await nextTurn();
    globalThis.gc();
    if (ref.deref() === undefined) return true;
  }
  return false;
}

test('a superseded navigation releases its route while its preload is still pending', async () => {
  const flight = Promise.withResolvers();
  let obsolete;
  const ref = (() => {
    const routes = [
      { path: '/', component: () => 'home' },
      { path: '/stuck', preload: () => flight.promise, component: () => 'stuck' },
    ];
    const stop = mount(h(Router, { routes }), document.createElement('div'));
    obsolete = navigate('/stuck', { transition: false });
    stop();
    return new WeakRef(routes[1]);
  })();
  const stop = mount(h(Router, { routes: [{ path: '/next', component: () => 'next' }] }), document.createElement('div'));
  try {
    await navigate('/next', { transition: false });
    await obsolete;
    assert.equal(await collectedWithin(ref), true, 'the obsolete route survived 12 collections while its preload was pending');
  } finally {
    flight.resolve();
    stop();
  }
});
