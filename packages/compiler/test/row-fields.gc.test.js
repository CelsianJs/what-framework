// What a keyed row's fields retain. A field is held by the row's item cell
// until the row goes, so it may only belong to something that lives exactly
// as long as the row (what-core render.js bindRowField, _$field): anything
// that is disposed before the row (a region's run, an inner list's row, a
// component that failed while the row was built) must take nothing of the row
// with it, and nothing of it may stay reachable from the row.
//
// Elements are captured through ref callbacks: jsdom keeps an element
// reachable after a selector query found it.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

const { document, cleanup } = installDOM();
after(cleanup);

const { h, mount, flushSync, Suspense } = await import('what-framework');

async function assertCollected(ref, label) {
  assert.ok(ref, `${label}: nothing was captured`);
  for (let attempt = 0; attempt < 15; attempt++) {
    // WeakRef targets remain alive through the turn in which they were created
    // or dereferenced. Each collection must happen in a fresh turn.
    await nextTurn();
    globalThis.gc();
    if (ref.deref() === undefined) return;
  }
  assert.fail(`${label} is still reachable after forced collection on ${process.version}`);
}

const mod = await loadCompiled(`
  import { signal, Show, use } from 'what-framework';
  export const rows = signal([]);
  export const groups = signal([]);
  export const itemsOf = signal([]);
  export const open = signal(true);
  export const els = new Map();
  const keep = (name) => (el) => { els.set(name, new WeakRef(el)); };

  function Row(props) { return <li ref={keep('row' + props.item.id)}><b>{props.item.label}</b><i>{props.item.a + props.item.b}</i></li>; }
  export function List() { return <ul>{rows().map((item) => <Row key={item.id} item={item} />)}</ul>; }

  function Item(props) { return <li ref={keep('item' + props.item.id)}><b>{props.group.name}</b><i>{props.item.label}</i></li>; }
  function Group(props) { return <section><ul>{itemsOf().map((it) => <Item key={it.id} item={it} group={props.group} />)}</ul></section>; }
  export function Groups() { return <div>{groups().map((g) => <Group key={g.id} group={g} />)}</div>; }
  export function InlineGroups() { return <div>{groups().map((g) => <section key={g.id}><ul>{itemsOf().map((it) => <li ref={keep('item' + it.id)} key={it.id}><b>{g.name}</b><i>{it.label}</i></li>)}</ul></section>)}</div>; }

  function Detail(props) { return <em ref={keep('shown' + props.item.id)}>{props.item.label}</em>; }
  function RowWithShow(props) { return <li><Show when={open()}><Detail item={props.item} /></Show></li>; }
  export function ShowList() { return <ul>{rows().map((item) => <RowWithShow key={item.id} item={item} />)}</ul>; }
  function RowWithTernary(props) { return <li>{open() ? <Detail item={props.item} /> : null}</li>; }
  export function TernaryList() { return <ul>{rows().map((item) => <RowWithTernary key={item.id} item={item} />)}</ul>; }
  export function InlineField() { return <ul>{rows().map((item) => <li key={item.id}>{open() ? <b ref={keep('shown' + item.id)}>{item.label}</b> : null}</li>)}</ul>; }
  export function InlineExpression() { return <ul>{rows().map((item) => <li key={item.id}>{open() ? <b ref={keep('shown' + item.id)}>{item.label + '!'}</b> : null}</li>)}</ul>; }

  export let release;
  export const gate = new Promise((resolve) => { release = resolve; });
  let attempts = 0;
  function Late(props) { return <li ref={keep('attempt' + (++attempts))}><b>{props.item.label}</b>{use(gate)}</li>; }
  export function Lates() { return <ul>{rows().map((item) => <Late key={item.id} item={item} />)}</ul>; }
`);
const R = (id, label) => ({ id, label, a: 1, b: 2 });

function mountIn(view) {
  const host = document.body.appendChild(document.createElement('div'));
  const stop = mount(view, host);
  flushSync();
  return () => { stop(); host.remove(); };
}

test('a removed component row, and its item, are let go of while the list lives', async () => {
  let refs;
  let stop;
  (() => {
    mod.els.clear();
    mod.rows([R(1, 'one'), R(2, 'two'), R(3, 'three')]);
    stop = mountIn(h(mod.List, {}));
    refs = { li: mod.els.get('row2'), item: new WeakRef(mod.rows()[1]) };
    mod.rows([mod.rows()[0], mod.rows()[2]]);
    flushSync();
  })();
  try {
    await assertCollected(refs.li, 'the removed row\'s element');
    await assertCollected(refs.item, 'the removed row\'s item');
  } finally {
    stop();
  }
});

for (const view of ['Groups', 'InlineGroups']) {
  test(`an inner row that shows the outer row's item is let go of when it is removed (${view})`, async () => {
    let refs;
    let stop;
    (() => {
      mod.els.clear();
      mod.groups([{ id: 'g', name: 'G' }]);
      mod.itemsOf([R(1, 'one'), R(2, 'two'), R(3, 'three')]);
      stop = mountIn(h(mod[view], {}));
      refs = { li: mod.els.get('item2'), item: new WeakRef(mod.itemsOf()[1]) };
      mod.itemsOf([mod.itemsOf()[0], mod.itemsOf()[2]]);
      flushSync();
    })();
    try {
      await assertCollected(refs.li, 'the removed inner row\'s element, while its outer row lives with the same item');
      await assertCollected(refs.item, 'the removed inner row\'s item');
    } finally {
      stop();
    }
  });
}

for (const view of ['ShowList', 'TernaryList', 'InlineField', 'InlineExpression']) {
  test(`what a region of a row showed is let go of when the region runs again (${view})`, async () => {
    let ref;
    let stop;
    (() => {
      mod.els.clear();
      mod.open(true);
      mod.rows([R(1, 'one'), R(2, 'two')]);
      stop = mountIn(h(mod[view], {}));
      ref = mod.els.get('shown1');
      mod.open(false);
      flushSync();
    })();
    try {
      await assertCollected(ref, 'the element the closed region showed, while its row lives with the same item');
    } finally {
      stop();
    }
  });
}

test('the attempt of a row component that showed a field and then suspended is let go of once it is retried', async () => {
  let ref;
  let stop;
  await (async () => {
    mod.els.clear();
    mod.rows([R(1, 'one')]);
    stop = mountIn(h(Suspense, { fallback: h('p', {}, 'wait') }, h(mod.Lates, {})));
    ref = mod.els.get('attempt1');
    mod.release('!');
    for (let i = 0; i < 4; i++) {
      await nextTurn();
      flushSync();
    }
    assert.ok(mod.els.get('attempt2'), 'the component was rendered again');
  })();
  try {
    await assertCollected(ref, 'the element of the failed attempt, while its row lives with the same item');
  } finally {
    stop();
  }
});
