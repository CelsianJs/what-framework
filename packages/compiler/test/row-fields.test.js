// A keyed row's fields: text its item cell writes when the row is handed
// another item, with no effect per field (what-core render.js _$field, and
// _$plain's row fields behind _$rowFields).
//
// A field is the row's only while what it belongs to lives exactly as long as
// the row: the row's own template, or a component with only components
// between it and the row. Anything that can go before the row (a region of
// the row that runs again, an inner list's row, a component that failed while
// the row was built) is an effect instead, which goes with its owner: a field
// there would be held, read and written until the row's next item.
//
// Replacing the item of such a row creates nothing: a field is read again
// through one reused tracking node.
import assert from 'node:assert/strict';
import { after, describe, it, test } from 'node:test';
import { installDOM } from '../../../test-utils/dom.js';
import { compileJSX } from '../../../test-utils/compile.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

const { document, cleanup } = installDOM();
after(cleanup);

const { h, mount, flushSync, computed, Suspense } = await import('what-framework');
const { __setDevToolsHooks } = await import('what-core/internal');

// Effects alive (created and not disposed), and how many were ever created
// and disposed.
const alive = new Set();
let created = 0;
let disposed = 0;
__setDevToolsHooks({
  onEffectCreate: (e) => { created++; alive.add(e); },
  onEffectDispose: (e) => { disposed++; alive.delete(e); },
});
after(() => __setDevToolsHooks(null));

function mounted(view) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const before = alive.size;
  const stop = mount(view, host);
  flushSync();
  return { host, stop, effects: () => alive.size - before };
}

