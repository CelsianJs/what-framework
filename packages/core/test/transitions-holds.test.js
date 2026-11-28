// What a transition holds, and with whom it commits (docs/ASYNC.md,
// "Transitions"), frame by frame on a virtual clock (fixtures/async-clock.js):
// transitions that reach one binding commit together, a held region is not
// released by an urgent write to a child binding, a computed that starts its
// first run at the commit belongs to the transition, an optimistic overlay
// shows while another action holds its view, an unmounted useTransition stops
// waiting, a rejection reaches the error boundary above useTransition, and a
// component that suspends at the commit says what to do instead.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { asyncClock } from './fixtures/async-clock.js';
import { withResolvers } from '../../../test-utils/with-resolvers.js';

let env;
let W;
before(async () => {
  env = installDOM();
  W = await import('../src/index.js');
});
after(() => env.cleanup());

const drain = () => new Promise((resolve) => setImmediate(resolve));

describe('transitions: what they hold, and with whom they commit', () => {
  it('two transitions that reach one binding commit together: no frame shows one without the other', async (t) => {
    const { signal, computed, startTransition, h, mount } = W;
    const host = document.createElement('div');
    const clock = asyncClock(t, () => host.textContent);
    const api = clock.api({ a: [10, (id) => 'A' + id], b: [20, (id) => 'B' + id] });
    const a = signal(1);
    const b = signal(1);
    const va = computed(async () => api.a(a()));
    const vb = computed(async () => api.b(b()));
    const stop = mount(h('div', null, () => 'ids=' + a() + ',' + b(), ' ', () => va(), ' ', () => vb()), host);
    try {
      await clock.start();
      await clock.to(20);
      let first = false;
      await clock.act(() => {
        void startTransition(() => a(2)).then(() => { first = true; });
        void startTransition(() => b(2));
      });
      await clock.to(35);
      assert.equal(first, false, 'the first waits for the second, which reaches the binding it holds');
      await clock.to(50);
      assert.equal(first, true);
      assert.deepEqual(clock.frames, [
        { at: 0, text: 'ids=1,1  ' },
        { at: 10, text: 'ids=1,1 A1 ' },
        { at: 20, text: 'ids=1,1 A1 B1' },
        { at: 40, text: 'ids=2,2 A2 B2' },
      ]);
    } finally {
      stop();
      clock.stop();
    }
  });

  it('an urgent write to a child binding does not release the region a transition holds', async (t) => {
    const { signal, computed, startTransition, h, mount } = W;
    const host = document.createElement('div');
    const clock = asyncClock(t, () => host.textContent);
    const api = clock.api({ data: [10, (id) => 'data' + id] });
    const id = signal(1);
    const urgent = signal('a');
    const data = computed(async () => api.data(id()));
    const stop = mount(h('div', null,
      () => h('section', null, 'page=' + id(), ' ', () => 'urgent=' + urgent()), ' ', () => data()), host);
    try {
      await clock.start();
      await clock.to(10);
      await clock.act(() => { void startTransition(() => id(2)); });
      await clock.to(12);
      await clock.act(() => urgent('b'));
      await clock.to(25);
      assert.deepEqual(clock.frames, [
        { at: 0, text: 'page=1 urgent=a ' },
        { at: 10, text: 'page=1 urgent=a data1' },
        { at: 12, text: 'page=1 urgent=b data1' },
        { at: 20, text: 'page=2 urgent=b data2' },
      ]);
    } finally {
      stop();
      clock.stop();
    }
  });

  it('a computed that answered synchronously until the transition and starts a run at its commit belongs to it', async (t) => {
    const { signal, computed, startTransition, h, mount } = W;
    const host = document.createElement('div');
    const clock = asyncClock(t, () => host.textContent);
    const api = clock.api({ data: [10, () => 'data2'] });
    const id = signal(1);
    const value = computed(() => (id() === 1 ? 'data1' : api.data()));
    const stop = mount(h('div', null, () => 'page=' + id(), ' ', () => value()), host);
    try {
      await clock.start();
      let committed = false;
      await clock.act(() => { void startTransition(() => id(2)).then(() => { committed = true; }); });
      await clock.to(5);
      assert.equal(committed, false);
      await clock.to(15);
      assert.equal(committed, true);
      assert.deepEqual(clock.frames, [
        { at: 0, text: 'page=1 data1' },
        { at: 10, text: 'page=2 data2' },
      ]);
      assert.deepEqual(clock.starts, [{ at: 0, name: 'data' }], 'the run started inside the transition');
    } finally {
      stop();
      clock.stop();
    }
  });
});

