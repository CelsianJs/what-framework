import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { installDOM } from '../../../test-utils/dom.js';

const { document, cleanup } = installDOM();
after(cleanup);

const { computed, createRoot, effect, flushSync, getOwner, h, mount, signal } = await import('../src/index.js');

const shared = signal(0);
let lastEffectValue;

async function assertCollected(ref, label) {
  for (let attempt = 0; attempt < 12; attempt++) {
    // WeakRef targets remain alive through the turn in which they were created
    // or dereferenced. Each collection must happen in a fresh turn.
    await nextTurn();
    globalThis.gc();
    if (ref.deref() === undefined) return;
  }
  assert.fail(`${label} is still reachable after forced collection on ${process.version}`);
}

test('disposing a root releases its owner and module-signal effect payload', async () => {
  const root = createRoot(dispose => {
    const payload = { value: 42 };
    effect(() => { lastEffectValue = payload.value + shared(); });
    assert.equal(lastEffectValue, payload.value + shared());
    return { owner: new WeakRef(getOwner()), payload: new WeakRef(payload), dispose };
  });
  root.dispose();
  shared(value => value + 1);
  flushSync();
  await assertCollected(root.payload, 'disposed effect payload');
  root.dispose();
  root.dispose = null;
  await assertCollected(root.owner, 'disposed root owner');
});

test('removing a keyed row releases its DOM while its sibling and list remain mounted', async () => {
  const items = signal(['remove', 'keep']);
  const host = document.querySelector('#app');
  const list = () => items().map(item => h('li', { key: item }, () => item + shared()));
  const unmount = mount(h('ul', {}, list), host);
  try {
    const ref = new WeakRef(host.querySelector('li'));
    items(['keep']);
    flushSync();
    assert.equal(host.querySelector('li').textContent, 'keep' + shared());
    await assertCollected(ref, 'removed row element');
  } finally {
    unmount();
  }
});

test('unmounting releases a component computed subscribed to a module-level signal', async () => {
  const host = document.querySelector('#app');
  let weak;
  function Component() {
    const payload = { label: 'mounted' };
    weak = new WeakRef(payload);
    const value = computed(() => payload.label + shared());
    return h('span', {}, value);
  }
  const unmount = mount(h(Component, {}), host);
  assert.equal(host.textContent, 'mounted' + shared());
  unmount();
  assert.equal(host.textContent, '');
  await assertCollected(weak, 'unmounted component payload');
});

test('unmounting a hydrated page releases a streamed boundary still waiting for its content', async () => {
  const { Suspense, createResource, hydrate } = await import('../src/index.js');
  const { __resetHydrationData } = await import('../src/hydration-data.js');
  const server = await import('../../server/src/index.js');
  let client = false;
  const never = new Promise(() => {});
  function Content() {
    const [value] = createResource(() => (client ? 'client' : never), { key: 'content' });
    return h('b', null, () => value());
  }
  function Page() { return h('main', null, h(Suspense, { fallback: h('i', null, 'waiting') }, h(Content))); }
  const stream = server.renderToStream(h(Page), { noScripts: true })[Symbol.asyncIterator]();
  const shell = Buffer.from((await stream.next()).value).toString();
  assert.match(shell, /<template id="pl-/, 'precondition: the boundary is still streaming');
  client = true;
  const ref = (() => {
    const host = document.body.appendChild(document.createElement('div'));
    host.innerHTML = shell;
    __resetHydrationData();
    const stop = hydrate(h(Page), host);
    const main = new WeakRef(host.firstElementChild);
    stop();
    host.remove();
    __resetHydrationData();
    return main;
  })();
  // jsdom's selector engine keeps the last node a query walked: move it off
  // the unmounted tree, so only the framework could hold it.
  document.body.appendChild(document.createElement('p')).querySelectorAll('x');
  await assertCollected(ref, 'the unmounted boundary\'s DOM');
  await stream.return?.();
});
