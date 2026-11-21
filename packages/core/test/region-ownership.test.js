// A reactive region owns what it renders. Each run of a region (a function
// child, a <Show> or <For> body, an ErrorBoundary or Suspense arm) builds into
// a scope of its own, which the region disposes before it renders its next
// value and when it is disposed itself.
//
// Before, what a region built on its first run registered with whatever owner
// was current: the mount() root, which kept a removed keyed row reachable for
// as long as the app stayed mounted (retention.gc.test.js), and kept the
// effects of a component in that row running after the row was gone. What a
// region built on a re-run registered with nothing, so a component that a
// branch swapped in after mount never had its effects disposed at all.
//
// These tests check the observable half without forcing a collection: once
// content leaves, its effects stop and its cleanups run, and nothing the region
// rendered is registered with the root.

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM('<!DOCTYPE html><html><body><div id="app"></div><div id="layer"></div></body></html>');

const {
  signal, effect, batch, flushSync, getOwner, createRoot, h, mount, onCleanup,
  Show, For, ErrorBoundary, Suspense, Portal,
} = await import('what-framework');
const { mapArray, insert } = await import('what-framework/render');

let host;
let shared;
let runs;
let cleaned;
beforeEach(() => {
  host = document.getElementById('app');
  document.getElementById('layer').textContent = '';
  shared = signal(0);
  runs = new Map();
  cleaned = [];
});

function ran(name) {
  runs.set(name, (runs.get(name) || 0) + 1);
}

// Runs recorded while `fn` runs, by name.
function runsDuring(fn) {
  const before = new Map(runs);
  fn();
  const out = {};
  for (const [name, n] of runs) {
    const delta = n - (before.get(name) || 0);
    if (delta > 0) out[name] = delta;
  }
  return out;
}

const write = () => runsDuring(() => { shared(v => v + 1); flushSync(); });

// A component with an effect and a binding on the module-level signal, and a
// cleanup, so a stray run or a missing disposal shows up by name.
function Probe({ name }) {
  effect(() => { shared(); ran(`${name}:effect`); });
  onCleanup(() => cleaned.push(name));
  return h('b', {}, () => { ran(`${name}:text`); return `${name}${shared()}`; });
}

// The root owner of a mount. A component is an owner of its own, created under
// the owner it is rendered in, and this one is rendered directly by mount().
function mountWithRoot(tree) {
  let root = null;
  function Root() {
    root = getOwner().owner;
    return null;
  }
  const unmount = mount([h(Root, {}), tree], host);
  return { root, unmount };
}

describe('h(): a region owns its rows', () => {
  it('stops a removed keyed row, and the root keeps none of it', () => {
    const items = signal(['remove', 'keep']);
    const { root, unmount } = mountWithRoot(h('ul', {}, () => items().map(item => h('li', { key: item },
      () => { ran(`${item}:child`); return item + shared(); },
      h(Probe, { name: item }),
    ))));
    try {
      // The list region: nothing the region rendered. (Root is an owner of its
      // own, and each keyed row is a root of its own, linked under this one
      // while its key is in the list and unlinked when it leaves.)
      assert.equal(root.disposals.length, 1);
      const kept = host.querySelectorAll('li')[1];
      items(['keep']);
      flushSync();
      assert.deepEqual(cleaned, ['remove'], 'the removed row is disposed and the kept row is not rebuilt');
      assert.equal(host.querySelectorAll('li').length, 1);
      assert.equal(host.querySelector('li'), kept);
      assert.deepEqual(write(), { 'keep:child': 1, 'keep:effect': 1, 'keep:text': 1 });
      assert.equal(root.disposals.length, 1);
    } finally {
      unmount();
    }
    assert.deepEqual(write(), {}, 'nothing runs after unmount');
  });

  it('stops unkeyed rows the same way', () => {
    const items = signal(['a', 'b']);
    const unmount = mount(h('ul', {}, () => items().map(item => h('li', {}, h(Probe, { name: item })))), host);
    items(['a']);
    flushSync();
    cleaned.length = 0;
    items([]);
    flushSync();
    assert.deepEqual(cleaned, ['a']);
    assert.deepEqual(write(), {});
    unmount();
  });

  it('stops the rows of a nested list when the outer row goes', () => {
    const groups = signal(['x', 'y']);
    const inner = signal([1, 2]);
    const unmount = mount(h('div', {}, () => groups().map(g => h('section', { key: g },
      () => inner().map(n => h('p', { key: n }, h(Probe, { name: `${g}${n}` }))),
    ))), host);
    inner([1, 2, 3]);
    flushSync();
    cleaned.length = 0;
    groups(['y']);
    flushSync();
    assert.ok(['x1', 'x2', 'x3'].every(name => cleaned.includes(name)));
    assert.deepEqual(Object.keys(write()).filter(k => k.startsWith('x')), [], 'no x row runs after its group left');
    unmount();
  });
});

