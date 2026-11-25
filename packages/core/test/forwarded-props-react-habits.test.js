// Props forwarded the way React code forwards them follow the parent's state.
//
// Each case is a shape a React developer writes by habit, and each kept the
// first value (or the first DOM) when the parent's state changed:
// - `<a {...rest} href="/x" />`: the spread's live `href` overwrote the
//   attribute written after it;
// - a handler handed through a rest (`<button {...rest} />`): the first
//   handler stayed bound;
// - `children={label()}` through three wrappers that forward their rest;
// - `const merged = { ...rest, className: 'fixed' }; <a {...merged} />`;
// - an accessor callback over a prop (`read={() => props.project}`) returned
//   an internal forwarding function instead of the value;
// - a keyed row rendering its cell through a callback (`{renderCell(item)}`)
//   hands the callback the raw item, as React does; a row that wants the
//   cell's nodes kept across a refetch hands it a live view (`live()`);
// - a key that reads the index (`key={`${t.term}-${i}`}`) fell back to a
//   list built again on every update, with a warning.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

const { cleanup } = installDOM();
after(cleanup);

const { mount, flushSync } = await import('what-framework');

const warnings = [];
const warn = console.warn;
console.warn = (...args) => warnings.push(args.join(' '));
const mod = await loadCompiled(`
  import { signal, live } from 'what-framework';
  export const on = signal(false);
  const label = () => (on() ? 'second' : 'first');
  export const calls = [];

  const After = ({ unused, ...rest }) => <a id="after" {...rest} href="/override" className="mine" />;
  const AfterLive = ({ unused, ...rest }) => <a id="after-live" {...rest} href={'/own-' + label()} />;
  const Before = ({ unused, ...rest }) => <a id="before" href="/override" {...rest} />;
  const Handler = ({ unused, ...rest }) => <button id="handler" {...rest} />;
  const Deep3 = ({ unused, ...rest }) => <a id="deep" {...rest} />;
  const Deep2 = ({ unused, ...rest }) => <Deep3 {...rest} />;
  const Deep1 = ({ unused, ...rest }) => <Deep2 {...rest} />;
  const Merged = ({ unused, ...rest }) => {
    const merged = { ...rest, className: 'fixed' };
    return <a id="merged" {...merged} title={merged.title} />;
  };
  const Inline = (props) => <a id="inline" {...{ ...props, rel: 'x' }} />;
  const Child = (props) => <i id="read">{String(props.read())}</i>;
  const Reader = (props) => <Child read={() => props.project} />;
  const Destructured = ({ project }) => <Child read={() => project} />;

  export function App() {
    return <main>
      <After href={'/' + label()} className={label()} />
      <AfterLive href={'/' + label()} />
      <Before href={'/' + label()} />
      <Handler onClick={on() ? () => calls.push('new') : () => calls.push('old')}>{label()}</Handler>
      <Deep1 href={'/' + label()} children={label()} />
      <Merged href={'/' + label()} className={label()} title={label()} />
      <Inline href={'/' + label()} />
      <Reader project={label()} />
      <p id="read2"><Destructured project={label()} /></p>
    </main>;
  }

  export const rows = signal([{ id: 1, name: 'a' }, { id: 2, name: 'b' }]);
  export const received = [];
  const renderCell = (item) => { received.push(item); return <span class="cell">{item.name}</span>; };
  const Cell = ({ item }) => <span class="cell">{item.name}</span>;
  const columns = [{ key: 'name', render: (row) => <em>{row.name}</em> }];
  export function Rows() {
    return <section>
      <div id="raw">{rows().map((item) => <div key={item.id}>{renderCell(item)}</div>)}</div>
      <div id="opt-in">{rows().map((item) => <div key={item.id}>{renderCell(live(() => item))}</div>)}</div>
      <div id="component">{rows().map((item) => <div key={item.id}><Cell item={item} /></div>)}</div>
      <table><tbody id="columns">{rows().map((row) => {
        const liveRow = live(() => row);
        return <tr key={row.id}>{columns.map((col) => <td key={col.key}>{col.render ? col.render(liveRow) : row[col.key]}</td>)}</tr>;
      })}</tbody></table>
    </section>;
  }

  export const terms = signal([{ term: 'x', n: 1 }, { term: 'y', n: 2 }]);
  export function Terms() {
    return <ul id="terms">{terms().map((item, i) => <li key={\`\${item.term}-\${i}\`}>{item.term}{item.n}</li>)}</ul>;
  }
`);
console.warn = warn;