describe('a transition an async action awaits', () => {
  // Within 50 ms, or the answer is that it never resolved.
  const within = (promise) => Promise.race([promise.then(() => 'resolved'), new Promise((r) => setTimeout(() => r('never'), 50))]);

  it('started in the action\'s synchronous part (it joins the action): resolves, and commits with the action', async () => {
    const { signal, startTransition, h, mount } = W;
    const host = document.createElement('div');
    const a = signal(0);
    const stop = mount(h('p', null, () => String(a())), host);
    try {
      let inner = 'pending';
      const outer = startTransition(async () => {
        a(1);
        await startTransition(() => a(2));
        inner = host.textContent;
      });
      assert.equal(await within(outer), 'resolved');
      assert.equal(inner, '0', 'it resolved before the commit: the action had not ended');
      assert.equal(host.textContent, '2');
    } finally {
      stop();
    }
  });

  it('started after an await, entangled with the action through a binding both reach: resolves, and both commit in one flush', async () => {
    const { signal, startTransition, h, mount } = W;
    const host = document.createElement('div');
    const a = signal(0);
    const b = signal(0);
    const stop = mount(h('p', null, () => a() + ',' + b()), host);
    try {
      const gate = withResolvers();
      const outer = startTransition(async () => {
        a(1);
        await gate.promise;
        await startTransition(() => b(1));
      });
      await drain();
      assert.equal(host.textContent, '0,0');
      gate.resolve();
      assert.equal(await within(outer), 'resolved');
      assert.equal(host.textContent, '1,1');
    } finally {
      stop();
    }
  });
});

describe('useOptimistic while another action holds the view', () => {
  it('a second overlay shows at once; the view adds overlays to the committed value; each real value replaces its overlay in its commit', async (t) => {
    const { useOptimistic, computed, refresh, startTransition, h, mount } = W;
    const host = document.createElement('div');
    const clock = asyncClock(t, () => host.textContent);
    let server = [];
    const api = clock.api({ list: [10, () => server], finishA: [30, () => {}], finishB: [50, () => {}] });
    const base = computed(async () => api.list());
    const [shown, add] = useOptimistic(base, (items, item) => [...items, item]);
    const stop = mount(h('p', null, () => shown().join(',') || '-'), host);
    try {
      await clock.start();
      await clock.to(10);
      await clock.act(() => {
        void startTransition(async () => {
          add('A');
          await Promise.resolve();
          server = ['A'];
          await refresh(base);
          await api.finishA();
        });
      });
      await clock.to(25);
      await clock.act(() => { void startTransition(async () => { add('B'); await api.finishB(); }); });
      assert.equal(shown().join(','), 'A,B', 'the view reads the committed list under both overlays');
      await clock.to(80);
      assert.deepEqual(clock.frames, [
        { at: 0, text: '' },
        { at: 10, text: '-' },
        { at: 10, text: 'A' },
        { at: 25, text: 'A,B' },
        { at: 75, text: 'A' },
      ]);
    } finally {
      stop();
      clock.stop();
    }
  });
});

describe('limits, pinned', () => {
  it('an overlay added while a transition holds its view runs the view\'s readers at once: one that also reads what the transition wrote shows it early', async () => {
    const { useOptimistic, signal, computed, refresh, startTransition, h, mount } = W;
    const host = document.createElement('div');
    const page = signal(1);
    let answer = withResolvers();
    const base = computed(async () => { page(); return answer.promise; });
    const [shown, add] = useOptimistic(base, (n, d) => n + d);
    const stop = mount(h('p', null, () => 'page ' + page() + ': ' + shown()), host);
    answer.resolve(10);
    await drain();
    const gate = withResolvers();
    answer = withResolvers();
    void startTransition(async () => {
      page(2);
      await Promise.resolve();
      answer.resolve(20);
      await refresh(base);
      await gate.promise;
    });
    await drain();
    await drain();
    assert.equal(host.textContent, 'page 1: 10', 'the transition holds the binding');
    const liked = withResolvers();
    void startTransition(async () => { add(1); await liked.promise; });
    await drain();
    assert.equal(host.textContent, 'page 2: 11', 'the overlay ran it: page 2 shows before the commit');
    gate.resolve();
    liked.resolve();
    await W.settled();
    assert.equal(host.textContent, 'page 2: 20');
    stop();
  });
});

