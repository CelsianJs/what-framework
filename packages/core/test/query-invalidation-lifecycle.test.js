// A query must still answer invalidateQueries() after it has refetched once.
//
// useQuery/useSWR subscribed to their key ONCE, outside the effect that does the
// fetching, while that effect's cleanup unsubscribed. The effect re-runs
// whenever the query function reads a signal that changed (a search term, a
// filter, a page number: the entire reason a query key has a reactive part). So
// the first reactive refetch ran the cleanup, dropped the subscription, and
// never restored it. From that moment invalidateQueries() found no subscriber
// for the key and did nothing at all, silently.
//
// The shape that hides this: the FIRST invalidation, before any refetch, works
// fine. So a test that mounts a query and immediately invalidates it passes, and
// only a query that has actually been used goes deaf. This was found by driving
// a real search box in a browser, not by a unit test.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!DOCTYPE html><html><body></body></html>');

const { signal, flushSync } = await import('../src/reactive.js');
const { useQuery, useSWR, invalidateQueries, clearCache } = await import('../src/data.js');

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('useQuery stays subscribed to invalidation across refetches', () => {
  beforeEach(() => clearCache());

  it('refetches on invalidateQueries after a reactive refetch', async () => {
    const term = signal('');
    let fetches = 0;

    useQuery({
      queryKey: ['products', 'search'],
      queryFn: async () => {
        fetches++;
        return `results for "${term()}"`;   // reading the signal re-runs the effect
      },
      staleTime: 0,
    });

    await tick();
    assert.equal(fetches, 1, 'initial fetch');

    // A reactive refetch. This is the step that used to cancel the subscription.
    term('mug');
    flushSync();
    await tick();
    assert.equal(fetches, 2, 'the query refetches when its fetcher reads a changed signal');

    invalidateQueries(['products']);
    await tick();
    assert.equal(fetches, 3, 'invalidateQueries must still reach a query that has refetched');
  });

  it('keeps answering invalidation repeatedly', async () => {
    const term = signal('a');
    let fetches = 0;

    useQuery({
      queryKey: ['orders'],
      queryFn: async () => { fetches++; return term(); },
      staleTime: 0,
    });

    await tick();
    for (let i = 0; i < 3; i++) {
      term(`term-${i}`);
      flushSync();
      await tick();
      const beforeInvalidate = fetches;
      invalidateQueries(['orders']);
      await tick();
      assert.equal(fetches, beforeInvalidate + 1, `round ${i}: invalidation must refetch`);
    }
  });
});

describe('invalidation is not answered from the freshness window', () => {
  beforeEach(() => clearCache());

  it('refetches a query with a staleTime, which its own dedupe would have skipped', async () => {
    // invalidateQueries means "this data is wrong now". Answering it from the
    // staleTime window is the one case where deduping is exactly wrong, and it
    // made invalidation a silent no-op for every query configured with one.
    let fetches = 0;
    useQuery({
      queryKey: ['reports'],
      queryFn: async () => { fetches++; return 'report'; },
      staleTime: 60_000,
    });

    await tick();
    assert.equal(fetches, 1);

    invalidateQueries(['reports']);
    await tick();
    assert.equal(fetches, 2, 'a staleTime must not swallow an explicit invalidation');
  });

  it('refetches a useSWR inside its default deduping interval', async () => {
    // useSWR dedupes for 2s by default, so an invalidation issued right after a
    // fetch (the normal case: mutate, then invalidate) did nothing at all.
    let fetches = 0;
    useSWR('dashboard', async () => { fetches++; return 'data'; }, { revalidateOnFocus: false });

    await tick();
    assert.equal(fetches, 1);

    invalidateQueries('dashboard');
    await tick();
    assert.equal(fetches, 2, 'the default dedupe window must not swallow an invalidation');
  });

  it('collapses one invalidation across many subscribers into one request', async () => {
    // Forcing past the freshness window must not also force past request
    // COALESCING: they share a name and a map but are different mechanisms.
    // Every component reading a key subscribes separately, so one
    // invalidateQueries() call arrives at N subscribers. Bypassing the in-flight
    // map opened N concurrent fetches of the same key whose responses then raced
    // to write the cache, and the loser could land last.
    let fetches = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const fetcher = async () => { fetches++; await gate; return 'data'; };

    for (let i = 0; i < 4; i++) {
      useSWR('widgets', fetcher, { revalidateOnFocus: false });
    }
    release();
    await tick();
    assert.equal(fetches, 1, 'four consumers of one key share one initial request');

    invalidateQueries('widgets');
    await tick();
    assert.equal(fetches, 2,
      'one invalidation across four subscribers must issue ONE refetch, not four');
  });

  it('is not answered by a request that was already in flight', async () => {
    // The ordering guarantee. A request that started BEFORE the mutation may
    // have read pre-mutation data, so it cannot answer an invalidation issued
    // after it, no matter how recently it started.
    //
    // Sequencing this on Date.now() was not enough: it has 1ms resolution, so a
    // refetch and an unrelated invalidation microseconds apart share a
    // timestamp and the invalidation joined the stale request. It showed up as
    // a 1-in-6 flake before it showed up as a bug.
    let fetches = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let firstResponseSent = false;

    useSWR('inventory', async () => {
      fetches++;
      if (fetches === 1) { await gate; firstResponseSent = true; return 'before-mutation'; }
      return 'after-mutation';
    }, { revalidateOnFocus: false });

    await tick();
    assert.equal(fetches, 1, 'the first request is in flight');
    assert.equal(firstResponseSent, false, 'and has not answered yet');

    // Mutation happens here, then invalidation, while request 1 is still open.
    invalidateQueries('inventory');
    await tick();
    assert.equal(fetches, 2, 'the invalidation must issue its own request');

    release();
    await tick();
  });

  it('ordinary reactive refetches still dedupe', async () => {
    // The force flag must be scoped to invalidation. If it leaked into the
    // normal path, every keystroke in a search box would bypass deduping.
    let fetches = 0;
    const term = signal('a');
    useSWR('search', async () => { fetches++; return term(); }, { revalidateOnFocus: false });

    await tick();
    assert.equal(fetches, 1);

    // Same key, immediately again, within the dedupe window: still deduped.
    useSWR('search', async () => { fetches++; return term(); }, { revalidateOnFocus: false });
    await tick();
    assert.equal(fetches, 1, 'a second consumer inside the dedupe window must not refetch');
  });
});

describe('useSWR stays subscribed to invalidation across refetches', () => {
  beforeEach(() => clearCache());

  it('refetches on invalidateQueries after a reactive refetch', async () => {
    const page = signal(1);
    let fetches = 0;

    useSWR('feed', async () => {
      fetches++;
      return `page ${page()}`;
    }, { dedupingInterval: 0, revalidateOnFocus: false });

    await tick();
    assert.equal(fetches, 1);

    page(2);
    flushSync();
    await tick();
    assert.equal(fetches, 2, 'useSWR refetches when its fetcher reads a changed signal');

    invalidateQueries('feed');
    await tick();
    assert.equal(fetches, 3, 'invalidateQueries must still reach a useSWR that has refetched');
  });
});
