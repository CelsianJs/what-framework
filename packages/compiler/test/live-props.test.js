// Live props: a component prop whose value reads a signal is passed as a
// getter over the expression, so the component sees the current value
// wherever it reads it.
//
//   <Badge on={count() > 0} />     props.on follows count, as <b>{count() > 0}</b> does
//
// Before, the compiler passed the value read once and the runtime copied it,
// so a prop written the way React code writes it froze at its first value
// with no warning (the React-habits measurements of 2026-11-23). The
// component side reads a destructured prop where it is used
// (common.js deferPlacedProps), and a props read in JSX is a binding
// (reactivity.js isPropsRead), so destructuring keeps it live too. Spreads
// and rest elements keep the getters (render.js _$merge, _$omit).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { compileJSX } from '../../../test-utils/compile.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM('<!DOCTYPE html><html><head></head><body></body></html>');

const { h, mount, flushSync, hydrate, getDiagnostics, clearDiagnostics } = await import('../../core/src/index.js');
const { _$createComponent } = await import('../../core/src/render.js');
const { renderToString } = await import('../../server/src/index.js');

function host() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

// The DOM with What's own comment markers left out.
const text = (el) => el.innerHTML.replace(/<!--[^>]*-->/g, '');

async function mounted(source) {
  const mod = await loadCompiled(source);
  const el = host();
  const stop = mount(h(mod.App, {}), el);
  flushSync();
  return { mod, el, stop, html: () => text(el) };
}

const PRELUDE = `import { signal } from 'what-framework';
export const count = signal(0);
export const busy = signal(true);
`;

