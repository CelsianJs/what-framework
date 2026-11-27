// What a keyed row component's reads of its item record, as docs/API.md
// (live views) and GOTCHAS describe it. A component handed the raw item
// (`<Row item={item} />`) keeps its nodes and its state across a replacement
// under its key while every field its body read holds the same value in the
// new item: `item.id` in the body reads as `_$propField(props, "item", "id")`,
// which records the field `id`, as `row.id` in the row's own code does. Reads
// in its JSX are bindings, which follow the new item. A body read of a field
// the new item changed builds the row again from it, as does a read of the
// whole item.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';
import { compileJSX } from '../../../test-utils/compile.js';

installDOM('<!DOCTYPE html><html><head></head><body></body></html>');

const { h, mount, flushSync } = await import('../../core/src/index.js');

// Mounts a list of one row, opens the row (component state), replaces the
// item with `next`, and reports whether the row kept its element and its
// state, and what it shows.
async function replaced(row, list, next = { id: 1, title: 'a', done: true }) {
  const mod = await loadCompiled(`import { signal, useState, live, onCleanup } from 'what-framework';
    export const items = signal([{ id: 1, title: 'a', done: false }]);
    export const gone = [];
    ${row}
    export function App() { return <ul>{items().map((item) => ${list})}</ul>; }`);
  const el = document.createElement('div');
  document.body.appendChild(el);
  mount(h(mod.App, {}), el);
  flushSync();
  const first = el.querySelector('li');
  first.click();
  flushSync();
  mod.items([next]);
  flushSync();
  const li = el.querySelector('li');
  return { kept: li === first, text: li.textContent, gone: mod.gone };
}

describe('a keyed row component and what its reads of the item record', () => {
  it('reads in its JSX only: the row keeps its element and its state', async () => {
    const r = await replaced(
      'function Row({ item }) { const [on, setOn] = useState(false); return <li data-id={item.id} onClick={() => setOn(true)}>{on() ? "on" : item.title}</li>; }',
      '<Row key={item.id} item={item} />');
    assert.deepEqual(r, { kept: true, text: 'on', gone: [] });
  });

  it('handed the field its body reads as a prop: the row keeps its element and its state', async () => {
    const r = await replaced(
      'function Row({ id, title }) { const [on, setOn] = useState(false); const tag = "row-" + id; return <li data-id={tag} onClick={() => setOn(true)}>{on() ? "on" : title}</li>; }',
      '<Row key={item.id} id={item.id} title={item.title} />');
    assert.deepEqual(r, { kept: true, text: 'on', gone: [] });
  });

  it('handed a live view, a body read of an unchanged field keeps the row', async () => {
    const r = await replaced(
      'function Row({ item }) { const [on, setOn] = useState(false); const id = item.id; return <li data-id={id} onClick={() => setOn(true)}>{on() ? "on" : item.title}</li>; }',
      '<Row key={item.id} item={live(() => item)} />');
    assert.deepEqual(r, { kept: true, text: 'on', gone: [] });
  });

  it('handed the raw item, a body read of an unchanged field keeps the row and its state', async () => {
    const r = await replaced(
      'function Row({ item }) { const [on, setOn] = useState(false); const id = item.id; return <li data-id={id} onClick={() => setOn(true)}>{on() ? "on" : item.title}</li>; }',
      '<Row key={item.id} item={item} />');
    assert.deepEqual(r, { kept: true, text: 'on', gone: [] });
  });

  it('a props object read in the body (`props.item.id`) keeps the row the same way', async () => {
    const r = await replaced(
      'function Row(props) { const [on, setOn] = useState(false); const id = props.item.id; return <li data-id={id} onClick={() => setOn(true)}>{on() ? "on" : props.item.title}</li>; }',
      '<Row key={item.id} item={item} />');
    assert.deepEqual(r, { kept: true, text: 'on', gone: [] });
  });

  it('a cleanup that uses a field the body read: the row is kept, not disposed', async () => {
    const r = await replaced(
      'function Row({ item }) { const key = item.id; onCleanup(() => gone.push(key)); const [on, setOn] = useState(false); return <li data-key={key} onClick={() => setOn(true)}>{on() ? "on" : item.title}</li>; }',
      '<Row key={item.id} item={item} />');
    assert.deepEqual(r, { kept: true, text: 'on', gone: [] });
  });

  it('a field it hands a child component, whose body reads it: the row is kept', async () => {
    const r = await replaced(
      'function Title({ text }) { const upper = text.toUpperCase(); return <b>{upper}</b>; } ' +
      'function Row({ item }) { const [on, setOn] = useState(false); return <li onClick={() => setOn(true)}>{on() ? "on" : <Title text={item.title} />}</li>; }',
      '<Row key={item.id} item={item} />');
    assert.deepEqual(r, { kept: true, text: 'on', gone: [] });
  });

  it('a body read of a field the new item changed builds the row again from the new item', async () => {
    const r = await replaced(
      'function Row({ item }) { const [on, setOn] = useState(false); const label = item.title.toUpperCase(); onCleanup(() => gone.push(label)); return <li onClick={() => setOn(true)}>{on() ? "on" : label}</li>; }',
      '<Row key={item.id} item={item} />',
      { id: 1, title: 'b', done: false });
    assert.deepEqual(r, { kept: false, text: 'B', gone: ['A'] });
  });

  it('a field handed to a child component that the new item changed builds the row again', async () => {
    const r = await replaced(
      'function Title({ text }) { const upper = text.toUpperCase(); return <b>{upper}</b>; } ' +
      'function Row({ item }) { const [on, setOn] = useState(false); return <li onClick={() => setOn(true)}><Title text={item.title} />{on() ? "on" : ""}</li>; }',
      '<Row key={item.id} item={item} />',
      { id: 1, title: 'b', done: false });
    assert.deepEqual(r, { kept: false, text: 'B', gone: [] });
  });

  it('handed something made from the item, a body read records the whole item: any replacement builds the row again', async () => {
    const r = await replaced(
      'function Row({ item }) { const [on, setOn] = useState(false); const label = item.label; return <li onClick={() => setOn(true)}>{on() ? "on" : label}</li>; }',
      '<Row key={item.id} item={{ label: item.title + (item.done ? " (done)" : "") }} />');
    assert.deepEqual(r, { kept: false, text: 'a (done)', gone: [] });
  });

  it('handed a prop whose getter reads the item twice, a body read records the whole item', async () => {
    const r = await replaced(
      'const pick = (a, b) => a || b; function Row({ item }) { const [on, setOn] = useState(false); const id = item.id; return <li data-id={id} onClick={() => setOn(true)}>{on() ? "on" : item.title}</li>; }',
      '<Row key={item.id} item={pick(item, item)} />');
    assert.deepEqual(r, { kept: false, text: 'a', gone: [] });
  });

  it('a method called on the item reads the whole item: any replacement builds the row again', async () => {
    const r = await replaced(
      'function Row({ item }) { const [on, setOn] = useState(false); const has = item.hasOwnProperty("id"); return <li data-has={has} onClick={() => setOn(true)}>{on() ? "on" : item.title}</li>; }',
      '<Row key={item.id} item={item} />');
    assert.deepEqual(r, { kept: false, text: 'a', gone: [] });
  });
});

