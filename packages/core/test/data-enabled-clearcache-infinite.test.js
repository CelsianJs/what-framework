// Three defects in the data layer, from the 2026-08 audit of whatfw.com against
// the released 0.12.3.
//
// 1. useQuery({ enabled: false }) was permanently dead. The flag was read once
//    at call time (components run once here, so it could never change), the
//    same check gated refetch(), and status() reported 'loading' forever. The
//    single most common use of the option, "disabled query, fetch it on a
//    button click", therefore had no supported form at all, and a disabled
//    query was indistinguishable from a pending one.
// 2. clearCache() emptied the cache Maps while mounted components still held
//    the old signal objects. Every one of them was left wired to a signal
//    nothing would ever write to again, and the data on their screen was NOT
//    cleared, which is exactly backwards for the case clearCache() exists for
//    (logout).
// 3. useInfiniteQuery ignored every base query option, had no error or status
//    surface at all, and seeded pageParams with initialPageParam that the first
//    fetch then appended again.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!DOCTYPE html><html><body></body></html>');

const { signal, effect, flushSync } = await import('../src/reactive.js');
const { h } = await import('../src/h.js');
const { mount } = await import('../src/dom.js');
const {
  useQuery,
  useSWR,
  useInfiniteQuery,
  invalidateQueries,
  setQueryData,
  getQueryData,
  clearCache,
} = await import('../src/data.js');

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
// Retries and aborts each cost a macrotask, so a few tests need more than one.
async function ticks(n) {
  for (let i = 0; i < n; i++) await tick();
}

describe('useQuery({ enabled }) is a live gate, not a permanent grave', () => {
  beforeEach(() => clearCache());

  it('does not report a disabled query as loading forever', async () => {
    const q = useQuery({
      queryKey: ['gate', 'idle-status'],
      queryFn: async () => 'never fetched',
      enabled: false,
    });

    await tick();
    assert.equal(q.isLoading(), false, 'nothing is in flight, so nothing is loading');
    assert.equal(q.status(), 'idle', 'a disabled query must be distinguishable from a pending one');
    assert.equal(q.fetchStatus(), 'idle');
  });

  it('fetches when an explicit refetch() asks it to', async () => {
    let fetches = 0;
    const q = useQuery({
      queryKey: ['gate', 'manual'],
      queryFn: async () => { fetches++; return 'clicked'; },
      enabled: false,
    });

    await tick();
    assert.equal(fetches, 0, 'a disabled query does not fetch on mount');

    await q.refetch();
    assert.equal(fetches, 1, 'refetch() is an explicit request and is not gated by enabled');
    assert.equal(q.data(), 'clicked');
    assert.equal(q.status(), 'success');
  });

  it('an explicit refetch() is not answered from the freshness window either', async () => {
    // Same rule as invalidateQueries: a manual "get me fresh data now" that a
    // staleTime silently swallows is a no-op the caller cannot see.
    let fetches = 0;
    const q = useQuery({
      queryKey: ['gate', 'manual-stale'],
      queryFn: async () => { fetches++; return `v${fetches}`; },
      enabled: false,
      staleTime: 60_000,
    });

    await tick();
    await q.refetch();
    assert.equal(fetches, 1);
    await q.refetch();
    assert.equal(fetches, 2, 'a staleTime must not swallow an explicit refetch');
  });

  it('starts fetching when a reactive enabled flag flips true', async () => {
    const ready = signal(false);
    let fetches = 0;
    const q = useQuery({
      queryKey: ['gate', 'reactive'],
      queryFn: async () => { fetches++; return 'now'; },
      enabled: ready,
    });

    await tick();
    assert.equal(fetches, 0, 'still gated');
    assert.equal(q.status(), 'idle');

    ready(true);
    flushSync();
    await tick();

    assert.equal(fetches, 1, 'flipping enabled must start the query');
    assert.equal(q.data(), 'now');
    assert.equal(q.status(), 'success');
  });

  it('accepts a plain thunk for enabled too', async () => {
    const userId = signal(null);
    let fetches = 0;
    useQuery({
      queryKey: ['gate', 'dependent'],
      queryFn: async () => { fetches++; return 'profile'; },
      enabled: () => userId() != null,
    });

    await tick();
    assert.equal(fetches, 0, 'the dependent query waits for its dependency');

    userId(7);
    flushSync();
    await tick();
    assert.equal(fetches, 1, 'and runs once the dependency arrives');
  });

  it('still fetches on mount when enabled is true or absent', async () => {
    let withFlag = 0;
    let withoutFlag = 0;
    useQuery({
      queryKey: ['gate', 'explicit-true'],
      queryFn: async () => { withFlag++; return 1; },
      enabled: true,
    });
    useQuery({
      queryKey: ['gate', 'absent'],
      queryFn: async () => { withoutFlag++; return 1; },
    });

    await tick();
    assert.equal(withFlag, 1, 'enabled:true is unchanged');
    assert.equal(withoutFlag, 1, 'the option being absent is unchanged');
  });

  it('reports cached data as success even while disabled', async () => {
    setQueryData(['gate', 'cached'], 'from cache');
    const q = useQuery({
      queryKey: ['gate', 'cached'],
      queryFn: async () => 'from network',
      enabled: false,
    });

    await tick();
    assert.equal(q.status(), 'success', 'disabled does not mean dataless');
    assert.equal(q.data(), 'from cache');
  });

  it('leaves the automatic paths gated', async () => {
    // invalidateQueries is automatic fetching aimed at a KEY, not a request from
    // this component, so it must not wake a query its owner turned off.
    let fetches = 0;
    useQuery({
      queryKey: ['gate', 'invalidation'],
      queryFn: async () => { fetches++; return 'x'; },
      enabled: false,
    });

    await tick();
    invalidateQueries(['gate', 'invalidation']);
    await tick();
    assert.equal(fetches, 0, 'a disabled query stays disabled when its key is invalidated');
  });
});

