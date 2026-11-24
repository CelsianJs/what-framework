// A keyed row is built again for a replaced item only when the code that
// built it read something the new item holds another value in. A read of one
// field (`row.name` in the row's own code, a live() view's property) records
// that field; a read of the whole item (handed to a function, a method call)
// records the item, as before. Found dogfooding Vura: a row component that
// named its signal after `ev.id` lost its revealed value on every refetch.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

const { cleanup } = installDOM();
after(cleanup);

const { h, mount, flushSync, signal, live, effect } = await import('what-framework');

const mod = await loadCompiled(`
  import { signal, live } from 'what-framework';
  export const rows = signal([]);
  export let builds = 0;
  export const clicks = (el) => el.dispatchEvent(new Event('click', { bubbles: true }));

  // A row component whose body reads one field of its item.
  function Named(props) {
    builds++;
    const opened = signal(false, 'row.' + props.kind);
    return <li data-kind={props.kind} onClick={() => opened(true)}>{props.label}:{opened() ? 'open' : 'shut'}</li>;
  }
  export function ByField() {
    return <ul>{rows().map((row) => <Named key={row.id} kind={row.kind} label={row.label} />)}</ul>;
  }

  // The whole item handed to the row component, read in its body.
  function Whole(props) {
    builds++;
    // A spread reads every field, so the row took the whole item. (An alias,
    // const item = props.item, is read live where it is used instead.)
    const item = { ...props.item };
    const opened = signal(false);
    return <li onClick={() => opened(true)}>{item.label}:{opened() ? 'open' : 'shut'}</li>;
  }
  export function ByItem() {
    return <ul>{rows().map((row) => <Whole key={row.id} item={row} />)}</ul>;
  }

  // A method of the item, called while the row is built: it may read any field.
  export function ByMethod() {
    return <ul>{rows().map((row) => { builds++; const text = row.describe(); return <li key={row.id}>{text}</li>; })}</ul>;
  }

  // A table: column render functions handed a live view of the row.
  function Toggle(props) {
    builds++;
    // Read while the row is built: the field kind, not the whole item.
    const shown = signal(false, 'env.' + props.ev.kind);
    return <span onClick={() => shown(true)}>{props.ev.label}={shown() ? 'shown' : '***'}</span>;
  }
  const columns = [
    { key: 'value', render: (ev) => <Toggle ev={ev} /> },
    // A plain cell: the field placed, and an attribute that reads one.
    { key: 'name', render: (ev) => <b class={ev.hot ? 'hot' : 'cold'}>{ev.label}</b> },
  ];
  export function Table() {
    return <table><tbody>{rows().map((row) => {
      const view = live(() => row);
      // As Vura's Table writes it: a column without a renderer shows the field.
      return <tr key={row.id}>{columns.map((col) => <td key={col.key}>{col.render ? col.render(view) : row[col.key]}</td>)}</tr>;
    })}</tbody></table>;
  }
`, { pluginOptions: { devMetadata: true } });

function render(Component, first) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  mod.rows(first);
  const stop = mount(h(Component, {}), host);
  flushSync();
  return { host, stop: () => { stop(); host.remove(); } };
}
const text = (host, sel = 'li') => [...host.querySelectorAll(sel)].map((n) => n.textContent).join(' ');

test('a row whose building code read one field keeps its state while that field stays the same', () => {
  const { host, stop } = render(mod.ByField, [{ id: 1, kind: 'a', label: 'one' }, { id: 2, kind: 'b', label: 'two' }]);
  const before = mod.builds;
  mod.clicks(host.querySelector('li'));
  flushSync();
  assert.equal(text(host), 'one:open two:shut');
  // A refetch: new objects, the same kinds, a new label.
  mod.rows([{ id: 1, kind: 'a', label: 'uno' }, { id: 2, kind: 'b', label: 'two' }]);
  flushSync();
  assert.equal(text(host), 'uno:open two:shut', 'the row kept its state and follows the new label');
  assert.equal(mod.builds, before, 'no row was built again');
  // The field it read changes: that row is built again.
  mod.rows([{ id: 1, kind: 'z', label: 'uno' }, { id: 2, kind: 'b', label: 'two' }]);
  flushSync();
  assert.equal(text(host), 'uno:shut two:shut');
  assert.equal(host.querySelector('li').dataset.kind, 'z');
  assert.equal(mod.builds, before + 1, 'only the row whose field changed');
  stop();
});

test('a row whose building code read the whole item is built again for a replaced item, as before', () => {
  const { host, stop } = render(mod.ByItem, [{ id: 1, label: 'one' }]);
  mod.clicks(host.querySelector('li'));
  flushSync();
  const before = mod.builds;
  mod.rows([{ id: 1, label: 'uno' }]);
  flushSync();
  assert.equal(text(host), 'uno:shut', 'rebuilt from the new item');
  assert.equal(mod.builds, before + 1);
  stop();
});

