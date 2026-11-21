// Work that nothing waits for any more retains nothing of what started it,
// while what it waits on stays pending:
//   - a useActionState dispatch whose component unmounted, while its action's
//     promise is held elsewhere;
//   - a dispatch whose action rejected, while the hook stays live (the wait
//     for its action is let go on every way out, a rejection included);
//   - an unmounted <Suspense>, while a promise its child suspended on stays
//     pending;
//   - a query flight dropped by an invalidation and the cache's removal of its
//     entry, while its transport ignores the abort, even one that keeps the
//     signal it was given.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { installDOM } from '../../../test-utils/dom.js';

const { cleanup } = installDOM();
after(cleanup);

const { h, mount, hydrate, settled, useActionState, Suspense } = await import('../src/index.js');
const { clearCache, invalidateQueries, query } = await import('../src/data.js');

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

test('an unmounted useActionState dispatch releases its props while the action\'s promise is pending', async () => {
  const work = Promise.withResolvers();
  const ran = [];
  let ref;
  (function startAndUnmount() {
    let dispatch;
    function Page(props) {
      ref = new WeakRef(props.payload);
      [, dispatch] = useActionState((_previous, n) => {
        ran.push(n);
        void props.payload.label;
        return work.promise;
      }, null);
      return 'ready';
    }
    const stop = mount(h(Page, { payload: { label: 'ready' } }), document.createElement('div'));
    dispatch(1);
    dispatch(2);
    stop();
  })();
  await settled();
  try {
    await assertCollected(ref, 'the unmounted dispatch\'s props');
  } finally {
    work.resolve();
  }
  await settled();
  assert.deepEqual(ran, [1], 'the dispatch queued behind it never runs once its component is gone');
});

for (const [name, transport] of [
  ['ignores the abort', (work) => () => work.promise],
  ['keeps the signal and ignores the abort', (work, kept) => (_key, { signal }) => {
    kept.push(signal);
    return work.promise;
  }],
]) {
  test(`a dropped query flight releases its fetcher's closure while a transport that ${name} has not answered`, async () => {
    const work = Promise.withResolvers();
    const entered = Promise.withResolvers();
    const kept = [];
    const second = transport(work, kept);
    let ref;
    let done;
    (function startAndUnmount() {
      const stop = mount(h(function Page({ payload }) {
        ref = new WeakRef(payload);
        let calls = 0;
        const result = query('gc-dropped-flight', (key, options) => {
          if (++calls === 1) return payload.label;
          entered.resolve();
          return second(key, options);
        }, { gcTime: 0 });
        return h('p', null, () => result());
      }, { payload: { label: 'ready' } }), document.createElement('div'));
      done = invalidateQueries('gc-dropped-flight');
      stop();
      clearCache();
    })();
    await entered.promise;
    try {
      assert.equal(await done, undefined, 'the refetch settles when its entry goes');
      await assertCollected(ref, 'the dropped fetcher\'s payload');
      if (kept.length > 0) assert.equal(kept[0].aborted, true);
    } finally {
      work.resolve();
    }
  });
}

test('a rejected action releases its reason while its dispatch is still live', async () => {
  const error = console.error;
  console.error = () => {};
  try {
    const [, dispatch, pending] = useActionState((state, reason) => (reason ? Promise.reject(reason) : state), null);
    const ref = (() => {
      const reason = new Error('rejected action');
      dispatch(reason);
      return new WeakRef(reason);
    })();
    await settled();
    assert.equal(pending(), false);
    await assertCollected(ref, 'the rejection reason of a finished dispatch');
    dispatch(null);
    await settled();
  } finally {
    console.error = error;
  }
});

test('an unmounted <Suspense> releases itself while a promise its hydrating child suspended on is pending', async () => {
  const pending = new Promise(() => {});
  let ref;
  (() => {
    const fallback = h('i', null, 'waiting');
    ref = new WeakRef(fallback);
    // A component body that suspends throws the promise it waits on: the
    // app's, which hydration hands to the boundary as it is.
    const Child = () => {
      throw pending;
    };
    const host = document.createElement('div');
    host.innerHTML = '<!--b--><b>server</b><!--/b-->';
    const stop = hydrate(h(Suspense, { fallback }, h(Child)), host);
    stop();
  })();
  await assertCollected(ref, 'a <Suspense> unmounted while its child waits');
});
