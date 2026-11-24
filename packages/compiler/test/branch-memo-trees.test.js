// Branch memoization beyond a ternary's first test (dogfood feedback from
// Vura): a ternary chain picks its arm by one lazy memo of the arm index, a
// <Show>/<Switch> fallback written as a ternary and a ternary handed to a
// component as JSX (a slot) do the same, and What's control flow lowers under
// whatever name it was imported as. Compiled output, behaviour in a DOM, and
// a server render that hydrates for each.
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

// Loaded before any test is registered: a top-level await between tests
// lets the root after() hook (the DOM's cleanup) run before the later ones.
const mod = await loadCompiled(`
  import { signal, Show, Switch as Branch, Match as When } from 'what-framework';
  export const a = signal(false);
  export const b = signal(1);
  export const loading = signal(true);
  export const data = signal(undefined);
  export const built = { counter: 0 };
  export function Counter() {
    built.counter++;
    const clicks = signal(0);
    return <button class="counter" onClick={() => clicks(clicks() + 1)}>c{clicks()}</button>;
  }
  function Card(props) { return <section class="card">{props.header}</section>; }
  export function Chain() {
    return <div>{a() ? <i>a</i> : b() > 0 ? <Counter /> : <em>none</em>}</div>;
  }
  export function Guarded() {
    return <div>{loading() ? <i>loading</i> : data().items.length ? <b>{data().items.length}</b> : <em>empty</em>}</div>;
  }
  export function Slot() {
    return <div><Card header={b() > 0 ? <Counter /> : <em>none</em>} /></div>;
  }
  export function Fallback() {
    return <div><Show when={loading()} fallback={data().items.length ? <Counter /> : <em>empty</em>}><i>loading</i></Show></div>;
  }
  export const user = signal({ name: 'ada' });
  export const count = signal(0);
  export const name = signal('');
  export function Profile(props) {
    built.profile = (built.profile || 0) + 1;
    const clicks = signal(0);
    return <button class="profile" onClick={() => clicks(clicks() + 1)}>{props.user.name}:{clicks()}</button>;
  }
  export function And() { return <div>{user() && <Profile user={user()} />}</div>; }
  export function Count() { return <div>{count() && <b>n</b>}</div>; }
  export function Or() { return <div>{name() || <em>anon</em>}</div>; }
  export function Aliased() {
    return <div><Branch fallback={<em>none</em>}><When when={a()}><i>a</i></When><When when={b() > 0}><Counter /></When></Branch></div>;
  }
`);

// --- Compiled output ---

test('a ternary chain is one lazy memo of the arm index, evaluated in the order the chain tests', () => {
  const code = body(compileJSX(`export function A(p) { return <div>{p.a() ? <X /> : p.b() ? <Y /> : <Z />}</div>; }`));
  assert.match(code, /const (_c\$\d+) = _\$lazyMemo\(\(\) => p\.a\(\) \? 0 : p\.b\(\) \? 1 : 2\);/);
  assert.match(code, /_c\$\d+\(\) === 0 \? _\$createComponent\(X[^)]*\) : _c\$\d+\(\) === 1 \? _\$createComponent\(Y[^)]*\) : _\$createComponent\(Z/);
  const region = code.slice(code.indexOf('_$insert('));
  assert.doesNotMatch(region, /p\.b\(\)/, 'the inner test is never read by the region itself');
});

test('a one-level ternary keeps its truthiness memo', () => {
  const code = body(compileJSX(`export function A(p) { return <div>{p.a() ? <X /> : <Z />}</div>; }`));
  assert.match(code, /_\$memo\(\(\) => !!p\.a\(\)\)/);
  assert.doesNotMatch(code, /_\$lazyMemo/);
});

test('a <Show> fallback and a <Switch> fallback written as ternaries read a lazy memo', () => {
  const show = body(compileJSX(`import { Show } from 'what-framework';
    export function A(p) { return <div><Show when={p.a()} fallback={p.b() ? <X /> : <Y />}><Z /></Show></div>; }`));
  assert.match(show, /_\$lazyMemo\(\(\) => p\.b\(\) \? 0 : 1\)/);
  const sw = body(compileJSX(`import { Switch, Match } from 'what-framework';
    export function A(p) { return <div><Switch fallback={p.b() ? <X /> : <Y />}><Match when={p.a()}><Z /></Match></Switch></div>; }`));
  assert.match(sw, /_\$lazyMemo\(\(\) => p\.b\(\) \? 0 : 1\)/);
});

