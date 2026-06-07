// Regression: component lifecycle disposal MUST run when items are removed
// from a list (keyed or unkeyed). Before AUDIT-2026-06-06 C5, _removeItemNodes
// and reconcileList's removal paths skipped disposeTree for component contexts
// (which live on the `c:start` comment), leaking effects, hook cleanups,
// onCleanup callbacks, event listeners, and devtools registrations on every
// list mutation. This test fails loudly if that regresses.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.SVGElement = dom.window.SVGElement;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.queueMicrotask = global.queueMicrotask || ((fn) => Promise.resolve().then(fn));

const { signal, flushSync } = await import('../src/reactive.js');
const { mapArray, _$createComponent } = await import('../src/render.js');
const { onCleanup } = await import('../src/hooks.js');

function getContainer() {
  const el = document.getElementById('app');
  el.textContent = '';
  return el;
}

describe('list disposal: component cleanup runs on removal (AUDIT C5)', () => {
  it('keyed (raw) — removing a middle item disposes that component', () => {
    const cleaned = [];
    function Row(props) {
      onCleanup(() => cleaned.push(props.id));
      const el = document.createElement('div');
      el.textContent = 'row ' + props.id;
      return el;
    }
    const items = signal([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const container = getContainer();
    mapArray(items, (it) => _$createComponent(Row, { id: it.id }), { key: (i) => i.id, raw: true })(container, null);
    flushSync();

    items([{ id: 1 }, { id: 3 }]); // remove middle
    flushSync();
    assert.deepEqual(cleaned, [2], `expected component 2 disposed, got [${cleaned}]`);
  });

  it('keyed (raw) — clear-all disposes every component', () => {
    const cleaned = [];
    function Row(props) {
      onCleanup(() => cleaned.push(props.id));
      const el = document.createElement('div');
      el.textContent = 'row ' + props.id;
      return el;
    }
    const items = signal([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const container = getContainer();
    mapArray(items, (it) => _$createComponent(Row, { id: it.id }), { key: (i) => i.id, raw: true })(container, null);
    flushSync();

    items([]); // clear all
    flushSync();
    assert.deepEqual(cleaned.sort((a, b) => a - b), [1, 2, 3], `expected all disposed, got [${cleaned}]`);
  });

  it('unkeyed — removing items disposes nested component contexts', () => {
    const cleaned = [];
    function Inner(props) {
      onCleanup(() => cleaned.push(props.id));
      const s = document.createElement('span');
      s.textContent = '' + props.id;
      return s;
    }
    // Element-root items containing a nested component.
    const items = signal([1, 2, 3, 4]);
    const container = getContainer();
    mapArray(items, (id) => {
      const li = document.createElement('li');
      li.appendChild(_$createComponent(Inner, { id }));
      return li;
    })(container, null); // no key => unkeyed reconcileList
    flushSync();

    items([1, 4]); // remove middle two (general/_reconcileMiddle path)
    flushSync();
    assert.deepEqual(cleaned.sort((a, b) => a - b), [2, 3], `expected nested 2,3 disposed, got [${cleaned}]`);
  });

  it('churn — 1000 add/remove cycles leak no live component cleanups', () => {
    let live = 0;
    function Row(props) {
      live++;
      onCleanup(() => { live--; });
      const el = document.createElement('div');
      el.textContent = 'r' + props.id;
      return el;
    }
    const items = signal([]);
    const container = getContainer();
    mapArray(items, (it) => _$createComponent(Row, { id: it.id }), { key: (i) => i.id, raw: true })(container, null);
    flushSync();

    for (let i = 0; i < 1000; i++) {
      items([{ id: i * 3 }, { id: i * 3 + 1 }, { id: i * 3 + 2 }]);
      flushSync();
      items([]); // drop them all
      flushSync();
    }
    assert.equal(live, 0, `leaked ${live} undisposed component(s) after 1000 churns`);
  });
});
