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

test('a merge takes every source object spread takes: null, undefined, booleans, numbers and strings', async () => {
  const { _$merge } = await import('../src/render.js');
  for (const source of [null, undefined, false, true, 0, 1, NaN, 10n, '', 'ab', Symbol('s'), [1, 2], { id: 'x' }]) {
    assert.deepEqual({ ..._$merge({ a: 1 }, source) }, { a: 1, ...source }, String(source));
  }
  const conditional = await loadCompiled(`
    import { signal } from 'what-framework';
    export const show = signal(true);
    function Child({ show, ...rest }) {
      const merged = { ...rest, ...(!show && { id: 'conditional' }), ...(show && ''), ...null, ...undefined, ...7, ...true };
      return <p {...merged}>inside</p>;
    }
    export function View() { return <div><Child show={show()} title="valid" /></div>; }
  `);
  const { el, stop } = host(conditional.View);
  try {
    const p = el.querySelector('p');
    assert.equal(p.getAttribute('title'), 'valid');
    assert.equal(p.getAttribute('id'), null);
    assert.equal(p.textContent, 'inside');
  } finally {
    stop();
  }
});

test('a name destructured from this.props in render() and called is called with no receiver', async () => {
  const mod2 = await loadCompiled(`
    export const seen = [];
    function format() { return this === undefined ? 'detached' : 'bound'; }
    function tag() { return this === undefined ? 'detached' : 'bound'; }
    function Made() { seen.push(this instanceof Made ? 'new' : 'called'); }
    class Child {
      constructor(props) { this.props = props; }
      render() {
        const { format, tag, Made } = this.props;
        new Made();
        return <p>{format()}-{tag\`x\`}</p>;
      }
    }
    export function View() { return <div><Child format={format} tag={tag} Made={Made} /></div>; }
  `);
  const { el, stop } = host(mod2.View);
  try {
    assert.equal(el.textContent, 'detached-detached');
    assert.deepEqual(mod2.seen, ['new']);
  } finally {
    stop();
  }
});

test('across spreads and attributes, each name has one writer, the last in source order, and stays live', async () => {
  const mod3 = await loadCompiled(`
    import { signal } from 'what-framework';
    export const on = signal(false);
    export const calls = [];
    const a = () => calls.push('a'), b = () => calls.push('b'), own = () => calls.push('own');
    const Two = ({ u, ...rest }) => <button id="two" {...rest} {...{ title: 'last', onClick: b }} />;
    const Before = ({ u, ...rest }) => <button id="before" onClick={own} title="own" {...rest} />;
    const Case = ({ u, ...rest }) => <button id="case" {...rest} onclick={own} />;
    export function View() {
      return <div>
        <Two title={on() ? 't2' : 't1'} onClick={on() ? undefined : a} />
        <Before onClick={on() ? a : undefined} />
        <Case onClick={a} />
      </div>;
    }
  `);
  const { el, stop } = host(mod3.View);
  const click = (id) => { mod3.calls.length = 0; el.querySelector(id).click(); return mod3.calls.join(); };
  try {
    assert.equal(el.querySelector('#two').title, 'last');
    assert.equal(click('#two'), 'b', 'the later spread\'s handler only');
    assert.equal(click('#before'), '', 'a spread that holds onClick, undefined, replaces the attribute before it');
    assert.equal(el.querySelector('#before').title, 'own');
    assert.equal(click('#case'), 'own', '`onclick` after a spread\'s `onClick` is the one handler');
    mod3.on(true);
    flushSync();
    assert.equal(el.querySelector('#two').title, 'last', 'the earlier spread\'s live title does not win');
    assert.equal(click('#two'), 'b');
    assert.equal(click('#before'), 'a', 'the spread\'s live handler');
  } finally {
    stop();
    mod3.on(false);
    flushSync();
  }
});