const { App, items, show } = await loadCompiled(`
  import { signal, effect, onCleanup } from 'what-framework';
    export const items = signal(['remove', 'keep']);
    export const show = signal(true);
    export function Badge({ name, probe }) {
      effect(() => probe(name));
      onCleanup(() => probe(name + ':cleanup'));
      return <b>{name}</b>;
    }
    export function App({ probe, shared }) {
      return (
        <div>
          {() => show() && (
            <ul>
              {items().map(item => (
                <li key={item}>{item + shared()}<Badge name={item} probe={(n) => { shared(); probe(n); }} /></li>
              ))}
            </ul>
          )}
        </div>
      );
    }
`);

describe('compiled: a region owns its rows', () => {
  it('stops removed keyed rows, rows the region rebuilt, and the region content on a swap', () => {
    const seen = [];
    const probe = name => seen.push(name);
    const { root, unmount } = mountWithRoot(h(App, { probe, shared }));
    try {
      // Nothing: Root and App are owners of their own, and App's region and
      // what it renders belong to App.
      assert.equal(root.disposals.length, 0);
      items(['keep']);
      flushSync();
      seen.length = 0;
      shared(1);
      flushSync();
      assert.deepEqual(seen, ['keep'], 'the removed row’s component effect no longer runs');
      assert.deepEqual([...host.querySelectorAll('li')].map(li => li.textContent), ['keep1keep']);

      show(false);
      flushSync();
      assert.ok(seen.includes('keep:cleanup'));
      show(true); // the region rebuilds the list on a re-run
      flushSync();
      show(false);
      flushSync();
      seen.length = 0;
      shared(2);
      flushSync();
      assert.deepEqual(seen, [], 'a list the region built on a re-run is disposed when it is swapped out');
    } finally {
      unmount();
    }
  });
});