describe('clearCache() keeps mounted components attached to their key', () => {
  beforeEach(() => clearCache());

  it('clears what a mounted component displays, and keeps it live afterwards', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    function Widget() {
      const { data } = useSWR('dashboard', async () => 'first', { revalidateOnFocus: false });
      return h('p', {}, () => String(data() ?? 'empty'));
    }

    mount(h(Widget, {}), container);
    await tick();
    flushSync();
    assert.equal(container.textContent, 'first');

    clearCache();
    flushSync();
    assert.equal(container.textContent, 'empty',
      'clearCache must clear the data the component is showing (this is the logout case)');

    setQueryData('dashboard', 'second');
    flushSync();
    assert.equal(container.textContent, 'second',
      'the component must still be reading the live signal for its key');
  });

  it('two consumers of one key stay on one signal across a clear', async () => {
    const first = useSWR('shared', async () => 'A', { revalidateOnFocus: false });
    await tick();
    assert.equal(first.data(), 'A');

    clearCache();

    // A second consumer mounting after the clear must join the SAME signals, or
    // the documented promise that one key means one shared set of signals is
    // broken for everything that was already on screen.
    const second = useSWR('shared', async () => 'B', { revalidateOnFocus: false });
    await tick();

    assert.equal(second.data(), 'B');
    assert.equal(first.data(), 'B', 'the consumer mounted before the clear sees the new fetch');
  });

  it('a query mounted across the clear sees the cleared value', async () => {
    let fetches = 0;
    const q = useQuery({
      queryKey: ['reports'],
      queryFn: async () => { fetches++; return `v${fetches}`; },
      staleTime: 0,
    });

    await tick();
    assert.equal(q.data(), 'v1');

    clearCache();
    assert.notEqual(q.data(), 'v1', 'the stale value is gone from the signal the query reads');
    // useQuery's data() falls through to placeholderData on an empty entry, and
    // no placeholder was given here, so an emptied entry reads as undefined.
    assert.equal(q.data(), undefined);
    // A cleared key reads as ABSENT whether or not its signal objects had to be
    // kept alive for a live consumer. "Is anything still reading this?" is a
    // guess (and a wrong one for a query created outside a component, whose
    // subscription is never disposed), so it must not be observable.
    assert.equal(getQueryData(['reports']), undefined);

    invalidateQueries(['reports']);
    await tick();
    assert.equal(fetches, 2, 'and still answers invalidation afterwards');
    assert.equal(q.data(), 'v2');
  });

  it('still forgets keys nothing is reading', async () => {
    setQueryData('orphan-1', 'value');
    setQueryData(['orphan', 2], 'value');
    clearCache();
    assert.equal(getQueryData('orphan-1'), undefined);
    assert.equal(getQueryData(['orphan', 2]), undefined);
  });
});

describe('useInfiniteQuery honours its options and reports failures', () => {
  beforeEach(() => clearCache());

  it('does not duplicate initialPageParam in pageParams', async () => {
    const q = useInfiniteQuery({
      queryKey: ['posts'],
      queryFn: async ({ pageParam }) => ({ items: [pageParam], next: pageParam + 1 }),
      getNextPageParam: (last) => last.next,
      initialPageParam: 0,
    });

    await tick();
    assert.deepEqual(q.data().pageParams, [0], 'one page fetched means one page param');
    assert.equal(q.data().pages.length, 1);

    await q.fetchNextPage();
    assert.deepEqual(q.data().pageParams, [0, 1]);
    assert.equal(q.data().pages.length, 2, 'pageParams[i] must line up with pages[i]');
  });

  it('surfaces a failed page fetch', async () => {
    const q = useInfiniteQuery({
      queryKey: ['broken'],
      queryFn: async () => { throw new Error('boom'); },
      getNextPageParam: () => undefined,
      initialPageParam: 0,
      retry: 0,
    });

    await tick();
    assert.equal(typeof q.error, 'function', 'an infinite query needs an error surface');
    assert.equal(q.error()?.message, 'boom');
    assert.equal(q.status(), 'error');
    assert.equal(q.isError(), true);
  });

  it('reports loading before the first page and success after it', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const q = useInfiniteQuery({
      queryKey: ['slow'],
      queryFn: async () => { await gate; return 'page-1'; },
      getNextPageParam: () => undefined,
      initialPageParam: 0,
    });

    assert.equal(q.isLoading(), true, 'the first page is loading');
    release();
    await tick();
    assert.equal(q.isLoading(), false);
    assert.equal(q.isSuccess(), true);
    assert.equal(q.status(), 'success');
  });

  it('does not fetch while disabled, and fetches on an explicit refetch', async () => {
    let fetches = 0;
    const q = useInfiniteQuery({
      queryKey: ['gated-pages'],
      queryFn: async ({ pageParam }) => { fetches++; return pageParam; },
      getNextPageParam: () => undefined,
      initialPageParam: 0,
      enabled: false,
    });

    await tick();
    assert.equal(fetches, 0, 'enabled:false must reach useInfiniteQuery too');
    assert.equal(q.status(), 'idle');

    await q.refetch();
    assert.equal(fetches, 1, 'an explicit refetch is not gated');
  });

  it('applies select to the page collection', async () => {
    const q = useInfiniteQuery({
      queryKey: ['selected'],
      queryFn: async ({ pageParam }) => ({ rows: [pageParam] }),
      getNextPageParam: () => undefined,
      initialPageParam: 1,
      select: (d) => d.pages.flatMap((p) => p.rows),
    });

    await tick();
    assert.deepEqual(q.data(), [1], 'select shapes the data the component reads');
  });

  it('retries a failing page fetch', async () => {
    let attempts = 0;
    const q = useInfiniteQuery({
      queryKey: ['flaky'],
      queryFn: async () => {
        attempts++;
        if (attempts < 3) throw new Error('flaky');
        return 'ok';
      },
      getNextPageParam: () => undefined,
      initialPageParam: 0,
      retry: 3,
      retryDelay: () => 0,
    });

    await ticks(8);
    assert.equal(attempts, 3, 'retry must be honoured');
    assert.equal(q.status(), 'success');
    assert.equal(q.error(), null, 'a recovered query has no error');
  });

  it('calls onSuccess, onError and onSettled', async () => {
    const seen = [];
    useInfiniteQuery({
      queryKey: ['callbacks-ok'],
      queryFn: async () => 'page',
      getNextPageParam: () => undefined,
      initialPageParam: 0,
      onSuccess: (result) => seen.push(['success', result]),
      onSettled: (result, err) => seen.push(['settled', result, err]),
      onError: (err) => seen.push(['error', err]),
    });

    await tick();
    assert.deepEqual(seen, [['success', 'page'], ['settled', 'page', null]]);

    const failures = [];
    useInfiniteQuery({
      queryKey: ['callbacks-fail'],
      queryFn: async () => { throw new Error('nope'); },
      getNextPageParam: () => undefined,
      initialPageParam: 0,
      retry: 0,
      onError: (err) => failures.push(['error', err.message]),
      onSettled: (result, err) => failures.push(['settled', result, err.message]),
    });

    await tick();
    assert.deepEqual(failures, [['error', 'nope'], ['settled', null, 'nope']]);
  });

  it('does not append a second first page when the query re-runs', async () => {
    // The effect that loads page one re-runs whenever the query function reads
    // a signal that changed (a filter, a sort order) and, now, whenever
    // `enabled` flips. Appending in that case leaves two copies of page one in
    // the list, one of them stale.
    const filter = signal('a');
    const q = useInfiniteQuery({
      queryKey: ['reactive-pages'],
      queryFn: async ({ pageParam }) => `${filter()}-${pageParam}`,
      getNextPageParam: () => undefined,
      initialPageParam: 0,
    });

    await tick();
    assert.deepEqual(q.data().pages, ['a-0']);

    filter('b');
    flushSync();
    await tick();

    assert.deepEqual(q.data().pages, ['b-0'], 'a re-run replaces the list, it does not append');
    assert.deepEqual(q.data().pageParams, [0]);
  });

  it('refetches when its key is invalidated', async () => {
    let fetches = 0;
    const q = useInfiniteQuery({
      queryKey: ['feed'],
      queryFn: async () => { fetches++; return `page-${fetches}`; },
      getNextPageParam: () => undefined,
      initialPageParam: 0,
    });

    await tick();
    assert.equal(fetches, 1);

    invalidateQueries(['feed']);
    await tick();
    assert.equal(fetches, 2, 'an infinite query must answer invalidation for its key');
    assert.deepEqual(q.data().pages, ['page-2'], 'a refetch replaces the pages, it does not append');
    assert.deepEqual(q.data().pageParams, [0]);
  });
});