test('spreads: the last writer of a name wins, its spelling aside; children, reshaped objects, class and XLink', async () => {
  const mod4 = await loadCompiled(`
    import { signal } from 'what-framework';
    export const on = signal(false);
    export const calls = [];
    const a = () => calls.push('a'), b = () => calls.push('b'), c = () => calls.push('c');
    const first = { children: 'first' };
    export const obj = signal({ title: 'x', id: '1' });
    export const bag = signal({ title: 'old', 'data-old': 'yes' });
    const Cls = ({ u, ...rest }) => <p id="cls" {...rest} {...{ className: 'fixed' }} />;
    export function View() {
      return <div>
        <button id="three" {...{ onClick: a }} {...{ onclick: b }} {...{ onClick: c }} />
        <svg><use id="ns" {...{ onClick: a }} {...{ onclick: b }} {...{ onClick: c }} xlink:href="#old" /></svg>
        <div id="kids" {...first} {...{ children: 'last' }} />
        <p id="one"><a {...obj()} /></p>
        <div id="merged" {...bag()} {...{ id: 'merged' }} />
        <Cls class={on() ? 'b' : 'a'} />
        <svg><use id="xl" {...{}} {...{}} xlinkHref={on() ? '#new' : '#old'} /><use id="xl2" xlinkHref={on() ? '#new' : '#old'} /></svg>
      </div>;
    }
  `);
  const XLINK = 'http://www.w3.org/1999/xlink';
  const { el, stop } = host(mod4.View);
  const click = (id) => { mod4.calls.length = 0; el.querySelector(id).dispatchEvent(new window.MouseEvent('click', { bubbles: true })); return mod4.calls.join(); };
  const attrs = (id) => Object.fromEntries([...el.querySelector(id).attributes].map((x) => [x.name, x.value]));
  try {
    assert.equal(click('#three'), 'c', 'onClick, onclick, onClick: the last');
    assert.equal(click('#ns'), 'c', 'a namespaced attribute beside them changes nothing');
    assert.equal(el.querySelector('#ns').getAttributeNS(XLINK, 'href'), '#old');
    assert.equal(el.querySelector('#kids').textContent, 'last', 'the last spread with children');
    assert.deepEqual(attrs('#one a'), { title: 'x', id: '1' });
    assert.equal(el.querySelector('#cls').className, 'fixed');
    for (const id of ['#xl', '#xl2']) assert.equal(el.querySelector(id).getAttributeNS(XLINK, 'href'), '#old', id);
    mod4.obj({ title: 'y', lang: 'en' });
    mod4.bag({ title: 'new', 'data-new': 'yes' });
    mod4.on(true);
    flushSync();
    assert.deepEqual(attrs('#one a'), { title: 'y', lang: 'en' }, 'a new object: changed, added and removed keys');
    assert.deepEqual(attrs('#merged'), { id: 'merged', title: 'new', 'data-new': 'yes' });
    assert.equal(el.querySelector('#cls').className, 'fixed', 'a live earlier class does not win over a later className');
    for (const id of ['#xl', '#xl2']) {
      assert.equal(el.querySelector(id).getAttributeNS(XLINK, 'href'), '#new', id);
      assert.equal(el.querySelector(id).hasAttribute('xlinkHref'), false, id);
    }
  } finally {
    stop();
    mod4.on(false);
    flushSync();
  }
});

// A spread read again (_$spreads with a function of its sources).
const mod5 = await loadCompiled(`
    import { signal } from 'what-framework';
    export const attrs = signal({ title: 'override' });
    export const field = signal({ value: 'a' });
    export const box = signal({ checked: true, type: 'checkbox' });
    export const html = signal('<b>one</b>');
    export const markup = signal(true);
    export const state = signal('x');
    export const refs = { a: { current: null }, b: { current: null } };
    export const which = signal('a');
    export const tick = signal(0);
    export let reads = 0;
    export const calls = [];
    const make = (s) => (s === 'x' ? { title: 'tx', 'data-x': '1' } : { title: 'ty', lang: 'en' });
    const stable = Object.create(null);
    for (let i = 0; i < 50; i++) Object.defineProperty(stable, 'data-k' + i, { get() { reads++; return 'v'; }, enumerable: true });
    export function View() {
      return <div>
        <p id="fb"><span title="fallback" {...attrs()} /></p>
        <input id="ctl" {...field()} />
        <input id="chk" {...box()} />
        <div id="html" {...(markup() ? { innerHTML: { __html: html() } } : {})} {...{}} />
        <div id="last-html" {...{ innerHTML: { __html: '<i>first</i>' } }} {...{ dangerouslySetInnerHTML: { __html: '<strong>last</strong>' } }} />
        <button id="mod" {...{ onClick: () => calls.push('a') }} {...{ onclick: () => calls.push('b') }} onblur__preventDefault={() => calls.push('blur')} />
        <p id="call"><span {...make(state())} /></p>
        <p id="ref"><span {...{ ref: refs[which()] }} /></p>
        <p id="perf"><span {...stable} {...{ 'data-t': String(tick()) }} /></p>
      </div>;
    }
`);

