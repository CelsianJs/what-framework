// A component's alias of a prop (`const ev = props.ev;` then `{ev.label}`)
// is read as the prop where each read stands, the way a destructured prop
// is, so the JSX follows a new value from the parent (and a keyed row its
// replaced item). Anything else (a call, arithmetic, `let`) is read once.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { installDOM } from '../../../test-utils/dom.js';
import { compileJSX } from '../../../test-utils/compile.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

const { document, cleanup } = installDOM();
after(cleanup);

const { h, mount, flushSync, getDiagnostics, clearDiagnostics } = await import('what-framework');
const { hydrate } = await import('what-core/render');
const { renderToHydratableString } = await import('what-server');

const body = (code) => code.slice(code.indexOf('export function'));

const SOURCE = `
  import { signal } from 'what-framework';
  export const ev = signal({ label: 'a', item: { name: 'x' } });
  export const rows = signal([{ id: 1, label: 'one' }, { id: 2, label: 'two' }]);
  function Card(props) {
    const ev = props.ev;
    const item = ev.item;
    const first = props.ev.label.toUpperCase();
    return <p class="card" title={ev.label}>{ev.label}:{item.name}:{first}</p>;
  }
  function Row(props) {
    const ev = props.ev;
    return <li>{ev.label}</li>;
  }
  export function Page() {
    return <main><Card ev={ev()} /><ul>{rows().map((r) => <Row key={r.id} ev={r} />)}</ul></main>;
  }`;

// Loaded before any test is registered (see branch-memo-trees.test.js).
const mod = await loadCompiled(SOURCE);
const ssr = await loadCompiled(SOURCE, { pluginOptions: { generate: 'ssr' } });
const client = await loadCompiled(SOURCE, { pluginOptions: { hydratable: true } });

test('an alias of a prop is read as the prop; other initializers are read once', () => {
  const code = body(compileJSX(`export function Row(props) {
    const ev = props.ev;
    const item = ev.item;
    const deep = props.ev?.meta;
    const n = props.count * 2;
    const up = props.ev.label.toUpperCase();
    let l = props.ev;
    return <li title={ev.title}>{ev.label}:{item.name}:{deep?.x}:{n}:{up}:{l.label}</li>;
  }`));
  // Reads with no call in them are placed by _$plain (what-core render.js).
  assert.match(code, /_\$plain\(_el\$0, \(\) => props\.ev\.label/);
  assert.match(code, /_\$plain\(_el\$0, \(\) => props\.ev\.item\.name/, 'an alias of an alias');
  assert.match(code, /_\$plain\(_el\$0, \(\) => props\.ev\?\.meta\?\.x/, 'an optional chain');
  assert.match(code, /"title", props\.ev\.title/);
  assert.doesNotMatch(code, /const (ev|item|deep) =/, 'the aliases are gone');
  assert.match(code, /const n = props\.count \* 2;/, 'arithmetic is read once');
  assert.match(code, /const up = props\.ev\.label\.toUpperCase\(\);/, 'a call is read once');
  assert.match(code, /let l = props\.ev;/, '`let` is read once');
  const tag = body(compileJSX(`export function A(props) { const ui = props.ui; return <ui.Icon />; }`));
  assert.match(tag, /const ui = props\.ui;/, 'an alias used as a tag stays');
  const jsx = body(compileJSX(`export function A(props) { const kids = props.children; const panels = props.panels; return <div>{kids}{() => panels[props.at()]}</div>; }`));
  assert.match(jsx, /const kids = props\.children;/, 'children is JSX: its alias is the build read in the run');
  assert.match(jsx, /const panels = props\.panels;/, 'an alias indexed with a computed key is the build read in the run');
});

test('the JSX follows a new value from the parent, and a keyed row its replaced item', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const stop = mount(h(mod.Page, {}), host);
  const card = host.querySelector('.card');
  assert.equal(card.textContent, 'a:x:A');
  mod.ev({ label: 'b', item: { name: 'y' } });
  flushSync();
  assert.equal(host.querySelector('.card'), card, 'the same element');
  assert.equal(card.textContent, 'b:y:A', 'live reads follow; the call stays read once');
  assert.equal(card.title, 'b');
  const li = host.querySelector('li');
  mod.rows([{ id: 1, label: 'uno' }, { id: 2, label: 'two' }]);
  flushSync();
  assert.equal(host.querySelector('li'), li, 'the row is kept by its key');
  assert.equal(li.textContent, 'uno', 'and shows the replaced item');
  stop();
  host.remove();
});

test('the server render hydrates in place, with no mismatch, and the aliases stay live', () => {
  const html = renderToHydratableString(h(ssr.Page, {}));
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  const card = host.querySelector('.card');
  const li = host.querySelector('li');
  clearDiagnostics();
  const errors = [];
  hydrate(h(client.Page, {}), host, { onHydrationError: (e) => errors.push(e) });
  flushSync();
  assert.deepEqual(errors, []);
  assert.deepEqual(getDiagnostics().events.filter((e) => e.code === 'ERR_HYDRATION_MISMATCH'), []);
  assert.equal(host.querySelector('.card'), card);
  assert.equal(card.textContent, 'a:x:A');
  client.ev({ label: 'c', item: { name: 'z' } });
  client.rows([{ id: 1, label: 'uno' }, { id: 2, label: 'two' }]);
  flushSync();
  assert.equal(card.textContent, 'c:z:A');
  assert.equal(host.querySelector('li'), li);
  assert.equal(li.textContent, 'uno');
  host.remove();
});