// --- Second round ---------------------------------------------------------
// Running the three fixes above found that two of them broke things of their
// own, all of it silent:
//
// A. The `enabled` thunk was read TRACKED by the query's own effect, so every
//    signal the thunk touched became a trigger for re-running it, and
//    re-running it aborts whatever is in flight. `enabled: () => tab() ===
//    'reports'` therefore let an unrelated move of `tab` cancel an explicit
//    refetch() -- the button click the whole fix exists to support -- with the
//    gate false the entire time. refetch() then RESOLVED WITH UNDEFINED: no
//    data, no error, no rejection.
// B. Same cause: `enabled: () => userId() != null` issued a second fetch when
//    userId moved 1 -> 2, into the queryKey captured at hook creation, i.e. the
//    old key.
// C. clearCache() emptied the SHARED cache signal, but `status` is per-hook and
//    it could not reach it, so a query reported 'success' with data() ===
//    undefined and the canonical guarded render turned into a TypeError at
//    logout, the one moment clearCache is most likely to be called.
// D. clearCache() did not clear a useInfiniteQuery at all: the previous user's
//    rows stayed on screen.
// E. "This key has subscribers" was used as a stand-in for "a mounted consumer
//    is reading this key", which is not true of a hook created outside a
//    component: nothing ever disposes it, so its key could never be dropped and
//    getQueryData reported `null` for it where it reported `undefined`
//    elsewhere.
// F. invalidateQueries with a PREDICATE iterated the cache Map, so it could not
//    see a query that has no cache entry.

describe('an explicit refetch is not collateral damage of a re-render', () => {
  beforeEach(() => clearCache());

  it('survives an unrelated signal moving inside the gate thunk', async () => {
    const tab = signal('home');
    let release;
    const arrival = new Promise((resolve) => { release = resolve; });

    const q = useQuery({
      queryKey: ['manual-vs-rerender'],
      queryFn: async () => { await arrival; return { name: 'ada' }; },
      // False for 'home' and false for 'inbox': the gate's VALUE never changes
      // in this test, only a signal the thunk happens to read.
      enabled: () => tab() === 'reports',
    });

    await tick();
    const pending = q.refetch();
    tab('inbox');
    flushSync();
    release();

    assert.deepEqual(await pending, { name: 'ada' },
      'refetch() must resolve with the data it fetched, not with undefined');
    assert.deepEqual(q.data(), { name: 'ada' });
    assert.equal(q.status(), 'success');
    assert.equal(q.fetchStatus(), 'idle');
    assert.equal(q.error(), null);
  });

  it('survives the gate genuinely closing under it', async () => {
    // Not an unrelated re-render this time: the gate really flips. The request
    // was still asked for by name, so throwing its answer away and resolving
    // the caller's promise with undefined is not an option either.
    const tab = signal('reports');
    let release;
    const arrival = new Promise((resolve) => { release = resolve; });
    let fetches = 0;

    const q = useQuery({
      queryKey: ['closed-mid-refetch'],
      queryFn: async () => {
        fetches++;
        if (fetches === 1) return 'v1';
        await arrival;
        return 'v2';
      },
      enabled: () => tab() === 'reports',
    });

    await tick();
    assert.equal(q.data(), 'v1');

    const pending = q.refetch();
    tab('home');
    flushSync();
    release();

    assert.equal(await pending, 'v2');
    assert.equal(q.data(), 'v2');
    assert.equal(q.isEnabled(), false, 'and the query really is off now');
    assert.equal(q.isFetching(), false);
  });

  it('is still cancelled when the component actually unmounts', async () => {
    // The other half of the ownership rule. The effect's cleanup now spares a
    // manual request, so unmount is the only place left to cancel one, and
    // losing that would fire callbacks into a component that is gone.
    const container = document.createElement('div');
    document.body.appendChild(container);

    let release;
    const arrival = new Promise((resolve) => { release = resolve; });
    const settled = [];
    let q;

    function Panel() {
      q = useQuery({
        queryKey: ['unmount-mid-refetch'],
        queryFn: async () => { await arrival; return 'late'; },
        enabled: false,
        refetchOnWindowFocus: false,
        onSettled: (result) => settled.push(result),
      });
      return h('p', {}, () => String(q.data() ?? 'empty'));
    }

    const unmount = mount(h(Panel, {}), container);
    await tick();

    const pending = q.refetch();
    unmount();
    release();
    await pending.catch(() => {});
    await ticks(2);

    assert.deepEqual(settled, [], 'nothing settles into an unmounted component');
    assert.equal(q.data(), undefined, 'and the response is not written anywhere');
  });

  it('survives an unrelated re-render in useInfiniteQuery too', async () => {
    const tab = signal('home');
    let release;
    const arrival = new Promise((resolve) => { release = resolve; });

    const q = useInfiniteQuery({
      queryKey: ['manual-pages-vs-rerender'],
      queryFn: async ({ pageParam }) => { await arrival; return `page-${pageParam}`; },
      getNextPageParam: () => undefined,
      initialPageParam: 0,
      enabled: () => tab() === 'reports',
    });

    await tick();
    const pending = q.refetch();
    tab('inbox');
    flushSync();
    release();

    assert.equal(await pending, 'page-0');
    assert.deepEqual(q.data().pages, ['page-0']);
    assert.equal(q.status(), 'success');
  });

  it('does not refetch when a gate thunk re-evaluates to the same value', async () => {
    const userId = signal(1);
    let fetches = 0;
    useQuery({
      queryKey: ['stable-thunk', 1],
      queryFn: async () => { fetches++; return 'profile'; },
      enabled: () => userId() != null,
    });

    await tick();
    assert.equal(fetches, 1);

    userId(2);
    flushSync();
    await tick();
    // The gate did not change (true -> true). A fetch here would also be a
    // fetch of the OLD key: queryKey was captured when the hook was created.
    assert.equal(fetches, 1, 'an unchanged gate is not a reason to fetch again');
  });

  it('still reacts every time the gate really does flip', async () => {
    // The guard against over-correcting: deduplicating the gate must not make
    // it deaf to the second flip.
    const ready = signal(false);
    let fetches = 0;
    const q = useQuery({
      queryKey: ['flip-flop'],
      queryFn: async () => { fetches++; return `v${fetches}`; },
      enabled: ready,
    });

    await tick();
    assert.equal(fetches, 0);

    ready(true); flushSync(); await tick();
    assert.equal(fetches, 1);
    assert.equal(q.isEnabled(), true);

    ready(false); flushSync(); await tick();
    assert.equal(q.isEnabled(), false);

    ready(true); flushSync(); await tick();
    assert.equal(fetches, 2, 'a second flip must start a second fetch');
  });

  it('forces a network request for an ENABLED query too', async () => {
    // Worth pinning, because it is a behaviour change for EVERY query and not
    // only for the `enabled: false` ones the fix was aimed at: refetch() used
    // to be answered from the freshness window, so with a staleTime it handed
    // back the cached value without asking the server.
    let fetches = 0;
    const q = useQuery({
      queryKey: ['enabled-refetch-forces'],
      queryFn: async () => { fetches++; return `v${fetches}`; },
      staleTime: 60_000,
    });

    await tick();
    assert.equal(fetches, 1);
    await q.refetch();
    assert.equal(fetches, 2, 'an explicit refetch always goes to the network');
  });
});

