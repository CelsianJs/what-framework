// Structural sharing (TanStack Query's default): a refetch that answers data
// equal to what the cache holds keeps the cached references, so a keyed list
// sees the same row objects and rebuilds nothing; a changed row is a new
// object and its neighbours are not.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { withResolvers } from '../../../test-utils/with-resolvers.js';

installDOM('<!DOCTYPE html><html><body></body></html>');

const { h, mount, effect, flushSync } = await import('../src/index.js');
const { useQuery, useSWR, setQueryData, invalidateQueries, clearCache } = await import('../src/entries/data.js');
const { replaceEqualDeep } = await import('../src/data.js');

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const stops = [];
afterEach(() => { for (const stop of stops.splice(0)) stop(); });

describe('replaceEqualDeep', () => {
  it('keeps the previous value when the next one equals it', () => {
    const prev = { rows: [{ id: 1, tags: ['a'] }, { id: 2 }], total: 2 };
    assert.equal(replaceEqualDeep(prev, structuredClone(prev)), prev);
  });

  it('shares every part it did not change', () => {
    const prev = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' }];
    const next = [{ id: 1, name: 'a' }, { id: 2, name: 'B' }, { id: 3, name: 'c' }, { id: 4, name: 'd' }];
    const out = replaceEqualDeep(prev, next);
    assert.notEqual(out, prev);
    assert.deepEqual(out, next);
    assert.equal(out[0], prev[0]);
    assert.notEqual(out[1], prev[1]);
    assert.equal(out[2], prev[2]);
    assert.equal(out[3], next[3]);
  });

  it('takes anything but arrays and plain objects as it arrives', () => {
    const d1 = new Date(0);
    const d2 = new Date(0);
    assert.equal(replaceEqualDeep(d1, d2), d2);
    class Row { constructor(id) { this.id = id; } }
    const r2 = new Row(1);
    assert.equal(replaceEqualDeep(new Row(1), r2), r2);
    assert.equal(replaceEqualDeep([1, 2], [1, 2, 3]).length, 3);
    assert.deepEqual(replaceEqualDeep({ a: 1, b: 2 }, { a: 1 }), { a: 1 });
    assert.equal(replaceEqualDeep({ a: undefined }, { b: undefined }).b, undefined);
  });
});

describe('useQuery and useSWR share structure across refetches', () => {
  beforeEach(() => clearCache());

  function reader(read) {
    const seen = [];
    const el = document.createElement('div');
    document.body.appendChild(el);
    stops.push(mount(h(() => {
      const q = read();
      effect(() => { seen.push(q.data()); });
      return h('i', null, 'x');
    }), el));
    return seen;
  }

  it('an equal refetch keeps the cached array and rows, and readers do not run again', async () => {
    let answer = [{ id: 'e1', key: 'A' }, { id: 'e2', key: 'B' }];
    const seen = reader(() => useQuery({ queryKey: ['env', 'p1'], queryFn: async () => structuredClone(answer) }));
    await tick(5); flushSync();
    const first = seen.at(-1);
    assert.equal(first.length, 2);
    const runs = seen.length;
    await invalidateQueries(['env', 'p1']); await tick(5); flushSync();
    assert.equal(seen.at(-1), first, 'same array');
    // data() also follows the fetch's status, so a reader may run again, but
    // every value it reads is the cached array itself.
    assert.ok(seen.slice(runs).every((v) => v === first), 'nothing read a new value');

    answer = [{ id: 'e1', key: 'A' }, { id: 'e2', key: 'B2' }];
    await invalidateQueries(['env', 'p1']); await tick(5); flushSync();
    const next = seen.at(-1);
    assert.notEqual(next, first);
    assert.equal(next[0], first[0], 'the unchanged row keeps its object');
    assert.notEqual(next[1], first[1]);
    assert.equal(next[1].key, 'B2');
  });

  it('a refetch over seeded data keeps the seeded rows it equals', async () => {
    const seed = [{ id: 'e1', key: 'A' }];
    setQueryData(['seeded'], seed);
    const seen = reader(() => useQuery({ queryKey: ['seeded'], queryFn: async () => [{ id: 'e1', key: 'A' }] }));
    await tick(5); flushSync();
    assert.equal(seen.at(-1), seed);
  });

  it('structuralSharing: false takes every response as it arrives', async () => {
    const seen = reader(() => useQuery({ queryKey: ['raw'], queryFn: async () => [{ id: 1 }], structuralSharing: false }));
    await tick(5); flushSync();
    const first = seen.at(-1);
    await invalidateQueries(['raw']); await tick(5); flushSync();
    assert.notEqual(seen.at(-1), first);
    assert.deepEqual(seen.at(-1), first);
  });

  it('a function decides what the cache keeps', async () => {
    const seen = reader(() => useQuery({ queryKey: ['fn'], queryFn: async () => ({ n: Math.random() }), structuralSharing: (prev, next) => prev ?? next }));
    await tick(5); flushSync();
    const first = seen.at(-1);
    await invalidateQueries(['fn']); await tick(5); flushSync();
    assert.equal(seen.at(-1), first);
  });

  it('useSWR shares structure too', async () => {
    const { promise, resolve } = withResolvers();
    let calls = 0;
    const seen = reader(() => useSWR('swr-rows', async () => { calls++; if (calls > 1) await promise; return [{ id: 1, v: 'a' }]; }, { dedupingInterval: 0 }));
    await tick(5); flushSync();
    const first = seen.at(-1);
    const again = invalidateQueries('swr-rows');
    resolve(); await again; await tick(5); flushSync();
    assert.equal(calls, 2);
    assert.equal(seen.at(-1), first);
  });
});

