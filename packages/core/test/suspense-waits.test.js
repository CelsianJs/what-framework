// What a <Suspense> waits for before it reveals (docs/ASYNC.md, "<Suspense>"),
// frame by frame on a virtual clock (fixtures/async-clock.js): every binding
// under it, including one whose value is computed from another async value;
// nothing a discarded branch or a removed component read; nothing once the
// boundary is gone. settled() resolves after the effects the reveal releases
// have run. Compiled JSX and h() reveal the same frames.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';
import { asyncClock } from './fixtures/async-clock.js';

let env;
let W;
before(async () => {
  env = installDOM();
  W = await import('../src/index.js');
});
after(() => env.cleanup());

const drain = () => new Promise((resolve) => setImmediate(resolve));
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();

// A master-detail page: orders and recommendations are fetched with the
// user's id, so they start when the user lands.
const MASTER_DETAIL = `
import { computed, Suspense, mount } from 'what-framework';
export function Details(props) {
  const user = computed(async () => props.api.user());
  const orders = computed(async () => props.api.orders(user().id));
  const recs = computed(async () => props.api.recs(user().id));
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <h1>{user().name}</h1>
      <ul>{orders().map((o) => <li key={o.id}>{o.total}</li>)}</ul>
      <ol>{recs().map((r) => <li key={r.id}>{r.title}</li>)}</ol>
    </Suspense>
  );
}
export function Nested(props) {
  const user = computed(async () => props.api.user());
  const orders = computed(async () => props.api.orders(user().id));
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <h1>{user().name}</h1>
      <Suspense fallback={<p>Loading orders…</p>}>
        <ul>{orders().map((o) => <li key={o.id}>{o.total}</li>)}</ul>
      </Suspense>
    </Suspense>
  );
}
export { mount };
`;

function masterDetailApi(clock) {
  return clock.api({
    user: [10, () => ({ id: 7, name: 'Ada' })],
    orders: [30, () => [{ id: 1, total: 10 }]],
    recs: [20, () => [{ id: 1, title: 'book' }]],
  });
}

function hDetails(api) {
  const { computed, h, Suspense } = W;
  const user = computed(async () => api.user());
  const orders = computed(async () => api.orders(user().id));
  const recs = computed(async () => api.recs(user().id));
  return h(Suspense, { fallback: h('p', null, 'Loading…') },
    h('h1', null, () => user().name),
    h('ul', null, () => orders().map((o) => h('li', { key: o.id }, o.total))),
    h('ol', null, () => recs().map((r) => h('li', { key: r.id }, r.title))));
}

describe('<Suspense> with values computed from other async values', () => {
  it('compiled: the fallback stays until the dependent values have landed too, then everything shows at once', async (t) => {
    const { Details, mount } = await loadCompiled(MASTER_DETAIL, { filename: 'MasterDetail.jsx' });
    const host = document.createElement('div');
    const clock = asyncClock(t, () => text(host));
    const stop = mount(Details({ api: masterDetailApi(clock) }), host);
    try {
      await clock.start();
      await clock.to(50);
      assert.deepEqual(clock.frames, [
        { at: 0, text: 'Loading…' },
        { at: 40, text: 'Ada10book' },
      ]);
      assert.deepEqual(clock.starts, [{ at: 0, name: 'user' }, { at: 10, name: 'orders' }, { at: 10, name: 'recs' }], 'no waterfall beyond the dependency');
    } finally {
      stop();
      clock.stop();
    }
  });

  it('h(): the same frames', async (t) => {
    const host = document.createElement('div');
    const clock = asyncClock(t, () => text(host));
    const stop = W.mount(hDetails(masterDetailApi(clock)), host);
    try {
      await clock.start();
      await clock.to(50);
      assert.deepEqual(clock.frames, [
        { at: 0, text: 'Loading…' },
        { at: 40, text: 'Ada10book' },
      ]);
    } finally {
      stop();
      clock.stop();
    }
  });

  it('a nested boundary shows its own fallback until its dependent value lands', async (t) => {
    const { Nested, mount } = await loadCompiled(MASTER_DETAIL, { filename: 'MasterDetail.jsx' });
    const host = document.createElement('div');
    const clock = asyncClock(t, () => text(host));
    const stop = mount(Nested({ api: masterDetailApi(clock) }), host);
    try {
      await clock.start();
      await clock.to(50);
      assert.deepEqual(clock.frames, [
        { at: 0, text: 'Loading…' },
        { at: 10, text: 'AdaLoading orders…' },
        { at: 40, text: 'Ada10' },
      ]);
    } finally {
      stop();
      clock.stop();
    }
  });
});