describe('live props: compiled output', () => {
  it('passes a prop that reads a signal as a getter, in an object with no prototype', () => {
    const out = compileJSX(`${PRELUDE}
      function Badge(props) { return <b>{props.on ? 'on' : 'off'}</b>; }
      export function App() { return <Badge on={count() > 0} />; }`);
    assert.match(out, /_\$createComponent\(Badge, \{\s*__proto__: null,\s*get on\(\) \{\s*return count\(\) > 0;\s*\}\s*\}/);
  });

  it('keeps names, literals, functions, ref and children as they are written', () => {
    const out = compileJSX(`${PRELUDE}
      function Box(props) { return <b>{props.children}</b>; }
      export function App() { const r = {}; return <Box n={count} s="x" f={() => count()} ref={r} k={1} />; }`);
    assert.doesNotMatch(out, /get |__proto__/, out);
    assert.match(out, /n: count,\s*s: "x",\s*f: \(\) => count\(\),\s*ref: r,\s*k: 1/);
  });

  it('passes a template literal whose holes read props or signals as a getter', () => {
    const out = compileJSX(`${PRELUDE}
      function Reveal(props) { return <b>{props.secret}</b>; }
      export function Row(props) { return <Reveal secret={\`s-\${props.name}\`} n={\`\${count()}\`} plain={\`static\`} />; }`);
    assert.match(out, /get secret\(\) \{\s*return `s-\$\{props\.name\}`;/, out);
    assert.match(out, /get n\(\) \{\s*return `\$\{count\(\)\}`;/, out);
    assert.match(out, /plain: `static`/, out);
  });

  it('merges spreads with _$merge, in source order', () => {
    const out = compileJSX(`${PRELUDE}
      function Inner(props) { return <b>{props.on ? 1 : 0}</b>; }
      export function Wrap(props) { return <Inner {...props} extra={count()} />; }`);
    assert.match(out, /_\$merge\(props, \{\s*__proto__: null,\s*get extra\(\)/);
  });

  it('reads a destructured prop where it is used', () => {
    const out = compileJSX(`
      export function Badge({ on, label = 'x', items = [] }) { return <b title={label}>{on ? 'Y' : 'N'}{items.length}</b>; }`);
    assert.match(out, /function Badge\(_props\)/);
    // A default that reads nothing of the component and calls nothing is made
    // once, when the component runs, and the prop is read where it is used.
    assert.match(out, /const _itemsDefault = \[\];/);
    assert.match(out, /\(_items = _props\.items\) === void 0 \? _itemsDefault : _items/);
    assert.doesNotMatch(out, /items = \[\]\s*\} = _props/);
    assert.match(out, /\(\) => _props\.on \? 'Y' : 'N'/);
  });

  it('reads a rest element with _$omit', () => {
    const out = compileJSX(`export function Button({ class: cls, ...rest }) { return <button class={cls} {...rest} />; }`);
    assert.match(out, /const rest = _\$omit\(_props, \["class"\]\);/);
  });
});

describe('live props: what a component sees', () => {
  it('a template literal prop follows the props and signals its holes read', async () => {
    const { mod, html } = await mounted(`${PRELUDE}
      function Leaf(props) { return <i>{props.label}</i>; }
      function Mid(props) { return <Leaf label={\`n=\${props.n}\`} />; }
      export function App() { return <Mid n={count()} />; }`);
    assert.equal(html(), '<i>n=0</i>');
    mod.count(3);
    flushSync();
    assert.equal(html(), '<i>n=3</i>');
  });

  it('a value prop follows the signal it reads, read as props.x', async () => {
    const { mod, html } = await mounted(`${PRELUDE}
      function Badge(props) { return <b class={props.on ? 'on' : 'off'}>{props.on ? 'on' : 'off'}{props.label}</b>; }
      export function App() { return <Badge on={count() > 0} label={'n' + count()} />; }`);
    assert.equal(html(), '<b class="off">offn0</b>');
    mod.count(2);
    flushSync();
    assert.equal(html(), '<b class="on">onn2</b>');
  });

  it('a destructured prop follows it too, and its default applies while the value is undefined', async () => {
    const { mod, html } = await mounted(`${PRELUDE}
      function Badge({ on, label = 'none' }) { return <b class={on ? 'on' : 'off'}>{on ? 'Y' : 'N'}{label}</b>; }
      export function App() { return <Badge on={count() > 0} label={count() > 1 ? 'two' : undefined} />; }`);
    assert.equal(html(), '<b class="off">Nnone</b>');
    mod.count(1);
    flushSync();
    assert.equal(html(), '<b class="on">Ynone</b>');
    mod.count(2);
    flushSync();
    assert.equal(html(), '<b class="on">Ytwo</b>');
  });

  it('a wrapper that forwards {...props} keeps them live', async () => {
    const { mod, html } = await mounted(`${PRELUDE}
      function Inner(props) { return <i>{props.on ? 'Y' : 'N'}{props.extra}</i>; }
      function Wrap(props) { return <Inner {...props} extra={'e' + count()} />; }
      export function App() { return <Wrap on={count() > 0} />; }`);
    assert.equal(html(), '<i>Ne0</i>');
    mod.count(1);
    flushSync();
    assert.equal(html(), '<i>Ye1</i>');
  });

  it('a rest element spread onto an element keeps them live', async () => {
    const { mod, html } = await mounted(`${PRELUDE}
      function Button({ class: cls, ...rest }) { return <button class={cls} {...rest}>go</button>; }
      export function App() { return <Button class="x" disabled={busy()} title={'t' + count()} />; }`);
    assert.equal(html(), '<button class="x" disabled="" title="t0">go</button>');
    mod.busy(false);
    mod.count(3);
    flushSync();
    assert.equal(html(), '<button class="x" title="t3">go</button>');
  });

  it('an accessor passed as a name stays the accessor', async () => {
    const { mod, html } = await mounted(`${PRELUDE}
      function Count(props) { return <b>{props.value()}</b>; }
      export function App() { return <Count value={count} />; }`);
    assert.equal(html(), '<b>0</b>');
    mod.count(4);
    flushSync();
    assert.equal(html(), '<b>4</b>');
  });

  it('a component keeps its state while a live prop changes', async () => {
    const { mod, el, html } = await mounted(`${PRELUDE}
      function Counter(props) {
        const clicks = signal(0);
        return <button onclick={() => clicks(clicks() + 1)}>{props.label}:{clicks()}</button>;
      }
      export function App() { return <Counter label={'c' + count()} />; }`);
    el.querySelector('button').click();
    flushSync();
    assert.equal(html(), '<button>c0:1</button>');
    mod.count(1);
    flushSync();
    assert.equal(html(), '<button>c1:1</button>', 'the component ran once: its own signal kept its value');
  });
});

describe('live props: a keyed row of components', () => {
  it('<Row item={item} /> shows an item replaced under its key, and keeps the row', async () => {
    const { mod, el, html } = await mounted(`import { signal } from 'what-framework';
      export const items = signal([{ id: 1, label: 'a' }, { id: 2, label: 'b' }]);
      export const selected = signal(0);
      function Row(props) { return <li class={props.isSelected ? 'on' : ''}>{props.item.label}</li>; }
      export function App() {
        return <ul>{items().map((item) => <Row key={item.id} item={item} isSelected={selected() === item.id} />)}</ul>;
      }`);
    assert.equal(html(), '<ul><li class="">a</li><li class="">b</li></ul>');
    const first = el.querySelector('li');
    mod.items([{ id: 1, label: 'A!' }, { id: 2, label: 'b' }]);
    flushSync();
    assert.equal(html(), '<ul><li class="">A!</li><li class="">b</li></ul>');
    assert.equal(el.querySelector('li'), first, 'the row kept its DOM');
    mod.selected(2);
    flushSync();
    assert.equal(html(), '<ul><li class="">A!</li><li class="on">b</li></ul>');
  });
});

describe('live props: hydration', () => {
  it('a server-rendered page adopts live props and follows them after hydrating', async () => {
    const source = `${PRELUDE}
      function Badge({ on, label = 'none' }) { return <p class={on ? 'on' : 'off'}>{label}<i>{on ? 'Y' : 'N'}</i></p>; }
      function Wrap(props) { return <Badge {...props} label={'L' + count()} />; }
      export function App() { return <main><Wrap on={count() > 0} /></main>; }`;
    const server = await loadCompiled(source, { pluginOptions: { generate: 'ssr' } });
    const client = await loadCompiled(source, { pluginOptions: { hydratable: true } });
    const el = host();
    el.innerHTML = renderToString(h(server.App, {}));
    assert.equal(text(el), '<main><p class="off">L0<i>N</i></p></main>');
    const p = el.querySelector('p');
    clearDiagnostics();
    hydrate(h(client.App, {}), el);
    flushSync();
    assert.deepEqual(getDiagnostics().events.filter((e) => /HYDRATION/.test(e.code)), []);
    assert.equal(el.querySelector('p'), p, 'the server node was adopted');
    client.count(1);
    flushSync();
    assert.equal(text(el), '<main><p class="on">L1<i>Y</i></p></main>');
  });
});

describe('live props: the runtime contract', () => {
  it('_$createComponent keeps the getters of a props object with no prototype, and copies any other', async () => {
    const { signal } = await import('../../core/src/reactive.js');
    const n = signal(1);
    const seen = [];
    function Probe(props) {
      seen.push(Object.getOwnPropertyDescriptor(props, 'n').get !== undefined);
      return h('b', null, () => props.n);
    }
    const el = host();
    // Created in a component body, which runs once and tracks nothing.
    const Root = () => [
      _$createComponent(Probe, { __proto__: null, get n() { return n(); } }, null),
      _$createComponent(Probe, { get n() { return n(); } }, null),
    ];
    mount(h(Root, {}), el);
    flushSync();
    assert.deepEqual(seen, [true, false]);
    assert.equal(text(el), '<b>1</b><b>1</b>');
    n(5);
    flushSync();
    assert.equal(text(el), '<b>5</b><b>1</b>', 'only the props object with no prototype is live');
    assert.equal(seen.length, 2, 'neither component ran again');
  });

  it('h() keeps the getters of a props object with no prototype', async () => {
    const { signal } = await import('../../core/src/reactive.js');
    const n = signal(1);
    const Probe = (props) => h('b', null, () => props.n);
    const el = host();
    mount(h(Probe, { __proto__: null, get n() { return n(); } }), el);
    flushSync();
    n(2);
    flushSync();
    assert.equal(text(el), '<b>2</b>');
  });
});
