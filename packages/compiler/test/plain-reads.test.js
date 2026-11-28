// A child that is an expression with no call in it (`{props.item.label}`,
// `{item.price * item.qty}`) is placed by _$plain, which reads it once before
// it decides how to keep it current: nothing at all for a value nothing
// reactive produced, a field of the list row for a value that came from the
// row's item alone, and an effect for anything else. A component per row,
// handed the item, therefore creates no effect per field it shows.
import assert from 'node:assert/strict';
import { after, describe, it, test } from 'node:test';
import { installDOM } from '../../../test-utils/dom.js';
import { compileJSX } from '../../../test-utils/compile.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

const { document, cleanup } = installDOM();
after(cleanup);

const { h, mount, flushSync, signal, computed, ErrorBoundary } = await import('what-framework');
const { settled } = await import('what-framework/testing');
const { __setDevToolsHooks } = await import('what-core/internal');

// Effects alive: created and not disposed.
const alive = new Set();
__setDevToolsHooks({
  onEffectCreate: (e) => alive.add(e),
  onEffectDispose: (e) => alive.delete(e),
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

const mod = await loadCompiled(`
  import { signal, Show } from 'what-framework';
  export const rows = signal([]);
  export const user = signal({ name: 'ada', reads: 0 });
  export const shown = signal(true);
  export let builds = 0;
  export let reads = 0;
  export const counted = (label) => ({ get label() { reads++; return label; } });

  function Row(props) {
    builds++;
    const open = signal(false);
    return <li class="row" onClick={() => open(true)}><b>{props.item.label}</b><i>{props.item.a + props.item.b}</i><u>{open() ? 'open' : 'shut'}</u></li>;
  }
  export function Rows() {
    return <ul>{rows().map((item) => <Row key={item.id} item={item} />)}</ul>;
  }

  export function Card(props) {
    return <p class="card">{props.item.label}/{props.item.missing}</p>;
  }
  // A prop that is JSX, read in an expression with no call in it.
  export const count = signal(1);
  export let slotBuilds = 0;
  function Counted2() {
    slotBuilds++;
    return <b>n={count()}</b>;
  }
  function Inspects({ toolbar }) {
    return <div class="slot">{toolbar ? toolbar : null}</div>;
  }
  export function Slotted() {
    return <Inspects toolbar={<Counted2 />} />;
  }
  export function Static() {
    return <Card item={{ label: 'fixed' }} />;
  }
  export function Counted() {
    return <Card item={counted('once')} />;
  }
  export function Live() {
    return <Card item={{ label: user().name }} />;
  }
  export function Waiting(props) {
    return <Card item={props.profile()} />;
  }

  export function Inline() {
    return <ul>{rows().map((item) => <li key={item.id}><b>{item.a + item.b}</b></li>)}</ul>;
  }

  function Cell(props) {
    return <b class="cell">{props.item.label}</b>;
  }
  export function Guarded() {
    return <ul>{rows().map((item) => <li key={item.id}><Show when={shown()}><Cell item={item} /></Show></li>)}</ul>;
  }

  function Risky(props) {
    return <b class="risky">{props.item.deep.label}</b>;
  }
  export function RiskyRows() {
    return <ul>{rows().map((item) => <Risky key={item.id} item={item} />)}</ul>;
  }
`);
const hydratable = await loadCompiled(`
  import { signal } from 'what-framework';
  export const rows = signal([]);
  function Row(props) {
    return <li><b>{props.item.label}</b></li>;
  }
  export function Rows() {
    return <ul>{rows().map((item) => <Row key={item.id} item={item} />)}</ul>;
  }
`, { pluginOptions: { hydratable: true } });

// Loaded before any test is registered (see branch-memo-trees.test.js).

describe('what the compiler emits', () => {
  const body = (code) => code.slice(code.indexOf('function Card'));

  it('places a read with no call by _$plain', () => {
    const out = body(compileJSX(`function Card(props) { return <p>{props.item.label}:{props.a + props.b}:{\`\${props.x}!\`}:{props.on ? 'y' : 'n'}</p>; }`));
    assert.match(out, /_\$plain\(_el\$0, \(\) => props\.item\.label, /);
    assert.match(out, /_\$plain\(_el\$0, \(\) => props\.a \+ props\.b, /);
    assert.match(out, /_\$plain\(_el\$0, \(\) => `\$\{props\.x\}!`, /);
    assert.match(out, /_\$plain\(_el\$0, \(\) => props\.on \? 'y' : 'n', /);
  });

  it('leaves a call, a bare name, a placed prop and JSX to _$insert', () => {
    const out = body(compileJSX(`function Card(props) { return <p>{props.count()}:{props.title}:{props.on ? <b>y</b> : null}:{format(props.at)}</p>; }`));
    assert.doesNotMatch(out, /_\$plain/);
    assert.match(out, /_\$insert\(_el\$0, \(\) => props\.count\(\)/);
  });

  it('emits _$hplain for hydratable output, with the hole\'s flag', () => {
    const out = body(compileJSX(`function Card(props) { return <p>{props.item.label}</p>; }`, { pluginOptions: { hydratable: true } }));
    assert.match(out, /_\$hplain\(_el\$0, \(\) => props\.item\.label, 3\)/);
  });

  it('places an inline row\'s expression over its item by _$plain, and one field still by _$field', () => {
    const out = compileJSX(`function List(props) { return <ul>{props.rows().map((row) => <li key={row.id}><i>{row.a + row.b}</i><b>{row.label}</b></li>)}</ul>; }`);
    assert.match(out, /_\$plain\(_el\$\d+, \(\) => _\$item\(_item\$0, "a"\)\.a \+ _\$item\(_item\$0, "b"\)\.b\)/);
    assert.match(out, /_\$field\(_el\$\d+, _item\$0, row\.label/);
  });
});

const text = (host, sel) => [...host.querySelectorAll(sel)].map((n) => n.textContent);
const click = (el) => el.dispatchEvent(new window.Event('click', { bubbles: true }));

test('a value nothing reactive produced is written once and keeps no effect', () => {
  const { host, stop, effects } = mounted(h(mod.Static, {}));
  assert.equal(host.querySelector('.card').textContent, 'fixed/');
  assert.equal(effects(), 0, 'no binding is kept for a prop that cannot change');
  stop();
});

test('the expression is read once when it is placed', () => {
  const before = mod.reads;
  const { host, stop } = mounted(h(mod.Counted, {}));
  assert.equal(host.querySelector('.card').textContent, 'once/');
  assert.equal(mod.reads - before, 1);
  stop();
});

test('a value a signal produced is an effect, and follows the signal', () => {
  mod.user({ name: 'ada' });
  const { host, stop, effects } = mounted(h(mod.Live, {}));
  assert.equal(host.querySelector('.card').textContent, 'ada/');
  assert.ok(effects() >= 1, 'the binding is an effect');
  mod.user({ name: 'grace' });
  flushSync();
  assert.equal(host.querySelector('.card').textContent, 'grace/');
  stop();
});

test('a read that needs an effect is read once when it is placed: that read is the effect\'s first run', () => {
  const n = signal(2);
  let runs = 0;
  let reads = 0;
  const doubled = computed(() => { runs++; return n() * 2; });
  const item = { get label() { reads++; return doubled(); } };
  const { host, stop } = mounted(h(mod.Card, { item }));
  assert.equal(host.querySelector('.card').textContent, '4/');
  assert.equal(reads, 1);
  assert.equal(runs, 1);
  n(5);
  flushSync();
  assert.equal(host.querySelector('.card').textContent, '10/');
  assert.equal(reads, 2);
  assert.equal(runs, 2);
  stop();
});

test('JSX a component is handed in a prop, read in an expression, is built once and stays live', () => {
  const { host, stop } = mounted(h(mod.Slotted, {}));
  assert.equal(host.querySelector('.slot').textContent, 'n=1');
  mod.user({ name: 'x' });
  mod.count(2);
  flushSync();
  assert.equal(host.querySelector('.slot').textContent, 'n=2', 'the JSX built for the prop kept its bindings');
  assert.equal(mod.slotBuilds, 1);
  stop();
});

test('a read of a value that is not ready yet is held, and shows it when it lands', async () => {
  let land;
  const profile = computed(async () => new Promise((resolve) => { land = resolve; }));
  const { host, stop } = mounted(h(mod.Waiting, { profile }));
  assert.equal(host.querySelector('.card').textContent, '/');
  land({ label: 'landed' });
  await settled();
  assert.equal(host.querySelector('.card').textContent, 'landed/');
  stop();
});

describe('a component per row, handed the item', () => {
  it('shows the item\'s fields with no effect per field, and follows a replaced item without rebuilding', () => {
    mod.rows([{ id: 1, label: 'one', a: 1, b: 2 }, { id: 2, label: 'two', a: 3, b: 4 }]);
    const { host, stop, effects } = mounted(h(mod.Rows, {}));
    assert.deepEqual(text(host, '.row b'), ['one', 'two']);
    assert.deepEqual(text(host, '.row i'), ['3', '7']);
    // The list's own effect, and each row's `open()` binding: nothing for the
    // four fields.
    assert.equal(effects(), 3);
    assert.equal(host.querySelector('ul').childNodes.length, 3, 'a row is its <li>: no marker comments');

    const builds = mod.builds;
    const first = host.querySelector('.row');
    click(first);
    flushSync();
    mod.rows([{ id: 1, label: 'uno', a: 10, b: 2 }, mod.rows()[1]]);
    flushSync();
    assert.deepEqual(text(host, '.row b'), ['uno', 'two']);
    assert.deepEqual(text(host, '.row i'), ['12', '7']);
    assert.equal(mod.builds, builds, 'no row component was built again');
    assert.equal(host.querySelector('.row'), first, 'the row kept its element');
    assert.equal(first.querySelector('u').textContent, 'open', 'and its state');
    assert.equal(effects(), 3);
    stop();
    assert.equal(effects(), 0);
  });

  it('becomes an effect when a field stops being text, and when its value comes to depend on a signal', () => {
    const label = signal('live');
    mod.rows([{ id: 1, label: 'one', a: 1, b: 1 }]);
    const { host, stop, effects } = mounted(h(mod.Rows, {}));
    const row = host.querySelector('.row');
    const builds = mod.builds;

    // Text to an element and back.
    const mark = document.createElement('mark');
    mark.textContent = 'el';
    mod.rows([{ id: 1, label: mark, a: 1, b: 1 }]);
    flushSync();
    assert.equal(row.querySelector('b').firstChild, mark);
    assert.equal(row.querySelector('b').childNodes.length, 1);
    mod.rows([{ id: 1, label: 'text again', a: 1, b: 1 }]);
    flushSync();
    assert.equal(row.querySelector('b').textContent, 'text again');
    assert.equal(row.querySelector('b').childNodes.length, 1);

    // A field whose getter reads a signal.
    mod.rows([{ id: 1, a: 1, get b() { return label(); } }]);
    flushSync();
    assert.equal(row.querySelector('i').textContent, '1live');
    label('later');
    flushSync();
    assert.equal(row.querySelector('i').textContent, '1later');
    mod.rows([{ id: 1, a: 2, b: 3 }]);
    flushSync();
    assert.equal(row.querySelector('i').textContent, '5');
    label('ignored');
    flushSync();
    assert.equal(row.querySelector('i').textContent, '5');

    assert.equal(mod.builds, builds, 'the row component was never built again');
    assert.equal(host.querySelector('.row'), row);
    stop();
    assert.equal(effects(), 0);
  });

  it('leaves a field alone once the component that showed it is gone', () => {
    mod.shown(true);
    mod.rows([{ id: 1, label: 'one' }]);
    const { host, stop } = mounted(h(mod.Guarded, {}));
    const cell = host.querySelector('.cell');
    assert.equal(cell.textContent, 'one');
    mod.shown(false);
    flushSync();
    assert.equal(host.querySelector('.cell'), null);
    mod.rows([{ id: 1, label: 'uno' }]);
    flushSync();
    assert.equal(cell.textContent, 'one', 'the removed cell is not written');
    mod.shown(true);
    flushSync();
    assert.equal(host.querySelector('.cell').textContent, 'uno');
    mod.rows([{ id: 1, label: 'eins' }]);
    flushSync();
    assert.equal(host.querySelector('.cell').textContent, 'eins', 'a cell built after its row follows it as an effect');
    stop();
  });

  it('hands an error from a re-read to the boundary above, keeps the other rows current, and reads again next time', () => {
    const caught = [];
    mod.rows([{ id: 1, deep: { label: 'a' } }, { id: 2, deep: { label: 'b' } }]);
    const { host, stop } = mounted(h(ErrorBoundary, { fallback: (error) => { caught.push(error.error ?? error); return h('em', {}, 'failed'); } }, h(mod.RiskyRows, {})));
    assert.deepEqual(text(host, '.risky'), ['a', 'b']);
    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args);
    try {
      mod.rows([{ id: 1 }, { id: 2, deep: { label: 'B' } }]);
      flushSync();
    } finally {
      console.error = original;
    }
    assert.equal(caught.length + errors.length > 0, true, 'the error was reported');
    if (caught.length === 0) {
      // No boundary took the rows down: the row after the failing one was
      // still written, and the failing field is read again for its next item.
      assert.deepEqual(text(host, '.risky'), ['a', 'B']);
      mod.rows([{ id: 1, deep: { label: 'A' } }, mod.rows()[1]]);
      flushSync();
      assert.deepEqual(text(host, '.risky'), ['A', 'B']);
    } else {
      assert.equal(host.querySelector('em').textContent, 'failed');
    }
    stop();
  });
});

test('an inline row\'s expression over its item follows a replaced item with no effect of its own', () => {
  mod.rows([{ id: 1, a: 1, b: 2 }, { id: 2, a: 3, b: 4 }]);
  const { host, stop, effects } = mounted(h(mod.Inline, {}));
  assert.deepEqual(text(host, 'b'), ['3', '7']);
  assert.equal(effects(), 1, 'only the list');
  const first = host.querySelector('li');
  mod.rows([{ id: 1, a: 5, b: 2 }, mod.rows()[1]]);
  flushSync();
  assert.deepEqual(text(host, 'b'), ['7', '7']);
  assert.equal(host.querySelector('li'), first);
  stop();
});

test('hydratable output mounted on the client binds the same way', () => {
  hydratable.rows([{ id: 1, label: 'one' }]);
  const { host, stop, effects } = mounted(h(hydratable.Rows, {}));
  assert.deepEqual(text(host, 'b'), ['one']);
  assert.equal(effects(), 1, 'only the list');
  hydratable.rows([{ id: 1, label: 'uno' }]);
  flushSync();
  assert.deepEqual(text(host, 'b'), ['uno']);
  stop();
});