describe('clearCache() leaves every hook in a state it can render', () => {
  beforeEach(() => clearCache());

  it('does not turn the canonical guarded render into a TypeError', async () => {
    const q = useQuery({
      queryKey: ['me'],
      queryFn: async () => ({ name: 'ada' }),
    });
    await tick();

    // The exact shape the accessors invite. Every branch is guarded, so it must
    // not be possible to reach data().name with nothing behind it.
    const render = () => {
      if (q.isLoading()) return 'Loading...';
      if (q.isError()) return 'Error';
      if (q.isIdle()) return 'Idle';
      return q.data().name;
    };

    assert.equal(render(), 'ada');

    clearCache();
    assert.equal(render(), 'Idle',
      'status must move with the data, not sit on success with nothing to read');
    assert.equal(q.status(), 'idle');
    assert.equal(q.isSuccess(), false);

    // And it is not wedged there: the query is still wired to its key.
    invalidateQueries(['me']);
    await tick();
    assert.equal(render(), 'ada');
    assert.equal(q.status(), 'success');
  });

  it('does not leave isError() true with no error left to read', async () => {
    const q = useQuery({
      queryKey: ['failed'],
      queryFn: async () => { throw new Error('boom'); },
      retry: 0,
    });

    await ticks(2);
    assert.equal(q.isError(), true);
    assert.equal(q.error()?.message, 'boom');

    clearCache();
    assert.equal(q.error(), null, 'the error object is gone');
    assert.equal(q.isError(), false, 'so isError() must not still claim there is one');
    assert.equal(q.status(), 'idle');
  });

  it('reports loading, not idle, while something is refilling the entry', async () => {
    // The contrast that makes 'idle' the right answer above: a hard
    // invalidation also empties the signal, but it starts a request in the same
    // breath, so there IS something to wait for.
    let release = () => {};
    let fetches = 0;
    const q = useQuery({
      queryKey: ['refilling'],
      queryFn: async () => {
        fetches++;
        if (fetches > 1) await new Promise((resolve) => { release = resolve; });
        return `v${fetches}`;
      },
    });

    await tick();
    assert.equal(q.status(), 'success');

    invalidateQueries(['refilling'], { hard: true });
    assert.equal(q.data(), undefined, 'the entry is empty');
    assert.equal(q.status(), 'loading', 'and a request is on its way to refill it');

    release();
    await tick();
    assert.equal(q.data(), 'v2');
    assert.equal(q.status(), 'success');
  });

  it('empties an infinite query too', async () => {
    const q = useInfiniteQuery({
      queryKey: ['rows'],
      queryFn: async ({ pageParam }) => ({ rows: [`secret-of-user-A-${pageParam}`] }),
      getNextPageParam: (last, all) => all.length,
      initialPageParam: 0,
    });

    await tick();
    await q.fetchNextPage();
    assert.equal(q.data().pages.length, 2);

    clearCache();
    assert.deepEqual(q.data().pages, [],
      "the previous user's rows must not stay on screen -- this is the logout case");
    assert.deepEqual(q.data().pageParams, []);
    assert.equal(q.error(), null);
    assert.equal(q.status(), 'idle');
    assert.equal(q.isFetching(), false);
  });

  it('does not let a page requested before the clear put the rows back', async () => {
    let release;
    const arrival = new Promise((resolve) => { release = resolve; });
    const q = useInfiniteQuery({
      queryKey: ['slow-rows'],
      queryFn: async () => { await arrival; return { rows: ['secret'] }; },
      getNextPageParam: () => undefined,
      initialPageParam: 0,
    });

    clearCache();
    release();
    await ticks(2);
    assert.deepEqual(q.data().pages, [],
      'a request issued for the previous user must not land after the clear');
  });

  it('drops the key of a query created outside a component too', async () => {
    // A module-scope store query: no component context, so nothing ever
    // disposes its effect and its invalidation subscription is immortal.
    // Whether clearCache could drop the entry must not be observable, or the
    // same call leaves a store reading `null` where a component reads
    // `undefined`.
    let fetches = 0;
    const q = useQuery({
      queryKey: ['probeB', 'store'],
      queryFn: async () => { fetches++; return `store-v${fetches}`; },
    });

    await tick();
    assert.equal(getQueryData(['probeB', 'store']), 'store-v1');

    clearCache();
    assert.equal(getQueryData(['probeB', 'store']), undefined,
      'a cleared key reads as absent, not as a cached empty');
    assert.equal(q.data(), undefined);

    // ...and the entry the hook writes to is still the entry getQueryData
    // reads, so a later fetch is visible through both.
    invalidateQueries(['probeB', 'store']);
    await tick();
    assert.equal(fetches, 2);
    assert.equal(q.data(), 'store-v2');
    assert.equal(getQueryData(['probeB', 'store']), 'store-v2');
  });
});