describe('<Suspense> stops waiting for what no longer blocks it', () => {
  it('a binding whose branch changed away from a value that has not landed', async (t) => {
    const { signal, computed, h, mount, Suspense, onMount } = W;
    const host = document.createElement('div');
    const clock = asyncClock(t, () => host.textContent);
    const api = clock.api({ slow: [100, () => 'unused'] });
    const enabled = signal(true);
    const pending = computed(async () => api.slow());
    let mounts = 0;
    function Child() {
      onMount(() => { mounts++; });
      return h('p', null, () => (enabled() ? pending() : 'skipped'));
    }
    const stop = mount(h(Suspense, { fallback: 'loading' }, h(Child)), host);
    try {
      await clock.start();
      await clock.to(10);
      await clock.act(() => enabled(false));
      assert.equal(mounts, 1, 'the reveal ran onMount');
      await clock.to(120);
      assert.deepEqual(clock.frames, [{ at: 0, text: 'loading' }, { at: 10, text: 'skipped' }]);
    } finally {
      stop();
      clock.stop();
    }
  });

  it('a suspended component that was removed: the boundary reveals, and settled() does not wait for its promise', async () => {
    const { use, signal, h, mount, Suspense } = W;
    const work = Promise.withResolvers();
    const visible = signal(true);
    function Child() { return use(work.promise); }
    const host = document.createElement('div');
    const stop = mount(h(Suspense, { fallback: 'loading' }, h('p', null, () => (visible() ? h(Child) : 'skipped'))), host);
    await drain();
    assert.equal(host.textContent, 'loading');
    visible(false);
    const quiet = await Promise.race([W.settled().then(() => true), drain().then(drain).then(() => false)]);
    assert.equal(host.textContent, 'skipped');
    assert.equal(quiet, true);
    work.resolve('late');
    stop();
  });

  it('an unmounted boundary: settled() does not wait for what it waited on', async () => {
    const { use, h, mount, Suspense } = W;
    const work = Promise.withResolvers();
    let runs = 0;
    function Child() { runs++; return use(work.promise); }
    const host = document.createElement('div');
    const stop = mount(h(Suspense, { fallback: 'loading' }, h(Child)), host);
    stop();
    const quiet = await Promise.race([W.settled().then(() => true), drain().then(drain).then(() => false)]);
    assert.equal(quiet, true);
    work.resolve('ready');
    await drain();
    assert.equal(runs, 1, 'the component is not rendered again');
    assert.equal(host.textContent, '');
  });

  it('settled() resolves after the onMount and useEffect the reveal releases have run, and their writes have shown', async () => {
    const { computed, h, mount, settled, Suspense, onMount, signal } = W;
    const work = Promise.withResolvers();
    const value = computed(async () => work.promise);
    const mounted = signal(false);
    function Child() {
      onMount(() => mounted(true));
      return h('p', null, () => value(), ' ', () => (mounted() ? 'mounted' : 'unmounted'));
    }
    const host = document.createElement('div');
    const stop = mount(h(Suspense, { fallback: 'loading' }, h(Child)), host);
    const quiet = settled();
    work.resolve('ready');
    await quiet;
    assert.equal(host.textContent, 'ready mounted');
    stop();
  });
});
