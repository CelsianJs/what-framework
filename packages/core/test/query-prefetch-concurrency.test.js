// Fetches that overlap, and who owns them.
//
// - An explicit prefetchQuery runs to completion and writes the cache whatever
//   the readers do: the last reader unmounting cancels only the fetches the
//   readers started. Before, a deferred prefetch was aborted when the last
//   reader of its key unmounted; it resolved undefined and left the old value.
// - An invalidation fetches as the active reader that attached last among the
//   readers that still read the entry: a reader whose key just moved to
//   another entry (its effect not flushed yet) is not one. Before, it handled
//   the old key's invalidation and heard its callback.
// - A newer fetch supersedes one in flight (TanStack Query's cancelRefetch):
//   the newest result lands, the superseded one never does, and callbacks
//   fire once.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!DOCTYPE html><html><body></body></html>');

const { createRoot, signal } = await import('../src/reactive.js');
const { useQuery, prefetchQuery, invalidateQueries, getQueryData, clearCache } = await import('../src/data.js');

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

// A fetcher whose calls the test answers.
function controlled(name, log) {
  const calls = [];
  const run = (key, abortSignal) => new Promise((resolve) => {
    log.push([name, key]);
    calls.push({ signal: abortSignal, resolve });
  });
  return { calls, run };
}

function reader(key, run, name, log, options = {}) {
  return createRoot((dispose) => ({
    dispose,
    q: useQuery({
      queryKey: key,
      queryFn: ({ queryKey, signal: abortSignal }) => run(queryKey, abortSignal),
      onSuccess: (data, k) => log.push(['callback', name, data, k]),
      refetchOnWindowFocus: false,
      ...options,
    }),
  }));
}

describe('overlapping fetches', () => {
  beforeEach(() => clearCache());

  it('a prefetch outlives the last reader of its key', async () => {
    const log = [];
    const r = controlled('reader', log);
    const p = controlled('prefetch', log);
    const a = reader('detach:key', r.run, 'a', log, { staleTime: Infinity, initialData: 'prior' });
    await tick();
    const done = prefetchQuery(['detach', 'key'], (key, { signal: s }) => p.run(key, s));
    a.dispose();
    p.calls[0].resolve('prefetched');
    assert.equal(await done, 'prefetched');
    assert.equal(p.calls[0].signal.aborted, false);
    assert.equal(getQueryData('detach:key'), 'prefetched');
    assert.deepEqual(log, [['prefetch', ['detach', 'key']]]);
  });

  it('a prefetch that joined a reader\'s fetch keeps it alive when the reader unmounts', async () => {
    const log = [];
    const r = controlled('reader', log);
    const a = reader('join:key', r.run, 'a', log);
    await tick();
    const done = prefetchQuery(['join', 'key'], () => { throw new Error('not called: it joins'); });
    a.dispose();
    r.calls[0].resolve('joined');
    assert.equal(await done, 'joined');
    assert.equal(r.calls[0].signal.aborted, false);
    assert.equal(getQueryData('join:key'), 'joined');
  });

  it('a reader\'s own fetch is still cancelled when the last reader unmounts', async () => {
    const log = [];
    const r = controlled('reader', log);
    const a = reader('own:key', r.run, 'a', log);
    await tick();
    a.dispose();
    assert.equal(r.calls[0].signal.aborted, true);
  });

  it('a refetch while a prefetch is in flight: the newest lands once, the prefetch resolves with it', async () => {
    const log = [];
    const r = controlled('reader', log);
    const p = controlled('prefetch', log);
    const a = reader('race:key', r.run, 'a', log, { staleTime: Infinity, initialData: 'prior' });
    await tick();
    const prefetched = prefetchQuery('race:key', (key, { signal: s }) => p.run(key, s));
    const refetched = a.q.refetch();
    assert.equal(p.calls[0].signal.aborted, true, 'the refetch supersedes the prefetch');
    a.dispose();
    assert.equal(r.calls[0].signal.aborted, false, 'it carries the prefetch, so the unmount does not cancel it');
    r.calls[0].resolve('newest');
    p.calls[0].resolve('stale');
    assert.equal(await prefetched, 'newest');
    assert.equal(await refetched, 'newest');
    await tick();
    assert.equal(getQueryData('race:key'), 'newest');
    assert.deepEqual(log.filter((entry) => entry[0] === 'callback'), [], 'the reader unmounted before it landed');
  });

  it('an invalidation during a reader\'s fetch: the newer fetch lands, its callback fires once', async () => {
    const log = [];
    const r = controlled('reader', log);
    const a = reader('inv:key', r.run, 'a', log);
    await tick();
    const invalidated = invalidateQueries('inv:key');
    assert.equal(r.calls.length, 2);
    assert.equal(r.calls[0].signal.aborted, true);
    r.calls[1].resolve('second');
    r.calls[0].resolve('first');
    await invalidated;
    await tick();
    assert.equal(getQueryData('inv:key'), 'second');
    assert.deepEqual(log.filter((entry) => entry[0] === 'callback'), [['callback', 'a', 'second', 'inv:key']]);
    a.dispose();
  });

  it('an invalidation of a key a reader just left goes to the reader that still reads it', async () => {
    const log = [];
    const o = controlled('older', log);
    const m = controlled('moving', log);
    const key = signal('moving:key');
    const older = reader('moving:key', o.run, 'older', log);
    const moving = reader(key, m.run, 'moving', log);
    await tick();
    for (const call of [...o.calls, ...m.calls]) call.resolve('first');
    await tick();
    log.length = 0;
    key('moving:other');
    const invalidated = invalidateQueries('moving:key', { exact: true });
    for (const call of [...o.calls, ...m.calls]) call.resolve('settled');
    await invalidated;
    await tick();
    const oldKeyCallbacks = log.filter((entry) => entry[0] === 'callback' && entry[3] === 'moving:key');
    assert.deepEqual(oldKeyCallbacks, [['callback', 'older', 'settled', 'moving:key']]);
    assert.deepEqual(log.filter((entry) => entry[0] === 'older'), [['older', ['moving:key']]]);
    older.dispose();
    moving.dispose();
  });
});
