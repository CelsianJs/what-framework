// A keyed list that slides like a window over a stream: a capped log drops
// rows at the start as items arrive at the end (a chat, a log tail), and a
// newest-first feed adds items at the start and drops rows at the end. The
// rows that stay hold the same items in the same order, so the reconciler
// keeps them where they are, removes the dropped rows and builds the added
// ones, reading each key in the range once rather than building a map of the
// old keys and walking every row (the chat smoke app: 400 messages arriving
// at once into a 1,000-row log).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();

const { signal, flushSync, onCleanup } = await import('../src/reactive.js');
const { mapArray } = await import('../src/render.js');

function container() {
  const el = document.getElementById('app');
  el.textContent = '';
  return el;
}

// A list of rows keyed by `id`, counting key reads, rows built and rows
// disposed. `mode` is 'raw' (the row is handed the item) or 'accessor'.
function list(initial, mode = 'raw') {
  const el = container();
  const stats = { keyReads: 0, built: 0, disposed: 0 };
  const key = (item) => { stats.keyReads++; return item.id; };
  const Row = (item) => {
    stats.built++;
    const row = document.createElement('p');
    row.dataset.id = mode === 'raw' ? item.id : item().id;
    return row;
  };
  const items = signal(initial);
  mapArray(items, Row, mode === 'raw' ? { key, raw: true } : { key })(el, null);
  flushSync();
  const ids = () => [...el.children].map((n) => n.dataset.id);
  const nodes = () => new Map([...el.children].map((n) => [n.dataset.id, n]));
  return { el, items, stats, ids, nodes };
}

const make = (from, to) => Array.from({ length: to - from }, (_, i) => ({ id: `m${from + i}` }));

describe('keyed list: a window that slid', () => {
  for (const mode of ['raw', 'accessor']) {
    it(`a capped log dropping one row as one item arrives reads each key once and keeps every other row (${mode} rows)`, () => {
      const initial = make(0, 1000);
      const { items, stats, ids, nodes } = list(initial, mode);
      const before = nodes();
      stats.keyReads = 0;
      stats.built = 0;
      const next = [...initial.slice(1), { id: 'm1000' }];
      items(next);
      flushSync();
      // A development build reads every key once to report duplicates; the
      // reconciler then reads the dropped key and each key of the new range.
      const reconcileReads = stats.keyReads - next.length;
      assert.ok(reconcileReads <= next.length + 20, `the reconciler read ${reconcileReads} keys for a slide of one`);
      assert.deepEqual(ids(), next.map((m) => m.id));
      assert.equal(stats.built, 1, 'one row built');
      const after = nodes();
      for (const m of next.slice(0, -1)) assert.equal(after.get(m.id), before.get(m.id), `${m.id} kept its node`);
    });
  }

  it('a newest-first feed adding at the start and dropping at the end keeps every other row', () => {
    const initial = make(0, 40).reverse();
    const { items, stats, ids, nodes } = list(initial);
    const before = nodes();
    stats.built = 0;
    const next = [{ id: 'm41' }, { id: 'm40' }, ...initial.slice(0, 38)];
    items(next);
    flushSync();
    assert.deepEqual(ids(), next.map((m) => m.id));
    assert.equal(stats.built, 2);
    const after = nodes();
    for (const m of initial.slice(0, 38)) assert.equal(after.get(m.id), before.get(m.id), `${m.id} kept its node`);
  });

  it('a slide with a prefix and a suffix that stay keeps them and the rows between', () => {
    const head = { id: 'head' };
    const tail = { id: 'tail' };
    const middle = make(0, 10);
    const { items, ids, nodes } = list([head, ...middle, tail]);
    const before = nodes();
    const next = [head, ...middle.slice(3), ...make(10, 13), tail];
    items(next);
    flushSync();
    assert.deepEqual(ids(), next.map((m) => m.id));
    const after = nodes();
    for (const m of [head, ...middle.slice(3), tail]) assert.equal(after.get(m.id), before.get(m.id), `${m.id} kept its node`);
  });

  it('an arriving item whose key a dropped row had takes that row, as the general path keys it', () => {
    const initial = make(0, 6);
    const { items, ids, nodes } = list(initial);
    const before = nodes();
    // m0 is dropped at the start and arrives again (a new object) at the end.
    const next = [...initial.slice(1), { id: 'm0' }];
    items(next);
    flushSync();
    assert.deepEqual(ids(), ['m1', 'm2', 'm3', 'm4', 'm5', 'm0']);
    assert.equal(nodes().get('m0'), before.get('m0'), 'the row of key m0 was kept and moved');
  });

  it('an item added at the start with the key of a kept item claims that row, as the general path keys it', () => {
    const initial = make(0, 6);
    const { items, ids, nodes } = list(initial);
    const before = nodes();
    // A new object keyed m2 arrives at the start: the first item with a key
    // claims its row, so the kept m2 further on is built anew.
    const next = [{ id: 'm2' }, ...initial.slice(0, 5)];
    items(next);
    flushSync();
    assert.deepEqual(ids(), ['m2', 'm0', 'm1', 'm2', 'm3', 'm4']);
    assert.equal(document.getElementById('app').children[0], before.get('m2'));
  });

  it('every row dropped by a slide is disposed, every row added is built, over a long stream', () => {
    const disposed = [];
    const el = container();
    let items = make(0, 50);
    const source = signal(items);
    mapArray(source, (item) => {
      onCleanup(() => disposed.push(item.id));
      const row = document.createElement('p');
      row.dataset.id = item.id;
      return row;
    }, { key: (m) => m.id, raw: true })(el, null);
    flushSync();
    let seq = 50;
    for (let step = 0; step < 300; step++) {
      const add = 1 + (step % 7);
      const drop = step % 3 === 0 ? add + 1 : add;
      items = [...items.slice(Math.min(drop, items.length - 1)), ...make(seq, seq + add)];
      seq += add;
      source(items);
      flushSync();
      assert.deepEqual([...el.children].map((n) => n.dataset.id), items.map((m) => m.id), `step ${step}`);
    }
    const shown = new Set(items.map((m) => m.id));
    assert.equal(disposed.length, seq - shown.size, 'every row not shown was disposed once');
    assert.equal(new Set(disposed).size, disposed.length, 'no row was disposed twice');
    assert.ok(disposed.every((id) => !shown.has(id)), 'no shown row was disposed');
  });
});