describe('invalidateQueries reaches queries with no cache entry', () => {
  beforeEach(() => clearCache());

  it('finds an infinite query through a predicate', async () => {
    let fetches = 0;
    useInfiniteQuery({
      queryKey: ['predicate-feed'],
      queryFn: async () => { fetches++; return `page-${fetches}`; },
      getNextPageParam: () => undefined,
      initialPageParam: 0,
    });

    await tick();
    assert.equal(fetches, 1);

    invalidateQueries((key) => key.startsWith('predicate-feed'));
    await tick();
    assert.equal(fetches, 2,
      'a predicate must see a query whose data never entered the cache Map');
  });
});

// --- Third round ----------------------------------------------------------
// Running the second round's fixes against the documented samples found three
// more, every one of them the same shape as the last: correct for the case it
// was tested on, silently wrong one step to the side.
//
// G. Round C's derived `status` reads the cache only inside
//    `s === 'success' && ...`. A computed whose dependency set can shrink to a
//    SINGLE signal is auto-promoted to a "stable" effect by the reactive core,
//    and a stable effect re-runs without tracking, so it can never subscribe to
//    anything it did not already have. A query created with `enabled: false`
//    takes exactly the path that promotes it -- 'idle' -> 'loading' when
//    refetch() starts is a re-run that reads rawStatus alone -- where an
//    enabled query goes 'loading' -> 'success' in a batch that writes the cache
//    too and so keeps both dependencies. Round C therefore fixed the enabled
//    case only: for the documented `enabled: false` + refetch() form,
//    clearCache() still left status on 'success' with data() === undefined, the
//    guarded render still walked into a TypeError, and the previous user's
//    value was still on screen. useSWR's `isLoading` had the identical defect.
// H. fetchNextPage()/fetchPreviousPage() are ungated by `enabled`, but a
//    disabled query's state is always the empty page list and the empty list
//    has no last page. They called getNextPageParam(undefined, []), which
//    throws on the documented `(lastPage) => lastPage.nextCursor` shape and
//    fetches nothing at all on a defensive `lastPage?.nextCursor`.
// I. clearCache() cancelled useInfiniteQuery's in-flight page and nothing else,
//    so a useQuery or useSWR response already on the wire landed after the
//    clear and wrote the previous user's data back onto the screen. And useSWR
//    never normalized its key, so an ARRAY key was stored by object identity
//    and reached invalidateQueries' predicate as an Array, where the documented
//    `key => key.startsWith('/api/posts')` throws.
//
// NOT fixed, deliberately: queryKey is still read exactly once, at hook
// creation. See the last describe() in this file for what that costs.

describe('a disabled query and an enabled one agree about a cleared cache', () => {
  beforeEach(() => clearCache());

  // Two of these mount a component on purpose. The defect is in how the status
  // computed TRACKS, and the promotion that breaks it only happens on a re-run,
  // so it needs something reading status eagerly as it moves 'idle' ->
  // 'loading' -> 'success' -- i.e. a render. Reading status() only at the ends
  // never reproduces it, which is most of why the round-2 tests missed it.
  it('keeps status with the data when a sibling empties the entry', async () => {
    // clearCache() is deliberately NOT used here. It settles the status signals
    // directly now, which masks this: the cache is SHARED, and a sibling's
    // setQueryData(key, null) empties it with nothing but the derived status to
    // notice. This is the case the status computed exists for.
    const container = document.createElement('div');
    document.body.appendChild(container);

    let q;
    const render = () => {
      if (q.isLoading()) return 'Loading...';
      if (q.isError()) return 'Error';
      if (q.isIdle()) return 'Idle';
      return q.data().name;
    };

    function Panel() {
      q = useQuery({
        queryKey: ['sibling-empties'],
        queryFn: async () => ({ name: 'ada' }),
        enabled: false,
        refetchOnWindowFocus: false,
      });
      return h('p', {}, () => render());
    }

    mount(h(Panel, {}), container);
    await tick();
    flushSync();
    await q.refetch();
    flushSync();
    assert.equal(container.textContent, 'ada');

    setQueryData(['sibling-empties'], null);
    flushSync();

    assert.equal(q.data(), undefined, 'the data is gone');
    assert.equal(q.status(), 'idle',
      'and the status must go with it, exactly as it does for an enabled query');
    assert.equal(render(), 'Idle', 'so no guard is walked past');
    assert.equal(container.textContent, 'Idle',
      "and the previous value is not left painted on screen");
  });

  it('settles a refetched enabled:false query when the cache is cleared', async () => {
    const q = useQuery({
      queryKey: ['gate-clear', 'usage'],
      queryFn: async () => ({ total: 42 }),
      enabled: false,
      refetchOnWindowFocus: false,
    });

    await tick();
    await q.refetch();
    assert.equal(q.status(), 'success');
    assert.deepEqual(q.data(), { total: 42 });

    clearCache();
    assert.equal(q.data(), undefined, 'the data is gone');
    assert.equal(q.status(), 'idle',
      'and the status must go with it, exactly as it does for an enabled query');
    assert.equal(q.isSuccess(), false);
  });

  it('does not turn the guarded render into a TypeError, or leave the value on screen', async () => {
    // The same canonical render as the enabled case above, on the form the docs
    // now advertise as first class. `enabled: false` + refetch() reached the
    // one state every guard was written to make unreachable.
    const container = document.createElement('div');
    document.body.appendChild(container);

    let q;
    let renderError = null;
    function Panel() {
      q = useQuery({
        queryKey: ['gate-clear', 'panel'],
        queryFn: async () => ({ name: 'ada' }),
        enabled: false,
        refetchOnWindowFocus: false,
      });
      return h('p', {}, () => {
        try {
          if (q.isLoading()) return 'Loading...';
          if (q.isError()) return 'Error';
          if (q.isIdle()) return 'Idle';
          return q.data().name;
        } catch (e) {
          renderError = e;
          return 'threw';
        }
      });
    }

    mount(h(Panel, {}), container);
    await tick();
    flushSync();
    assert.equal(container.textContent, 'Idle');

    await q.refetch();
    flushSync();
    assert.equal(container.textContent, 'ada');

    clearCache();
    flushSync();
    assert.equal(renderError, null, 'no guard may be walked past');
    assert.equal(container.textContent, 'Idle',
      "the previous user's value must not stay painted after a logout");
  });

  it('reports a fetch into an emptied entry as loading, for a disabled query too', async () => {
    // The other half of G: settling to 'idle' must not cost the ability to say
    // 'loading'. The status computed still has to hear fetchStatus move.
    let release = () => {};
    let fetches = 0;
    const q = useQuery({
      queryKey: ['gate-clear', 'refilling'],
      queryFn: async () => {
        fetches++;
        if (fetches > 1) await new Promise((resolve) => { release = resolve; });
        return `v${fetches}`;
      },
      enabled: false,
      refetchOnWindowFocus: false,
    });

    await tick();
    await q.refetch();
    assert.equal(q.status(), 'success');

    const pending = q.refetch();
    await tick();
    assert.equal(q.data(), 'v1', 'the old value is still there during a soft refetch');
    invalidateQueries(['gate-clear', 'refilling'], { hard: true });
    assert.equal(q.data(), undefined);
    assert.equal(q.status(), 'loading', 'something really is on its way to refill it');

    release();
    await pending.catch(() => {});
    await ticks(2);
    assert.equal(q.status(), 'success');
    assert.equal(q.data(), 'v2');
  });

  it('keeps useSWR isLoading honest after a plain cache write', async () => {
    // Same defect, same file: `cacheS() == null && isValidating()` reads the
    // second signal only when the cache is empty, so any re-run that found it
    // full -- a mutate(), a setQueryData(), a second successful fetch -- dropped
    // the computed to one dependency, promoted it, and isLoading() answered
    // false for the rest of the page's life.
    let release;
    let fetches = 0;
    const s = useSWR('swr-loading', async () => {
      fetches++;
      if (fetches > 1) await new Promise((resolve) => { release = resolve; });
      return `v${fetches}`;
    }, { revalidateOnFocus: false, dedupingInterval: 0 });
    // A subscriber, as a component rendering a spinner is. Without one the
    // computed is only ever evaluated lazily at the points this test asserts,
    // which is the one access pattern that never promotes it.
    effect(() => { s.isLoading(); });

    await tick();
    assert.equal(s.data(), 'v1');
    assert.equal(s.isLoading(), false);

    // A cache write while the entry is full: the re-run that used to promote it.
    setQueryData('swr-loading', 'edited');
    flushSync();
    assert.equal(s.data(), 'edited');

    clearCache();
    flushSync();
    const pending = s.revalidate();
    await tick();
    assert.equal(s.data(), null, 'the entry is empty');
    assert.equal(s.isValidating(), true, 'and a request is in flight');
    assert.equal(s.isLoading(), true,
      'which is the one state isLoading() exists to report');

    release();
    await pending.catch(() => {});
    await ticks(2);
    assert.equal(s.isLoading(), false);
  });
});