const SOURCE = `
  import { signal, h, onCleanup, Show, use } from 'what-framework';
  export const rows = signal([]);
  export const inner = signal([]);
  export const open = signal(true);
  export const ids = signal([]);
  export const log = [];
  export let reads = 0;
  // An item whose label counts its reads.
  export const counted = (id, label) => ({ id, a: 1, b: 2, get label() { reads++; return label; } });
  export const grabbed = new Map();
  const grab = (name) => (el) => { grabbed.set(name, el); };

  function Row(props) {
    return <li class="row"><b>{props.item.label}</b><i>{props.item.a + props.item.b}</i></li>;
  }
  export function Rows() {
    return <ul>{rows().map((item) => <Row key={item.id} item={item} />)}</ul>;
  }

  // A component under a component under the row: still the row's.
  function Label(props) { return <b class="label">{props.item.label}</b>; }
  function Wraps(props) { return <li><Label item={props.item} /></li>; }
  export function Chained() {
    return <ul>{rows().map((item) => <Wraps key={item.id} item={item} />)}</ul>;
  }
  // An element among a component's children, in an inline row.
  function Box(props) { return <div class="box">{props.children}</div>; }
  export function InChildren() {
    return <ul>{rows().map((item) => <li key={item.id}><Box><b class="label">{item.label}</b></Box></li>)}</ul>;
  }

  // What goes before its row.
  function Detail(props) { return <em class="detail" ref={grab('detail' + props.item.id)}>{props.item.label}</em>; }
  export function BehindShow() {
    return <ul>{rows().map((item) => <li key={item.id}><Show when={open()}><Detail item={item} /></Show></li>)}</ul>;
  }
  export function BehindTernary() {
    return <ul>{rows().map((item) => <li key={item.id}>{open() ? <b class="cond" ref={grab('cond' + item.id)}>{item.label}</b> : null}</li>)}</ul>;
  }
  export function TernaryExpression() {
    return <ul>{rows().map((item) => <li key={item.id}>{open() ? <b class="cond" ref={grab('cond' + item.id)}>{item.label + '!'}</b> : null}</li>)}</ul>;
  }
  function InnerItem(props) { return <li class="inner" ref={grab('inner' + props.item.id)}><b>{props.group.label}</b><i>{props.item.label}</i></li>; }
  function Group(props) { return <section><ul>{inner().map((it) => <InnerItem key={it.id} item={it} group={props.group} />)}</ul></section>; }
  export function Groups() {
    return <div>{rows().map((g) => <Group key={g.id} group={g} />)}</div>;
  }
  export function InlineGroups() {
    return <div>{rows().map((g) => <section key={g.id}><ul>{inner().map((it) => <li class="inner" ref={grab('inner' + it.id)} key={it.id}><b>{g.label}</b><i>{it.label}</i></li>)}</ul></section>)}</div>;
  }

  // A row's component that shows a field, then suspends: an outer boundary
  // takes the suspension, and the row lives on with the retry.
  export let gate = null;
  export let release = null;
  export const closeGate = () => { gate = new Promise((resolve) => { release = resolve; }); };
  function Late(props) { return <li class="late" ref={grab('late')}><b>{props.item.label}</b>{use(gate)}</li>; }
  export function Lates() {
    return <ul>{rows().map((item) => <Late key={item.id} item={item} />)}</ul>;
  }

  // A field whose element lost its text node to other code.
  export function Emptied() {
    return <ul>{rows().map((item) => <li key={item.id}><b ref={grab('b' + item.id)}>{item.label}</b><i ref={grab('i' + item.id)}>{item.a + item.b}</i></li>)}</ul>;
  }

  // A field read that throws for the new item, in a list with no boundary.
  function Deep(props) { return <li class="deep"><b>{props.item.user.name}</b><i>{props.item.label}</i></li>; }
  export function Deeps() {
    return <ol>{rows().map((item) => <Deep key={item.id} item={item} />)}</ol>;
  }

  // Options whose text is their value, under a select with a value.
  export function Pick(props) {
    return <select value={props.value}><option>{props.x.label}</option><option>{props.y.label}</option></select>;
  }
  // A select in each row, its options' text fields of the row.
  function Chooser(props) {
    return <li><select value={props.pick}><option>{props.item.first}</option><option>{props.item.second}</option></select></li>;
  }
  export function Choosers() {
    return <ul>{rows().map((item) => <Chooser key={item.id} item={item} pick="b" />)}</ul>;
  }

  // Keyed vnode rows in a plain child.
  function Item(props) {
    log.push('built ' + props.id);
    onCleanup(() => log.push('gone ' + props.id));
    return h('li', {}, 'item ' + props.id);
  }
  function Holder(props) { return <ol>{props.data.list}</ol>; }
  export function VnodeRows() {
    return <Holder data={{ list: ids().map((id) => h(Item, { key: id, id })) }} />;
  }
`;
const mod = await loadCompiled(SOURCE);
const hydratable = await loadCompiled(`
  import { signal } from 'what-framework';
  export const tone = signal('k');
  export function Card(props) {
    return <p class="card">{props.a.x}{props.b.x}<b class={tone()}>{props.c.x}</b><i>{props.d.x}</i>tail</p>;
  }
  export const rows = signal([]);
  export const open = signal(true);
  export const grabbed = new Map();
  export function Cond() {
    return <ul>{rows().map((item) => <li key={item.id}>{open() ? <b class="cond" ref={(el) => { grabbed.set(item.id, el); }}>{item.label}</b> : null}</li>)}</ul>;
  }
`, { pluginOptions: { hydratable: true } });

// Loaded before any test is registered (see branch-memo-trees.test.js).

const text = (host, sel) => [...host.querySelectorAll(sel)].map((n) => n.textContent);
const R = (id, label) => ({ id, label, a: 1, b: 2 });
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();
  }
};
function captureErrors(run) {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  try { run(); } finally { console.error = original; }
  return errors;
}

