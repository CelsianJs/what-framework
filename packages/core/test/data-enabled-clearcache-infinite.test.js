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
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;

const { signal, flushSync } = await import('../src/reactive.js');
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
