// Development diagnostics for the async mistakes agents make (docs/ASYNC.md,
// "Diagnostics"): each fires on its mistake, and stays silent on correct code.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

let env;
let W;
before(async () => {
  env = installDOM();
  W = await import('../src/index.js');
});
after(() => env.cleanup());
beforeEach(() => W.clearDiagnostics());

const drain = () => new Promise((resolve) => setImmediate(resolve));
const codes = () => W.getDiagnostics().events.map((e) => e.code);
const quiet = (fn) => {
  const warn = console.warn;
  const error = console.error;
  console.warn = () => {};
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.warn = warn;
    console.error = error;
  }
};

describe('ERR_ASYNC_EFFECT', () => {
  it('reports an async function passed to effect() or useEffect()', async () => {
    const { effect, useEffect, h, mount, createRoot, signal } = W;
    const id = signal(1);
    quiet(() => createRoot((dispose) => {
      effect(async () => { id(); });
      dispose();
    }));
    function Page() {
      useEffect(async () => {});
      return h('p', null, 'page');
    }
    const host = document.createElement('div');
    const stop = quiet(() => mount(h(Page), host));
    await drain();
    stop();
    assert.deepEqual(codes(), ['ERR_ASYNC_EFFECT', 'ERR_ASYNC_EFFECT'], 'one for effect(), one for useEffect()');
  });

  it('stays silent for synchronous effects and an async onMount', async () => {
    const { effect, useEffect, onMount, h, mount, createRoot } = W;
    createRoot((dispose) => {
      effect(() => {});
      dispose();
    });
    function Page() {
      useEffect(() => () => {});
      onMount(async () => {});
      return h('p', null, 'page');
    }
    const host = document.createElement('div');
    const stop = mount(h(Page), host);
    await drain();
    stop();
    assert.deepEqual(codes(), []);
  });
});

describe('ERR_PENDING_READ_UNTRACKED', () => {
  it('reports pending() or isPending() read once in a component body', () => {
    const { computed, isPending, h, mount } = W;
    function Page() {
      const users = computed(() => Promise.resolve([]));
      const refreshing = users.pending() || isPending(() => users());
      return h('p', null, refreshing ? 'refreshing' : '');
    }
    const host = document.createElement('div');
    const stop = quiet(() => mount(h(Page), host));
    stop();
    assert.deepEqual([...new Set(codes())], ['ERR_PENDING_READ_UNTRACKED']);
  });

  it('stays silent in a binding and in an event handler', () => {
    const { computed, h, mount } = W;
    let users;
    function Page() {
      users = computed(() => Promise.resolve([]));
      return h('p', null, () => (users.pending() ? 'refreshing' : ''));
    }
    const host = document.createElement('div');
    const stop = mount(h(Page), host);
    users.pending();
    stop();
    assert.deepEqual(codes(), []);
  });
});

describe('ERR_WRITE_AFTER_AWAIT', () => {
  it('reports a transition writing, after an await, a signal it wrote before', async () => {
    const { signal, startTransition } = W;
    const status = signal('idle', 'status');
    const done = quiet(() => startTransition(async () => {
      status('saving');
      await Promise.resolve();
      status('saved');
    }));
    await done;
    assert.deepEqual(codes(), ['ERR_WRITE_AFTER_AWAIT']);
    assert.match(W.getDiagnostics().events[0].message, /"status"/);
  });

  it('stays silent for a write wrapped in its own transition, and for an event handler', async () => {
    const { signal, startTransition, h, mount } = W;
    const status = signal('idle');
    const slow = Promise.withResolvers();
    const done = startTransition(async () => {
      status('saving');
      await slow.promise;
      startTransition(() => status('saved'));
    });
    const host = document.createElement('div');
    const stop = mount(h('button', { onclick: () => status('clicked') }, 'b'), host);
    host.querySelector('button').click();
    slow.resolve();
    await done;
    stop();
    assert.deepEqual(codes(), []);
  });
});