const settle5 = async () => { await Promise.resolve(); flushSync(); await Promise.resolve(); };
// The view mounted as a component, so what it binds has its owner (and goes on unmount).
async function withView(check) {
  const el = document.body.appendChild(document.createElement('div'));
  const unmount = mount(mod5.View, el);
  flushSync();
  let stopped = false;
  try {
    await check((s) => el.querySelector(s), () => { unmount(); stopped = true; });
  } finally {
    if (!stopped) unmount();
    el.remove();
  }
}

test('a static attribute before a spread read again shows again when the spread drops the name', () => withView((q) => {
  mod5.attrs({ title: 'override' });
  flushSync();
  assert.equal(q('#fb span').title, 'override');
  mod5.attrs({});
  flushSync();
  assert.equal(q('#fb span').title, 'fallback');
}));

test('value and checked from a spread read again are bound: an edit the state did not take is undone', () => withView(async (q) => {
  q('#ctl').value = 'typed';
  q('#ctl').dispatchEvent(new window.Event('input', { bubbles: true }));
  await settle5();
  assert.equal(q('#ctl').value, 'a');
  q('#chk').click();
  await settle5();
  assert.equal(q('#chk').checked, true);
  mod5.field({ value: 'b' });
  flushSync();
  assert.equal(q('#ctl').value, 'b', 'a new value is shown');
}));

test('innerHTML and dangerouslySetInnerHTML are one name, and a spread that drops it clears the markup', () => withView((q) => {
  mod5.markup(true);
  flushSync();
  assert.equal(q('#last-html').innerHTML, '<strong>last</strong>');
  assert.equal(q('#html').innerHTML, '<b>one</b>');
  mod5.markup(false);
  flushSync();
  assert.equal(q('#html').innerHTML, '');
}));

test('an event with modifiers on the element leaves the click\'s last writer alone', () => withView((q) => {
  mod5.calls.length = 0;
  q('#mod').click();
  assert.deepEqual(mod5.calls, ['b']);
}));

test('a spread of a call whose argument reads state is made again with the new keys', () => withView((q) => {
  mod5.state('x');
  flushSync();
  assert.deepEqual([q('#call span').title, q('#call span').getAttribute('data-x')], ['tx', '1']);
  mod5.state('y');
  flushSync();
  assert.deepEqual([q('#call span').title, q('#call span').getAttribute('data-x'), q('#call span').lang], ['ty', null, 'en']);
}));

test('a ref a spread no longer holds lets the element go, and so does the last one on unmount', () => withView((q, unmount) => {
  mod5.which('a');
  flushSync();
  assert.equal(mod5.refs.a.current, q('#ref span'));
  mod5.which('b');
  flushSync();
  assert.equal(mod5.refs.a.current, null);
  assert.equal(mod5.refs.b.current, q('#ref span'));
  unmount();
  assert.equal(mod5.refs.b.current, null);
}));

test('another source changing does not rebind a stable spread\'s getters', () => withView((q) => {
  const before = mod5.reads;
  for (let i = 1; i <= 20; i++) { mod5.tick(i); flushSync(); }
  assert.equal(q('#perf span').getAttribute('data-t'), '20');
  assert.equal(mod5.reads, before, 'no getter of the stable spread ran again');
}));

