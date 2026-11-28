// Keyed and unkeyed list rows are disposed through their reactive scope, not by
// walking their DOM, and a whole list is cleared or replaced with one DOM
// operation (T2-1 in docs/research/solid-2-review.md, item B1).
//
// What has to hold:
//   - everything a row created while it was built (bindings, effects,
//     components, nested lists) is released when the row goes, without a walk;
//   - content a region inside the row rendered LATER is owned by that region
//     and released with the row (region-ownership.test.js covers regions);
//   - clearing a list that owns its parent is one textContent write, and a list
//     that shares its parent clears only its own rows;
//   - a single-node row carries no <!--i--> boundary comment, a multi-node row
//     keeps one, and the two mix within one list.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();

const { signal, effect, flushSync, onCleanup, createRoot } = await import('../src/reactive.js');
const { mapArray, _$mapKeyed, _$createComponent, insert } = await import('../src/render.js');
const { onCleanup: onComponentCleanup } = await import('../src/hooks.js');

let container;
beforeEach(() => {
  container = document.getElementById('app');
  container.textContent = '';
});

const comments = (el) => [...el.childNodes].filter(n => n.nodeType === 8).map(n => n.data);
const rowTexts = (el) => [...el.children].map(c => c.textContent);

// Count DOM removals made through removeChild while `fn` runs.
function countRemovals(fn) {
  const proto = window.Node.prototype;
  const original = proto.removeChild;
  let removed = 0;
  proto.removeChild = function (child) { removed++; return original.call(this, child); };
  try { fn(); } finally { proto.removeChild = original; }
  return removed;
}

describe('row disposal through the row scope', () => {
  it('releases a pure row without walking its DOM', () => {
    const runs = [];
    let walked = 0;
    const tick = signal(0);
    const items = signal([1, 2, 3]);
    _$mapKeyed(items, (n) => {
      const li = document.createElement('li');
      effect(() => { runs.push(`${n}:${tick()}`); li.textContent = String(n); });
      // Only a DOM walk calls a node's _dispose.
      li._dispose = () => { walked++; };
      return li;
    }, { key: (n) => n })(container, null);
    flushSync();

    items([1, 3]);
    flushSync();
    runs.length = 0;
    tick(1);
    flushSync();
    assert.deepEqual(runs.sort(), ['1:1', '3:1'], 'row 2 effect was released, rows 1 and 3 kept theirs');
    assert.deepEqual(rowTexts(container), ['1', '3']);
    assert.equal(walked, 0, 'a pure row is not walked');
  });

  it('disposes a component built in the row through the row scope', () => {
    const cleaned = [];
    function Cell(props) {
      onComponentCleanup(() => cleaned.push(props.n));
      const td = document.createElement('td');
      td.textContent = String(props.n);
      return td;
    }
    const items = signal([1, 2, 3]);
    _$mapKeyed(items, (n) => {
      const tr = document.createElement('tr');
      tr.appendChild(_$createComponent(Cell, { n }));
      return tr;
    }, { key: (n) => n })(container, null);
    flushSync();

    items([1, 3]);
    flushSync();
    assert.deepEqual(cleaned, [2]);
    items([]);
    flushSync();
    assert.deepEqual(cleaned.sort(), [1, 2, 3]);
  });

  it('releases a component a region in the row rendered after the row was built', () => {
    const cleaned = [];
    function Badge() {
      onComponentCleanup(() => cleaned.push('badge'));
      return document.createElement('b');
    }
    const show = signal(false);
    const items = signal([1]);
    _$mapKeyed(items, () => {
      const li = document.createElement('li');
      insert(li, () => (show() ? _$createComponent(Badge, null) : null));
      return li;
    }, { key: (n) => n })(container, null);
    flushSync();

    show(true); // the region builds the component on a re-run, into its own scope
    flushSync();
    assert.equal(container.querySelectorAll('b').length, 1);
    items([]);
    flushSync();
    assert.deepEqual(cleaned, ['badge']);
  });

  it('releases the rows of a nested list when the outer row goes', () => {
    const cleaned = [];
    const outer = signal(['a', 'b']);
    _$mapKeyed(outer, (group) => {
      const ul = document.createElement('ul');
      _$mapKeyed(() => [1, 2], (n) => {
        onCleanup(() => cleaned.push(`${group}${n}`));
        const li = document.createElement('li');
        li.textContent = `${group}${n}`;
        return li;
      }, { key: (n) => n })(ul, null);
      return ul;
    }, { key: (g) => g })(container, null);
    flushSync();

    outer(['b']);
    flushSync();
    assert.deepEqual(cleaned.sort(), ['a1', 'a2']);
    assert.equal(container.querySelectorAll('li').length, 2);
  });

  it('releases unkeyed rows through their scope too', () => {
    const cleaned = [];
    const items = signal(['x', 'y']);
    mapArray(items, (v) => {
      onCleanup(() => cleaned.push(v));
      const li = document.createElement('li');
      li.textContent = v;
      return li;
    })(container, null);
    flushSync();
    items(['x']);
    flushSync();
    assert.deepEqual(cleaned, ['y']);
    items([]);
    flushSync();
    assert.deepEqual(cleaned, ['y', 'x']);
    assert.equal(container.querySelectorAll('li').length, 0);
  });
});