describe('ERR_OPTIMISTIC_OUTSIDE_TRANSITION', () => {
  it('reports addOptimistic called outside a transition', () => {
    const { signal, useOptimistic } = W;
    const [, add] = useOptimistic(signal(1));
    add(2);
    assert.deepEqual(codes(), ['ERR_OPTIMISTIC_OUTSIDE_TRANSITION']);
  });

  it('stays silent when called inside a transition, an async one included', async () => {
    const { signal, useOptimistic, startTransition } = W;
    const [, add] = useOptimistic(signal(1));
    await startTransition(async () => {
      add(2);
      await Promise.resolve();
    });
    assert.deepEqual(codes(), []);
  });
});

describe('ERR_USE_UNCACHED_PROMISE', () => {
  it('stops a component that suspends on a new promise every time it runs, with an error', async () => {
    const { use, h, mount, Suspense, ErrorBoundary } = W;
    let runs = 0;
    function User() {
      runs++;
      return h('p', null, use(Promise.resolve('fresh')));
    }
    const host = document.createElement('div');
    const stop = mount(h(ErrorBoundary, { fallback: ({ error }) => h('em', null, error.code) },
      h(Suspense, { fallback: 'wait' }, h(User))), host);
    for (let i = 0; i < 6; i++) await drain();
    assert.equal(host.textContent, 'ERR_USE_UNCACHED_PROMISE');
    assert.ok(runs <= 4, `the loop was broken (${runs} runs)`);
    stop();
    assert.ok(codes().includes('ERR_USE_UNCACHED_PROMISE'));
  });

  it('stays silent for promises made outside, one per row, and a sequence of cached promises', async () => {
    const { use, h, mount, Suspense } = W;
    const rows = [Promise.resolve('a'), Promise.resolve('b'), Promise.resolve('c')];
    const steps = [Promise.resolve(1), Promise.resolve(2), Promise.resolve(3), Promise.resolve(4)];
    function Row(props) { return h('li', null, use(rows[props.i])); }
    function Steps() { return h('p', null, steps.map((p) => use(p)).join('')); }
    const host = document.createElement('div');
    const stop = mount(h(Suspense, { fallback: 'wait' }, h(Row, { i: 0 }), h(Row, { i: 1 }), h(Row, { i: 2 }), h(Steps)), host);
    for (let i = 0; i < 8; i++) await drain();
    assert.equal(host.textContent, 'abc1234');
    stop();
    assert.deepEqual(codes(), []);
  });
});

describe('ERR_ASYNC_WITHOUT_SUSPENSE', () => {
  it('stays silent under a boundary, and for a binding that waits', async () => {
    const { lazy, computed, h, mount, Suspense } = W;
    const chunk = Promise.withResolvers();
    const Settings = lazy(() => chunk.promise);
    const later = computed(() => new Promise(() => {}));
    const host = document.createElement('div');
    const stop = mount(h('div', null, h(Suspense, { fallback: 'wait' }, h(Settings)), h('p', null, () => later())), host);
    chunk.resolve({ default: () => h('p', null, 'settings') });
    await drain();
    stop();
    assert.deepEqual(codes(), []);
  });
});

describe('ERR_ASYNC_READ_IN_BODY', () => {
  it('is the error for a body that reads, before it lands, an async value it made', async () => {
    const { computed, h, mount, ErrorBoundary } = W;
    let fetches = 0;
    function Profile() {
      const user = computed(() => { fetches++; return new Promise(() => {}); });
      return h('h1', null, user().name);
    }
    const host = document.createElement('div');
    const stop = mount(h(ErrorBoundary, { fallback: ({ error }) => h('em', null, error.code) }, h(Profile)), host);
    await drain();
    assert.equal(host.textContent, 'ERR_ASYNC_READ_IN_BODY');
    assert.equal(fetches, 1);
    stop();
    assert.deepEqual(codes(), ['ERR_ASYNC_READ_IN_BODY']);
  });

  it('stays silent for a value read in JSX, and one made outside the component', async () => {
    const { computed, use, h, mount, Suspense } = W;
    const shared = computed(() => Promise.resolve({ name: 'Ada' }));
    function Profile() {
      const user = computed(() => Promise.resolve({ name: 'Bo' }));
      return h('h1', null, () => user().name, ' ', use(shared).name);
    }
    const host = document.createElement('div');
    const stop = mount(h(Suspense, { fallback: 'wait' }, h(Profile)), host);
    for (let i = 0; i < 4; i++) await drain();
    assert.equal(host.textContent, 'Bo Ada');
    stop();
    assert.deepEqual(codes(), []);
  });
});

