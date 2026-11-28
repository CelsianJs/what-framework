// List rows that are not one element: unkeyed rows that render a fragment, an
// array or a component, and rows whose key (or, unkeyed, whose item) repeats.
//
// An unkeyed multi-node row used to be stored as the DocumentFragment it was
// built in, which inserting empties, so such rows never moved, never left and
// survived a clear. A repeated key kept only its last row in the reconciler's
// index map, so the others were orphaned: never removed, not even by a clear,
// and their bindings kept running. Both lists now share one row representation
// and one reconciler, which matches the occurrences of a repeated key in
// order, and a keyed list reports a repeated key in development.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM();

const { signal, flushSync, mount } = await import('what-framework');
const { mapArray, insert } = await import('what-framework/render');
const { capture } = await import('../src/diagnostics.js');
const { __subsOf } = await import('../src/reactive.js');

let host;
beforeEach(() => {
  host = document.getElementById('app');
  host.textContent = '';
});

const text = (el) => el.textContent;

async function quietCompile(source) {
  const { info, warn } = console;
  console.info = console.warn = () => {};
  try {
    return await loadCompiled(source);
  } finally {
    console.info = info;
    console.warn = warn;
  }
}

const multi = await quietCompile(`
  import { For, signal } from 'what-framework';
  export const T = { runs: 0, cleaned: [] };
  export const tick = signal(0);
  function Row(p) {
    return <><b>{p.id}</b><i>{() => (T.runs++, tick(), '.')}</i></>;
  }
  export const Frag = (p) => <p><For each={p.items}>{x => <>{x}<i>.</i></>}</For></p>;
  export const Arr = (p) => <p><For each={p.items}>{x => [x, '|']}</For></p>;
  export const Comp = (p) => <p><For each={p.items}>{x => <Row id={x} />}</For></p>;
`);

describe('unkeyed rows of more than one node', () => {
  const mod = multi;

  for (const [name, Component, render] of [
    ['fragment', mod.Frag, (xs) => xs.map(x => `${x}.`).join('')],
    ['array', mod.Arr, (xs) => xs.map(x => `${x}|`).join('')],
    ['component', mod.Comp, (xs) => xs.map(x => `${x}.`).join('')],
  ]) {
    it(`moves, removes and clears ${name} rows`, () => {
      const items = signal(['a', 'b', 'c']);
      const unmount = mount(() => Component({ items }), host);
      const p = host.querySelector('p');
      for (const next of [['c', 'b', 'a'], ['c'], ['b', 'c', 'd'], ['d', 'b'], [], ['a', 'b']]) {
        items(next);
        flushSync();
        assert.equal(text(p), render(next), JSON.stringify(next));
      }
      unmount();
    });
  }

  it('keeps the nodes of a row whose item persists', () => {
    const items = signal(['a', 'b', 'c']);
    const unmount = mount(() => mod.Comp({ items }), host);
    const b = [...host.querySelectorAll('b')].find(el => el.textContent === 'b');
    items(['c', 'b', 'a']);
    flushSync();
    assert.equal([...host.querySelectorAll('b')].find(el => el.textContent === 'b'), b);
    unmount();
  });

  it('stops the bindings of removed rows', () => {
    const items = signal(['a', 'b', 'c']);
    const unmount = mount(() => mod.Comp({ items }), host);
    items(['a']);
    flushSync();
    let before = mod.T.runs;
    mod.tick(v => v + 1);
    flushSync();
    assert.equal(mod.T.runs - before, 1, 'only the remaining row binding runs');
    items([]);
    flushSync();
    before = mod.T.runs;
    mod.tick(v => v + 1);
    flushSync();
    assert.equal(mod.T.runs - before, 0, 'no binding runs after a clear');
    assert.equal(__subsOf(mod.tick).length, 0);
    unmount();
  });

  it('works through mapArray called directly, with rows built from arrays', () => {
    const items = signal([1, 2, 3]);
    const ul = document.createElement('ul');
    host.appendChild(ul);
    insert(ul, mapArray(items, (n) => {
      const a = document.createElement('li');
      a.textContent = String(n);
      return [a, document.createTextNode('/')];
    }));
    items([3, 1]);
    flushSync();
    assert.equal(ul.textContent, '3/1/');
    items([]);
    flushSync();
    assert.equal(ul.textContent, '');
  });
});

const dups = await quietCompile(`
  import { For, signal } from 'what-framework';
  export const T = { reads: 0 };
  export const tick = signal(0);
  export const rows = signal([{ id: 1, t: 'x' }, { id: 1, t: 'y' }, { id: 2, t: 'z' }]);
  export function Keyed() {
    return <ul>{rows().map(r => <li key={r.id}>{r.t}{() => (T.reads++, tick(), '')}</li>)}</ul>;
  }
  export const KeyedApp = () => <section><Keyed /></section>;
  export const items = signal([1, 1, 2]);
  export const Unkeyed = () => <p><For each={items}>{x => <b>{x}</b>}</For></p>;
  export const Accessor = () => <ol><For each={rows} key={r => r.id}>{r => <li>{() => r().t}</li>}</For></ol>;
`);

