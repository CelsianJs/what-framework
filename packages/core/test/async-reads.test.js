// Reading async values (docs/ASYNC.md, "Reading", "<ErrorBoundary>", "use()"):
// an error boundary's reset() fetches again the run whose error it caught,
// whatever was rejected with; a tracked isPending() follows a branch onto a
// value being fetched; use() counts suspensions per instance; a derived value
// with no value yet is not a landed undefined; an adopted async generator
// refetches when what it read changes.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

let env;
let W;
before(async () => {
  env = installDOM();
  W = await import('../src/index.js');
});
after(() => env.cleanup());

const drain = () => new Promise((resolve) => setImmediate(resolve));

describe('ErrorBoundary reset() fetches again the run whose error it caught', () => {
  it('a rejection with a string is retried', async () => {
    const { computed, h, mount, Suspense, ErrorBoundary } = W;
    const host = document.createElement('div');
    let runs = 0;
    let reset;
    const value = computed(async () => { if (++runs === 1) throw 'offline'; return 'ready'; });
    const stop = mount(h(ErrorBoundary, { fallback: ({ error, reset: retry }) => { reset = retry; return String(error); } },
      h(Suspense, { fallback: 'loading' }, h('p', null, () => value()))), host);
    await drain();
    assert.equal(host.textContent, 'offline');
    reset();
    await drain();
    assert.equal(host.textContent, 'ready');
    assert.equal(runs, 2);
    stop();
  });

  it('two values rejected with one Error object: only the one the boundary caught is fetched again', async () => {
    const { computed, h, mount, ErrorBoundary } = W;
    const host = document.createElement('div');
    const shared = new Error('offline');
    const a = Promise.withResolvers();
    const b = Promise.withResolvers();
    let runsA = 0;
    let runsB = 0;
    let reset;
    const visible = computed(async () => (++runsA === 1 ? a.promise : 'visible OK'));
    computed(async () => (++runsB === 1 ? b.promise : 'unread OK'));
    const stop = mount(h(ErrorBoundary, { fallback: ({ error, reset: retry }) => { reset = retry; return error.message; } },
      h('p', null, () => visible())), host);
    a.reject(shared);
    await drain();
    b.reject(shared);
    await drain();
    reset();
    await drain();
    assert.equal(host.textContent, 'visible OK');
    assert.deepEqual([runsA, runsB], [2, 1]);
    stop();
  });

  it('an error read through a derived value is retried at its source', async () => {
    const { computed, h, mount, ErrorBoundary } = W;
    const host = document.createElement('div');
    let runs = 0;
    let reset;
    const user = computed(async () => { if (++runs === 1) throw new Error('offline'); return { name: 'Ada' }; });
    const name = computed(() => user().name);
    const stop = mount(h(ErrorBoundary, { fallback: ({ error, reset: retry }) => { reset = retry; return error.message; } },
      h('p', null, () => name())), host);
    await drain();
    assert.equal(host.textContent, 'offline');
    reset();
    await drain();
    assert.equal(host.textContent, 'Ada');
    stop();
  });
});

describe('isPending()', () => {
  it('a tracked isPending() sees a branch switch onto a value being fetched again, and its landing', async () => {
    const { computed, signal, effect, isPending, createRoot } = W;
    const key = signal(0);
    const enabled = signal(false);
    const idle = Promise.withResolvers();
    const value = computed(async () => (key() ? idle.promise : 'ready'));
    const outer = computed(() => (enabled() ? value() : 'disabled'));
    await drain();
    const seen = [];
    const dispose = createRoot((d) => {
      effect(() => { seen.push(isPending(() => outer())); });
      return d;
    });
    key(1);
    enabled(true);
    await drain();
    assert.deepEqual(seen, [false, true]);
    idle.resolve('next');
    await drain();
    assert.deepEqual(seen, [false, true, false]);
    dispose();
  });
});

