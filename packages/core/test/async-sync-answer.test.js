// An async computed whose run in flight gives way to a synchronous answer
// (an input changed, and the new run answers at once) has landed as surely as
// one whose promise resolved: what waits for its landing must hear it. And
// settled() must not resolve while a <Suspense> is still about to look again
// at what it waits for. The query cache's value takes exactly this path when
// its entry lands (data.js), which is how both were found.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!DOCTYPE html><html><body></body></html>');

const { h, mount, signal, computed, effect, refresh, settled, Suspense } = await import('../src/index.js');

const timeout = (ms) => new Promise((resolve) => setTimeout(() => resolve('timed out'), ms));

describe('a run that gives way to a synchronous answer', () => {
  it('reveals the <Suspense> waiting on it, and settled() waits for the reveal', async () => {
    const source = Promise.withResolvers();
    const user = computed(async () => source.promise);
    // A computed that answers with a promise of the value it reads, then,
    // when that value lands and it runs again, with the value itself.
    const name = computed(() => {
      try {
        return user().name;
      } catch (wait) {
        if (wait && typeof wait.then === 'function') return wait.then(() => user.peek().name);
        throw wait;
      }
    });
    const el = document.createElement('div');
    document.body.appendChild(el);
    const stop = mount(h(Suspense, { fallback: h('i', null, 'loading') }, h('b', null, () => name())), el);
    assert.equal(el.textContent, 'loading');
    source.resolve({ name: 'Ada' });
    assert.notEqual(await Promise.race([settled().then(() => 'settled'), timeout(200)]), 'timed out');
    assert.equal(el.textContent, 'Ada', 'on the line after settled(), the boundary has revealed');
    stop();
  });

  it('settled() waits until the <Suspense> has looked again at what it waits for', async () => {
    const source = Promise.withResolvers();
    const user = computed(async () => source.promise);
    const profile = computed(() => {
      try {
        return user();
      } catch (wait) {
        if (wait && typeof wait.then === 'function') return wait.then(() => user.peek());
        throw wait;
      }
    });
    const el = document.createElement('div');
    document.body.appendChild(el);
    const stop = mount(h(Suspense, { fallback: h('i', null, 'loading') }, h('b', null, () => profile().name)), el);
    source.resolve({ name: 'Grace' });
    await settled();
    assert.equal(el.textContent, 'Grace');
    stop();
  });

  it('resolves a refresh() promise of the run it ends', async () => {
    const mode = signal('async');
    const value = computed(() => (mode() === 'async' ? new Promise(() => {}) : 'answered'));
    const stop = effect(() => { try { value(); } catch { /* waiting */ } });
    const done = refresh(value);
    mode('sync');
    assert.equal(await Promise.race([done, timeout(200)]), 'answered');
    stop();
  });
});
