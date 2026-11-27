// ERR_PROP_READ_ONCE for a value derived from a prop in the component body
// and shown in JSX: `function Title({ name }) { const label =
// name.toUpperCase(); return <h1>{label}</h1>; }` runs once, so `label` keeps
// the first name where React computes it again on every render. Reported once,
// at build time, in development. What the compiler reads where it is used, a
// read inside a function or JSX, a hook's seed, a route's params and a handle
// fetched once (an accessor, a spread, an object read for its fields) are not.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileJSX } from '../../../test-utils/compile.js';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

let file = 0;
function warnings(source, options = {}) {
  const warn = console.warn;
  const seen = [];
  console.warn = (...args) => seen.push(args.join(' '));
  try {
    compileJSX(source, { filename: `/proj/src/derived-${file++}.jsx`, ...options });
  } finally {
    console.warn = warn;
  }
  return seen.filter((w) => w.includes('ERR_PROP_READ_ONCE'));
}

const HOOKS = `import { useState, useSignal, useEffect, signal, untrack, For } from 'what-framework';\n`;

describe('ERR_PROP_READ_ONCE: a value derived from a prop in the body and shown in JSX', () => {
  it('reports it, naming the prop, the value and the fix', () => {
    const found = warnings(`export function Title({ name }) {
  const label = name.toUpperCase();
  return <h1>{label}</h1>;
}`);
    assert.equal(found.length, 1, found.join('\n'));
    assert.ok(found[0].includes('`name`, destructured from the props of <Title>'), found[0]);
    assert.ok(found[0].includes('`label` is computed from it in the component body and shown in JSX'), found[0]);
    assert.ok(found[0].includes('(`{name.toUpperCase()}`)') && found[0].includes('`const label = () => name.toUpperCase()`') && found[0].includes('(`{label()}`)'), found[0]);
    assert.match(found[0], /derived-\d+\.jsx:2:9/, 'names the declaration');
  });

  for (const [shape, source, name] of [
    ['a read of props.<key>', `export function Badge(props) { const cls = 'badge-' + props.tone; return <i class={cls} />; }`, 'props.tone'],
    ['a name destructured from the props in the body', `export function A(props) { const { name } = props; const upper = name.trim(); return <p>{upper}</p>; }`, 'name'],
    ['an alias of a destructured name', `export function A({ name }) { const label = name; return <p>{label}</p>; }`, 'name'],
    ['a field destructured from a prop', `export function Post({ post }) { const { title } = post; return <h1>{title}</h1>; }`, 'post'],
    ['a branch decided by a prop', `export function A({ expanded }) { const body = expanded ? <p>long</p> : <p>short</p>; return <div>{body}</div>; }`, 'expanded'],
    ['a list filtered from a prop and mapped in JSX', `export function List({ items }) { const open = items.filter((i) => !i.done); return <ul>{open.map((i) => <li>{i.text}</li>)}</ul>; }`, 'items'],
    ['a list handed to <For>', `${HOOKS}export function List({ items }) { const open = items.filter((i) => !i.done); return <ul><For each={open}>{(i) => <li>{i.text}</li>}</For></ul>; }`, 'items'],
    ['a value shown by a thunk child', `export function A({ count }) { const twice = count * 2; return <p>{() => twice}</p>; }`, 'count'],
    ['a value shown in a list row', `export function A({ rows, unit }) { const suffix = ' ' + unit; return <ul>{rows.map((r) => <li>{r.n}{suffix}</li>)}</ul>; }`, 'unit'],
    ['a value handed to a component prop named like an event', `export function A({ status }) { const online = status === 'up'; return <Dot online={online} />; }\nfunction Dot(props) { return <i class={props.online ? 'on' : 'off'} />; }`, 'status'],
  ]) {
    it(`reports ${shape}`, () => {
      const found = warnings(source);
      assert.equal(found.length, 1, found.join('\n'));
      assert.ok(found[0].includes(`\`${name}\``), found[0]);
    });
  }
});

