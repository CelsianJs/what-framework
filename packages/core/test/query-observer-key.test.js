// Each observer's fetcher gets its own key, as it wrote it, as in TanStack
// Query. Keys that normalize alike ('q:alpha', ['q', 'alpha']) name one cache
// entry, and the entry kept the spelling of whatever created it, so a fetcher
// got another caller's key: after setQueryData('q:alpha', ...), a
// useQuery({ queryKey: ['q', 'alpha'] }) queryFn was called with ['q:alpha']
// (found adopting What in the Vura dashboard). A fetch the cache starts itself
// (an invalidation) uses the key of the observer whose fetcher it calls.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!DOCTYPE html><html><body></body></html>');

const { signal, flushSync, createRoot } = await import('../src/reactive.js');
const { useQuery, useSWR, query, setQueryData, prefetchQuery, invalidateQueries, clearCache } = await import('../src/data.js');

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a fetcher gets its own observer\'s key', () => {
  let dispose = () => {};
  beforeEach(() => {
    dispose();
    clearCache();
  });

  it('useQuery gets its array key for an entry setQueryData seeded with a string', async () => {
    const seen = [];
    setQueryData('q:alpha', 'seeded');
    let result;
    createRoot((d) => {
      dispose = d;
      result = useQuery({ queryKey: ['q', 'alpha'], queryFn: ({ queryKey }) => { seen.push(queryKey); return queryKey.join('/'); } });
    });
    await tick();
    assert.deepEqual(seen, [['q', 'alpha']]);
    assert.equal(result.data(), 'q/alpha');
  });

  it('the Vura probe: a reactive key, behind a gate, over a seeded entry', async () => {
    const seen = [];
    setQueryData('q:alpha', 'seeded');
    const cacheKey = signal(null);
    const gate = signal(false);
    let result;
    createRoot((d) => {
      dispose = d;
      result = useQuery({
        queryKey: () => (cacheKey() ? ['q', cacheKey()] : null),
        enabled: gate,
        queryFn: ({ queryKey }) => { seen.push(queryKey); return queryKey.join('/'); },
      });
    });
    cacheKey('alpha');
    flushSync();
    assert.equal(result.data(), 'seeded');
    gate(true);
    flushSync();
    await tick();
    assert.equal(result.data(), 'q/alpha');
    cacheKey('beta');
    flushSync();
    await tick();
    assert.equal(result.data(), 'q/beta');
    assert.deepEqual(seen, [['q', 'alpha'], ['q', 'beta']]);
  });

  it('two observers of one entry each refetch with their own spelling', async () => {
    const swrKeys = [];
    const queryKeys = [];
    let swr;
    let q;
    createRoot((d) => {
      dispose = d;
      swr = useSWR('todos', (key) => { swrKeys.push(key); return 'swr'; }, { revalidateOnFocus: false, dedupingInterval: 0 });
      q = useQuery({ queryKey: ['todos'], queryFn: ({ queryKey }) => { queryKeys.push(queryKey); return 'query'; }, refetchOnWindowFocus: false });
    });
    await tick();
    swrKeys.length = queryKeys.length = 0;
    await q.refetch();
    await swr.revalidate();
    assert.deepEqual(queryKeys, [['todos']]);
    assert.deepEqual(swrKeys, ['todos']);
  });

  it('query() gets its key as written', async () => {
    const seen = [];
    setQueryData('user:7', { name: 'seeded' });
    createRoot((d) => {
      dispose = d;
      query(['user', 7], (key) => { seen.push(key); return { name: 'fetched' }; });
    });
    await tick();
    assert.deepEqual(seen, [['user', 7]]);
  });

  it('an invalidation fetches with the observer\'s key, and onSuccess hears it', async () => {
    const seen = [];
    const heard = [];
    setQueryData('acct:1', 'seeded');
    createRoot((d) => {
      dispose = d;
      useQuery({ queryKey: ['acct', 1], queryFn: ({ queryKey }) => { seen.push(queryKey); return 'fetched'; }, onSuccess: (_, key) => heard.push(key) });
    });
    await tick();
    seen.length = heard.length = 0;
    await invalidateQueries(['acct']);
    await tick();
    assert.deepEqual(seen, [['acct', 1]]);
    assert.deepEqual(heard, [['acct', 1]]);
  });

  it('prefetchQuery gets its own key for an entry another spelling created', async () => {
    const seen = [];
    setQueryData('p:1', 'old');
    await new Promise((resolve) => setTimeout(resolve, 5));
    await prefetchQuery(['p', 1], (key) => { seen.push(key); return 'new'; });
    assert.deepEqual(seen, [['p', 1]]);
  });

  it('a reactive key that changes spelling but not entry hands the fetcher the new spelling', async () => {
    const seen = [];
    const key = signal('q:alpha');
    let result;
    createRoot((d) => {
      dispose = d;
      result = useQuery({ queryKey: key, queryFn: ({ queryKey }) => { seen.push(queryKey); return 'v'; }, refetchOnWindowFocus: false });
    });
    await tick();
    assert.deepEqual(seen, [['q:alpha']]);
    key(['q', 'alpha']);
    flushSync();
    await result.refetch();
    await invalidateQueries(['q', 'alpha']);
    assert.deepEqual(seen, [['q:alpha'], ['q', 'alpha'], ['q', 'alpha']]);
  });

  it('a stale prefetchQuery fetches with its own fetcher and key while an observer is attached', async () => {
    const observed = [];
    const prefetched = [];
    createRoot((d) => {
      dispose = d;
      useQuery({ queryKey: 'pf:1', queryFn: ({ queryKey }) => { observed.push(queryKey); return 'observer'; }, refetchOnWindowFocus: false });
    });
    await tick();
    observed.length = 0;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const value = await prefetchQuery(['pf', 1], (key) => { prefetched.push(key); return 'prefetch'; });
    assert.equal(value, 'prefetch');
    assert.deepEqual(prefetched, [['pf', 1]]);
    assert.deepEqual(observed, []);
  });

  it('an invalidation fetches as the reader that attached last (TanStack Query: the last observer\'s options)', async () => {
    const calls = [];
    const heard = [];
    createRoot((d) => {
      dispose = d;
      useQuery({ queryKey: 'inv:1', queryFn: ({ queryKey }) => { calls.push(['first', queryKey]); return 1; }, onSuccess: () => heard.push('first'), refetchOnWindowFocus: false });
    });
    await tick();
    const disposeFirst = dispose;
    createRoot((d) => {
      dispose = () => { d(); disposeFirst(); };
      useSWR(['inv', 1], (key) => { calls.push(['last', key]); return 1; }, { onSuccess: () => heard.push('last'), revalidateOnFocus: false, dedupingInterval: 0 });
    });
    await tick();
    calls.length = heard.length = 0;
    await invalidateQueries(['inv', 1]);
    assert.deepEqual(calls, [['last', ['inv', 1]]]);
    assert.deepEqual(heard, ['last']);
  });
});
