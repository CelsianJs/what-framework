// A key on a component outside a list row (`<Form key={user().id} />`) is
// React's way to start it again: a new instance whenever the key's value
// changes, the old one disposed (its cleanups run, its DOM removed), the new
// one run fresh in the same place, and the same value rebuilding nothing. An
// element with a key outside a list (`<input key={id()} />`) is built again
// the same way. Compiled output on both targets, behaviour in a DOM in every
// position the JSX can stand in, and a server render that hydrates with no
// mismatch and starts the component again after hydration when its key
// changes.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { installDOM } from '../../../test-utils/dom.js';
import { compileJSX } from '../../../test-utils/compile.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

const { document, cleanup } = installDOM();
after(cleanup);

const { h, mount, flushSync, getDiagnostics, clearDiagnostics } = await import('what-framework');
const { hydrate } = await import('what-core/render');
const { renderToHydratableString, renderToString } = await import('what-server');

const body = (code) => code.slice(code.indexOf('export function'));
const ssr = { pluginOptions: { generate: 'ssr' } };

const SOURCE = `
  import { signal, useState, onCleanup } from 'what-framework';
  export const id = signal(1);
  export const tone = signal('x');
  export const show = signal(true);
  export const rows = signal([{ id: 'a', v: 1 }, { id: 'b', v: 1 }]);
  export const log = { built: [], cleaned: [] };
  export function Edit(props) {
    const [first] = useState(props.seed);
    log.built.push(first());
    const [text, setText] = useState(props.seed);
    onCleanup(() => log.cleaned.push(first()));
    return <b class="e" data-tone={props.tone} onClick={() => setText(text() + '!')}>{text()}</b>;
  }
  function Card(props) { return <section class="card">{props.header}{props.children}</section>; }
  export function Root() { return <Edit key={id()} seed={'r' + id()} tone={tone()} />; }
  export function Frag() { return <><i>f</i><Edit key={id()} seed={'f' + id()} tone={tone()} /><i>g</i></>; }
  export function Field() { return <input class="i" key={id()} data-tone={tone()} />; }
  export function Page() {
    return (
      <main>
        <div class="child"><Edit key={id()} seed={'c' + id()} tone={tone()} />tail</div>
        <div class="root"><Root /></div>
        <div class="tern">{show() ? <Edit key={id()} seed={'t' + id()} tone={tone()} /> : <em>none</em>}</div>
        <div class="and">{show() && <Edit key={id()} seed={'a' + id()} tone={tone()} />}</div>
        <div class="frag"><Frag /></div>
        <div class="kids"><Card><Edit key={id()} seed={'k' + id()} tone={tone()} /></Card></div>
        <div class="slot"><Card header={<Edit key={id()} seed={'s' + id()} tone={tone()} />} /></div>
        <ul class="rows">{rows().map((r) => <li key={r.id}><Edit key={r.v} seed="v" tone={tone()} /></li>)}</ul>
        <div class="crow">{rows().map((r) => <Edit key={r.id} seed={r.id} tone={tone()} />)}</div>
        <p class="el-child"><input class="i" key={id()} data-tone={tone()} />tail</p>
        <p class="el-root"><Field /></p>
        <p class="el-arm">{show() ? <input class="i" key={id()} data-tone={tone()} /> : null}</p>
      </main>
    );
  }
`;

const POSITIONS = ['child', 'root', 'tern', 'and', 'frag', 'kids', 'slot'];
const FIELDS = ['el-child', 'el-root', 'el-arm'];

// Loaded before any test is registered: a top-level await between tests
// lets the root after() hook (the DOM's cleanup) run before the later ones.
const mod = await loadCompiled(SOURCE);
const server = await loadCompiled(SOURCE, ssr);
const client = await loadCompiled(SOURCE, { pluginOptions: { hydratable: true } });

// --- Compiled output ---

test('a key that cannot change costs nothing: the output is the unkeyed one', () => {
  const keyed = `const K = 'k'; export function A(p) { return <div><Edit key="a" x={p.x} />{p.on() ? <Edit key={K} /> : null}</div>; }`;
  // The same source without the keys, each at the same offset (a hydratable
  // component call carries the offset of its JSX).
  const plain = keyed.replace(/ key=("a"|\{K\})/g, (m) => ' '.repeat(m.length));
  for (const options of [{}, { pluginOptions: { hydratable: true } }, ssr]) {
    assert.equal(compileJSX(keyed, options), compileJSX(plain, options));
  }
  assert.doesNotMatch(compileJSX(keyed), /_\$keyed/);
});