describe('use()', () => {
  it('counts suspensions per instance: rows that each read a cached promise never look uncached', async () => {
    const { use, h, mount, Suspense, ErrorBoundary } = W;
    const host = document.createElement('div');
    const flights = Array.from({ length: 4 }, () => Promise.withResolvers());
    const cached = flights.map(({ promise }) => ({ then: promise.then.bind(promise) }));
    function Row({ promise }) { return use(promise); }
    const place = (i) => {
      const el = document.createElement('div');
      host.appendChild(el);
      return mount(h(ErrorBoundary, { fallback: ({ error }) => error.code },
        h(Suspense, { fallback: 'loading' }, h(Row, { promise: cached[i] }))), el);
    };
    const warn = console.warn;
    console.warn = () => {};
    const stops = [place(0)];
    try {
      for (let i = 0; i < 3; i++) {
        await drain();
        flights[i].resolve('row' + i);
        await Promise.resolve();
        stops.push(place(i + 1));
        await drain();
      }
      flights[3].resolve('row3');
      await drain();
      assert.equal([...host.children].map((el) => el.textContent).join('|'), 'row0|row1|row2|row3');
    } finally {
      console.warn = warn;
      for (const stop of stops) stop();
    }
  });
});

describe('a value with nothing landed yet, read through a derived value', () => {
  it('a component body reading a useMemo over its own pending computed is ERR_ASYNC_READ_IN_BODY, not undefined', async () => {
    const { computed, useMemo, h, mount, Suspense, ErrorBoundary } = W;
    const host = document.createElement('div');
    let attempts = 0;
    function Child() {
      const source = computed(async () => 'ready');
      const derived = useMemo(() => source());
      attempts++;
      return 'derived:' + derived();
    }
    const error = console.error;
    console.error = () => {};
    try {
      const stop = mount(h(ErrorBoundary, { fallback: ({ error: e }) => e.code },
        h(Suspense, { fallback: 'loading' }, h(Child))), host);
      await drain();
      assert.equal(host.textContent, 'ERR_ASYNC_READ_IN_BODY');
      assert.equal(attempts, 1);
      stop();
    } finally {
      console.error = error;
    }
  });

  it('read through a derived value made outside, the body suspends until it lands', async () => {
    const { computed, h, mount, Suspense } = W;
    const host = document.createElement('div');
    const gate = Promise.withResolvers();
    const source = computed(async () => gate.promise);
    const derived = computed(() => 'derived:' + source());
    function Child() { return derived(); }
    const stop = mount(h(Suspense, { fallback: 'loading' }, h(Child)), host);
    await drain();
    assert.equal(host.textContent, 'loading');
    gate.resolve('ready');
    await drain();
    await drain();
    assert.equal(host.textContent, 'derived:ready');
    stop();
  });
});

describe('an async generator adopted while hydrating', () => {
  it('refetches when what it read before its first await changes', async () => {
    const server = await import('../../server/src/index.js');
    const internal = await import('../src/entries/internal.js');
    const { h, computed, signal, Suspense, hydrate } = W;
    const id = signal(1);
    const calls = [];
    function Page() {
      const content = computed(async function* ({ signal: abort }) {
        const value = id();
        if (abort.aborted) return;
        calls.push(value + (internal.getServerContext() ? '@server' : '@client'));
        yield 'item' + value;
      });
      return h(Suspense, { fallback: 'loading' }, h('p', null, () => content()));
    }
    const html = await server.renderDocument({ default: Page });
    const host = document.createElement('div');
    document.body.appendChild(host);
    host.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
    internal.__resetHydrationData();
    const stop = hydrate(h(Page), host);
    await drain();
    assert.equal(host.querySelector('p').textContent, 'item1');
    assert.deepEqual(calls, ['1@server'], 'adopted, with no client fetch');
    id(2);
    await drain();
    await drain();
    assert.equal(host.querySelector('p').textContent, 'item2');
    assert.deepEqual(calls, ['1@server', '2@client']);
    stop();
    host.remove();
  });
});