test('a ternary handed to a component as JSX is a reactive child with its own lazy memo, on both targets', () => {
  const dom = body(compileJSX(`export function A(p) { return <div><Card header={p.b() ? <X /> : <Y />} /></div>; }`));
  assert.match(dom, /header: \(\) => \{\s*const (_c\$\d+) = _\$lazyMemo\(\(\) => p\.b\(\) \? 0 : 1\);\s*return \(\) => \1\(\) === 0 \?/);
  const ssr = body(compileJSX(`export function A(p) { return <div><Card header={p.b() ? <X /> : <Y />} /></div>; }`, { pluginOptions: { generate: 'ssr' } }));
  assert.match(ssr, /header: \(\) => p\.b\(\) \? _\$ssrComponent\(X/, 'the server hands the same function');
  const plain = body(compileJSX(`const wide = true; export function A() { return <div><Card header={wide ? <X /> : <Y />} /></div>; }`));
  assert.match(plain, /header: \(\) => wide \? _\$createComponent/, 'a test that reads nothing reactive stays as it was');
  const nullable = body(compileJSX(`export function A(p) { return <div><Card icon={p.b() ? null : <X />} /></div>; }`));
  assert.match(nullable, /icon: \(\) => p\.b\(\) \? null :/, 'an arm that is null stays a value: a component testing the prop sees false');
});

test("What's control flow lowers under the name it was imported as; a third party's Switch and the file's own stay components", () => {
  const aliased = body(compileJSX(`import { Switch as Branch, Match as When, Show as Visible } from 'what-framework';
    import { Switch } from './ui/Switch.jsx';
    export function A(p) {
      return <div>
        <Branch fallback={<i />}><When when={p.a()}><X /></When></Branch>
        <Visible when={p.b()}><Y /></Visible>
        <Switch checked={p.a()} />
      </div>;
    }`));
  assert.doesNotMatch(aliased, /_\$createComponent\((Branch|When|Visible)/, 'the aliases are lowered');
  assert.match(aliased, /_\$memo\(\(\) => p\.a\(\) \? 0 : -1\)/, 'Branch lowers as <Switch> does');
  assert.match(aliased, /_\$memo\(\(\) => !!p\.b\(\)\)/, 'Visible lowers as <Show> does');
  assert.match(aliased, /_\$createComponent\(Switch,/, "the file's own Switch is a component");

  const foreign = body(compileJSX(`import { Switch } from 'ui-kit';
    export function A(p) { return <div><Switch checked={p.a()} /></div>; }`));
  assert.match(foreign, /_\$createComponent\(Switch,/, "a package's Switch is that package's component");

  const ssr = body(compileJSX(`import { Switch as Branch, Match as When } from 'what-framework';
    export function A(p) { return <div><Branch fallback={<i />}><When when={p.a()}><X /></When></Branch></div>; }`, { pluginOptions: { generate: 'ssr' } }));
  assert.doesNotMatch(ssr, /_\$ssrComponent\((Branch|When)/, 'the server target lowers the aliases too');
});

test('`&&` and `||` pick their arm by a lazy memo of the left side\'s truthiness', () => {
  const code = body(compileJSX(`export function A(p) { return <div>{p.user() && <Profile user={p.user()} />}{p.name() || <Placeholder />}{p.html() || <Fallback />}</div>; }`));
  assert.match(code, /_\$lazyMemo\(\(\) => !!p\.user\(\)\);\s*_\$insert\(_el\$0, \(\) => _c\$\d+\(\) \? _\$createComponent\(Profile[\s\S]*?\) : p\.user\(\)/);
  assert.match(code, /_\$lazyMemo\(\(\) => !!p\.name\(\)\);\s*_\$insert\(_el\$0, \(\) => _c\$\d+\(\) \? p\.name\(\) : _\$createComponent\(Placeholder/);
  const jsxLeft = body(compileJSX(`export function A(p) { return <div>{(p.a() && <i />) || <Fallback />}</div>; }`));
  assert.doesNotMatch(jsxLeft, /_\$lazyMemo\(\(\) => !!\(p\.a\(\) &&/, 'an `||` whose left side builds DOM keeps its value memo');
  const ssr = body(compileJSX(`export function A(p) { return <div>{p.user() && <Profile user={p.user()} />}</div>; }`, { pluginOptions: { generate: 'ssr' } }));
  assert.match(ssr, /\(\) => p\.user\(\) && _\$ssrComponent\(Profile/, 'the server renders `&&` itself: the same output');
});

// --- Behaviour ---


function reset() {
  mod.a(false); mod.b(1); mod.loading(true); mod.data(undefined);
  mod.user({ name: 'ada' }); mod.count(0); mod.name('');
  mod.built.counter = 0; mod.built.profile = 0;
  flushSync();
}

function render(Component) {
  reset();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const stop = mount(h(Component, {}), host);
  return { host, stop: () => { stop(); host.remove(); } };
}

const click = (el) => el.dispatchEvent(new document.defaultView.MouseEvent('click', { bubbles: true }));

test('a component in an inner arm keeps its state while the inner test keeps its answer', () => {
  const { host, stop } = render(mod.Chain);
  const button = host.querySelector('.counter');
  click(button); flushSync();
  assert.equal(button.textContent, 'c1');
  mod.b(2); flushSync();
  mod.b(5); flushSync();
  assert.equal(host.querySelector('.counter'), button, 'the same node: not rebuilt');
  assert.equal(button.textContent, 'c1');
  assert.equal(mod.built.counter, 1);
  mod.b(0); flushSync();
  assert.equal(host.textContent, 'none');
  mod.b(3); flushSync();
  assert.equal(host.querySelector('.counter').textContent, 'c0', 'a new arm is a new component');
  stop();
});

test('an inner test its outer arm guards is never read unguarded', () => {
  const { host, stop } = render(mod.Guarded);
  assert.equal(host.textContent, 'loading');
  mod.data({ items: [1, 2] }); mod.loading(false); flushSync();
  assert.equal(host.textContent, '2');
  mod.loading(true); mod.data(undefined); flushSync();
  assert.equal(host.textContent, 'loading');
  stop();

  const fallback = render(mod.Fallback);
  assert.equal(fallback.host.textContent, 'loading', 'a <Show> fallback is not evaluated while it does not show');
  mod.data({ items: [1] }); mod.loading(false); flushSync();
  assert.equal(fallback.host.querySelector('.counter').textContent, 'c0');
  fallback.stop();
});

test('a ternary handed to a component as JSX follows its test, and keeps the arm it placed', () => {
  const { host, stop } = render(mod.Slot);
  const button = host.querySelector('.counter');
  click(button); flushSync();
  mod.b(4); flushSync();
  assert.equal(host.querySelector('.counter'), button, 'kept while the test holds');
  assert.equal(button.textContent, 'c1');
  mod.b(0); flushSync();
  assert.equal(host.querySelector('.card').textContent, 'none', 'the other arm shows (it used to stay on the first one)');
  mod.b(1); flushSync();
  assert.equal(host.querySelector('.counter').textContent, 'c0');
  stop();
});

test('an aliased Switch renders and switches its arms', () => {
  const { host, stop } = render(mod.Aliased);
  const button = host.querySelector('.counter');
  mod.b(7); flushSync();
  assert.equal(host.querySelector('.counter'), button);
  mod.a(true); flushSync();
  assert.equal(host.textContent, 'a');
  mod.a(false); mod.b(0); flushSync();
  assert.equal(host.textContent, 'none');
  stop();
});

test('`left && <X />` keeps <X> while the left side stays truthy, and renders a falsy left value as React does', () => {
  const { host, stop } = render(mod.And);
  const button = host.querySelector('.profile');
  click(button); flushSync();
  mod.user({ name: 'grace' }); flushSync();
  assert.equal(host.querySelector('.profile'), button, 'a new object, still truthy: kept');
  assert.equal(button.textContent, 'grace:1', 'its live prop follows; its state is kept');
  assert.equal(mod.built.profile, 1);
  mod.user(null); flushSync();
  assert.equal(host.textContent, '', 'null renders nothing');
  mod.user({ name: 'lin' }); flushSync();
  assert.equal(host.querySelector('.profile').textContent, 'lin:0');
  stop();

  const n = render(mod.Count);
  assert.equal(n.host.textContent, '0', '0 renders "0", as in React');
  for (const [value, text] of [[false, ''], ['', ''], [undefined, ''], [null, ''], [0, '0'], [3, 'n']]) {
    mod.count(value); flushSync();
    assert.equal(n.host.textContent, text, `count = ${JSON.stringify(value)}`);
  }
  n.stop();
});

test('`name() || <Fallback />` shows the value while it is truthy and the fallback otherwise', () => {
  const { host, stop } = render(mod.Or);
  assert.equal(host.textContent, 'anon');
  const em = host.querySelector('em');
  mod.name(0); flushSync();
  assert.equal(host.querySelector('em'), em, 'falsy to falsy: the fallback is kept');
  mod.name('ada'); flushSync();
  assert.equal(host.textContent, 'ada');
  mod.name('grace'); flushSync();
  assert.equal(host.textContent, 'grace', 'the value is live');
  stop();
});

// --- Server render, then hydration ---

const SOURCE = `
  import { signal, Show, Switch as Branch, Match as When } from 'what-framework';
  export const a = signal(false);
  export const b = signal(1);
  export const loading = signal(false);
  export const data = signal({ items: [1] });
  export const user = signal({ name: 'ada' });
  export const count = signal(0);
  export const name = signal('');
  function Card(props) { return <section class="card">{props.header}</section>; }
  function Profile(props) { return <b>{props.user.name}</b>; }
  export function Page() {
    return (
      <main>
        <p class="and">{user() && <Profile user={user()} />}</p>
        <p class="count">{count() && <b>n</b>}</p>
        <p class="or">{name() || <em>anon</em>}</p>
        <p class="chain">{a() ? <i>a</i> : b() > 0 ? <b>pos</b> : <em>none</em>}</p>
        <div class="slot"><Card header={b() > 0 ? <b>on</b> : <em>off</em>} /></div>
        <p class="fallback"><Show when={loading()} fallback={data().items.length ? <b>list</b> : <em>empty</em>}><i>loading</i></Show></p>
        <p class="aliased"><Branch fallback={<em>none</em>}><When when={a()}><i>a</i></When><When when={b() > 0}><b>yes</b></When></Branch></p>
      </main>
    );
  }`;

test('each lowering hydrates the server render in place, with no mismatch, and stays reactive', async () => {
  const ssr = await loadCompiled(SOURCE, { pluginOptions: { generate: 'ssr' } });
  const client = await loadCompiled(SOURCE, { pluginOptions: { hydratable: true } });
  const html = renderToHydratableString(h(ssr.Page, {}));
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  const before = [...host.querySelectorAll('b, em, i, section')];
  clearDiagnostics();
  const errors = [];
  hydrate(h(client.Page, {}), host, { onHydrationError: (e) => errors.push(e) });
  flushSync();
  assert.deepEqual(errors, []);
  assert.deepEqual(getDiagnostics().events.filter((e) => e.code === 'ERR_HYDRATION_MISMATCH'), []);
  assert.deepEqual([...host.querySelectorAll('b, em, i, section')], before, 'every server node adopted');
  const text = (sel) => host.querySelector(sel).textContent;
  assert.deepEqual([text('.chain'), text('.slot'), text('.fallback'), text('.aliased')], ['pos', 'on', 'list', 'yes']);

  assert.deepEqual([text('.and'), text('.count'), text('.or')], ['ada', '0', 'anon']);
  const profile = host.querySelector('.and b');
  client.user({ name: 'grace' }); flushSync();
  assert.equal(host.querySelector('.and b'), profile, '`&&` keeps its arm after hydration');
  assert.equal(text('.and'), 'grace');
  client.count(2); client.name('ada'); flushSync();
  assert.deepEqual([text('.count'), text('.or')], ['n', 'ada']);
  client.user(null); client.count(0); client.name(''); flushSync();
  assert.deepEqual([text('.and'), text('.count'), text('.or')], ['', '0', 'anon']);

  const pos = host.querySelector('.chain b');
  client.b(2); flushSync();
  assert.equal(host.querySelector('.chain b'), pos, 'the chain keeps its arm after hydration');
  client.b(0); client.data({ items: [] }); flushSync();
  assert.deepEqual([text('.chain'), text('.slot'), text('.fallback'), text('.aliased')], ['none', 'off', 'empty', 'none']);
  client.a(true); flushSync();
  assert.deepEqual([text('.chain'), text('.aliased')], ['a', 'a']);
  host.remove();
});
