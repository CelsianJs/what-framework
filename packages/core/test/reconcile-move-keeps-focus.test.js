// A keyed row moved in the DOM keeps the focus of the field being edited in
// it, where the browser can move a node without taking it out
// (Element.moveBefore, in Chromium and Firefox). insertBefore takes the node
// out and puts it back: the field loses the focus and its caret, and
// Chromium fires blur, which a form validating on blur takes for the visitor
// leaving the field (the wizard smoke app: a vehicle moved up with Alt+ArrowUp
// while its model was being typed).
//
// jsdom has no moveBefore; the test gives Element one that records the nodes
// it moves, so it can tell which call moved each row.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();

const { signal, flushSync } = await import('../src/reactive.js');
const { mapArray } = await import('../src/render.js');

const moved = [];
const inserted = [];
let realInsertBefore;

before(() => {
  realInsertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function insertBefore(node, ref) {
    if (node.isConnected) inserted.push(node);
    return realInsertBefore.call(this, node, ref);
  };
  Element.prototype.moveBefore = function moveBefore(node, ref) {
    moved.push(node);
    return realInsertBefore.call(this, node, ref);
  };
});

after(() => {
  Node.prototype.insertBefore = realInsertBefore;
  delete Element.prototype.moveBefore;
});

function list(ids) {
  const el = document.getElementById('app');
  el.textContent = '';
  const items = signal(ids.map((id) => ({ id })));
  const Row = (item) => {
    const row = document.createElement('p');
    row.dataset.id = item.id;
    row.appendChild(document.createElement('input')).name = item.id;
    return row;
  };
  mapArray(items, Row, { key: (item) => item.id, raw: true })(el, null);
  flushSync();
  const byId = new Map(items.peek().map((item) => [item.id, item]));
  return {
    el,
    order: () => [...el.children].map((n) => n.dataset.id),
    show(next) {
      moved.length = 0;
      inserted.length = 0;
      items(next.map((id) => byId.get(id)));
      flushSync();
    },
  };
}

const rowsMovedBy = (calls) => calls.filter((n) => n.nodeType === 1 && n.localName === 'p').map((n) => n.dataset.id);

describe('a keyed row moved where the browser has moveBefore', () => {
  const cases = [
    ['two rows swapped', ['a', 'b', 'c'], ['b', 'a', 'c']],
    ['two rows far apart swapped', ['a', 'b', 'c', 'd', 'e'], ['a', 'd', 'c', 'b', 'e']],
    ['one row moved up', ['a', 'b', 'c', 'd', 'e'], ['a', 'd', 'b', 'c', 'e']],
    ['one row moved to the end', ['a', 'b', 'c', 'd'], ['b', 'c', 'd', 'a']],
    ['a shuffle', ['a', 'b', 'c', 'd', 'e', 'f'], ['f', 'c', 'a', 'e', 'b', 'd']],
  ];
  for (const [name, from, to] of cases) {
    it(`${name}: each row moves with moveBefore, none is taken out`, () => {
      const l = list(from);
      l.show(to);
      assert.deepEqual(l.order(), to);
      assert.ok(rowsMovedBy(moved).length > 0, 'a row moved');
      assert.deepEqual(rowsMovedBy(inserted), [], `rows taken out and put back: ${rowsMovedBy(inserted).join(', ')}`);
    });
  }
});