describe('fetchNextPage() has an answer for an empty page list', () => {
  beforeEach(() => clearCache());

  it('fetches the first page instead of asking what follows a page that does not exist', async () => {
    let askedAboutNothing = false;
    const q = useInfiniteQuery({
      queryKey: ['empty-next'],
      queryFn: async ({ pageParam }) => ({ items: [`row-${pageParam}`], nextCursor: pageParam + 1 }),
      // The documented callback shape, undefended on purpose: a defensive
      // `lastPage?.nextCursor` would turn the defect into a silent no-op and
      // this test would pass while fetching nothing.
      getNextPageParam: (lastPage) => {
        if (lastPage === undefined) askedAboutNothing = true;
        return lastPage.nextCursor;
      },
      initialPageParam: 0,
      enabled: false,
    });

    await tick();
    assert.deepEqual(q.data().pages, [], 'a disabled list starts empty');

    await q.fetchNextPage();
    assert.equal(askedAboutNothing, false,
      'the callback is never handed a page that does not exist');
    assert.deepEqual(q.data().pages, [{ items: ['row-0'], nextCursor: 1 }],
      'the next page of nothing is the first page');
    assert.deepEqual(q.data().pageParams, [0]);
    assert.equal(q.status(), 'success');

    // and paging on from there is unchanged
    await q.fetchNextPage();
    assert.equal(q.data().pages.length, 2);
    assert.deepEqual(q.data().pageParams, [0, 1]);
  });

  it('does the same for fetchPreviousPage()', async () => {
    let askedAboutNothing = false;
    const q = useInfiniteQuery({
      queryKey: ['empty-prev'],
      queryFn: async ({ pageParam }) => ({ items: [`row-${pageParam}`], prevCursor: pageParam - 1 }),
      getNextPageParam: () => undefined,
      getPreviousPageParam: (firstPage) => {
        if (firstPage === undefined) askedAboutNothing = true;
        return firstPage.prevCursor;
      },
      initialPageParam: 5,
      enabled: false,
    });

    await tick();
    await q.fetchPreviousPage();
    assert.equal(askedAboutNothing, false);
    assert.deepEqual(q.data().pages, [{ items: ['row-5'], prevCursor: 4 }]);
    assert.deepEqual(q.data().pageParams, [5]);
  });

  it('still stops when the loaded list really has no next page', async () => {
    // The guard against over-correcting: "empty list" is the only case that
    // means "load page one". A list that has been loaded and says it is
    // finished must stay finished.
    let fetches = 0;
    const q = useInfiniteQuery({
      queryKey: ['exhausted'],
      queryFn: async ({ pageParam }) => { fetches++; return `page-${pageParam}`; },
      getNextPageParam: () => undefined,
      initialPageParam: 0,
    });

    await tick();
    assert.equal(fetches, 1);
    assert.equal(q.hasNextPage(), false);

    await q.fetchNextPage();
    assert.equal(fetches, 1, 'a finished list does not silently reload page one');
    assert.deepEqual(q.data().pages, ['page-0']);
  });

  it('retries page one when the first attempt failed and left the list empty', async () => {
    let attempts = 0;
    const q = useInfiniteQuery({
      queryKey: ['first-page-failed'],
      queryFn: async ({ pageParam }) => {
        attempts++;
        if (attempts === 1) throw new Error('offline');
        return `page-${pageParam}`;
      },
      getNextPageParam: (lastPage) => (lastPage ? undefined : 0),
      initialPageParam: 0,
      retry: 0,
    });

    await ticks(2);
    assert.equal(q.status(), 'error');
    assert.deepEqual(q.data().pages, []);

    await q.fetchNextPage();
    assert.deepEqual(q.data().pages, ['page-0'], 'the only page there is to load is page one');
    assert.equal(q.status(), 'success');
    assert.equal(q.error(), null);
  });
});

