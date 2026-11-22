// Every way an async computed's run ends settles what waits for it
// (docs/ASYNC.md, "Starting and running"): a promise that settles, an async
// iterable that yields, ends or fails, and an answer already known that
// replaces the run in flight (the function returns a plain value or throws,
// createResource's mutate() sets one). What waits: refresh() promises, a
// component suspended on the value, held readers, a transition, settled().
// Times are virtual (fixtures/async-clock.js).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { asyncClock } from './fixtures/async-clock.js';
import { withResolvers } from '../../../test-utils/with-resolvers.js';

let env;
let W;
let R;
before(async () => {
  env = installDOM();
  W = await import('../src/index.js');
  R = await import('../src/reactive.js');
});
after(() => env.cleanup());

const drain = () => new Promise((resolve) => setImmediate(resolve));
// Whether settled() resolves within a few turns of the event loop. One that
// spun the microtask queue would starve those turns forever, so microtasks
// are capped while it waits: past the cap it has failed.
async function quietSoon() {
  const original = globalThis.queueMicrotask;
  let budget = 10000;
  globalThis.queueMicrotask = (fn) => { if (--budget > 0) original(fn); };
  try {
    return await Promise.race([W.settled().then(() => budget > 0), drain().then(drain).then(drain).then(() => false)]);
  } finally {
    globalThis.queueMicrotask = original;
  }
}

describe('a run replaced by an answer known at once', () => {
  it('settled() resolves when a refetch answers synchronously, with no flush left unscheduled', async (t) => {
    const { createResource } = W;
    const clock = asyncClock(t, () => '');
    const api = clock.api({ remote: [50, () => 'remote'] });
    const [data, { refetch }] = createResource((source) => (source === 'local' ? 'local' : api.remote()), { initialValue: 'initial' });
    const first = refetch('remote');
    const second = refetch('local');
    assert.equal(data.peek(), 'local');
    assert.equal(R._busy(), 1, 'the readers it reached run in a flush that is on its way');
    assert.equal(await quietSoon(), true, 'nothing is left in flight');
    let both = false;
    void Promise.all([first, second]).then(() => { both = true; });
    await drain();
    assert.ok(both, 'the superseded refetch and the new one both resolved');
    await clock.to(60);
    assert.equal(data.peek(), 'local', 'the superseded request never lands');
    clock.stop();
  });

  it('createResource mutate() supersedes a refetch a transition waits for: the request is aborted, the refetch resolves and the transition commits', async () => {
    const { createResource, startTransition, effect } = W;
    const requests = [];
    const [data, { refetch, mutate }] = createResource((source, { signal }) => {
      const flight = withResolvers();
      requests.push({ signal, flight });
      return flight.promise;
    }, { initialValue: 'initial' });
    const seen = [];
    const stop = effect(() => { seen.push(data()); });
    let refetched = false;
    let committed = false;
    void startTransition(() => { void refetch('next').then(() => { refetched = true; }); }).then(() => { committed = true; });
    await drain();
    mutate('local');
    requests[0].flight.resolve('stale');
    assert.equal(await quietSoon(), true);
    assert.equal(data.peek(), 'local');
    assert.ok(requests[0].signal.aborted, 'the superseded request was aborted');
    assert.ok(refetched, 'the refetch resolved with the mutation');
    assert.ok(committed, 'the transition stopped waiting for the run');
    assert.deepEqual(seen, ['initial', 'local'], 'the stale answer never shows');
    stop();
  });

  it('a synchronous value after a run started: refresh() resolves with it, and a component suspended on the value renders it', async (t) => {
    const { signal, computed, refresh, h, mount, Suspense } = W;
    const host = document.createElement('div');
    const clock = asyncClock(t, () => host.textContent);
    const api = clock.api({ slow: [100, () => 'late'] });
    const id = signal(0);
    const value = computed(({ signal: abort }) => (id() === 0 ? api.slow(abort) : 'local'));
    function Child() { return value(); }
    const stop = mount(h(Suspense, { fallback: 'loading' }, h(Child)), host);
    await clock.start();
    let result = 'unresolved';
    void refresh(value).then((v) => { result = v; });
    await clock.act(() => id(1));
    assert.equal(result, 'local');
    assert.equal(host.textContent, 'local', 'the component retried with the value');
    assert.equal(await quietSoon(), true);
    await clock.to(120);
    assert.deepEqual(clock.frames, [{ at: 0, text: 'loading' }, { at: 0, text: 'local' }], 'the superseded run never shows');
    stop();
    clock.stop();
  });

  it('a synchronous throw after a run started: refresh() rejects with it, and readers see the error', async () => {
    const { signal, computed, refresh, effect } = W;
    const key = signal(0);
    const gate = withResolvers();
    const value = computed(({ signal: abort }) => {
      if (key()) throw new Error('offline');
      void abort;
      return gate.promise;
    });
    const seen = [];
    const stop = effect(() => {
      try { seen.push('value:' + value()); } catch (error) {
        if (error instanceof Error) seen.push('error:' + error.message); else throw error;
      }
    });
    let outcome = 'unresolved';
    void refresh(value).then(() => { outcome = 'resolved'; }, (error) => { outcome = error.message; });
    key(1);
    await drain();
    assert.equal(outcome, 'offline');
    assert.deepEqual(seen, ['error:offline']);
    assert.equal(await quietSoon(), true);
    stop();
  });

  it('a resource whose refetch throws synchronously: an effect showing its value sees the error', async () => {
    const { createResource, effect } = W;
    const [data, { refetch, error }] = createResource((source) => {
      if (source === 'throw') throw new Error('offline');
      return Promise.resolve('initial');
    });
    const seen = [];
    const stop = effect(() => {
      try { seen.push('value:' + data()); } catch (e) {
        if (e instanceof Error) seen.push('error:' + e.message); else throw e;
      }
    });
    await drain();
    await refetch('throw');
    await drain();
    assert.deepEqual(seen, ['value:initial', 'error:offline']);
    assert.equal(error()?.message, 'offline');
    stop();
  });

  it('refresh() of a landed value whose function now answers at once: readers see the new value or error, and the promise settles with it', async () => {
    const { computed, refresh, effect } = W;
    let answer = 'fetch';
    let n = 0;
    const value = computed(() => {
      n++;
      if (answer === 'throw') throw new Error('offline ' + n);
      return answer === 'fetch' ? Promise.resolve('fetched ' + n) : 'local ' + n;
    });
    const seen = [];
    const stop = effect(() => {
      try { seen.push(value()); } catch (e) {
        if (e instanceof Error && e.message.startsWith('offline')) seen.push(e.message);
      }
    });
    await drain();
    answer = 'local';
    assert.equal(await refresh(value), 'local 2');
    await drain();
    answer = 'throw';
    await assert.rejects(refresh(value), { message: 'offline 3' });
    await drain();
    assert.deepEqual(seen, ['fetched 1', 'local 2', 'offline 3']);
    stop();
  });
});