describe('ERR_ASYNC_EFFECT on a run after the first', () => {
  it('reports an effect that starts returning a promise when it runs again', async () => {
    const { signal, effect, createRoot } = W;
    const armed = signal(false);
    const dispose = createRoot((d) => {
      effect(() => { if (armed()) return Promise.resolve(); });
      return d;
    });
    assert.deepEqual(codes(), []);
    quiet(() => armed(true));
    await drain();
    assert.deepEqual(codes(), ['ERR_ASYNC_EFFECT']);
    dispose();
  });
});

describe('ERR_WRITE_AFTER_AWAIT is a heuristic', () => {
  it('stays silent for a write, from a timer, to a signal the running transition never wrote', async () => {
    const { signal, startTransition, h, mount } = W;
    const status = signal('idle', 'status');
    const other = signal('a', 'other');
    const host = document.createElement('div');
    const stop = mount(h('p', null, () => status() + other()), host);
    const slow = Promise.withResolvers();
    const done = startTransition(async () => { status('saving'); await slow.promise; });
    await new Promise((resolve) => setTimeout(() => { other('b'); resolve(); }, 0));
    slow.resolve();
    await done;
    stop();
    assert.deepEqual(codes(), []);
  });
});

describe('ERR_ASYNC_COMPONENT', () => {
  it('reports a component that returns a promise', async () => {
    const { h, mount } = W;
    async function Profile() { return h('h1', null, 'Ada'); }
    const host = document.createElement('div');
    const stop = quiet(() => mount(h(Profile), host));
    stop();
    assert.deepEqual(codes(), ['ERR_ASYNC_COMPONENT']);
    assert.match(W.getDiagnostics().events[0].message, /"Profile"/);
  });

  it('stays silent for a component that returns a function or reads an async value', async () => {
    const { computed, h, mount, Suspense } = W;
    function Profile() {
      const user = computed(async () => ({ name: 'Ada' }));
      return () => h('h1', null, user().name);
    }
    const host = document.createElement('div');
    const stop = mount(h(Suspense, { fallback: 'wait' }, h(Profile)), host);
    await drain();
    stop();
    assert.deepEqual(codes(), []);
  });
});

describe('ERR_ASYNC_MEMO', () => {
  it('reports useMemo returning a promise', async () => {
    const { useMemo, h, mount } = W;
    let memo;
    function Profile() {
      memo = useMemo(() => Promise.resolve({ name: 'Ada' }));
      return h('p', null, 'profile');
    }
    const host = document.createElement('div');
    const stop = quiet(() => mount(h(Profile), host));
    quiet(() => memo());
    stop();
    assert.deepEqual(codes(), ['ERR_ASYNC_MEMO']);
  });

  it('stays silent for a synchronous useMemo and for computed() over a promise', async () => {
    const { useMemo, computed, h, mount, Suspense } = W;
    function Profile() {
      const total = useMemo(() => 1 + 2);
      const user = computed(() => Promise.resolve({ name: 'Ada' }));
      return h('p', null, () => total() + user().name);
    }
    const host = document.createElement('div');
    const stop = mount(h(Suspense, { fallback: 'wait' }, h(Profile)), host);
    await drain();
    await drain();
    assert.equal(host.textContent, '3Ada');
    stop();
    assert.deepEqual(codes(), []);
  });
});