describe('ERR_PROP_READ_ONCE: what is not reported as a derived value', () => {
  for (const [shape, source] of [
    ['the expression written in JSX', `export function T({ name }) { return <h1>{name.toUpperCase()}</h1>; }`],
    ['a function, called in JSX', `export function T({ name }) { const label = () => name.toUpperCase(); return <h1>{label()}</h1>; }`],
    ['a read inside untrack', `${HOOKS}export function T({ name }) { const first = untrack(() => name); return <h1>{first}</h1>; }`],
    ['a read inside a callback', `const CHAPTERS = [];\nexport function T({ slug }) { const index = CHAPTERS.findIndex((c) => c.slug === slug); return <p>{index}</p>; }`],
    ['a read inside JSX', `export function T({ title }) { const heading = <h1>{title}</h1>; return <header>{heading}</header>; }`],
    ['a value used in an effect', `${HOOKS}export function T({ value }) { const start = value; useEffect(() => console.log(start)); return <p>{value}</p>; }`],
    ['a value used by a handler declared in the body', `export function T({ id }) { const url = '/api/' + id; const save = () => fetch(url); return <button onClick={save}>Save</button>; }`],
    ['a value used by an event handler in JSX', `export function T({ id }) { const url = '/api/' + id; return <button onClick={() => fetch(url)}>Save</button>; }`],
    ['a handler, a ref and a key', `export function T({ onPick, inputRef, id }) { const pick = onPick || (() => {}); const ref = inputRef ?? null; const k = 'row-' + id; return <li key={k}><input ref={ref} onclick={pick} /></li>; }`],
    ['state seeded from a prop', `${HOOKS}export function T({ initial, value }) { const [draft, setDraft] = useState(initial); const text = useSignal(value); const n = signal(value); return <p>{draft()}{text()}{n()}</p>; }`],
    ['an alias the compiler reads where it is used', `export function T(props) { const label = props.name; const city = props.address.city; return <p>{label}{city}</p>; }`],
    ['a name destructured from the props', `export function T(props) { const { name } = props; return <p>{name}</p>; }`],
    ['a route page reading its params, query and route', `export function User({ params, query }) { const id = params.id; const tab = query.tab ?? 'info'; return <h1>{id}{tab}</h1>; }\nexport function Page(props) { const id = props.params.id; const path = props.route.path; return <p>{id}{path}</p>; }`],
    ['children', `export function T({ children }) { const items = Array.isArray(children) ? children : [children]; return <ul>{items}</ul>; }`],
    ['a component held in a name', `const icons = {};\nexport function T({ kind }) { const Icon = icons[kind]; return <Icon />; }`],
    ['what a function prop returns', `export function Card({ renderHeader, renderFooter, title }) { const header = renderHeader(); const footer = renderFooter?.(); return <article>{header}<h2>{title}</h2>{footer}</article>; }`],
    ['what a render function in props returns', `export function Card(props) { const header = props.renderHeader(props.title); return <article>{header}</article>; }`],
    ['an accessor fetched once', `const draftOf = () => signal('');\nexport function T({ slug }) { const draft = draftOf(slug); return <textarea value={draft()} />; }`],
    ['an accessor fetched once and handed on', `const listOf = () => signal([]);\nexport function T({ id }) { const list = listOf(id); return <div><Row list={list} />{list().length}</div>; }\nfunction Row(props) { return <p>{props.list().length}</p>; }`],
    ['a method destructured from a prop', `export function T({ form }) { const { register } = form; return <input {...register('name')} />; }`],
    ['props a helper made once, spread', `export function T({ form, id }) { const field = form.register('since-' + id); return <input {...field} />; }`],
    ['an object read for its fields', `const cards = {};\nexport function Card({ id }) { const card = cards[id]; return <b>{card.title}</b>; }`],
    ['a lower-case helper', `export function helper({ name }) { const label = name.toUpperCase(); return <h1>{label}</h1>; }`],
    ['a list row', `export function A({ rows }) { return <ul>{rows.map(({ name }) => { const up = name.toUpperCase(); return <li>{up}</li>; })}</ul>; }`],
  ]) {
    it(shape, () => {
      assert.deepEqual(warnings(source), []);
    });
  }

  it('a production build reports nothing', () => {
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      assert.deepEqual(warnings(`export function T({ name }) { const label = name.toUpperCase(); return <h1>{label}</h1>; }`, { production: true }), []);
    } finally {
      process.env.NODE_ENV = env;
    }
  });
});

describe('ERR_PROP_READ_ONCE: the reported value is stale, the fix follows the prop', () => {
  const { document, cleanup } = installDOM();
  after(cleanup);

  it('shows the first name, and the function form the current one', async () => {
    const { h, mount, flushSync, signal } = await import('what-framework');
    const warn = console.warn;
    console.warn = () => {};
    let mod;
    try {
      mod = await loadCompiled(`export function Stale({ name }) { const label = name.toUpperCase(); return <b>{label}</b>; }
export function Live({ name }) { const label = () => name.toUpperCase(); return <i>{label()}</i>; }
export function App({ name }) { return <p><Stale name={name()} /><Live name={name()} /></p>; }`, { filename: '/proj/src/derived-runtime.jsx' });
    } finally {
      console.warn = warn;
    }
    const name = signal('ada');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const stop = mount(h(mod.App, { name }), host);
    flushSync();
    assert.equal(host.textContent, 'ADAADA');
    name('grace');
    flushSync();
    assert.equal(host.querySelector('b').textContent, 'ADA', 'the value derived in the body keeps the first name');
    assert.equal(host.querySelector('i').textContent, 'GRACE', 'the suggested function follows the prop');
    stop();
    host.remove();
  });
});