test('a key that can change builds the component in a reactive child that reads it, on both targets', () => {
  const src = `import { signal } from 'what-framework';
    const id = signal(1);
    export function A(p) { return <div><Edit key={id()} x={1} /><Edit key={id} /><Edit key={p.user.id} /></div>; }`;
  const dom = body(compileJSX(src));
  assert.match(dom, /_\$insert\(_el\$\d+, _\$keyed\(\(\) => id\(\), \(\) => _\$createComponent\(Edit, \{\s*x: 1\s*\}, \[\]\)\)/);
  assert.match(dom, /_\$keyed\(\(\) => id\(\), \(\) => _\$createComponent\(Edit, null/, 'a name holding a signal is read, as an attribute reads one');
  assert.match(dom, /_\$keyed\(\(\) => p\.user\.id, /, 'a prop can change');
  assert.doesNotMatch(dom, /key:/, 'the key is never a prop');
  const server = body(compileJSX(src, ssr));
  assert.match(server, /_\$ssr\(_tmpl\$\d+, \(\) => _\$ssrLeaf\(Edit, \{\s*x: 1\s*\}[^)]*\), \(\) => _\$ssrLeaf\(Edit, null[^)]*\), \(\) => _\$ssrLeaf\(Edit/,
    'the server renders the function child the client builds, which a hydratable render brackets');

  const field = `import { signal } from 'what-framework';
    const id = signal(1);
    export function A(p) { return <p><b>a</b><input key={id()} value={p.v} /></p>; }`;
  assert.match(body(compileJSX(field)), /_\$insert\(_el\$\d+, _\$keyed\(\(\) => id\(\), \(\) => \{\s*const (_el\$\d+) = _tmpl\$\d+\(\);[\s\S]*?return \1;\s*\}\)/,
    'an element with such a key is built, bindings and all, in the function the key runs again');
  assert.match(compileJSX(field), /_\$template\("<p><b>a"\)/, "it is not part of its parent's template");
  assert.match(body(compileJSX(field, ssr)), /_\$ssr\(_tmpl\$\d+, \(\) => _\$ssr\(_tmpl\$\d+, p\.v\)\)/);
});

test("a list row's key stays the list's key; a key inside the row is the row's component's own", () => {
  const src = `export function A(p) {
    return <ul>
      {p.rows().map((r) => <Row key={r.id} item={r} />)}
      {p.rows().map((r) => <li key={r.id}><Edit key={r.v} /></li>)}
      <For each={p.rows()}>{(r) => <Row key={r().id} />}</For>
    </ul>;
  }`;
  const dom = body(compileJSX(src));
  assert.match(dom, /key: r => r\.id/);
  assert.equal((dom.match(/_\$keyed\(/g) || []).length, 1, 'only the component inside the row is keyed');
  assert.match(dom, /_\$keyed\(\(\) => _\$item\(_item\$\d+, "v"\)\.v, \(\) => _\$createComponent\(Edit/, 'it reads the row item through its cell');
  const server = body(compileJSX(src, ssr));
  assert.equal((server.match(/\(\) => _\$ssrLeaf\(Edit/g) || []).length, 1);
  assert.doesNotMatch(server, /\(\) => _\$ssrLeaf\(Row/);
});

// --- Behaviour ---

function reset(m) {
  m.id(1); m.tone('x'); m.show(true); m.rows([{ id: 'a', v: 1 }, { id: 'b', v: 1 }]);
  flushSync();
  m.log.built.length = 0;
  m.log.cleaned.length = 0;
}

const click = (el) => el.dispatchEvent(new document.defaultView.MouseEvent('click', { bubbles: true }));
const at = (host, position) => host.querySelector(`.${position} .e`);

// Every position: the key's change starts the component again there, a
// write that leaves its value as it was and a change of another prop do not.
function checkRestarts(m, host) {
  const before = Object.fromEntries(POSITIONS.map((p) => [p, at(host, p)]));
  for (const p of POSITIONS) click(before[p]);
  flushSync();
  for (const p of POSITIONS) assert.match(before[p].textContent, /!$/, `${p}: its state changed`);
  m.log.built.length = 0;

  m.id(1); m.tone('y'); flushSync();
  for (const p of POSITIONS) {
    assert.equal(at(host, p), before[p], `${p}: the same key keeps the instance`);
    assert.match(before[p].textContent, /!$/, `${p}: and its state`);
    assert.equal(before[p].getAttribute('data-tone'), 'y', `${p}: its live props follow`);
  }
  assert.deepEqual(m.log.built, []);
  assert.deepEqual(m.log.cleaned, []);

  m.id(2); flushSync();
  for (const p of POSITIONS) {
    const now = at(host, p);
    assert.notEqual(now, before[p], `${p}: a new key builds a new instance`);
    assert.equal(before[p].isConnected, false, `${p}: the old one's DOM is gone`);
    assert.equal(now.textContent, `${p[0]}2`, `${p}: the new one runs fresh, with its own state`);
  }
  assert.deepEqual([...m.log.cleaned].sort(), POSITIONS.map((p) => `${p[0]}1`).sort(), 'every old instance ran its cleanups');
  assert.deepEqual([...m.log.built].sort(), POSITIONS.map((p) => `${p[0]}2`).sort());
  assert.equal(host.querySelector('.child').textContent, 'c2tail', 'in the same place');
  assert.equal(host.querySelector('.frag').textContent, 'ff2g');
}

// An element with a key outside a list follows the same rule: a new key is a
// new element, what was typed in the old one gone.
function checkElements(m, host) {
  const field = (p) => host.querySelector(`.${p} .i`);
  const before = Object.fromEntries(FIELDS.map((p) => [p, field(p)]));
  for (const p of FIELDS) before[p].value = 'typed';
  m.id(2); m.tone('z'); flushSync();
  for (const p of FIELDS) {
    assert.equal(field(p), before[p], `${p}: the same key keeps the element`);
    assert.equal(field(p).value, 'typed', `${p}: and what was typed`);
    assert.equal(field(p).getAttribute('data-tone'), 'z', `${p}: its bindings follow`);
  }
  m.id(3); flushSync();
  for (const p of FIELDS) {
    assert.notEqual(field(p), before[p], `${p}: a new key builds a new element`);
    assert.equal(before[p].isConnected, false, `${p}: the old one is gone`);
    assert.equal(field(p).value, '', `${p}: the new one is fresh`);
    assert.equal(field(p).getAttribute('data-tone'), 'z');
  }
  assert.equal(host.querySelector('.el-child').lastChild.textContent, 'tail', 'in the same place');
}

// A row keeps its DOM while the list's key does, and the component in it
// starts again when its own key changes (a row whose component reads the item
// in its body is built again for a new item anyway, as without a key).
function checkRows(m, host) {
  const li = host.querySelector('.rows li');
  const inner = li.querySelector('.e');
  const crow = host.querySelector('.crow .e');
  click(inner);
  flushSync();
  assert.equal(li.textContent, 'v!');
  m.log.built.length = 0;
  m.log.cleaned.length = 0;
  m.rows([{ id: 'a', v: 1 }, { id: 'b', v: 1 }]); flushSync();
  assert.equal(li.querySelector('.e'), inner, 'a new item with the same inner key keeps the instance');
  m.rows([{ id: 'a', v: 2 }, { id: 'b', v: 1 }]); flushSync();
  assert.equal(host.querySelector('.rows li'), li, "the row stays while the list's key does");
  assert.notEqual(li.querySelector('.e'), inner, "the row's component starts again for its new key");
  assert.equal(li.textContent, 'v', 'fresh');
  assert.deepEqual(m.log.cleaned, ['v']);
  assert.equal(host.querySelector('.crow .e'), crow, 'a component row stays while its row key does');
  m.rows([{ id: 'b', v: 1 }, { id: 'a', v: 2 }]); flushSync();
  assert.equal(host.querySelector('.rows li:last-child'), li, 'a row moves with its key');
  assert.deepEqual([...host.querySelectorAll('.crow .e')].map((el) => el.textContent), ['b', 'a']);
}

test('in every position, a new key value starts the component again in place; the same value builds nothing', () => {
  reset(mod);
  const host = document.createElement('div');
  document.body.appendChild(host);
  clearDiagnostics();
  const stop = mount(h(mod.Page, {}), host);
  checkRestarts(mod, host);
  checkRows(mod, host);
  checkElements(mod, host);
  assert.deepEqual(getDiagnostics().events.map((e) => e.code), [], 'development reports nothing: a new key is a new instance, not lost state');
  mod.show(false); flushSync();
  assert.equal(host.querySelector('.tern').textContent, 'none');
  assert.equal(host.querySelector('.and').textContent, '');
  mod.id(4); mod.show(true); flushSync();
  assert.equal(at(host, 'tern').textContent, 't4', 'an arm shown again is a new instance with the current key');
  const cleaned = mod.log.cleaned.length;
  stop();
  assert.ok(mod.log.cleaned.length > cleaned, 'unmounting disposes the keyed instances');
  host.remove();
});

// --- Server render, then hydration ---

test('the server renders what the unkeyed component renders, in the function child the hydration walk expects', () => {
  const html = renderToString(h(server.Page, {}));
  assert.match(html, /<div class="child"><b class="e" data-tone="x">c1<\/b>tail<\/div>/);
  assert.match(html, /<div class="frag"><i>f<\/i><b class="e" data-tone="x">f1<\/b><i>g<\/i><\/div>/);
  assert.match(html, /<li><b class="e" data-tone="x">v<\/b><\/li>/);
  assert.match(html, /<p class="el-child"><input class="i" data-tone="x">tail<\/p>/);
  const hydratable = renderToHydratableString(h(server.Page, {}));
  assert.match(hydratable, /<div class="child"><!--\$--><b data-hk="00" class="e" data-tone="x"><!--\$-->c1<!--\/\$--><\/b><!--\/\$-->tail<\/div>/);
});

test('hydration adopts every keyed component with no mismatch, and a key change after it starts each one again', () => {
  const html = renderToHydratableString(h(server.Page, {}));
  reset(client);
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  const before = [...host.querySelectorAll('*')];
  clearDiagnostics();
  const errors = [];
  hydrate(h(client.Page, {}), host, { onHydrationError: (e) => errors.push(e) });
  flushSync();
  assert.deepEqual(errors, []);
  assert.deepEqual(getDiagnostics().events.filter((e) => e.code === 'ERR_HYDRATION_MISMATCH'), []);
  assert.deepEqual([...host.querySelectorAll('*')], before, 'every server node adopted');
  assert.equal(client.log.cleaned.length, 0);
  checkRestarts(client, host);
  checkRows(client, host);
  checkElements(client, host);
  host.remove();
});
