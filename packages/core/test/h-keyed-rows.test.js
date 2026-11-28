// Keyed vnode lists keep their rows: a reactive child that returns an array of
// keyed vnodes (`() => keys().map(id => h(Row, { key: id }))`, the runtime
// <For>) keeps the row of every key that persists, as a compiled keyed list
// does, instead of rebuilding every row on every change. A component that
// returns several siblings was the case reported: after keys(['a', 'b']) the
// first row's element was a new object.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!DOCTYPE html><html><body><div id="app"></div><div id="layer"></div></body></html>');

const { signal, effect, flushSync, mount, h, onCleanup, For, Portal, createRoot } = await import('what-framework');
const { insert } = await import('what-framework/render');
const { hydrate } = await import('../src/render.js');
const { createDOM } = await import('../src/dom.js');
const { capture } = await import('../src/diagnostics.js');
const { __subsOf } = await import('../src/reactive.js');

let host;
let tick;
let runs;
let built;
let cleaned;
beforeEach(() => {
  host = document.getElementById('app');
  host.textContent = '';
  document.getElementById('layer').textContent = '';
  tick = signal(0);
  runs = 0;
  built = [];
  cleaned = [];
});

function Row({ id }) {
  built.push(id);
  effect(() => { tick(); runs++; });
  onCleanup(() => cleaned.push(id));
  return [h('b', { 'data-id': id }, id), h('i', {}, () => `${id}${tick()}`)];
}

const ids = (el) => [...el.querySelectorAll('b')].map(b => b.textContent).join(',');