describe('what the compiler writes in a keyed list\'s options', () => {
  const options = (code) => code.slice(code.indexOf('key:'));

  it('installs row fields for a row that renders a component, or holds an expression over its item', () => {
    assert.match(options(compileJSX('const A = (p) => <ul>{p.rows().map((r) => <Row key={r.id} item={r} />)}</ul>;')), /fields: _\$rowFields\(\)/);
    assert.match(options(compileJSX('const A = (p) => <ul>{p.rows().map((r) => <li key={r.id}>{r.a + r.b}</li>)}</ul>;')), /fields: _\$rowFields\(\)/);
    assert.match(options(compileJSX('const A = (p) => <ul>{p.rows().map((r) => <li key={r.id}><ui.Badge row={r} /></li>)}</ul>;')), /fields: _\$rowFields\(\)/);
    assert.match(options(compileJSX('const A = (p) => <ul><For each={p.rows} key={(r) => r.id}>{(r) => <Row item={r()} />}</For></ul>;')), /fields: _\$rowFields\(\)/);
  });

  it('and not for a row of elements whose children are single fields, calls or constants', () => {
    for (const row of ['<li key={r.id}>{r.label}</li>', '<li key={r.id}><b>{r.user.name}</b>{format(r.at)}{p.title}:{1 + 2}</li>', '<li key={r.id} class={r.done ? "done" : ""}>{r.label}</li>']) {
      const out = compileJSX(`const A = (p) => <ul>{p.rows().map((r) => ${row})}</ul>;`);
      assert.doesNotMatch(out, /_\$rowFields/, row);
    }
    assert.doesNotMatch(compileJSX('const A = (p) => <ul><For each={p.rows} key={(r) => r.id}>{(r) => <li>{r().label}</li>}</For></ul>;'), /_\$rowFields/);
    assert.doesNotMatch(compileJSX('const A = (p) => <ul><For each={p.rows}>{(r) => <Row item={r} />}</For></ul>;'), /_\$rowFields/, 'an unkeyed list has no item cell');
  });
});

test('the compiler marks a field that is not in the template its row\'s callback returns', () => {
  const out = compileJSX(`const A = (p) => <ul>{p.rows().map((r) => <li key={r.id}><b>{r.label}</b>{p.open() ? <i>{r.note}</i> : null}<Card><u>{r.title}</u></Card><ol>{p.inner().map((x) => <li key={x.id}>{r.name}{x.label}</li>)}</ol></li>)}</ul>;`);
  const call = (field) => out.split('\n').find((line) => line.includes('_$field(') && line.includes(`r.${field},`) || line.includes(`x.${field},`));
  // Built with the row, in its own template: bound with no check.
  assert.match(call('label'), /_f\$\d+\);$/);
  // In a region of the row, a component's children and an inner list's row:
  // bound only when what builds it lives as long as the row.
  for (const field of ['note', 'title', 'name']) assert.match(call(field), /_f\$\d+, 1\);$/, field);
  assert.match(out.split('\n').find((line) => line.includes('x.label,')), /_f\$\d+\);$/, 'the inner row\'s own field is direct');
  const hydratable = compileJSX('const A = (p) => <ul>{p.rows().map((r) => <li key={r.id}>{r.label}{p.open() ? <i>{r.note}</i> : null}</li>)}</ul>;', { pluginOptions: { hydratable: true } });
  assert.match(hydratable, /_\$hfield\([^\n]*r\.label, \d, _f\$\d+\);/);
  assert.match(hydratable, /_\$hfield\([^\n]*r\.note, \d, _f\$\d+, 1\);/);
});