describe('one-shot clear and replace', () => {
  function rows(items) {
    return _$mapKeyed(items, (n) => {
      const li = document.createElement('li');
      li.textContent = String(n);
      return li;
    }, { key: (n) => n });
  }

  it('clears a list that owns its parent with textContent, not per-row removal', () => {
    const items = signal([1, 2, 3, 4]);
    rows(items)(container, null);
    flushSync();
    const removed = countRemovals(() => { items([]); flushSync(); });
    assert.equal(removed, 0);
    assert.equal(container.children.length, 0);
    assert.deepEqual(comments(container), ['/list'], 'the end marker survives the clear');
    items([5, 6]);
    flushSync();
    assert.deepEqual(rowTexts(container), ['5', '6'], 'the list still renders after a clear');
  });

  it('clears only its own rows when the parent has other children', () => {
    const before = document.createElement('p');
    before.textContent = 'before';
    const after = document.createElement('p');
    after.textContent = 'after';
    container.append(before, after);
    const items = signal([1, 2, 3]);
    rows(items)(container, after);
    flushSync();

    items([]);
    flushSync();
    assert.deepEqual(rowTexts(container), ['before', 'after']);
    items([7]);
    flushSync();
    assert.deepEqual(rowTexts(container), ['before', '7', 'after']);
  });

  it('replaces every row when no key survives', () => {
    const cleaned = [];
    const items = signal([1, 2, 3]);
    _$mapKeyed(items, (n) => {
      onCleanup(() => cleaned.push(n));
      const li = document.createElement('li');
      li.textContent = String(n);
      return li;
    }, { key: (n) => n })(container, null);
    flushSync();
    const first = container.firstChild;

    const removed = countRemovals(() => { items([4, 5, 6]); flushSync(); });
    assert.equal(removed, 0, 'replace-all clears in one operation');
    assert.deepEqual(cleaned.sort(), [1, 2, 3]);
    assert.deepEqual(rowTexts(container), ['4', '5', '6']);
    assert.notEqual(container.firstChild, first);
  });

  it('keeps the general path when some keys survive', () => {
    const items = signal([1, 2, 3]);
    rows(items)(container, null);
    flushSync();
    const kept = container.children[1];
    items([9, 2, 8]);
    flushSync();
    assert.deepEqual(rowTexts(container), ['9', '2', '8']);
    assert.equal(container.children[1], kept, 'the surviving row keeps its node');
  });
});

describe('row boundaries', () => {
  it('gives a single-node row no boundary comment', () => {
    const items = signal([1, 2]);
    _$mapKeyed(items, (n) => {
      const li = document.createElement('li');
      li.textContent = String(n);
      return li;
    }, { key: (n) => n })(container, null);
    flushSync();
    assert.deepEqual(comments(container), ['/list']);
  });

  it('keeps a boundary for multi-node rows and reorders mixed rows correctly', () => {
    const items = signal(['a', 'B', 'c', 'D']);
    // Lowercase rows are one element; uppercase rows are two.
    _$mapKeyed(items, (v) => {
      if (v === v.toLowerCase()) {
        const li = document.createElement('li');
        li.textContent = v;
        return li;
      }
      const frag = document.createDocumentFragment();
      for (const part of [v, v + '2']) {
        const li = document.createElement('li');
        li.textContent = part;
        frag.appendChild(li);
      }
      return frag;
    }, { key: (v) => v })(container, null);
    flushSync();
    assert.deepEqual(comments(container), ['i', 'i', '/list']);
    assert.deepEqual(rowTexts(container), ['a', 'B', 'B2', 'c', 'D', 'D2']);

    items(['D', 'B', 'c', 'a']); // reverse-ish: general path
    flushSync();
    assert.deepEqual(rowTexts(container), ['D', 'D2', 'B', 'B2', 'c', 'a']);
    items(['D', 'a', 'c', 'B']); // swap of rows 1 and 3
    flushSync();
    assert.deepEqual(rowTexts(container), ['D', 'D2', 'a', 'c', 'B', 'B2']);
    items(['a', 'c', 'B']); // remove a multi-node row
    flushSync();
    assert.deepEqual(rowTexts(container), ['a', 'c', 'B', 'B2']);
    assert.deepEqual(comments(container), ['i', '/list']);
  });

  it('turns a row that renders a string into a text-node row', () => {
    const items = signal(['x', 'y']);
    _$mapKeyed(items, (v) => v.toUpperCase(), { key: (v) => v })(container, null);
    flushSync();
    assert.equal(container.textContent, 'XY');
    items(['y']);
    flushSync();
    assert.equal(container.textContent, 'Y');
  });

  it('disposes the whole list, rows included, when its owner is disposed', () => {
    const cleaned = [];
    const items = signal([1, 2]);
    let dispose;
    createRoot((d) => {
      dispose = d;
      _$mapKeyed(items, (n) => {
        onCleanup(() => cleaned.push(n));
        return document.createElement('li');
      }, { key: (n) => n })(container, null);
    });
    flushSync();
    dispose();
    assert.deepEqual(cleaned.sort(), [1, 2]);
    items([3]);
    flushSync();
    assert.equal(container.querySelectorAll('li').length, 2, 'a disposed list no longer reconciles');
  });
});
