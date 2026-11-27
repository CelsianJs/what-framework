// What a keyed row component's reads of its item record, as docs/API.md
// (live views) and GOTCHAS describe it: a component handed the raw item keeps
// its nodes and state across a replacement while it reads the item in its
// JSX, or is handed the field it needs as a prop, or a live() view of the
// item; a read of the raw item in its body records the whole item, so any
// replacement builds the row again.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM('<!DOCTYPE html><html><head></head><body></body></html>');

const { h, mount, flushSync } = await import('../../core/src/index.js');

// Mounts a list of one row, opens the row (component state), replaces the
// item with a copy that changes `done` (read nowhere), and reports whether
// the row kept its element and its state.
async function replaced(row, list) {
  const mod = await loadCompiled(`import { signal, useState, live } from 'what-framework';
    export const items = signal([{ id: 1, title: 'a', done: false }]);
    ${row}
    export function App() { return <ul>{items().map((item) => ${list})}</ul>; }`);
  const el = document.createElement('div');
  document.body.appendChild(el);
  mount(h(mod.App, {}), el);
  flushSync();
  const first = el.querySelector('li');
  first.click();
  flushSync();
  mod.items([{ id: 1, title: 'a', done: true }]);
  flushSync();
  return { kept: el.querySelector('li') === first, text: el.querySelector('li').textContent };
}

describe('a keyed row component and what its reads of the item record', () => {
  it('reads in its JSX only: the row keeps its element and its state', async () => {
    const r = await replaced(
      'function Row({ item }) { const [on, setOn] = useState(false); return <li data-id={item.id} onClick={() => setOn(true)}>{on() ? "on" : item.title}</li>; }',
      '<Row key={item.id} item={item} />');
    assert.deepEqual(r, { kept: true, text: 'on' });
  });

  it('handed the field its body reads as a prop: the row keeps its element and its state', async () => {
    const r = await replaced(
      'function Row({ id, title }) { const [on, setOn] = useState(false); const tag = "row-" + id; return <li data-id={tag} onClick={() => setOn(true)}>{on() ? "on" : title}</li>; }',
      '<Row key={item.id} id={item.id} title={item.title} />');
    assert.deepEqual(r, { kept: true, text: 'on' });
  });

  it('handed a live view, a body read of an unchanged field keeps the row', async () => {
    const r = await replaced(
      'function Row({ item }) { const [on, setOn] = useState(false); const id = item.id; return <li data-id={id} onClick={() => setOn(true)}>{on() ? "on" : item.title}</li>; }',
      '<Row key={item.id} item={live(() => item)} />');
    assert.deepEqual(r, { kept: true, text: 'on' });
  });

  it('handed the raw item, a body read records the whole item: any replacement builds the row again', async () => {
    const r = await replaced(
      'function Row({ item }) { const [on, setOn] = useState(false); const id = item.id; return <li data-id={id} onClick={() => setOn(true)}>{on() ? "on" : item.title}</li>; }',
      '<Row key={item.id} item={item} />');
    assert.deepEqual(r, { kept: false, text: 'a' });
  });
});
