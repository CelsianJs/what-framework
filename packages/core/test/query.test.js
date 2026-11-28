// query(key, fetcher): the signal-native read of the one query cache. Every
// key is one entry, an async value in the graph, shared by every reader and by
// the hooks (docs/DATA.md).

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { withResolvers } from '../../../test-utils/with-resolvers.js';

installDOM('<!DOCTYPE html><html><body></body></html>');

const {
  h, mount: mountApp, signal, effect, flushSync, refresh, isPending, startTransition, useOptimistic, settled,
  Suspense, ErrorBoundary,
} = await import('../src/index.js');
const {
  query, useQuery, useSWR, invalidateQueries, invalidatePath, setQueryData, getQueryData, clearCache,
} = await import('../src/entries/data.js');
const { _tagQueries } = await import('../src/entries/internal.js');

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

// A fetcher whose requests the test settles by hand.
function remote() {
  const calls = [];
  const fetcher = (key, { signal: abort }) => {
    const call = { key, abort, ...withResolvers() };
    calls.push(call);
    return call.promise;
  };
  return { calls, fetcher };
}

// Every test unmounts what it mounted: a reader left on screen would fetch
// again when the next test clears the cache.
const mounted = [];
function mount(vnode, el) {
  const stop = mountApp(vnode, el);
  mounted.push(stop);
  return stop;
}
afterEach(() => {
  for (const stop of mounted.splice(0)) stop();
});

function host() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