describe('a field lives exactly as long as its row', () => {
  it('a component under the row\'s component, and an element among a component\'s children, are the row\'s', () => {
    mod.rows([R(1, 'one'), R(2, 'two')]);
    for (const View of [mod.Chained, mod.InChildren]) {
      const { host, stop, effects } = mounted(h(View, {}));
      assert.deepEqual(text(host, '.label'), ['one', 'two']);
      assert.equal(effects(), 1, 'only the list: no effect per field');
      mod.rows([R(1, 'uno'), mod.rows()[1]]);
      flushSync();
      assert.deepEqual(text(host, '.label'), ['uno', 'two']);
      assert.equal(effects(), 1);
      mod.rows([R(1, 'one'), mod.rows()[1]]);
      stop();
    }
  });

  it('a component behind <Show> in a row is an effect, and reads nothing once it is closed', () => {
    mod.open(true);
    mod.rows([mod.counted(1, 'one')]);
    const { host, stop, effects } = mounted(h(mod.BehindShow, {}));
    assert.deepEqual(text(host, '.detail'), ['one']);
    const whenOpen = effects();
    const detail = mod.grabbed.get('detail1');
    mod.open(false);
    flushSync();
    assert.equal(host.querySelector('.detail'), null);
    assert.ok(effects() < whenOpen, 'its binding was an effect, and went with it');
    const reads = mod.reads;
    mod.rows([mod.counted(1, 'uno')]);
    flushSync();
    assert.equal(mod.reads, reads, 'nothing of the closed component read the new item');
    assert.equal(detail.textContent, 'one', 'and its element was not written');
    mod.open(true);
    flushSync();
    assert.deepEqual(text(host, '.detail'), ['uno']);
    mod.rows([mod.counted(1, 'eins')]);
    flushSync();
    assert.deepEqual(text(host, '.detail'), ['eins'], 'built after its row, it follows the row as an effect');
    stop();
  });

  for (const [name, view, shown] of [['a field', 'BehindTernary', (s) => s], ['an expression', 'TernaryExpression', (s) => s + '!']]) {
    it(`${name} of an inline row inside a region of the row goes with the region's run`, () => {
      mod.open(true);
      mod.rows([mod.counted(1, 'one')]);
      const { host, stop, effects } = mounted(h(mod[view], {}));
      assert.deepEqual(text(host, '.cond'), [shown('one')]);
      const first = mod.grabbed.get('cond1');
      // Each run of the region builds the element again: nothing of an
      // earlier run may be left reading or written.
      for (let i = 0; i < 3; i++) {
        mod.open(false);
        flushSync();
        mod.open(true);
        flushSync();
      }
      const steady = effects();
      const reads = mod.reads;
      mod.rows([mod.counted(1, 'uno')]);
      flushSync();
      assert.deepEqual(text(host, '.cond'), [shown('uno')]);
      assert.equal(mod.reads - reads, 1, 'one read: the element that is shown');
      assert.equal(first.textContent, shown('one'), 'the first run\'s element was not written');
      assert.equal(effects(), steady);
      stop();
    });
  }

  for (const view of ['Groups', 'InlineGroups']) {
    it(`an inner list's row that shows the outer item is not the outer row's (${view})`, () => {
      mod.rows([mod.counted('g', 'G')]);
      mod.inner([R(1, 'one'), R(2, 'two')]);
      const { host, stop } = mounted(h(mod[view], {}));
      assert.deepEqual(text(host, '.inner'), ['Gone', 'Gtwo']);
      const removed = mod.grabbed.get('inner2');
      mod.inner([mod.inner()[0]]);
      flushSync();
      const reads = mod.reads;
      mod.rows([mod.counted('g', 'H')]);
      flushSync();
      assert.deepEqual(text(host, '.inner'), ['Hone']);
      assert.equal(mod.reads - reads, 1, 'the one inner row left read the new outer item');
      assert.equal(removed.textContent, 'Gtwo', 'the removed inner row was not written');
      stop();
    });
  }

  it('a row component that showed a field and then suspended leaves no field of the failed attempt', async () => {
    mod.closeGate();
    mod.rows([mod.counted(1, 'one')]);
    const { host, stop } = mounted(h(Suspense, { fallback: h('p', {}, 'wait') }, h(mod.Lates, {})));
    const attempt = mod.grabbed.get('late');
    assert.equal(attempt.querySelector('b').textContent, 'one', 'the attempt had shown the field before it suspended');
    mod.release('!');
    await tick();
    assert.deepEqual(text(host, '.late'), ['one!']);
    assert.notEqual(mod.grabbed.get('late'), attempt, 'the retry built the row\'s element again');
    const reads = mod.reads;
    mod.rows([mod.counted(1, 'uno')]);
    flushSync();
    assert.deepEqual(text(host, '.late'), ['uno!']);
    assert.equal(mod.reads - reads, 1, 'only the retry\'s binding read the new item');
    assert.equal(attempt.querySelector('b').textContent, 'one', 'the failed attempt was not written');
    stop();
  });
});