function host(build) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const stop = mount(build(), el);
  flushSync();
  return { el, stop: () => { stop(); el.remove(); } };
}

// The App, mounted for `check` and torn down after it, its state put back.
function withApp(check) {
  mod.on(false);
  flushSync();
  const { el, stop } = host(mod.App);
  try {
    check(el);
  } finally {
    stop();
    mod.on(false);
    flushSync();
  }
}

test('an attribute written after a spread wins over the spread, as in React', () => withApp((el) => {
  const attrs = () => [el.querySelector('#after').getAttribute('href'), el.querySelector('#after').className,
    el.querySelector('#after-live').getAttribute('href'), el.querySelector('#before').getAttribute('href')];
  assert.deepEqual(attrs(), ['/override', 'mine', '/own-first', '/first']);
  mod.on(true);
  flushSync();
  assert.deepEqual(attrs(), ['/override', 'mine', '/own-second', '/second'], 'the spread is written before the attributes after it');
}));

test('a handler handed through a rest is the parent\'s current handler', () => withApp((el) => {
  mod.calls.length = 0;
  el.querySelector('#handler').click();
  mod.on(true);
  flushSync();
  el.querySelector('#handler').click();
  assert.deepEqual(mod.calls, ['old', 'new'], 'one handler at a time, the latest');
}));

test('children forwarded through three rests stay live', () => withApp((el) => {
  assert.equal(el.querySelector('#deep').textContent, 'first');
  mod.on(true);
  flushSync();
  assert.equal(el.querySelector('#deep').textContent, 'second');
  assert.equal(el.querySelector('#deep').getAttribute('href'), '/second');
  assert.equal(el.querySelector('#deep').getAttribute('children'), null);
}));

test('an object built by spreading the rest keeps its live props', () => withApp((el) => {
  const merged = () => [el.querySelector('#merged').getAttribute('href'), el.querySelector('#merged').className, el.querySelector('#merged').title];
  assert.deepEqual(merged(), ['/first', 'fixed', 'first']);
  assert.equal(el.querySelector('#inline').getAttribute('href'), '/first');
  mod.on(true);
  flushSync();
  assert.deepEqual(merged(), ['/second', 'fixed', 'second']);
  assert.equal(el.querySelector('#inline').getAttribute('href'), '/second');
  assert.equal(el.querySelector('#inline').getAttribute('rel'), 'x');
}));

test('an accessor callback over a prop returns the prop\'s value', () => withApp((el) => {
  assert.equal(el.querySelector('#read').textContent, 'first');
  assert.equal(el.querySelector('#read2').textContent, 'first');
  mod.on(true);
  flushSync();
  assert.equal(el.querySelector('#read').textContent, 'second');
  assert.equal(el.querySelector('#read2').textContent, 'second');
}));

test('a render callback in a keyed row gets the raw item; a live() view keeps the cell\'s nodes', () => {
  mod.received.length = 0;
  const { el, stop } = host(mod.Rows);
  try {
    const raw = mod.received.filter((item) => mod.rows().includes(item));
    assert.equal(raw.length, 2, 'the callback is handed the very objects of rows(), not a view');
    assert.ok(raw.every((item, i) => item === mod.rows()[i] && Object.getPrototypeOf(item) === Object.prototype));
    const nodes = () => ['#opt-in .cell', '#component .cell', '#columns em'].map((s) => [...el.querySelectorAll(s)]);
    const first = nodes();
    mod.received.length = 0;
    const next = [{ id: 1, name: 'a2' }, { id: 2, name: 'b2' }];
    mod.rows(next);
    flushSync();
    assert.equal(el.querySelector('#raw').textContent, 'a2b2', 'the raw callback shows the new item');
    assert.ok(mod.received.filter((item) => next.includes(item)).length === 2, 'and is handed the new objects themselves');
    const after = nodes();
    assert.deepEqual(after.map((list) => list.map((n) => n.textContent).join()), ['a2,b2', 'a2,b2', 'a2,b2']);
    for (let i = 0; i < first.length; i++) {
      assert.ok(first[i].every((n, j) => n === after[i][j]), `${['live() written by hand', 'component', 'column render with live()'][i]}: the cell's nodes are kept`);
    }
  } finally {
    stop();
    mod.rows([{ id: 1, name: 'a' }, { id: 2, name: 'b' }]);
    flushSync();
  }
});

