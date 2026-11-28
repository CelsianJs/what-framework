// A keyed .map() row whose item is replaced by an immutable update, the way the
// docs teach it (items(prev => prev.map(i => i.id === id ? { ...i, done: true } : i))),
// shows the new item, and every other row keeps its DOM nodes.
//
// Compiled rows read their item through an accessor (what-compiler's
// readItemThroughAccessor, mapArray's follow mode): the row's bindings follow
// the new item and keep their nodes, and a row whose building code (a
// component's body included) read a field the new item holds another value in
// is built again from the new item. h() and JSX-runtime rows are vnodes made
// again on every run: a
// kept key whose vnode renders something else gets a row built from it.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>');

const { mount, hydrate, flushSync, h, signal, For } = await import('what-framework');
const { __resetHydrationData } = await import('../src/hydration-data.js');
const server = await import('../../server/src/index.js');

const toggle = (id) => (prev) => prev.map((t) => (t.id === id ? { ...t, title: t.title + '!', done: !t.done } : t));

describe('a keyed .map() row after an immutable update', () => {
  let app;
  beforeEach(() => {
    app = document.getElementById('app');
    app.textContent = '';
  });

  it('shows the replaced item\'s fields', async () => {
    const { items, List } = await loadCompiled(`
      import { signal } from 'what-framework';
      export const items = signal([{ id: 1, title: 'a', done: false }, { id: 2, title: 'b', done: false }]);
      export function List() {
        return <ul>{items().map((t) => <li key={t.id} class={t.done ? 'done' : 'open'}>{t.title}</li>)}</ul>;
      }
    `);
    mount(() => List(), app);
    items((prev) => prev.map((t) => (t.id === 1 ? { ...t, title: 'a!', done: true } : t)));
    flushSync();
    const first = app.querySelector('li');
    assert.equal(first.textContent, 'a!');
    assert.equal(first.className, 'done');
  });

  it('keeps the other rows\' DOM nodes', async () => {
    const { items, List } = await loadCompiled(`
      import { signal } from 'what-framework';
      export const items = signal([{ id: 1, title: 'a' }, { id: 2, title: 'b' }]);
      export function List() {
        return <ul>{items().map((t) => <li key={t.id}>{t.title}</li>)}</ul>;
      }
    `);
    mount(() => List(), app);
    const second = app.querySelectorAll('li')[1];
    items((prev) => prev.map((t) => (t.id === 1 ? { ...t, title: 'a!' } : t)));
    flushSync();
    assert.equal(app.querySelector('li').textContent, 'a!');
    assert.equal(app.querySelectorAll('li')[1], second, 'an unchanged item keeps its row');
  });

  it('keeps the replaced row\'s own nodes, and the focus in it, when only its bindings read the item', async () => {
    const { items, List } = await loadCompiled(`
      import { signal } from 'what-framework';
      export const items = signal([{ id: 1, title: 'a', done: false }, { id: 2, title: 'b', done: false }]);
      export function List() {
        return <ul>{items().map((t) => (
          <li key={t.id}><input type="checkbox" checked={t.done} /><span>{t.title}</span></li>
        ))}</ul>;
      }
    `);
    mount(() => List(), app);
    const box = app.querySelector('input');
    box.focus();
    items(toggle(1));
    flushSync();
    assert.equal(app.querySelector('input'), box, 'the row was not rebuilt');
    assert.equal(document.activeElement, box);
    assert.equal(box.checked, true);
    assert.equal(app.querySelector('span').textContent, 'a!');
  });

  it('keeps a row whose component read in its body only fields the new item holds the same', async () => {
    const { items, List, built } = await loadCompiled(`
      import { signal } from 'what-framework';
      export const items = signal([{ id: 1, title: 'a', done: false }, { id: 2, title: 'b', done: false }]);
      export const built = [];
      function Item(props) {
        built.push(props.todo.id);
        return <li class={props.todo.done ? 'done' : 'open'}>{props.todo.title}</li>;
      }
      export function List() {
        return <ul>{items().map((t) => <Item key={t.id} todo={t} />)}</ul>;
      }
    `);
    mount(() => List(), app);
    const [first, second] = app.querySelectorAll('li');
    built.length = 0;
    items(toggle(1));
    flushSync();
    assert.deepEqual(built, [], 'no row is built again');
    assert.equal(app.querySelector('li'), first);
    assert.equal(first.textContent, 'a!');
    assert.equal(first.className, 'done');
    assert.equal(app.querySelectorAll('li')[1], second);
  });

  it('builds a row again when its component read in its body a field the new item changed', async () => {
    const { items, List, built } = await loadCompiled(`
      import { signal } from 'what-framework';
      export const items = signal([{ id: 1, title: 'a', done: false }, { id: 2, title: 'b', done: false }]);
      export const built = [];
      function Item({ todo }) {
        const label = todo.title.toUpperCase();
        built.push(label);
        return <li class={todo.done ? 'done' : 'open'}>{label}</li>;
      }
      export function List() {
        return <ul>{items().map((t) => <Item key={t.id} todo={t} />)}</ul>;
      }
    `);
    mount(() => List(), app);
    const second = app.querySelectorAll('li')[1];
    built.length = 0;
    items(toggle(1));
    flushSync();
    assert.deepEqual(built, ['A!'], 'only the replaced row is built again');
    assert.equal(app.querySelector('li').textContent, 'A!');
    assert.equal(app.querySelector('li').className, 'done');
    assert.equal(app.querySelectorAll('li')[1], second);
  });

  it('follows replaced items through a reorder, a swap and a refetch of every item', async () => {
    const { items, List } = await loadCompiled(`
      import { signal } from 'what-framework';
      export const items = signal([1, 2, 3, 4, 5].map((id) => ({ id, title: 't' + id })));
      export function List() {
        return <ul>{items().map((t) => <li key={t.id}>{t.title}</li>)}</ul>;
      }
    `);
    mount(() => List(), app);
    const nodes = new Map([...app.querySelectorAll('li')].map((li, i) => [i + 1, li]));
    const text = () => [...app.querySelectorAll('li')].map((li) => li.textContent).join(',');
    const same = (ids) => assert.ok([...app.querySelectorAll('li')].every((li, i) => li === nodes.get(ids[i])), 'the rows are the same nodes');

    // A swap with a replaced item in between (the swap fast path).
    items((prev) => [prev[0], prev[3], { ...prev[2], title: 'T3' }, prev[1], prev[4]]);
    flushSync();
    assert.equal(text(), 't1,t4,T3,t2,t5');
    same([1, 4, 3, 2, 5]);

    // A move with replaced items (the single-move fast path).
    items((prev) => [{ ...prev[0], title: 'T1' }, prev[2], prev[3], prev[1], prev[4]]);
    flushSync();
    assert.equal(text(), 'T1,T3,t2,t4,t5');
    same([1, 3, 2, 4, 5]);

    // Every item a new object, as a refetch returns them, in a new order.
    items((prev) => [...prev].reverse().map((t) => ({ ...t, title: t.title.toUpperCase() })));
    flushSync();
    assert.equal(text(), 'T5,T4,T2,T3,T1');
    same([5, 4, 2, 3, 1]);
  });
});