describe('useTransition', () => {
  it('a component that unmounts in the synchronous part of its action stops waiting for it', async () => {
    const { useTransition, h, mount } = W;
    const gate = withResolvers();
    const host = document.createElement('div');
    let trigger;
    let stop;
    function Child() {
      const [, start] = useTransition();
      trigger = () => start(async () => { stop(); await gate.promise; });
      return 'ready';
    }
    stop = mount(h(Child), host);
    let committed = false;
    void trigger().then(() => { committed = true; });
    let quiet = false;
    void W.settled().then(() => { quiet = true; });
    await drain();
    assert.equal(committed, true);
    assert.equal(quiet, true);
    gate.resolve();
  });

  it('a rejected action shows in the ErrorBoundary above the component, as in React 19; the returned promise rejects too', async () => {
    const { useTransition, h, mount, ErrorBoundary } = W;
    const unhandled = [];
    const onUnhandled = (e) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    const page = () => {
      const host = document.createElement('div');
      let start;
      function Saver() {
        [, start] = useTransition();
        return h('p', null, 'form');
      }
      const stop = mount(h(ErrorBoundary, { fallback: ({ error }) => h('p', null, 'failed: ' + error.message) }, h(Saver)), host);
      return { host, start, stop };
    };
    try {
      const awaited = page();
      const done = awaited.start(async () => { await Promise.resolve(); throw new Error('save failed'); });
      await drain();
      assert.equal(awaited.host.textContent, 'failed: save failed');
      await assert.rejects(done, /save failed/);
      awaited.stop();

      const ignored = page();
      void ignored.start(async () => { throw new Error('nobody awaits this'); });
      await drain();
      await drain();
      assert.equal(ignored.host.textContent, 'failed: nobody awaits this');
      assert.deepEqual(unhandled, [], 'a rejection a boundary took is not unhandled');
      ignored.stop();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('with no boundary above, the returned promise rejects as before', async () => {
    const { useTransition, h, mount } = W;
    const host = document.createElement('div');
    let start;
    function Saver() {
      [, start] = useTransition();
      return h('p', null, 'form');
    }
    const stop = mount(h(Saver), host);
    await assert.rejects(start(async () => { throw new Error('no boundary'); }), /no boundary/);
    assert.equal(host.textContent, 'form');
    stop();
  });
});

describe('a component that suspends while a transition commits', () => {
  it('React\'s tabs pattern: the fallback shows, and development reports ERR_SUSPEND_IN_TRANSITION with the fix', async () => {
    const { signal, h, mount, Suspense, use, startTransition, getDiagnostics, clearDiagnostics } = W;
    clearDiagnostics();
    const tab = signal('a');
    const panelB = withResolvers();
    function B() { return h('p', null, use(panelB.promise)); }
    const host = document.createElement('div');
    const warn = console.warn;
    console.warn = () => {};
    try {
      const stop = mount(h(Suspense, { fallback: h('p', null, 'loading') },
        () => (tab() === 'a' ? h('p', null, 'tab a') : h(B))), host);
      assert.equal(host.textContent, 'tab a');
      await startTransition(() => tab('b'));
      await drain();
      assert.equal(host.textContent, 'loading');
      const event = getDiagnostics().events.find((e) => e.code === 'ERR_SUSPEND_IN_TRANSITION');
      assert.ok(event, 'reported');
      assert.match(event.message, /"B"/);
      panelB.resolve('tab b');
      await drain();
      assert.equal(host.textContent, 'tab b');
      stop();
    } finally {
      console.warn = warn;
    }
  });

  it('stays silent when a component suspends outside a transition\'s commit', async () => {
    const { signal, h, mount, Suspense, use, getDiagnostics, clearDiagnostics } = W;
    clearDiagnostics();
    const tab = signal('a');
    const panelB = withResolvers();
    function B() { return h('p', null, use(panelB.promise)); }
    const host = document.createElement('div');
    const stop = mount(h(Suspense, { fallback: h('p', null, 'loading') },
      () => (tab() === 'a' ? h('p', null, 'tab a') : h(B))), host);
    tab('b');
    await drain();
    assert.equal(host.textContent, 'loading');
    assert.ok(!getDiagnostics().events.some((e) => e.code === 'ERR_SUSPEND_IN_TRANSITION'));
    panelB.resolve('tab b');
    await drain();
    stop();
  });
});