test('a method called while the row is built takes the whole item', () => {
  const make = (label) => ({ id: 1, label, describe() { return 'is ' + this.label; } });
  const { host, stop } = render(mod.ByMethod, [make('one')]);
  mod.rows([make('two')]);
  flushSync();
  assert.equal(text(host), 'is two', 'a method that reads another field is not missed');
  stop();
});

test('a render function handed a live() row: the cell keeps its state, follows a renamed field, and rebuilds when a field it read changes', () => {
  const { host, stop } = render(mod.Table, [{ id: 1, kind: 'db', label: 'DB_URL' }, { id: 2, kind: 'key', label: 'API_KEY' }]);
  const before = mod.builds;
  mod.clicks(host.querySelector('span'));
  flushSync();
  assert.equal(text(host, 'span'), 'DB_URL=shown API_KEY=***');
  mod.rows([{ id: 1, kind: 'db', label: 'DATABASE_URL' }, { id: 2, kind: 'key', label: 'API_KEY' }]);
  flushSync();
  assert.equal(text(host, 'span'), 'DATABASE_URL=shown API_KEY=***', 'state kept, renamed field followed');
  assert.equal(mod.builds, before);
  mod.rows([{ id: 1, kind: 'pg', label: 'DATABASE_URL' }, { id: 2, kind: 'key', label: 'API_KEY' }]);
  flushSync();
  assert.equal(text(host, 'span'), 'DATABASE_URL=*** API_KEY=***', 'the field its body read changed');
  assert.equal(mod.builds, before + 1);
  stop();
});

test('live(): a read-only view of the current value, with live props What follows', () => {
  const data = signal({ name: 'ada', tags: ['x'] });
  const view = live(() => data());
  assert.equal(view.name, 'ada');
  data({ name: 'grace', tags: [] });
  assert.equal(view.name, 'grace');
  assert.equal(Object.getPrototypeOf(view), null);
  assert.equal(typeof Object.getOwnPropertyDescriptor(view, 'name').get, 'function', 'a getter: a live prop');
  assert.deepEqual(Object.keys(view).sort(), ['name', 'tags']);
  assert.deepEqual({ ...view }, { name: 'grace', tags: [] });
  assert.equal('name' in view, true);
  assert.equal('nope' in view, false);
  assert.equal(Object.keys(view).includes('toString'), false, 'an inherited name reads through but is no key of the view');
  assert.throws(() => { 'use strict'; view.name = 'x'; }, TypeError);
  Object.freeze(view);
  assert.equal(view.name, 'grace', 'a frozen view still reads the current value');

  const empty = signal(null);
  const nothing = live(() => empty());
  assert.equal(nothing.name, undefined);
  empty({ name: 'later' });
  assert.equal(nothing.name, 'later');

  const host = document.createElement('div');
  const stop = mount(h(function Card() { return h('b', {}, () => view.name); }, {}), host);
  data({ name: 'linus', tags: [] });
  flushSync();
  assert.equal(host.textContent, 'linus');
  stop();
  assert.throws(() => live('nope'), TypeError);
});

test('a plain render-function cell keeps its element and follows a replaced item: checking a field is live reads nothing', () => {
  // kind is read while the row is built (the Toggle column); label and hot
  // only in bindings, so replacing them keeps the row and the cell.
  const { host, stop } = render(mod.Table, [{ id: 1, kind: 'secret', label: 'API_KEY', hot: false }]);
  const bold = host.querySelector('b');
  assert.equal(bold.textContent, 'API_KEY');
  assert.equal(bold.className, 'cold');
  mod.rows([{ id: 1, kind: 'secret', label: 'API_TOKEN', hot: true }]);
  flushSync();
  assert.equal(host.querySelector('b'), bold, 'the same element: the cell was not built again');
  assert.equal(bold.textContent, 'API_TOKEN');
  assert.equal(bold.className, 'hot');
  stop();
});

test('asking whether a live view has a field subscribes nothing: only reading the field does', () => {
  const item = signal({ name: 'a', n: 1 });
  const view = live(() => item());
  let checks = 0;
  let reads = 0;
  // What the runtime does before it places a prop (_isLiveProp), and an `in` test.
  const stopCheck = effect(() => { checks++; Object.getOwnPropertyDescriptor(view, 'name'); 'n' in view; });
  const stopRead = effect(() => { reads++; void view.name; });
  item({ name: 'b', n: 2 });
  flushSync();
  assert.equal(checks, 1, 'a presence check does not depend on the value');
  assert.equal(reads, 2, 'a read does');
  stopCheck();
  stopRead();
});