describe('an h() keyed row after an immutable update', () => {
  let app;
  beforeEach(() => {
    app = document.getElementById('app');
    app.textContent = '';
  });

  it('is built again from its new vnode; the other rows keep their nodes', () => {
    const items = signal([{ id: 1, title: 'a', done: false }, { id: 2, title: 'b', done: false }]);
    const stop = mount(h('ul', {}, () => items().map((t) => h('li', {
      key: t.id,
      class: t.done ? 'done' : 'open',
      onclick: () => items(toggle(t.id)),
    }, t.title))), app);
    const second = app.querySelectorAll('li')[1];
    app.querySelector('li').click();
    flushSync();
    assert.equal(app.querySelector('li').textContent, 'a!');
    assert.equal(app.querySelector('li').className, 'done');
    assert.equal(app.querySelectorAll('li')[1], second, 'a row whose vnode is the same, its handler included, is kept');
    stop();
  });

  it('a row of the runtime <For> follows its item the same way', () => {
    const items = signal([{ id: 1, title: 'a' }, { id: 2, title: 'b' }]);
    const stop = mount(h('ul', {}, h(For, { each: items }, (t) => h('li', {}, t.title))), app);
    const second = app.querySelectorAll('li')[1];
    items((prev) => prev.map((t) => (t.id === 1 ? { ...t, title: 'a!' } : t)));
    flushSync();
    assert.equal(app.querySelector('li').textContent, 'a!');
    assert.equal(app.querySelectorAll('li')[1], second);
    stop();
  });
});