describe('staleTime 0', () => {
  beforeEach(() => clearCache());

  it('a reader mounted in the same millisecond as setQueryData still fetches on mount', async () => {
    const realNow = Date.now;
    Date.now = () => 1_000_000; // every read in one millisecond
    try {
      const calls = [];
      setQueryData(['same-ms'], { v: 'seeded' });
      const el = document.createElement('div');
      document.body.appendChild(el);
      stops.push(mount(h(() => {
        const q = useQuery({ queryKey: ['same-ms'], queryFn: async () => { calls.push(1); return { v: 'fetched' }; } });
        return h('i', null, () => q.data()?.v);
      }), el));
      flushSync();
      await tick(5); flushSync();
      assert.equal(calls.length, 1, 'staleTime 0: seeded data is stale at once');
      assert.equal(el.textContent, 'fetched');
    } finally {
      Date.now = realNow;
    }
  });
});

describe('query accessors cut off unchanged values', () => {
  beforeEach(() => clearCache());

  it("a region reading data() and isLoading() keeps what it built across an equal refetch", async () => {
    let built = 0;
    const el = document.createElement('div');
    document.body.appendChild(el);
    stops.push(mount(h(() => {
      const q = useQuery({ queryKey: ['region'], queryFn: async () => ({ plan: 'pro' }) });
      return h('section', null, () => {
        if (q.isLoading()) return h('i', null, 'loading');
        const d = q.data();
        if (!d) return null;
        built++;
        return h('b', null, d.plan);
      });
    }), el));
    await tick(5); flushSync();
    assert.equal(el.textContent, 'pro');
    const node = el.querySelector('b');
    const builds = built;
    await invalidateQueries(['region']); await tick(5); flushSync();
    assert.equal(el.querySelector('b'), node, 'the region did not run again');
    assert.equal(built, builds);
  });

  it('select is memoized on the cached value', async () => {
    let selects = 0;
    const seen = [];
    const el = document.createElement('div');
    document.body.appendChild(el);
    stops.push(mount(h(() => {
      const q = useQuery({ queryKey: ['sel'], queryFn: async () => [{ id: 1 }, { id: 2 }], select: (rows) => { selects++; return rows.map((r) => r.id); } });
      effect(() => { seen.push(q.data()); });
      return h('i', null, 'x');
    }), el));
    await tick(5); flushSync();
    const first = seen.at(-1);
    const count = selects;
    await invalidateQueries(['sel']); await tick(5); flushSync();
    assert.equal(seen.at(-1), first);
    assert.equal(selects, count, 'the shared value was not selected again');
  });
});