describe('sibling cases', () => {
  it('a row region that switches between text and a component disposes the component each time', () => {
    const mode = signal('text');
    const items = signal([1]);
    const unmount = mount(h('ul', {}, mapArray(items, n => {
      const li = document.createElement('li');
      insert(li, () => (mode() === 'text' ? `t${n}${shared()}` : h(Probe, { name: `c${n}` })));
      return li;
    }, { key: n => n, raw: true })), host);
    mode('component');
    flushSync();
    mode('text');
    flushSync();
    assert.deepEqual(cleaned, ['c1']);
    assert.deepEqual(write(), {});
    mode('component');
    flushSync();
    items([]);
    flushSync();
    assert.deepEqual(cleaned, ['c1', 'c1']);
    assert.deepEqual(write(), {});
    unmount();
  });

  it('<Show> disposes the arm it swaps out, built on the first run or a later one', () => {
    const on = signal(true);
    const unmount = mount(h(Show, { when: on, fallback: h(Probe, { name: 'off' }) }, h(Probe, { name: 'on' })), host);
    for (let i = 0; i < 3; i++) {
      on(false);
      flushSync();
      on(true);
      flushSync();
    }
    assert.deepEqual(cleaned, ['on', 'off', 'on', 'off', 'on', 'off']);
    assert.deepEqual(write(), { 'on:effect': 1, 'on:text': 1 });
    unmount();
    assert.deepEqual(write(), {});
  });

  it('<For> disposes the rows it drops', () => {
    const items = signal(['a', 'b', 'c']);
    const unmount = mount(h(For, { each: items }, item => h(Probe, { name: item })), host);
    items(['c']);
    flushSync();
    assert.deepEqual(Object.keys(write()).sort(), ['c:effect', 'c:text']);
    unmount();
  });

  it('an ErrorBoundary disposes the arm it replaces, both ways', () => {
    const broken = signal(false);
    let reset;
    function Bomb() {
      throw new Error('boom');
    }
    const fallback = (props) => {
      reset = props.reset;
      return h(Probe, { name: 'fallback' });
    };
    const error = console.error;
    console.error = () => {};
    try {
      const unmount = mount(h(ErrorBoundary, { fallback },
        h(Probe, { name: 'child' }),
        h('i', {}, () => (broken() ? h(Bomb, {}) : null)),
      ), host);
      broken(true);
      flushSync();
      assert.deepEqual(cleaned, ['child']);
      assert.deepEqual(Object.keys(write()).sort(), ['fallback:effect', 'fallback:text']);
      broken(false);
      reset();
      flushSync();
      assert.deepEqual(cleaned, ['child', 'fallback']);
      assert.deepEqual(Object.keys(write()).sort(), ['child:effect', 'child:text']);
      unmount();
    } finally {
      console.error = error;
    }
  });

  it('a Suspense boundary disposes its fallback when the children land', async () => {
    let resolve;
    const pending = new Promise(r => { resolve = r; });
    let ready = false;
    function Slow() {
      if (!ready) throw pending;
      return h(Probe, { name: 'content' });
    }
    const unmount = mount(h(Suspense, { fallback: h(Probe, { name: 'fallback' }) }, h(Slow, {})), host);
    flushSync();
    ready = true;
    resolve();
    await pending;
    await Promise.resolve();
    flushSync();
    assert.ok(cleaned.includes('fallback'));
    assert.deepEqual(Object.keys(write()).sort(), ['content:effect', 'content:text']);
    unmount();
  });

  it('a portal inside a region is removed, and stops, when the region swaps it out or its row goes', () => {
    const layer = document.getElementById('layer');
    const on = signal(true);
    const items = signal([1]);
    const unmount = mount(h('ul', {}, mapArray(items, n => {
      const li = document.createElement('li');
      insert(li, () => (on() ? h(Portal, { target: layer }, h(Probe, { name: `p${n}` })) : null));
      return li;
    }, { key: n => n, raw: true })), host);
    on(false);
    flushSync();
    on(true); // built on a re-run
    flushSync();
    assert.equal(layer.querySelectorAll('b').length, 1);
    items([]);
    flushSync();
    assert.equal(layer.querySelectorAll('b').length, 0, 'the portal content left with its row');
    assert.deepEqual(cleaned, ['p1', 'p1']);
    assert.deepEqual(write(), {});
    unmount();
  });

  it('a batch that flushes inside createRoot does not hand that root what re-runs create', () => {
    const on = signal(false);
    const unmount = mount(h('div', {}, () => (on() ? h(Probe, { name: 'late' }) : null)), host);
    let owner;
    const dispose = createRoot((d) => {
      owner = getOwner();
      batch(() => on(true));
      return d;
    });
    assert.equal(owner.disposals.length, 0);
    dispose();
    assert.deepEqual(write(), { 'late:effect': 1, 'late:text': 1 }, 'the region, not that root, owns the component');
    unmount();
  });
});
