// A function in a key array is read as part of the key: `['search', term]`
// (a signal) and `['search', () => term()]` name the entry of term's current
// value, follow it to a new entry when it changes, and hand the fetcher the
// values, as `() => ['search', term()]` does (docs/DATA.md).

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { withResolvers } from '../../../test-utils/with-resolvers.js';

installDOM('<!DOCTYPE html><html><body></body></html>');

const { signal, flushSync } = await import('../src/index.js');
const {
  useQuery, useSWR, invalidateQueries, setQueryData, getQueryData, clearCache,
} = await import('../src/entries/data.js');

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function remote() {
  const calls = [];
  const fetcher = (key) => {
    const call = { key, ...withResolvers() };
    calls.push(call);
    return call.promise;
  };
  return { calls, fetcher };
}

describe('a function in a key array', () => {
  beforeEach(() => clearCache());

  for (const [name, part] of [
    ['a thunk', (term) => () => term()],
    ['a signal', (term) => term],
  ]) {
    it(`${name} names its current value's entry and follows it`, async () => {
      const { calls, fetcher } = remote();
      const term = signal('red');
      const q = useQuery({
        queryKey: ['parts', part(term)],
        queryFn: ({ queryKey }) => fetcher(queryKey),
        refetchOnWindowFocus: false,
      });
      assert.deepEqual(calls[0].key, ['parts', 'red'], 'the fetcher gets the values');
      calls[0].resolve('red things');
      await tick();
      assert.equal(q.data(), 'red things');

      term('blue');
      flushSync();
      await tick();
      assert.equal(calls.length, 2);
      assert.deepEqual(calls[1].key, ['parts', 'blue']);
      calls[1].resolve('blue things');
      await tick();
      assert.equal(q.data(), 'blue things');
      assert.equal(getQueryData(['parts', 'red']), 'red things', 'each value has its own entry');
      assert.equal(getQueryData(['parts', 'blue']), 'blue things');
    });
  }

  it('the cache functions read the part too', async () => {
    const term = signal('a');
    setQueryData(['cache-parts', term], 1);
    assert.equal(getQueryData(['cache-parts', 'a']), 1);
    assert.equal(getQueryData(['cache-parts', () => term()]), 1);

    const { calls, fetcher } = remote();
    useQuery({ queryKey: ['cache-parts', 'a'], queryFn: ({ queryKey }) => fetcher(queryKey), refetchOnWindowFocus: false });
    calls[0].resolve(2);
    await tick();
    invalidateQueries(['cache-parts', term]);
    await tick();
    assert.equal(calls.length, 2, 'invalidating with a signal part refetches its value\'s entry');
  });

  it('useSWR treats a part that throws as no key yet', async () => {
    const { calls, fetcher } = remote();
    const user = signal(null);
    const swr = useSWR(['swr-parts', () => user().id], fetcher);
    await tick();
    assert.equal(calls.length, 0);
    assert.equal(swr.data(), useSWR(null, fetcher).data(), 'it reads as a null key does');

    user({ id: 7 });
    flushSync();
    await tick();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].key, ['swr-parts', 7]);
  });
});
