// Regression for the query-key normalization gap found in the 2026-08-09 parity
// audit: useQuery joined an array key into a string, and every other cache entry
// point used the raw value. `invalidateQueries(['todos'])` therefore looked up an
// Array object as a Map key, found nothing, and silently did nothing. The
// documented shape was the broken one.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  invalidateQueries,
  prefetchQuery,
  setQueryData,
  getQueryData,
  clearCache,
} from '../src/data.js';

describe('array query keys reach the same cache entry from every API', () => {
  beforeEach(() => clearCache());

  it('setQueryData and getQueryData agree on an array key', () => {
    setQueryData(['todos', 1], { title: 'write tests' });
    assert.deepEqual(getQueryData(['todos', 1]), { title: 'write tests' });
  });

  it('a string key and the equivalent array key are the same entry', () => {
    setQueryData(['todos'], 'from array');
    assert.equal(getQueryData('todos'), 'from array', 'useSWR string keys share the namespace');
  });

  it('prefetchQuery populates the entry an array key reads', async () => {
    await prefetchQuery(['user', 7], async () => ({ id: 7 }));
    assert.deepEqual(getQueryData(['user', 7]), { id: 7 });
  });

  it('distinct array keys stay distinct', () => {
    setQueryData(['todos', 1], 'one');
    setQueryData(['todos', 2], 'two');
    assert.equal(getQueryData(['todos', 1]), 'one');
    assert.equal(getQueryData(['todos', 2]), 'two');
  });

  // Without escaping, ['user', 'a:b'] and ['user', 'a', 'b'] both join to
  // 'user:a:b' and one query serves the other's data, which is worse than a miss.
  it('a colon inside a segment cannot collide with a segment boundary', () => {
    setQueryData(['user', 'a:b'], 'inside');
    setQueryData(['user', 'a', 'b'], 'boundary');
    assert.equal(getQueryData(['user', 'a:b']), 'inside');
    assert.equal(getQueryData(['user', 'a', 'b']), 'boundary');
  });
});

describe('invalidateQueries treats an array key as a prefix', () => {
  beforeEach(() => clearCache());

  it('hard-invalidates every key under the prefix', () => {
    setQueryData(['todos', 1], 'one');
    setQueryData(['todos', 2], 'two');
    setQueryData(['users', 1], 'untouched');

    invalidateQueries(['todos'], { hard: true });

    assert.equal(getQueryData(['todos', 1]), null, 'nested keys are invalidated');
    assert.equal(getQueryData(['todos', 2]), null);
    assert.equal(getQueryData(['users', 1]), 'untouched', 'unrelated keys are left alone');
  });

  it('matches on segment boundaries, so a shorter word is not a prefix', () => {
    setQueryData(['todos'], 'plural');
    invalidateQueries(['todo'], { hard: true });
    assert.equal(getQueryData(['todos']), 'plural', "['todo'] must not match 'todos'");
  });

  it('invalidates the exact key as well as its children', () => {
    setQueryData(['todos'], 'list');
    setQueryData(['todos', 1], 'item');
    invalidateQueries(['todos'], { hard: true });
    assert.equal(getQueryData(['todos']), null);
    assert.equal(getQueryData(['todos', 1]), null);
  });

  it('exact:true narrows to the single key', () => {
    setQueryData(['todos'], 'list');
    setQueryData(['todos', 1], 'item');
    invalidateQueries(['todos'], { hard: true, exact: true });
    assert.equal(getQueryData(['todos']), null);
    assert.equal(getQueryData(['todos', 1]), 'item', 'children survive an exact invalidation');
  });

  it('still honours a string key and a predicate', () => {
    setQueryData('key1', 'v');
    invalidateQueries('key1', { hard: true });
    assert.equal(getQueryData('key1'), null);

    setQueryData('users:1', 'u');
    invalidateQueries((key) => key.startsWith('users:'), { hard: true });
    assert.equal(getQueryData('users:1'), null);
  });
});
