// A keyed list's swap and its removals update the list's row arrays in
// place (render.js reconcileKeyed). Every later diff reads those arrays, so a
// sequence of writes that takes each path in turn (a swap, a removal, an
// adjacent swap, a contiguous removal, a single move, a reverse, an append)
// must keep every row matched to its item: the same node for an item that
// stays, a build only for a new item, and a disposal exactly for each item
// that goes.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

let cleanup;
let reactive;
let render;

before(async () => {
  ({ cleanup } = installDOM());
  reactive = await import('../src/reactive.js');
  render = await import('../src/render.js');
});
after(() => cleanup());

function list(initial, multiNode) {
  const { signal, onCleanup, createRoot, flushSync } = reactive;
  const container = document.body.appendChild(document.createElement('div'));
  const built = [];
  const disposed = [];
  const nodes = new Map();
  const Row = (item) => {
    built.push(item.id);
    onCleanup(() => disposed.push(item.id));
    const el = document.createElement('p');
    el.dataset.id = item.id;
    el.textContent = item.id;
    nodes.set(item.id, el);
    if (!multiNode) return el;
    const frag = document.createDocumentFragment();
    frag.append(el, document.createElement('hr'));
    return frag;
  };
  const items = signal(initial.split('').map((id) => ({ id })));
  createRoot(() => render.mapArray(items, Row, { key: (i) => i.id, raw: true })(container, null));
  flushSync();
  const byId = new Map(items().map((item) => [item.id, item]));
  const write = (order) => {
    items(order.split('').map((id) => {
      if (!byId.has(id)) byId.set(id, { id });
      return byId.get(id);
    }));
    flushSync();
  };
  const shown = () => [...container.querySelectorAll('p')].map((p) => p.dataset.id).join('');
  return { container, built, disposed, nodes, write, shown };
}

const STEPS = [
  ['aicdefghbj', 'a swap of two rows apart'],
  ['aidefghbj', 'a removal'],
  ['aiedfghbj', 'a swap of neighbours'],
  ['aiedhbj', 'a contiguous removal'],
  ['abiedhj', 'a single move'],
  ['jhdeiba', 'a reverse'],
  ['jhdeibaxy', 'an append'],
  ['jdeibaxy', 'another removal'],
  ['jyeibaxd', 'another swap'],
  ['jyibaxd', 'a removal after it'],
];

describe('keyed rows swapped and removed in place stay matched to their items', () => {
  for (const multiNode of [false, true]) {
    it(`through a sequence that takes each reconcile path (${multiNode ? 'rows of several nodes' : 'one node per row'})`, () => {
      const l = list('abcdefghij', multiNode);
      const first = new Map(l.nodes);
      let before = 'abcdefghij';
      for (const [order, what] of STEPS) {
        const builtBefore = l.built.length;
        const disposedBefore = l.disposed.length;
        l.write(order);
        assert.equal(l.shown(), order, what);
        const added = [...order].filter((id) => !before.includes(id));
        const gone = [...before].filter((id) => !order.includes(id));
        assert.deepEqual(l.built.slice(builtBefore), added, `${what}: builds only the new items`);
        assert.deepEqual(l.disposed.slice(disposedBefore).sort(), gone.sort(), `${what}: disposes only the items that went`);
        for (const id of order) {
          if (first.has(id)) assert.equal(l.container.querySelector(`[data-id="${id}"]`), first.get(id), `${what}: ${id} kept its node`);
        }
        if (multiNode) {
          for (const p of l.container.querySelectorAll('p')) assert.equal(p.nextSibling.localName, 'hr', `${what}: ${p.dataset.id} kept its nodes together`);
        }
        before = order;
      }
      l.write('');
      assert.equal(l.shown(), '');
      assert.deepEqual(l.disposed.sort(), [...'abcdefghijxy'].sort(), 'every row was disposed once');
    });
  }
});
