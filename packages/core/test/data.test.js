// Tests for What Framework - Data Fetching
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { signal, effect } from '../src/reactive.js';

// Import cache management functions
const dataModule = await import('../src/data.js');
const {
  invalidateQueries,
  prefetchQuery,
  setQueryData,
  getQueryData,
  clearCache
} = dataModule;

describe('data fetching', () => {
  beforeEach(() => {
    clearCache();
  });

  describe('cache management', () => {
    it('setQueryData should set data in cache', () => {
      setQueryData('test-key', { value: 42 });
      assert.deepEqual(getQueryData('test-key'), { value: 42 });
    });

    it('setQueryData should accept updater function', () => {
      setQueryData('test-key', { count: 1 });
      setQueryData('test-key', (prev) => ({ count: prev.count + 1 }));
      assert.deepEqual(getQueryData('test-key'), { count: 2 });
    });

    it('getQueryData should return undefined for missing keys', () => {
      assert.equal(getQueryData('nonexistent'), undefined);
    });

    it('clearCache should remove all entries', () => {
      setQueryData('key1', 'value1');
      setQueryData('key2', 'value2');
      clearCache();
      assert.equal(getQueryData('key1'), undefined);
      assert.equal(getQueryData('key2'), undefined);
    });

    it('invalidateQueries with hard option should null specific key', () => {
      setQueryData('key1', 'value1');
      setQueryData('key2', 'value2');
      invalidateQueries('key1', { hard: true });
      assert.equal(getQueryData('key1'), null);
      assert.equal(getQueryData('key2'), 'value2');
    });

    it('invalidateQueries soft (default) should keep stale data', () => {
      setQueryData('key1', 'value1');
      invalidateQueries('key1');
      // Soft invalidation: data stays (stale-while-revalidate)
      assert.equal(getQueryData('key1'), 'value1');
    });

    it('invalidateQueries should support predicate function with hard option', () => {
      setQueryData('users:1', 'user1');
      setQueryData('users:2', 'user2');
      setQueryData('posts:1', 'post1');

      invalidateQueries((key) => key.startsWith('users:'), { hard: true });

      assert.equal(getQueryData('users:1'), null);
      assert.equal(getQueryData('users:2'), null);
      assert.equal(getQueryData('posts:1'), 'post1');
    });
  });

  describe('prefetchQuery', () => {
    it('should fetch and cache data', async () => {
      const fetcher = async (key) => ({ data: key });
      await prefetchQuery('prefetch-key', fetcher);
      assert.deepEqual(getQueryData('prefetch-key'), { data: 'prefetch-key' });
    });
  });
});