describe('a superseded page fetch does not leave its spinner running', () => {
  beforeEach(() => clearCache());

  // Found while checking that the empty-list change above could not make things
  // worse; it is older than that change and reaches a LOADED list, which is why
  // it is pinned separately. isFetchingNextPage and isFetchingPreviousPage are
  // two flags and an aborted fetch cleared neither, so any abort that was not a
  // same-direction replacement left one of them true with nothing behind it --
  // and isFetching() reads both.

  it('clears the flag when a fetch in the other direction supersedes it', async () => {
    let release;
    const arrival = new Promise((resolve) => { release = resolve; });
    let fetches = 0;
    const q = useInfiniteQuery({
      queryKey: ['supersede-direction'],
      queryFn: async ({ pageParam }) => {
        fetches++;
        if (fetches > 1) await arrival;
        return { p: pageParam };
      },
      getNextPageParam: (last) => (last ? last.p + 1 : undefined),
      getPreviousPageParam: (first) => (first ? first.p - 1 : undefined),
      initialPageParam: 5,
    });

    await tick();
    const next = q.fetchNextPage();
    await tick();
    assert.equal(q.isFetchingNextPage(), true);

    const previous = q.fetchPreviousPage();
    release();
    await Promise.allSettled([next, previous]);
    await ticks(3);

    assert.equal(q.isFetchingNextPage(), false,
      'the superseded direction is not still fetching');
    assert.equal(q.isFetching(), false, 'so isFetching() comes back down');
  });

  it('clears it when the effect re-runs and interrupts a previous-page fetch', async () => {
    // The same hole reached from the other side: the effect's cleanup aborts
    // whatever it started, and the re-run always fetches forwards.
    const filter = signal('a');
    let release;
    const arrival = new Promise((resolve) => { release = resolve; });
    let fetches = 0;
    const q = useInfiniteQuery({
      queryKey: ['supersede-rerun'],
      queryFn: async ({ pageParam }) => {
        fetches++;
        if (fetches === 2) await arrival;
        return `${filter()}-${pageParam}`;
      },
      getNextPageParam: () => undefined,
      getPreviousPageParam: () => 0,
      initialPageParam: 1,
    });

    await tick();
    const previous = q.fetchPreviousPage();
    await tick();
    assert.equal(q.isFetchingPreviousPage(), true);

    filter('b');
    flushSync();
    release();
    await Promise.allSettled([previous]);
    await ticks(3);

    assert.equal(q.isFetchingPreviousPage(), false,
      'an interrupted backwards fetch does not leave its spinner running');
    assert.equal(q.isFetching(), false);
  });

  it('still lets a same-direction replacement keep the flag up', async () => {
    // The guard the blunt `if (!abortSignal.aborted)` was there for: while a
    // replacement in the SAME direction is running, the flag must stay true.
    let release;
    const arrival = new Promise((resolve) => { release = resolve; });
    let fetches = 0;
    const q = useInfiniteQuery({
      queryKey: ['supersede-same'],
      queryFn: async ({ pageParam }) => {
        fetches++;
        if (fetches > 1) await arrival;
        return { p: pageParam };
      },
      getNextPageParam: (last) => (last ? last.p + 1 : undefined),
      initialPageParam: 0,
    });

    await tick();
    const first = q.fetchNextPage();
    const second = q.fetchNextPage();
    await ticks(2);
    assert.equal(q.isFetchingNextPage(), true,
      'the replacement is still fetching, so the flag stays up');

    release();
    await Promise.allSettled([first, second]);
    await ticks(3);
    assert.equal(q.isFetchingNextPage(), false);
  });
});

describe('clearCache() cancels what is already on the wire', () => {
  beforeEach(() => clearCache());

  it('does not let a useQuery response requested before the clear land after it', async () => {
    let release;
    const arrival = new Promise((resolve) => { release = resolve; });
    const q = useQuery({
      queryKey: ['inflight-me'],
      queryFn: async () => { await arrival; return { name: 'user-A-secret' }; },
      refetchOnWindowFocus: false,
    });

    await tick();
    clearCache();
    assert.equal(q.status(), 'idle',
      'nothing is in flight any more, so nothing is loading either');

    release();
    await ticks(3);
    assert.equal(q.data(), undefined,
      "a request issued for the previous user must not put their data back");
    assert.equal(q.status(), 'idle');
  });

  it('does the same for useSWR', async () => {
    let release;
    const arrival = new Promise((resolve) => { release = resolve; });
    const s = useSWR('inflight-swr', async () => { await arrival; return 'user-A-secret'; },
      { revalidateOnFocus: false });

    await tick();
    clearCache();
    release();
    await ticks(3);
    assert.equal(s.data(), null,
      "a request issued for the previous user must not put their data back");
    assert.equal(s.isValidating(), false);
  });

  it('cancels a manual refetch too, rather than paint a logged-out user', async () => {
    // The one place the manual/automatic ownership rule does NOT apply.
    // clearCache() is a nuke: an explicit refetch() that lands after it is
    // still the previous user's data, and useInfiniteQuery has always treated
    // it that way. The caller's promise resolving with undefined is the cost.
    let release;
    const arrival = new Promise((resolve) => { release = resolve; });
    const q = useQuery({
      queryKey: ['inflight-manual'],
      queryFn: async () => { await arrival; return 'late'; },
      enabled: false,
      refetchOnWindowFocus: false,
    });

    await tick();
    const pending = q.refetch();
    clearCache();
    release();
    assert.equal(await pending.catch(() => undefined), undefined);
    await ticks(2);
    assert.equal(q.data(), undefined);
    assert.equal(q.status(), 'idle', 'and it is not wedged on a fetch that no longer exists');
  });

  it('leaves the query able to fetch again afterwards', async () => {
    let fetches = 0;
    const q = useQuery({
      queryKey: ['inflight-recover'],
      queryFn: async () => { fetches++; return `v${fetches}`; },
      refetchOnWindowFocus: false,
    });

    await tick();
    clearCache();
    await q.refetch();
    assert.equal(q.data(), 'v2', 'cancelling in flight must not detach the hook from its key');
    assert.equal(q.status(), 'success');
  });
});