describe('the member reads of props the compiler writes as _$propField', () => {
  const SOURCE = `
    function Row({ item, onPick }) {
      const a = item.id;
      const b = item.meta?.x;
      const n = item['n'];
      const c = item.format();
      item.count = 1;
      const { title } = item;
      const k = item[a];
      const later = () => item.label;
      return <li data-id={item.id} onClick={() => onPick(item.id)}>{item.label}<Child v={item.done} f={() => item.f} /></li>;
    }
    function Child(p) { return <b>{p.v}</b>; }
    function helper(obj) { return obj.a.b; }
    export { Row, helper };`;
  const code = compileJSX(SOURCE);

  it('rewrites a read of one static key of a prop in the body, in functions of it, and in a prop handed to a component', () => {
    assert.match(code, /const a = _\$propField\(_props, "item", "id"\);/);
    assert.match(code, /const b = _\$propField\(_props, "item", "meta"\)\?\.x;/);
    assert.match(code, /const n = _\$propField\(_props, "item", "n"\);/);
    assert.match(code, /const later = \(\) => _\$propField\(_props, "item", "label"\);/);
    assert.match(code, /get v\(\) \{\s*return _\$propField\(_props, "item", "done"\);/);
  });

  it('keeps a method call, a write, destructuring, a computed key and the JSX that builds elements as written', () => {
    assert.match(code, /const c = _props\.item\.format\(\);/);
    assert.match(code, /_props\.item\.count = 1;/);
    assert.match(code, /\} = _props\.item;/);
    assert.match(code, /const k = _props\.item\[a\];/);
    assert.match(code, /_\$setAttr\(_el\$0, "data-id", _props\.item\.id\)/);
    assert.match(code, /_\$plain\(_el\$0, \(\) => _props\.item\.label/);
    assert.match(code, /\$\$click = \(\) => _props\.onPick\(_props\.item\.id\)/);
    assert.match(code, /f: \(\) => _props\.item\.f/);
  });

  it('leaves a function that renders no JSX, and the server back end, alone', () => {
    assert.match(code, /return obj\.a\.b;/);
    assert.doesNotMatch(compileJSX(SOURCE, { pluginOptions: { generate: 'ssr' } }), /_\$propField/);
  });
});