describe('query()', () => {
  beforeEach(() => clearCache());

  it('suspends under <Suspense>, shows the value, and one fetch answers every reader', async () => {
    const { calls, fetcher } = remote();
    const el = host();
    function Name() {
      const user = query(['user', 1], fetcher);
      return h('b', null, () => user().name);
    }
    mount(h(Suspense, { fallback: h('i', null, 'loading') }, h(Name), h(Name)), el);
    assert.equal(el.textContent, 'loading');
    assert.equal(calls.length, 1, 'two readers of one key share one request');
    calls[0].resolve({ name: 'Ada' });
    await settled();
    assert.equal(el.textContent, 'AdaAda');
    assert.deepEqual(getQueryData(['user', 1]), { name: 'Ada' }, 'and the hooks see the same entry');
  });

  it('follows a reactive key: keeps the old value with pending() while the new key loads', async () => {
    const { calls, fetcher } = remote();
    const id = signal(1);
    const el = host();
    let q;
    function Profile() {
      q = query(() => ['profile', id()], fetcher, { staleTime: 60_000 });
      // pending() in a binding of its own: a binding that reads q() waits,
      // keeping what it showed, while q fetches again.
      return h('p', null, h('span', null, () => q()), h('span', null, () => (q.pending() ? ' (refreshing)' : '')));
    }
    mount(h(Suspense, { fallback: 'loading' }, h(Profile)), el);
    calls[0].resolve('one');
    await settled();
    assert.equal(el.textContent, 'one');

    id(2);
    flushSync();
    await tick();
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].key, ['profile', 2], 'the fetcher gets the key as written');
    assert.equal(el.textContent, 'one (refreshing)', 'the old value stays, pending');

    calls[1].resolve('two');
    await settled();
    assert.equal(el.textContent, 'two');

    id(1);
    flushSync();
    await settled();
    assert.equal(calls.length, 2, 'a cached key within its staleTime shows at once, with no request');
    assert.equal(el.textContent, 'one');
  });

  it('aborts the old key\'s request when nothing reads it any more', async () => {
    const { calls, fetcher } = remote();
    const id = signal(1);
    mount(h(Suspense, { fallback: 'loading' }, h(() => {
      const q = query(() => ['abort', id()], fetcher);
      return h('p', null, () => q());
    })), host());
    id(2);
    flushSync();
    await tick();
    assert.equal(calls[0].abort.aborted, true, 'the superseded key\'s request is aborted');
    assert.equal(calls[1].abort.aborted, false);
  });

  it('refresh(q) fetches the entry again and reports pending until it lands', async () => {
    const { calls, fetcher } = remote();
    const el = host();
    let q;
    mount(h(Suspense, { fallback: 'loading' }, h(() => {
      q = query('refreshable', fetcher);
      return h('p', null, () => q());
    })), el);
    calls[0].resolve('v1');
    await settled();
    const done = refresh(q);
    assert.equal(calls.length, 2);
    assert.equal(isPending(() => q()), true);
    calls[1].resolve('v2');
    assert.equal(await done, 'v2');
    await settled();
    assert.equal(el.textContent, 'v2');
  });

  it('a key change inside a transition commits with the rest of it', async () => {
    const { calls, fetcher } = remote();
    const page = signal(1);
    const el = host();
    mount(h(Suspense, { fallback: 'loading' }, h(() => {
      const list = query(() => ['page', page()], fetcher);
      return h('p', null, h('span', null, () => `page ${page()}`), h('span', null, () => `: ${list()}`));
    })), el);
    calls[0].resolve('a');
    await settled();
    assert.equal(el.textContent, 'page 1: a');

    const committed = startTransition(() => page(2));
    await tick();
    assert.equal(el.textContent, 'page 1: a', 'the transition holds the label and the list');
    calls[1].resolve('b');
    await committed;
    assert.equal(el.textContent, 'page 2: b', 'and commits both in one flush');
  });

  it('invalidateQueries inside an action refetches into the same commit as the overlay drop', async () => {
    const { calls, fetcher } = remote();
    const el = host();
    let likes;
    let add;
    let shownValue;
    mount(h(Suspense, { fallback: 'loading' }, h(() => {
      likes = query(['likes'], fetcher);
      const [shown, addOptimistic] = useOptimistic(likes, (n, by) => n + by);
      add = addOptimistic;
      shownValue = shown;
      return h('p', null, () => String(shown()));
    })), el);
    calls[0].resolve(1);
    await settled();

    const frames = [];
    const record = effect(() => { frames.push(el.textContent); shownValue(); });
    const done = startTransition(async () => {
      add(1);
      await tick();
      await invalidateQueries(['likes']);
    });
    await tick();
    assert.equal(el.textContent, '2', 'the overlay shows at once');
    frames.length = 0;
    calls[1].resolve(2);
    await done;
    await tick();
    record();
    assert.equal(el.textContent, '2');
    assert.ok(!frames.includes('1'), `no frame between the overlay and the refetched value: ${frames}`);
  });

  it('setQueryData reaches query() readers, and clearCache() makes a mounted one fetch again', async () => {
    const { calls, fetcher } = remote();
    const el = host();
    mount(h(Suspense, { fallback: 'loading' }, h(() => {
      const q = query('shared-write', fetcher);
      return h('p', null, () => q());
    })), el);
    calls[0].resolve('server');
    await settled();
    setQueryData('shared-write', 'local');
    flushSync();
    assert.equal(el.textContent, 'local');
    clearCache();
    await tick();
    assert.equal(calls.length, 2, 'the cleared entry is fetched again for the reader still on screen');
    calls[1].resolve('fresh');
    await settled();
    assert.equal(el.textContent, 'fresh');
  });

  it('a failed fetch reaches the <ErrorBoundary>; reset() fetches again', async () => {
    const { calls, fetcher } = remote();
    const el = host();
    let retry;
    mount(h(ErrorBoundary, {
      fallback: ({ error, reset }) => { retry = reset; return h('em', null, error.message); },
    }, h(Suspense, { fallback: 'loading' }, h(() => {
      const q = query('flaky', fetcher);
      return h('p', null, () => q());
    }))), el);
    calls[0].reject(new Error('offline'));
    await settled();
    assert.equal(el.textContent, 'offline');
    retry();
    await tick();
    assert.equal(calls.length, 2, 'reset() fetched the entry again');
    calls[1].resolve('back');
    await settled();
    assert.equal(el.textContent, 'back');
  });

  it('a fetcher that throws before it returns reaches the <ErrorBoundary> at once, and reset() fetches again', async () => {
    const el = host();
    let calls = 0;
    let retry;
    mount(h(ErrorBoundary, {
      fallback: ({ error, reset }) => { retry = reset; return h('em', null, error.message); },
    }, h(Suspense, { fallback: 'loading' }, h(() => {
      const q = query('throws-at-once', () => {
        if (++calls === 1) throw new Error('offline');
        return Promise.resolve('back');
      });
      return h('p', null, () => q());
    }))), el);
    let quiet = false;
    void settled().then(() => { quiet = true; });
    await tick();
    assert.deepEqual([el.textContent, quiet, calls], ['offline', true, 1], 'the throw is the entry\'s error, and nothing waits for a landing');
    retry();
    await settled();
    assert.deepEqual([el.textContent, calls], ['back', 2]);
  });

  it('a fetch that lands undefined is a value: it shows, and nothing fetches it again', async () => {
    const el = host();
    let calls = 0;
    mount(h(Suspense, { fallback: 'loading' }, h(() => {
      const q = query('lands-undefined', () => (++calls === 1 ? Promise.resolve(undefined) : new Promise(() => {})));
      return h('p', null, () => q() ?? 'empty');
    })), el);
    await settled();
    await tick();
    assert.deepEqual([calls, el.textContent], [1, 'empty']);
  });

  it('a superseded invalidation answers with its replacement, without waiting for a transport that ignores the abort', async () => {
    const { calls, fetcher } = remote();
    const stop = mount(h(() => {
      const q = query('replaced', fetcher, { initialData: 'initial', staleTime: Infinity });
      return h('p', null, () => q());
    }), host());
    const answers = [];
    const first = invalidateQueries('replaced').then(() => answers.push('first'));
    const latest = invalidateQueries('replaced').then(() => answers.push('latest'));
    assert.equal(calls.length, 2);
    assert.equal(calls[0].abort.aborted, true);
    calls[1].resolve('current');
    await latest;
    await tick();
    assert.deepEqual(answers.sort(), ['first', 'latest'], 'the first answered once its replacement landed');
    calls[0].resolve('stale');
    await first;
    await tick();
    assert.equal(getQueryData('replaced'), 'current', 'the aborted transport\'s late answer is dropped');
    stop();
  });

  it('drops an entry nothing reads after its gcTime, and a reader within it is answered from the cache', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000 });
    const { calls, fetcher } = remote();
    const show = () => mount(h(Suspense, { fallback: 'loading' }, h(() => {
      const q = query('collectable', fetcher, { gcTime: 1000, staleTime: 60_000 });
      return h('p', null, () => q());
    })), host());
    let stop = show();
    calls[0].resolve('kept');
    await settled();
    stop();
    t.mock.timers.tick(500);
    stop = show();
    await settled();
    assert.equal(calls.length, 1, 'within gcTime: from the cache');
    stop();
    t.mock.timers.tick(1001);
    assert.equal(getQueryData('collectable'), undefined, 'after gcTime the entry is gone');
    stop = show();
    assert.equal(calls.length, 2, 'and a new reader fetches');
    stop();
  });

  it('invalidatePath(path) refetches what was read on that path', async () => {
    const { calls, fetcher } = remote();
    const el = host();
    mount(h(Suspense, { fallback: 'loading' }, h(() => {
      const q = _tagQueries('/inbox', () => query(['inbox'], fetcher));
      return h('p', null, () => q());
    })), el);
    calls[0].resolve('3 unread');
    await settled();
    const done = invalidatePath('/inbox');
    assert.equal(calls.length, 2);
    calls[1].resolve('0 unread');
    await done;
    await settled();
    assert.equal(el.textContent, '0 unread');
    await invalidatePath('/elsewhere');
    assert.equal(calls.length, 2, 'another path is not touched');
  });
});