describe('a hydrated keyed row after an immutable update', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    __resetHydrationData();
  });

  it('follows its item on the compiled client', async () => {
    const source = `
      import { signal } from 'what-framework';
      export const items = signal([{ id: 1, title: 'a' }, { id: 2, title: 'b' }]);
      export function List() {
        return <ul>{() => items().map((t) => <li key={t.id}>{t.title}</li>)}</ul>;
      }
    `;
    const serverMod = await loadCompiled(source, { pluginOptions: { generate: 'ssr' } });
    const client = await loadCompiled(source, { pluginOptions: { hydratable: true } });
    const app = document.getElementById('app');
    app.innerHTML = server.renderToHydratableString(h(serverMod.List, {}));
    const rows = [...app.querySelectorAll('li')];
    const stop = hydrate(h(client.List, {}), app);
    client.items((prev) => prev.map((t) => (t.id === 1 ? { ...t, title: 'a!' } : t)));
    flushSync();
    assert.ok([...app.querySelectorAll('li')].every((li, i) => li === rows[i]), 'the server\'s rows are kept');
    assert.equal(rows[0].textContent, 'a!');
    stop();
  });

  it('is built again from its new vnode on the h() client', () => {
    const items = signal([{ id: 1, title: 'a' }, { id: 2, title: 'b' }]);
    const tree = () => h('ul', {}, () => items().map((t) => h('li', { key: t.id }, t.title)));
    const app = document.getElementById('app');
    app.innerHTML = server.renderToHydratableString(tree());
    const second = app.querySelectorAll('li')[1];
    const stop = hydrate(tree(), app);
    items((prev) => prev.map((t) => (t.id === 1 ? { ...t, title: 'a!' } : t)));
    flushSync();
    assert.equal(app.querySelector('li').textContent, 'a!');
    assert.equal(app.querySelectorAll('li')[1], second);
    stop();
  });
});

// A plain field of the item (`{t.title}`) is a text node the row's item cell
// writes, not a reactive region: no effect, no markers, and on the server
// plain text the client claims as its text node.
describe('a keyed row\'s plain field', () => {
  const source = `
    import { signal, effect } from 'what-framework';
    export const items = signal([{ id: 1, title: 'a' }, { id: 2, title: 'b' }]);
    export function List() {
      return <ul>{items().map((t) => <li key={t.id}><b>{t.title}</b></li>)}</ul>;
    }`;

  it('is a text node the row writes in place, with no effect of its own', async () => {
    const { items, List } = await loadCompiled(source);
    const app = document.getElementById('app');
    app.textContent = '';
    const stop = mount(() => List(), app);
    const text = app.querySelector('b').firstChild;
    assert.equal(app.querySelector('ul').innerHTML.includes('<!--'), true, 'precondition: the list keeps its end marker');
    assert.equal(app.querySelector('b').childNodes.length, 1, 'no region markers around the field');
    items((prev) => prev.map((t) => (t.id === 1 ? { ...t, title: 'a!' } : t)));
    flushSync();
    assert.equal(app.querySelector('b').firstChild, text, 'the same text node');
    assert.equal(text.data, 'a!');
    stop();
  });

  it('is written as plain text by the server target and claimed with no node created', async () => {
    const serverSide = await loadCompiled(source, { pluginOptions: { generate: 'ssr' } });
    const client = await loadCompiled(source, { pluginOptions: { hydratable: true } });
    const html = server.renderToHydratableString(h(serverSide.List));
    assert.match(html, /<b>a<\/b>/, 'no markers around a plain field');
    const app = document.getElementById('app');
    app.innerHTML = html;
    __resetHydrationData();
    const before = new Set();
    const walk = (fn) => { const w = document.createTreeWalker(app, 0xFFFFFFFF); for (let n = w.nextNode(); n; n = w.nextNode()) fn(n); };
    walk((n) => before.add(n));
    const reports = [];
    const stop = hydrate(h(client.List), app, { onHydrationError: (r) => reports.push(r) });
    let created = 0;
    walk((n) => { if (!before.has(n)) created++; });
    assert.equal(created, 0);
    assert.deepEqual(reports, []);
    const text = app.querySelector('b').firstChild;
    client.items((prev) => prev.map((t) => (t.id === 1 ? { ...t, title: 'a!' } : t)));
    flushSync();
    assert.equal(app.querySelector('b').firstChild, text);
    assert.equal(text.data, 'a!');
    stop();
  });

  it('a field that is not text renders as a child, and an item whose field stops being text builds the row again', async () => {
    const { items, List } = await loadCompiled(`
      import { signal, h } from 'what-framework';
      export const items = signal([{ id: 1, title: 'a' }, { id: 2, title: h('i', null, 'b') }]);
      export function List() {
        return <ul>{items().map((t) => <li key={t.id}>{t.title}</li>)}</ul>;
      }
    `);
    const app = document.getElementById('app');
    app.textContent = '';
    const stop = mount(() => List(), app);
    assert.equal(app.querySelectorAll('li')[1].querySelector('i').textContent, 'b');
    const first = app.querySelector('li');
    items((prev) => prev.map((t) => (t.id === 1 ? { ...t, title: h('em', null, 'now an element') } : t)));
    flushSync();
    assert.equal(app.querySelector('li em').textContent, 'now an element');
    assert.notEqual(app.querySelector('li'), first, 'built again');
    stop();
  });
});