test('an attribute the element is made with (`multiple`) stays in the template beside a spread read again', async () => {
  const sel = await loadCompiled(`
    import { signal } from 'what-framework';
    export const v = signal(null);
    export const S = () => <select name="f" multiple {...{ value: v }}><option>a</option><option>b</option><option>c</option></select>;
    export const C = () => <select name="f" multiple value={v()}><option>a</option><option>b</option><option>c</option></select>;
  `);
  const runs = {};
  for (const name of ['S', 'C']) {
    const el = document.body.appendChild(document.createElement('div'));
    const stop = mount(sel[name], el);
    flushSync();
    const selected = () => [...el.querySelectorAll('option')].filter((o) => o.selected).map((o) => o.value).join();
    const seen = [selected()];
    for (const w of [['c'], ['a', 'b'], null, 'b', null]) { sel.v(w); flushSync(); seen.push(selected()); }
    runs[name] = seen;
    stop();
    el.remove();
    sel.v(null);
    flushSync();
  }
  assert.deepEqual(runs.S, ['', 'c', 'a,b', '', 'b', ''], 'through a spread');
  assert.deepEqual(runs.S, runs.C, 'as the attribute binds it');
});

// Spreads read again whose writers change kind, read getters, alias names or
// change a field's kind (verification 4).
const mod6 = await loadCompiled(`
  import { signal } from 'what-framework';
  export const enabled = signal(false), current = signal('acc-1'), title = signal('t1'), moving = signal('m1');
  export const multi = signal(true), picked = signal(['a', 'b']), type = signal('date');
  export const counts = { reads: 0 };
  const bag = { get title() { counts.reads++; return title(); } };
  const getBag = () => bag;
  export const View = () => <div>
    <input id="kind" {...{ value: enabled() ? current : 'literal' }} />
    <p id="same" {...getBag()} />
    <label id="for" {...{ htmlFor: moving() }} {...{ for: 'winner' }} />
    <i id="tab" {...{ tabIndex: moving() === 'm1' ? 1 : 2 }} {...{ tabindex: '7' }} />
    <select id="sel" {...{ multiple: multi(), value: picked() }}><option>a</option><option>b</option></select>
    <select id="sel2" {...{ value: picked(), multiple: multi() }}><option>a</option><option>b</option></select>
    <input id="type" {...{ type: type(), value: 'abc' }} />
  </div>;
`);

async function withView6(check) {
  const el = document.body.appendChild(document.createElement('div'));
  const unmount = mount(mod6.View, el);
  flushSync();
  try {
    await check((s) => el.querySelector(s));
  } finally {
    unmount();
    el.remove();
  }
}

test('a spread value that turns from a plain value into an accessor follows the accessor', () => withView6((q) => {
  mod6.enabled(false);
  flushSync();
  assert.equal(q('#kind').value, 'literal');
  mod6.enabled(true);
  flushSync();
  assert.equal(q('#kind').value, 'acc-1');
  mod6.current('acc-2');
  flushSync();
  assert.equal(q('#kind').value, 'acc-2');
  mod6.enabled(false);
  flushSync();
  assert.equal(q('#kind').value, 'literal', 'and back');
}));

test('a factory that hands back the same object: its getter is read once a run, and its new value shown', () => withView6((q) => {
  assert.equal(q('#same').title, mod6.title());
  const before = mod6.counts.reads;
  mod6.title(mod6.title() === 't1' ? 't2' : 't1');
  flushSync();
  assert.equal(q('#same').title, mod6.title());
  assert.equal(mod6.counts.reads - before, 1, 'one read for the update');
}));

test('htmlFor and for, tabIndex and tabindex are one name: the later writer keeps winning', () => withView6((q) => {
  assert.equal(q('#for').getAttribute('for'), 'winner');
  assert.equal(q('#tab').getAttribute('tabindex'), '7');
  mod6.moving(mod6.moving() === 'm1' ? 'm2' : 'm1');
  flushSync();
  assert.equal(q('#for').getAttribute('for'), 'winner');
  assert.equal(q('#tab').getAttribute('tabindex'), '7');
}));

test('a select whose multiple changes selects its value again, whichever is written first', () => withView6((q) => {
  const selected = (s) => [...q(s).options].filter((o) => o.selected).map((o) => o.value).join();
  for (const s of ['#sel', '#sel2']) assert.equal(selected(s), 'a,b', s);
  mod6.multi(false);
  flushSync();
  mod6.multi(true);
  flushSync();
  for (const s of ['#sel', '#sel2']) assert.equal(selected(s), 'a,b', `${s} after multiple went off and on`);
}));

test('an input whose type changes takes back the value its new type accepts', () => withView6((q) => {
  mod6.type('date');
  flushSync();
  mod6.type('text');
  flushSync();
  assert.equal(q('#type').value, 'abc');
}));
