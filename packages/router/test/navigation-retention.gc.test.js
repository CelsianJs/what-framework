// A navigation that a newer one supersedes stops waiting at once, so a
// preload that never settles keeps nothing of it: not its route, not its
// preparation, not the Router that is gone.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { installDOM } from '../../../test-utils/dom.js';
import { withResolvers } from '../../../test-utils/with-resolvers.js';

const { cleanup } = installDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
after(cleanup);

const { h, mount } = await import('what-core');
const { Router, navigate, beforeNavigate } = await import('../src/index.js');

async function collectedWithin(ref) {
  for (let attempt = 0; attempt < 12; attempt++) {
    await nextTurn();
    globalThis.gc();
    if (ref.deref() === undefined) return true;
  }
  return false;
}

test('a superseded navigation releases its route while its preload is still pending', async () => {
  const flight = withResolvers();
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

// A guard that starts a navigation of its own and declines: the call that
// returns after the newer one began waiting never takes over how the newer
// one leaves, so unmounting the Router still settles it, and its guard (held
// only by the hook list and that wait) is released.
test('a navigation a guard started is released when the Router unmounts', async () => {
  const gate = withResolvers();
  const held = { replacement: null };
  const ref = (() => {
    const payload = { rows: Array.from({ length: 1000 }, (_, i) => i) };
    const stop = mount(h(Router, { routes: [{ path: '/', component: () => 'home' }, { path: '/new', component: () => 'new' }] }), document.createElement('div'));
    const off = beforeNavigate((to) => {
      if (to === '/old') {
        held.replacement = navigate('/new', { transition: false });
        return false;
      }
      return payload.rows.length ? gate.promise : false;
    });
    const first = navigate('/old', { transition: false });
    return { ref: new WeakRef(payload), first, stop, off };
  })();
  try {
    await ref.first;
    ref.stop();
    ref.off();
    // `off` holds the guard: drop it, as an app drops the handle it called.
    ref.off = ref.stop = ref.first = null;
    const settled = await Promise.race([held.replacement.then(() => 'settled'), nextTurn().then(() => 'pending')]);
    assert.equal(settled, 'settled', 'the replacement stops waiting on its guard');
    assert.equal(await collectedWithin(ref.ref), true, 'its guard closure is collected');
  } finally {
    gate.resolve(false);
    await held.replacement;
  }
});