describe('invalidateQueries hands its predicate a normalized key', () => {
  beforeEach(() => clearCache());

  it('does not break on a useSWR array key', async () => {
    let fetches = 0;
    useSWR(['/api/posts', 1], async () => { fetches++; return 'post-1'; },
      { revalidateOnFocus: false, dedupingInterval: 0 });

    await tick();
    assert.equal(fetches, 1);

    // The documented predicate. It was handed an Array and threw, and because
    // the keys are selected before any of them is bumped, ONE array key
    // anywhere in the app turned every predicate invalidation into a total
    // no-op that announced itself as a TypeError.
    invalidateQueries((key) => key.startsWith('/api/posts'));
    await tick();
    assert.equal(fetches, 2);
  });

  it('gives an array-keyed useSWR the same cache entry as everything else', async () => {
    // normalizeQueryKey's contract: one key means one entry, whichever hook
    // spelled it. useSWR stored the Array itself as a Map key, so two
    // components passing equal-but-distinct arrays never saw each other's data
    // and getQueryData could not find any of it.
    const fetcherKeys = [];
    useSWR(['/api/user', 7], async (key) => { fetcherKeys.push(key); return 'ada'; },
      { revalidateOnFocus: false, dedupingInterval: 0 });

    await tick();
    assert.equal(getQueryData(['/api/user', 7]), 'ada',
      'the entry must be addressable by an equal key, not only by that exact Array');
    assert.deepEqual(fetcherKeys, [['/api/user', 7]],
      'the fetcher still receives the original key: how the cache spells it is not its business');

    setQueryData(['/api/user', 7], 'grace');
    const second = useSWR(['/api/user', 7], async () => 'from-network',
      { revalidateOnFocus: false, dedupingInterval: 60_000 });
    assert.equal(second.data(), 'grace', 'a second consumer joins the same entry');
  });
});

describe('KNOWN LIMITATION: queryKey is read once, at hook creation', () => {
  beforeEach(() => clearCache());

  // This describe() pins a DEFECT, not a design. It is here so the behaviour is
  // written down and so that making queryKey reactive breaks a test on purpose
  // rather than by surprise.
  //
  // `enabled` is a live gate; the KEY next to it is not. useQuery does
  // `const key = normalizeQueryKey(queryKey)` once, and components run once, so
  // the array literal `['posts', user.data()?.id]` has already been built
  // before useQuery ever sees it -- there is nothing left in it to observe.
  // Making the key reactive therefore cannot be done by reading it more often;
  // it needs a thunk form for the key, a lifecycle for switching keys (cancel
  // in flight, move the invalidation subscription, re-point the data and status
  // computeds at the new signals, decide what to show while it switches), and
  // the same again in useSWR and useInfiniteQuery. That is a release, not a
  // patch, so it is not attempted here.

  it('freezes the key at whatever the dependency was worth on the first run', async () => {
    const user = useQuery({
      queryKey: ['limitation-user'],
      queryFn: async () => ({ id: 1 }),
      refetchOnWindowFocus: false,
    });

    // The natural dependent form. The gate is live, so this DOES wait for the
    // user and DOES fetch afterwards -- it is only the key that is stuck.
    const posts = useQuery({
      queryKey: ['limitation-posts', user.data()?.id],
      queryFn: async () => ['rows-of-1'],
      enabled: () => user.data() != null,
      refetchOnWindowFocus: false,
    });

    await ticks(3);
    assert.deepEqual(posts.data(), ['rows-of-1'], 'the query itself runs correctly');

    assert.equal(getQueryData(['limitation-posts', 1]), undefined,
      'but its data is not under the key the caller thinks it is under');
    assert.deepEqual(getQueryData(['limitation-posts', undefined]), ['rows-of-1'],
      'it is under the key as it read at creation, when the dependency was pending');

    let woken = 0;
    invalidateQueries((key) => {
      if (key === 'limitation-posts:1') woken++;
      return false;
    });
    assert.equal(woken, 0, 'and invalidateQueries([...,1]) has nothing to match');
  });

  it('and two such queries collide on that one frozen key', async () => {
    // The consequence worth knowing about: every instance created while its
    // dependency is pending freezes to the SAME key, so they are one cache
    // entry no matter which user each of them goes on to fetch for.
    const a = signal(null);
    const b = signal(null);
    const mk = (who) => useQuery({
      queryKey: ['limitation-collide', who()?.id],
      queryFn: async () => `rows-of-user-${who().id}`,
      enabled: () => who() != null,
      refetchOnWindowFocus: false,
    });

    const qa = mk(a);
    const qb = mk(b);

    a({ id: 1 });
    flushSync();
    await ticks(2);
    assert.equal(qa.data(), 'rows-of-user-1');
    assert.equal(qb.data(), 'rows-of-user-1',
      "user 2's panel is showing user 1's rows, having fetched nothing");

    b({ id: 2 });
    flushSync();
    await ticks(2);
    assert.equal(qa.data(), 'rows-of-user-2',
      "and user 1's panel has been overwritten with user 2's rows");
  });

  it('has a form that works today: create the query once the key is known', async () => {
    // The supported shape, and the one the docs should be showing. No `enabled`
    // is needed: the query is not CREATED until its key is real, so the key it
    // captures is the right one, addressable and invalidatable, and each user
    // gets their own entry.
    const user = useQuery({
      queryKey: ['workaround-user'],
      queryFn: async () => ({ id: 1 }),
      refetchOnWindowFocus: false,
    });

    let versions = 0;
    function Posts({ userId }) {
      const posts = useQuery({
        queryKey: ['workaround-posts', userId],
        queryFn: async () => `rows-of-${userId}-v${++versions}`,
        refetchOnWindowFocus: false,
      });
      return h('p', {}, () => String(posts.data() ?? 'empty'));
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    mount(h('div', {}, () => {
      const u = user.data();
      return u ? h(Posts, { userId: u.id }) : h('span', {}, 'loading user');
    }), container);

    flushSync();
    assert.equal(container.textContent, 'loading user');

    await ticks(3);
    flushSync();
    assert.equal(container.textContent, 'rows-of-1-v1');
    assert.equal(getQueryData(['workaround-posts', 1]), 'rows-of-1-v1',
      'the key is the one the caller wrote');

    invalidateQueries(['workaround-posts', 1]);
    await ticks(2);
    flushSync();
    assert.equal(container.textContent, 'rows-of-1-v2', 'and the invalidation reaches it');
  });
});