// A keyed .map() row hands a component its item (`<Row key={item.id}
// item={item} />`), and a field its body reads (`item.title`) is recorded:
// the row is built again when that field changes, so a value derived from it
// is never stale there. Which components are rows is known only where they
// render, so a development build with devMetadata (what-compiler/vite) leaves
// a value derived only from fields of props to the page: the read reports
// ERR_PROP_READ_ONCE unless it read a field of the row's item.
describe('ERR_PROP_READ_ONCE: a value derived from a field of a keyed row\'s item', () => {
  let env;
  before(() => { env = installDOM(); });
  after(() => env.cleanup());
  const ROW = `import { signal } from 'what-framework';
export const items = signal([{ id: 1, title: 'ada' }]);
export const picked = signal({ id: 2, title: 'grace' });
function Row({ item }) {
  const label = item.title.toUpperCase();
  return <li>{label}</li>;
}
function Card(props) {
  const heading = 'card ' + props.item.title;
  return <b>{heading}</b>;
}
`;
  const DEV = { devMetadata: true, projectRoot: '/proj' };

  async function render(app, name) {
    const { h, mount, flushSync, clearDiagnostics, getDiagnostics } = await import('what-framework');
    const warn = console.warn;
    const warned = [];
    console.warn = (...args) => warned.push(args.join(' '));
    const host = document.createElement('div');
    let mod;
    let stop;
    try {
      mod = await loadCompiled(ROW + app, { filename: `/proj/src/${name}.jsx`, pluginOptions: DEV });
      clearDiagnostics();
      document.body.appendChild(host);
      stop = mount(h(mod.App, {}), host);
      flushSync();
    } finally {
      console.warn = warn;
    }
    const reported = () => getDiagnostics().events.filter((e) => e.code === 'ERR_PROP_READ_ONCE');
    return { mod, host, flushSync, reported, warned: warned.filter((w) => w.includes('[what-compiler] ERR_PROP_READ_ONCE')), stop: () => { stop(); host.remove(); } };
  }

  it('is not reported in a row, where a change of the field builds the row again', async () => {
    const r = await render(`export function App() { return <ul>{items().map((item) => <Row key={item.id} item={item} />)}{items().map((item) => <Card key={item.id} item={item} />)}</ul>; }`, 'rows');
    try {
      assert.deepEqual(r.warned, [], 'nothing at build time');
      assert.deepEqual(r.reported(), [], 'nothing on the page');
      r.mod.items([{ id: 1, title: 'lovelace' }]);
      r.flushSync();
      assert.equal(r.host.textContent, 'LOVELACEcard lovelace');
      assert.deepEqual(r.reported(), []);
    } finally {
      r.stop();
    }
  });

  it('is reported where the component is no row, when it reads the prop', async () => {
    const r = await render(`export function App() { return <div><Row item={picked()} /><Card item={picked()} /></div>; }`, 'single');
    try {
      assert.deepEqual(r.warned, []);
      const found = r.reported().map((e) => [e.data.component, e.data.name, e.loc]);
      assert.deepEqual(found, [['Row', 'item', 'src/single.jsx:5:9'], ['Card', 'props.item', 'src/single.jsx:9:9']]);
      r.mod.picked({ id: 2, title: 'hopper' });
      r.flushSync();
      assert.equal(r.host.textContent, 'GRACEcard grace', 'the value it reports is stale');
    } finally {
      r.stop();
    }
  });

  it('is not reported where the prop reads nothing reactive, as its value cannot change', async () => {
    const r = await render(`const ROOTS = [{ id: 3, title: 'hopper' }];
const pinned = { item: { id: 4, title: 'liskov' } };
export function App() { return <div><Row item={ROOTS[0]} /><Card item={pinned.item} /></div>; }`, 'constant');
    try {
      assert.deepEqual(r.warned, []);
      assert.deepEqual(r.reported(), []);
      assert.equal(r.host.textContent, 'HOPPERcard liskov');
    } finally {
      r.stop();
    }
  });

  it('is reported once a prop that reads a signal reaches the component that a constant reached first', async () => {
    const r = await render(`const ROOTS = [{ id: 3, title: 'hopper' }];
export function App() { return <div><Row item={ROOTS[0]} /><Row item={picked()} /></div>; }`, 'mixed');
    try {
      assert.deepEqual(r.reported().map((e) => [e.data.component, e.loc]), [['Row', 'src/mixed.jsx:5:9']]);
    } finally {
      r.stop();
    }
  });

  it('is reported at build time without devMetadata, as no page can tell', () => {
    const found = warnings(`${ROW}export function App() { return <ul>{items().map((item) => <Row key={item.id} item={item} />)}</ul>; }`);
    assert.equal(found.length, 2, found.join('\n'));
  });
});