describe('h(): keyed vnode rows', () => {
  it('keeps the rows of a component that returns siblings', () => {
    const keys = signal(['a']);
    const unmount = mount(h('main', {}, () => keys().map(id => h(Row, { key: id, id }))), host);
    const a = host.querySelector('b');
    keys(['a', 'b']);
    flushSync();
    assert.equal(host.querySelector('b'), a);
    assert.equal(ids(host), 'a,b');
    assert.deepEqual(built, ['a', 'b']);
    unmount();
  });

  it('keeps element rows, moves them and removes only the rows that left', () => {
    const keys = signal(['a', 'b', 'c']);
    const unmount = mount(h('ul', {}, () => keys().map(id => h('li', { key: id }, id))), host);
    const [a, b, c] = host.querySelectorAll('li');
    keys(['c', 'a', 'd']);
    flushSync();
    const lis = [...host.querySelectorAll('li')];
    assert.deepEqual(lis.map(li => li.textContent), ['c', 'a', 'd']);
    assert.equal(lis[0], c);
    assert.equal(lis[1], a);
    assert.ok(!b.isConnected);
    unmount();
  });

  it('disposes removed rows and leaves kept rows running once', () => {
    const keys = signal(['a', 'b', 'c']);
    const unmount = mount(h('main', {}, () => keys().map(id => h(Row, { key: id, id }))), host);
    keys(['c', 'a']);
    flushSync();
    assert.deepEqual(cleaned, ['b']);
    assert.deepEqual(built, ['a', 'b', 'c']);
    runs = 0;
    tick(1);
    flushSync();
    assert.equal(runs, 2);
    assert.equal(host.textContent, 'cc1aa1');
    unmount();
    assert.deepEqual(cleaned.sort(), ['a', 'b', 'c']);
    assert.equal(__subsOf(tick).length, 0);
  });

  it('switches to other content and back, and clears through an empty array', () => {
    const value = signal(['a', 'b']);
    const unmount = mount(h('main', {}, () => {
      const v = value();
      return Array.isArray(v) ? v.map(id => h(Row, { key: id, id })) : v;
    }), host);
    value('text');
    flushSync();
    assert.equal(host.textContent, 'text');
    assert.deepEqual(cleaned.sort(), ['a', 'b']);
    value(['b']);
    flushSync();
    assert.equal(ids(host), 'b');
    value([]);
    flushSync();
    assert.equal(host.querySelector('main').textContent, '');
    value(['a', 'b']);
    flushSync();
    assert.equal(ids(host), 'a,b');
    unmount();
    assert.equal(__subsOf(tick).length, 0);
    assert.equal(__subsOf(value).length, 0);
  });

  it('rebuilds an array that is not all keyed, without leaking', () => {
    const keys = signal(['a', 'b']);
    const unmount = mount(h('main', {}, () => [h('p', {}, 'head'), ...keys().map(id => h(Row, { key: id, id }))]), host);
    keys(['a', 'b', 'c']);
    flushSync();
    assert.equal(ids(host), 'a,b,c');
    unmount();
    assert.equal(__subsOf(tick).length, 0);
  });

  it('keeps the rows of the runtime <For>', () => {
    const items = signal(['x', 'y']);
    const unmount = mount(h('ul', {}, h(For, { each: items }, (item) => h('li', {}, item))), host);
    const [x, y] = host.querySelectorAll('li');
    items(['y', 'z', 'x']);
    flushSync();
    const lis = [...host.querySelectorAll('li')];
    assert.deepEqual(lis.map(li => li.textContent), ['y', 'z', 'x']);
    assert.equal(lis[0], y);
    assert.equal(lis[2], x);
    unmount();
  });

  it('does not report repeated primitive items of the runtime <For> as duplicate keys', () => {
    const diagnostics = capture({ quiet: true });
    try {
      const items = signal(['x', 'x', 'y']);
      const unmount = mount(h('ul', {}, h(For, { each: items }, (item) => h('li', {}, item))), host);
      items(['y', 'x', 'x']);
      flushSync();
      assert.equal(host.textContent, 'yxx');
      unmount();
      assert.deepEqual(diagnostics.events.filter(e => e.code === 'ERR_DUPLICATE_KEY'), []);
    } finally {
      diagnostics.stop();
    }
  });

  it('keeps rows through insert() with a reactive child', () => {
    const keys = signal([1, 2]);
    const ul = document.createElement('ul');
    host.appendChild(ul);
    insert(ul, () => keys().map(n => h('li', { key: n }, String(n))));
    const [one] = ul.children;
    keys([2, 3, 1]);
    flushSync();
    assert.equal(ul.textContent, '231');
    assert.equal(ul.children[2], one);
    keys([]);
    flushSync();
    assert.equal(ul.textContent, '');
  });

  it('keeps rows after hydration', () => {
    host.innerHTML = '<ul><li>a</li><li>b</li></ul>';
    const keys = signal(['a', 'b']);
    const tree = h('ul', {}, () => keys().map(id => h('li', { key: id }, id)));
    const dispose = createRoot((d) => { hydrate(tree, host); return d; });
    keys(['b', 'a']);
    flushSync();
    assert.equal(host.textContent, 'ba');
    const [b, a] = host.querySelectorAll('li');
    keys(['a', 'c', 'b']);
    flushSync();
    const lis = [...host.querySelectorAll('li')];
    assert.deepEqual(lis.map(li => li.textContent), ['a', 'c', 'b']);
    assert.equal(lis[0], a);
    assert.equal(lis[2], b);
    dispose();
    host.textContent = '';
  });

  it('releases its rows when a tree built under no owner is mounted, then unmounted', () => {
    const keys = signal(['a', 'b']);
    const List = () => h('main', {}, () => keys().map(id => h(Row, { key: id, id })));
    // Built before any root exists, as `mount(<List />, el)` builds it: the
    // mount adopts the component, and unmounting disposes it and its rows.
    const node = createDOM(h(List, {}), host);
    mount(node, host)();
    assert.deepEqual(cleaned.sort(), ['a', 'b']);
    assert.equal(__subsOf(tick).length, 0);
    assert.equal(__subsOf(keys).length, 0);
  });

  it('releases its rows when its owner is disposed', () => {
    const keys = signal(['a', 'b']);
    let node;
    const dispose = createRoot((d) => {
      node = createDOM(h('main', {}, () => keys().map(id => h(Row, { key: id, id }))), host);
      return d;
    });
    host.appendChild(node);
    dispose();
    assert.deepEqual(cleaned.sort(), ['a', 'b']);
    assert.equal(__subsOf(tick).length, 0);
    assert.equal(__subsOf(keys).length, 0);
  });

  it('removes a portal rendered by a row that leaves', () => {
    const keys = signal(['a', 'b']);
    const layer = document.getElementById('layer');
    const unmount = mount(h('main', {}, () => keys().map(id =>
      h('section', { key: id }, h(Portal, { target: layer }, h('em', {}, id))))), host);
    assert.equal(layer.textContent, 'ab');
    keys(['b']);
    flushSync();
    assert.equal(layer.textContent, 'b');
    unmount();
    assert.equal(layer.textContent, '');
  });

  it('renders keyed rows inside SVG in the SVG namespace', () => {
    const keys = signal(['a']);
    const unmount = mount(h('svg', {}, () => keys().map(id => h('circle', { key: id, r: 1 }))), host);
    keys(['a', 'b']);
    flushSync();
    const circles = host.querySelectorAll('circle');
    assert.equal(circles.length, 2);
    for (const c of circles) assert.equal(c.namespaceURI, 'http://www.w3.org/2000/svg');
    unmount();
  });

  it('reports a duplicate key and keeps every row', () => {
    const diagnostics = capture({ quiet: true });
    try {
      const keys = signal(['a', 'a', 'b']);
      const unmount = mount(h('main', {}, () => keys().map(id => h(Row, { key: id, id }))), host);
      assert.equal(ids(host), 'a,a,b');
      keys(['b', 'a']);
      flushSync();
      assert.equal(ids(host), 'b,a');
      keys([]);
      flushSync();
      assert.equal(ids(host), '');
      unmount();
      assert.equal(cleaned.length, 3);
      assert.ok(diagnostics.events.some(e => e.code === 'ERR_DUPLICATE_KEY' && /"a"/.test(e.message)));
    } finally {
      diagnostics.stop();
    }
  });
});