describe('repeated items and duplicate keys', () => {
  const mod = dups;

  it('never orphans a keyed row whose key repeats, and stops its bindings', () => {
    const diagnostics = capture({ quiet: true });
    mod.rows([{ id: 1, t: 'x' }, { id: 1, t: 'y' }, { id: 2, t: 'z' }]);
    const unmount = mount(mod.Keyed, host);
    try {
      assert.equal(host.querySelectorAll('li').length, 3);
      mod.rows([{ id: 3, t: 'w' }]);
      flushSync();
      assert.equal(text(host), 'w');
      mod.rows([{ id: 1, t: 'a' }, { id: 2, t: 'b' }, { id: 1, t: 'c' }, { id: 1, t: 'd' }]);
      flushSync();
      assert.equal(text(host), 'abcd');
      mod.rows([{ id: 1, t: 'a' }, { id: 1, t: 'c' }]);
      flushSync();
      assert.equal(host.querySelectorAll('li').length, 2);
      mod.rows([]);
      flushSync();
      assert.equal(host.querySelectorAll('li').length, 0);
      const before = mod.T.reads;
      mod.tick(v => v + 1);
      flushSync();
      assert.equal(mod.T.reads - before, 0, 'no row binding runs after a clear');
    } finally {
      unmount();
      diagnostics.stop();
    }
  });

  it('renders every repeated item of an unkeyed list, through any sequence of updates', () => {
    mod.items([1, 1, 2]);
    const unmount = mount(mod.Unkeyed, host);
    const p = host.querySelector('p');
    const bs = () => [...p.querySelectorAll('b')].map(b => b.textContent).join(',');
    for (const next of [[1, 2, 1], [2, 2], [3, 1, 1], [1], [1, 1, 1, 1], [1, 2, 1, 2], []]) {
      mod.items(next);
      flushSync();
      assert.equal(bs(), next.join(','), JSON.stringify(next));
    }
    unmount();
  });

  it('keeps the rows of a repeated key and hands each its item', () => {
    const diagnostics = capture({ quiet: true });
    const x = { id: 1, t: 'x' };
    const y = { id: 1, t: 'y' };
    const z = { id: 2, t: 'z' };
    const w = { id: 3, t: 'w' };
    mod.rows([x, y, z]);
    const unmount = mount(mod.Accessor, host);
    try {
      const [first, second] = host.querySelectorAll('li');
      for (const next of [[z, y, x], [w, x, z, y], [y, w, x], [x, y]]) {
        mod.rows(next);
        flushSync();
        assert.equal(text(host), next.map(r => r.t).join(''));
        const lis = [...host.querySelectorAll('li')];
        assert.ok(lis.includes(first) && lis.includes(second), 'both rows keyed 1 are kept');
      }
    } finally {
      unmount();
      diagnostics.stop();
    }
  });

  it('reports a duplicate key in development, naming the key, the list and its owner', () => {
    const diagnostics = capture({ quiet: true });
    try {
      mod.rows([{ id: 'dup', t: 'a' }, { id: 'dup', t: 'b' }]);
      const unmount = mount(mod.KeyedApp, host);
      unmount();
      const events = diagnostics.events.filter(e => e.code === 'ERR_DUPLICATE_KEY');
      assert.equal(events.length, 1);
      assert.match(events[0].message, /"dup"/);
      assert.deepEqual(events[0].owner, ['binding "KeyedApp"', '<Keyed>', 'binding "list"']);

      diagnostics.clear();
      const list = signal([1, 2, 2]);
      const ul = document.createElement('ul');
      insert(ul, mapArray(list, (n) => document.createTextNode(String(n)), { key: (n) => n, raw: true, loc: 'src/List.jsx:4:7' }));
      const [event] = diagnostics.events.filter(e => e.code === 'ERR_DUPLICATE_KEY');
      assert.equal(event.loc, 'src/List.jsx:4:7');
      assert.match(event.message, /key 2\b/);
    } finally {
      diagnostics.stop();
    }
  });

  it('does not report repeated items of an unkeyed list, or unique keys', () => {
    const diagnostics = capture({ quiet: true });
    try {
      mod.items([1, 1, 1]);
      mount(mod.Unkeyed, host)();
      mod.rows([{ id: 1, t: 'a' }, { id: 2, t: 'b' }]);
      mount(mod.Keyed, host)();
      assert.deepEqual(diagnostics.events.filter(e => e.code === 'ERR_DUPLICATE_KEY'), []);
    } finally {
      diagnostics.stop();
    }
  });
});

describe('keyed-signal rows get their new item on every path', () => {
  it('updates a row between the two rows of a swap', () => {
    const a = { id: 'a', t: 'A' };
    const b = { id: 'b', t: 'B' };
    const c = { id: 'c', t: 'C' };
    const items = signal([a, b, c]);
    const ul = document.createElement('ul');
    host.appendChild(ul);
    insert(ul, mapArray(items, (item) => {
      const li = document.createElement('li');
      insert(li, () => item().t);
      return li;
    }, { key: (item) => item.id }));
    const [liA, liB, liC] = ul.children;
    items([c, { id: 'b', t: 'B2' }, a]);
    flushSync();
    assert.equal(ul.textContent, 'CB2A');
    assert.deepEqual([...ul.children], [liC, liB, liA]);
    items([{ id: 'c', t: 'C3' }, { id: 'a', t: 'A3' }, { id: 'b', t: 'B3' }]);
    flushSync();
    assert.equal(ul.textContent, 'C3A3B3');
    assert.deepEqual([...ul.children], [liC, liA, liB]);
  });
});