describe('async iterables', () => {
  it('a first next() that throws is the computed\'s error, and the run stops counting as in flight', async () => {
    const { computed, createRoot, effect } = W;
    let value;
    const seen = [];
    const dispose = createRoot((d) => {
      value = computed(() => ({
        [Symbol.asyncIterator]() { return this; },
        next() { throw new Error('first next'); },
      }));
      effect(() => {
        try { seen.push(value()); } catch (e) {
          if (e instanceof Error) seen.push('error:' + e.message); else throw e;
        }
      });
      return d;
    });
    assert.equal(await quietSoon(), true);
    assert.deepEqual(seen, ['error:first next']);
    dispose();
    assert.equal(await quietSoon(), true);
  });

  it('a next() that throws after the first yield is the computed\'s error, not an unhandled rejection', async () => {
    const { computed, createRoot } = W;
    const unhandled = [];
    const onUnhandled = (e) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    let pulls = 0;
    let value;
    const dispose = createRoot((d) => {
      // Taking `{ signal }` makes it start when created.
      value = computed(({ signal }) => ({
        signal,
        [Symbol.asyncIterator]() { return this; },
        next() {
          if (++pulls > 1) throw new Error('next threw');
          return Promise.resolve({ value: 'first', done: false });
        },
      }));
      return d;
    });
    try {
      assert.equal(await quietSoon(), true);
      assert.throws(() => value(), /next threw/);
      await drain();
      assert.deepEqual(unhandled, []);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      dispose();
    }
  });

  it('settled() waits while an iterable is still pulled after its first value, until it ends or fails', async (t) => {
    const { computed, createRoot } = W;
    const clock = asyncClock(t, () => '');
    const api = clock.api({ second: [50, () => { throw new Error('midstream'); }] });
    let value;
    let pulls = 0;
    const dispose = createRoot((d) => {
      value = computed(({ signal }) => ({
        signal,
        [Symbol.asyncIterator]() { return this; },
        next() { return ++pulls === 1 ? Promise.resolve({ value: 'first', done: false }) : api.second(); },
        return() { return Promise.resolve({ done: true }); },
      }));
      return d;
    });
    let quiet = false;
    void W.settled().then(() => { quiet = true; });
    await drain();
    assert.equal(value(), 'first');
    assert.equal(quiet, false, 'the stream can still deliver or fail');
    await clock.to(60);
    assert.equal(quiet, true);
    assert.throws(() => value(), /midstream/);
    dispose();
    clock.stop();
  });
});