test('replacing the items of component rows creates and disposes no effect', () => {
  mod.rows(Array.from({ length: 50 }, (_, i) => R(i, 'row ' + i)));
  const { host, stop, effects } = mounted(h(mod.Rows, {}));
  assert.equal(effects(), 1, 'only the list');
  const before = [created, disposed];
  mod.rows(mod.rows().map((row, i) => (i % 10 === 0 ? { ...row, label: row.label + ' !!!', a: 5 } : row)));
  flushSync();
  assert.deepEqual([created, disposed], before, 'nothing was created or disposed for the five replaced items');
  assert.equal(text(host, '.row b')[10], 'row 10 !!!');
  assert.equal(text(host, '.row i')[10], '7');
  assert.equal(text(host, '.row b')[11], 'row 11');
  assert.equal(effects(), 1);
  stop();
});

test('a field whose element lost its text node gets one again', () => {
  mod.rows([R(1, 'one'), R(2, 'two')]);
  const { host, stop } = mounted(h(mod.Emptied, {}));
  assert.deepEqual(text(host, 'li'), ['one3', 'two3']);
  // Other code changed what the elements hold before their fields were ever
  // written again: emptied, and an element put there instead.
  const [b1, i1, b2] = ['b1', 'i1', 'b2'].map((name) => mod.grabbed.get(name));
  b1.textContent = '';
  i1.textContent = '';
  b2.textContent = '';
  b2.appendChild(document.createElement('wbr'));
  mod.rows([{ id: 1, label: 'uno', a: 5, b: 2 }, { id: 2, label: 'dos', a: 1, b: 2 }]);
  flushSync();
  assert.equal(b1.textContent, 'uno');
  assert.equal(i1.textContent, '7');
  assert.equal(b2.innerHTML, 'dos<wbr>', 'the field\'s text goes before what is there');
  stop();
});

test('a field read that throws for a new item, in a list with no boundary, is reported and leaves the other rows current', () => {
  const user = (id, name, label) => ({ id, user: { name }, label });
  mod.rows([user(1, 'ada', 'a'), user(2, 'bob', 'b'), user(3, 'cy', 'c')]);
  const { host, stop } = mounted(h(mod.Deeps, {}));
  assert.deepEqual(text(host, '.deep'), ['adaa', 'bobb', 'cyc']);
  const errors = captureErrors(() => {
    mod.rows([user(1, 'ada2', 'a2'), { id: 2, label: 'b2' }, user(3, 'cy2', 'c2')]);
    flushSync();
  });
  assert.equal(errors.length, 1, 'the failing read was reported once');
  assert.match(String(errors[0][0]), /Uncaught error in effect/);
  assert.deepEqual(text(host, '.deep'), ['ada2a2', 'bobb2', 'cy2c2'], 'the rows before and after it, and the row\'s other field, were written');
  mod.rows([mod.rows()[0], user(2, 'bob3', 'b3'), mod.rows()[2]]);
  flushSync();
  assert.deepEqual(text(host, '.deep'), ['ada2a2', 'bob3b3', 'cy2c2'], 'and the field is read again for its next item');
  stop();
});