test('a key that reads the index is keyed by item and position, without a warning', () => {
  assert.deepEqual(warnings.filter((w) => w.includes('key=')), []);
  const { el, stop } = host(mod.Terms);
  const lis = () => [...el.querySelectorAll('#terms li')];
  const first = lis();
  assert.equal(el.textContent, 'x1y2');
  // A refetch: the same terms at the same places, new objects.
  mod.terms([{ term: 'x', n: 3 }, { term: 'y', n: 4 }]);
  flushSync();
  assert.equal(el.textContent, 'x3y4');
  assert.ok(lis().every((li, i) => li === first[i]), 'the rows are kept');
  // An item put in front: every key moves, as React keys them.
  mod.terms([{ term: 'w', n: 0 }, { term: 'x', n: 3 }, { term: 'y', n: 4 }]);
  flushSync();
  assert.equal(el.textContent, 'w0x3y4');
  stop();
});

test('a list keyed by the index hydrates the server\'s rows in place', async () => {
  const { h, hydrate } = await import('what-framework');
  const { renderToHydratableString } = await import('what-server');
  const source = `
    import { signal } from 'what-framework';
    export const terms = signal([{ term: 'x', n: 1 }, { term: 'y', n: 2 }]);
    export function View() {
      return <ul>{terms().map((item, i) => <li key={item.term + '-' + i}>{item.term}{item.n}<input /></li>)}</ul>;
    }
  `;
  const server = await loadCompiled(source, { pluginOptions: { generate: 'ssr' } });
  const client = await loadCompiled(source, { pluginOptions: { hydratable: true } });
  const el = document.createElement('div');
  el.innerHTML = await renderToHydratableString(h(server.View));
  document.body.append(el);
  const serverRows = [...el.querySelectorAll('li')];
  const reports = [];
  const stop = hydrate(h(client.View), el, { onHydrationError: (r) => reports.push(r) });
  try {
    flushSync();
    assert.deepEqual(reports, []);
    assert.ok([...el.querySelectorAll('li')].every((li, i) => li === serverRows[i]), 'the server\'s rows are adopted');
    client.terms([{ term: 'x', n: 5 }, { term: 'y', n: 6 }]);
    flushSync();
    assert.equal(el.textContent, 'x5y6');
    assert.ok([...el.querySelectorAll('li')].every((li, i) => li === serverRows[i]), 'a refetch keeps them');
  } finally {
    stop();
    el.remove();
  }
});

test('components written with h(), a factory\'s, a hook\'s and a class\'s render() read their props live', async () => {
  const shapes = await loadCompiled(`
    import { signal, h, memo } from 'what-framework';
    export const on = signal(false);
    const label = () => (on() ? 'second' : 'first');
    const Tabs = { Panel: ({ value }) => h('i', {}, () => value) };
    const Make = () => ({ value }) => h('i', {}, () => value);
    const Factory = Make();
    const Memo = memo(function ({ value }) { return h('i', {}, () => value); });
    function useLook({ value }) { return h('i', {}, () => value); }
    function HookLike() { return useLook({ get value() { return label(); } }); }
    class Cls { constructor(props) { this.props = props; } render() { const { value } = this.props; return <i>{value}</i>; } }
    export default ({ value }) => h('i', {}, () => value);
    export function make(Default) {
      return () => <p><Tabs.Panel value={label()} /><Factory value={label()} /><Memo value={label()} /><HookLike /><Cls value={label()} /><Default value={label()} /></p>;
    }
  `);
  const { el, stop } = host(shapes.make(shapes.default));
  try {
    const text = () => [...el.querySelectorAll('i')].map((i) => i.textContent);
    assert.deepEqual(text(), Array(6).fill('first'));
    shapes.on(true);
    flushSync();
    assert.deepEqual(text(), Array(6).fill('second'));
  } finally {
    stop();
  }
});
