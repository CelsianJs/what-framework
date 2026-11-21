// A promise nobody waits for any more retains nothing of what waited for it
// (docs/ASYNC.md): an async computed's run, and a component suspended with
// use(), let go of the computed, the component's props and its place when
// they are disposed, while the promise is still pending.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { installDOM } from '../../../test-utils/dom.js';

const { document, cleanup } = installDOM();
after(cleanup);

const { computed, use, h, mount, Suspense } = await import('../src/index.js');

async function assertCollected(ref, label) {
  for (let attempt = 0; attempt < 12; attempt++) {
    // WeakRef targets remain alive through the turn in which they were created
    // or dereferenced. Each collection must happen in a fresh turn.
    await nextTurn();
    globalThis.gc();
    if (ref.deref() === undefined) return;
  }
  assert.fail(`${label} is still reachable after forced collection on ${process.version}`);
}

test('an unmounted component\'s pending run and suspension retain nothing while their promises are pending', async () => {
  const computedWork = Promise.withResolvers();
  const useWork = Promise.withResolvers();
  const refs = {};
  function ComputedChild() {
    const payload = { label: 'computed' };
    refs.computed = new WeakRef(payload);
    const value = computed(() => { void payload.label; return computedWork.promise; });
    return h('span', null, () => value());
  }
  function UseChild({ payload }) { return use(useWork.promise) + payload.label; }
  (() => {
    const payload = { label: 'use' };
    refs.use = new WeakRef(payload);
    const host = document.createElement('div');
    const stop = mount(h(Suspense, { fallback: 'loading' }, h(ComputedChild), h(UseChild, { payload })), host);
    stop();
  })();
  await assertCollected(refs.computed, 'the payload of a disposed computed whose promise is pending');
  await assertCollected(refs.use, 'the props of a removed component suspended on a pending promise');
  computedWork.resolve('late');
  useWork.resolve('late');
});