test('a field held on a value that is not ready, twice, is rebound once when the values land', async () => {
  let landFirst;
  let landSecond;
  const first = computed(async () => new Promise((resolve) => { landFirst = resolve; }));
  const second = computed(async () => new Promise((resolve) => { landSecond = resolve; }));
  mod.rows([R(1, 'one')]);
  const { host, stop } = mounted(h(mod.Rows, {}));
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  try {
    mod.rows([{ id: 1, a: 1, b: 2, get label() { return first(); } }]);
    flushSync();
    mod.rows([{ id: 1, a: 1, b: 2, get label() { return second(); } }]);
    flushSync();
    assert.deepEqual(text(host, '.row b'), ['one'], 'the last text stays while the value is awaited');
    landFirst('first');
    await tick();
    landSecond('second');
    await tick();
    assert.deepEqual(text(host, '.row b'), ['second']);
    mod.rows([R(1, 'plain')]);
    flushSync();
    assert.deepEqual(text(host, '.row b'), ['plain']);
  } finally {
    console.error = original;
  }
  assert.deepEqual(errors, [], 'neither held read failed when it landed');
  stop();
});

describe('option text under a select with a value', () => {
  it('a value nothing reactive produced selects its option', () => {
    const { host, stop } = mounted(h(mod.Pick, { value: 'b', x: { label: 'a' }, y: { label: 'b' } }));
    assert.equal(host.querySelector('select').value, 'b');
    assert.equal(host.querySelector('select').selectedIndex, 1);
    stop();
  });

  it('a row field selects its option, when it is bound and when it is written', () => {
    mod.rows([{ id: 1, first: 'a', second: 'b' }]);
    const { host, stop, effects } = mounted(h(mod.Choosers, {}));
    const select = host.querySelector('select');
    assert.equal(effects(), 1, 'the option texts are fields: only the list is an effect');
    assert.equal(select.selectedIndex, 1, 'bound');
    mod.rows([{ id: 1, first: 'b', second: 'c' }]);
    flushSync();
    assert.equal(host.querySelector('select'), select);
    assert.equal(select.selectedIndex, 0, 'written: the option that now reads "b"');
    stop();
  });
});

test('keyed vnodes in a plain child are rows of the component the child belongs to', () => {
  mod.log.length = 0;
  mod.ids([1, 2]);
  const { host, stop } = mounted(h(mod.VnodeRows, {}));
  assert.deepEqual(text(host, 'li'), ['item 1', 'item 2']);
  assert.deepEqual(mod.log, ['built 1', 'built 2']);
  mod.ids([2, 1, 3]);
  flushSync();
  assert.deepEqual(text(host, 'li'), ['item 2', 'item 1', 'item 3']);
  assert.deepEqual(mod.log, ['built 1', 'built 2', 'built 3'], 'a key that stayed kept its row');
  mod.ids([3]);
  flushSync();
  assert.deepEqual(mod.log.slice(3).sort(), ['gone 1', 'gone 2']);
  stop();
  assert.deepEqual(mod.log.slice(5), ['gone 3'], 'and unmounting disposed the rest');
});

test('hydratable output mounted on the client places each plain child at its own placeholder', () => {
  hydratable.tone('k');
  const { host, stop } = mounted(h(hydratable.Card, { a: { x: 'A' }, b: { x: 'B' }, c: { x: 'C' }, d: { x: 'D' } }));
  const card = host.querySelector('.card');
  assert.equal(card.innerHTML.replace(/<!--.*?-->/g, ''), 'AB<b class="k">C</b><i>D</i>tail');
  hydratable.tone('m');
  flushSync();
  assert.equal(card.querySelector('b').className, 'm', 'the element after them was the one bound');
  stop();
});

test('hydratable output mounted on the client lets a field in a region of the row go with the region\'s run', () => {
  hydratable.open(true);
  hydratable.rows([R(1, 'one')]);
  const { host, stop } = mounted(h(hydratable.Cond, {}));
  assert.deepEqual(text(host, '.cond'), ['one']);
  const first = hydratable.grabbed.get(1);
  hydratable.open(false);
  flushSync();
  hydratable.open(true);
  flushSync();
  hydratable.rows([R(1, 'uno')]);
  flushSync();
  assert.deepEqual(text(host, '.cond'), ['uno']);
  assert.equal(first.textContent, 'one', 'the first run\'s element was not written');
  stop();
});