describe('the hooks share the entry query() reads', () => {
  beforeEach(() => clearCache());

  it('useQuery and useSWR on one key are one request and one value', async () => {
    const { calls, fetcher } = remote();
    const a = useQuery({ queryKey: ['hooks', 'shared'], queryFn: ({ queryKey, signal: abort }) => fetcher(queryKey, { signal: abort }), refetchOnWindowFocus: false });
    const b = useSWR(['hooks', 'shared'], fetcher, { revalidateOnFocus: false });
    assert.equal(calls.length, 1);
    calls[0].resolve('one');
    await tick();
    assert.equal(a.data(), 'one');
    assert.equal(b.data(), 'one');
  });

  it('a function queryKey follows its signals into a new entry', async () => {
    const { calls, fetcher } = remote();
    const id = signal(1);
    const q = useQuery({
      queryKey: () => ['reactive-hook', id()],
      queryFn: ({ queryKey, signal: abort }) => fetcher(queryKey, { signal: abort }),
      refetchOnWindowFocus: false,
      keepPreviousData: true,
    });
    calls[0].resolve('first');
    await tick();
    id(2);
    flushSync();
    await tick();
    assert.deepEqual(calls[1].key, ['reactive-hook', 2]);
    assert.equal(q.data(), 'first', 'keepPreviousData shows the previous key\'s data');
    assert.equal(q.isPlaceholderData(), true);
    calls[1].resolve('second');
    await tick();
    assert.equal(q.data(), 'second');
    assert.deepEqual(getQueryData(['reactive-hook', 1]), 'first', 'each key has its own entry');
  });
});
