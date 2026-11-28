// What this async model deliberately does not give, compared with Solid 2.0's
// (docs/ASYNC.md, "Limits"). Solid stages every write until the work it causes
// has landed; What keeps a read right after a write fresh, and holds only what
// is on screen. Each test pins What's actual behaviour, so the difference is a
// decision and stays visible.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { withResolvers } from '../../../test-utils/with-resolvers.js';

let env;
let W;
before(async () => {
  env = installDOM();
  W = await import('../src/index.js');
});
after(() => env.cleanup());

const drain = () => new Promise((resolve) => setImmediate(resolve));

function page() {
  const { signal, computed, h, mount } = W;
  const flights = new Map();
  const id = signal(1);
  const user = computed(() => {
    const flight = withResolvers();
    flights.set(id(), flight);
    return flight.promise;
  });
  const host = document.createElement('div');
  const stop = mount(h('div', null,
    h('b', null, () => 'id ' + id()),
    h('i', null, () => user())), host);
  return { id, host, stop, land: (n, v) => flights.get(n).resolve(v) };
}

describe('limits of the model, pinned', () => {
  it('an imperative read can be ahead of what a held screen shows (Solid serves the committed value)', async () => {
    const { startTransition } = W;
    const { id, host, stop, land } = page();
    land(1, 'user1');
    await drain();
    const committed = startTransition(() => id(2));
    await drain();
    assert.equal(id(), 2, 'a handler, a test, devtools read 2');
    assert.equal(host.textContent, 'id 1user1', 'while the screen still shows 1');
    land(2, 'user2');
    await committed;
    assert.equal(host.textContent, 'id 2user2');
    stop();
  });

  it('outside a transition, a reader of the write and a reader of the async value tear (Solid holds both)', async () => {
    const { id, host, stop, land } = page();
    land(1, 'user1');
    await drain();
    id(2);
    await drain();
    assert.equal(host.textContent, 'id 2user1', 'the id updated at once, the user waits for its fetch');
    land(2, 'user2');
    await drain();
    assert.equal(host.textContent, 'id 2user2');
    stop();
  });

  it('inside a batch(), what an earlier write queued is not held by a transition started there (Solid stages every write)', async () => {
    const { batch, startTransition } = W;
    const { id, host, stop, land } = page();
    land(1, 'user1');
    await drain();
    let committed;
    batch(() => {
      id(2);
      committed = startTransition(() => id(3));
    });
    await drain();
    assert.equal(host.textContent, 'id 3user1', 'the id binding, queued by id(2), shows the transition\'s write at once');
    await committed;
    land(3, 'user3');
    await drain();
    assert.equal(host.textContent, 'id 3user3');
    stop();
  });

  it('a transition does not hold a component that suspends on a chunk: the fallback shows (React keeps the old page)', async () => {
    const { signal, h, mount, Suspense, lazy, startTransition } = W;
    const chunk = withResolvers();
    const Page = lazy(() => chunk.promise);
    const route = signal('home');
    const host = document.createElement('div');
    const stop = mount(h(Suspense, { fallback: h('p', null, 'loading') },
      () => (route() === 'home' ? h('h1', null, 'home') : h(Page))), host);
    const committed = startTransition(() => route('page'));
    await committed;
    await drain();
    assert.equal(host.textContent, 'loading');
    chunk.resolve({ default: () => h('h1', null, 'page') });
    await drain();
    await drain();
    assert.equal(host.textContent, 'page');
    stop();
  });

  it('a write after an await inside startTransition is an ordinary write: it shows before the commit (Solid keeps it in the action)', async () => {
    const { signal, h, mount, startTransition, refresh, computed } = W;
    const status = signal('idle');
    const answers = [withResolvers(), withResolvers()];
    let run = 0;
    const list = computed(() => answers[run++].promise);
    const host = document.createElement('div');
    const stop = mount(h('p', null, () => status(), ' ', () => list()), host);
    answers[0].resolve('v1');
    await drain();
    const warn = console.warn;
    console.warn = () => {};
    let done;
    try {
      done = startTransition(async () => {
        await Promise.resolve();
        status('saved');
        const landed = refresh(list);
        await landed;
      });
      await drain();
    } finally {
      console.warn = warn;
    }
    assert.equal(host.textContent, 'saved v1', 'status shows at once, while the list waits for the transition');
    answers[1].resolve('v2');
    await done;
    assert.equal(host.textContent, 'saved v2');
    stop();
  });
});
