// What a component call hands back. A component that returns one element IS
// that element: no <!--c:start-->/<!--c:end--> comments around it and no
// fragment to carry them, so a list row that is a component is one node, like
// a row written inline. Any other output (a fragment, text, an array, a
// region, nothing) is bracketed as before. Ownership does not depend on the
// markers: the owner tree disposes the component, and in development the
// element answers __ownerOf with it.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

const { document, cleanup } = installDOM();
after(cleanup);

const { h, mount, flushSync } = await import('what-framework');
const { __ownerOf, __ownerPath } = await import('what-core/internal');

const mod = await loadCompiled(`
  import { signal, effect, mount, onCleanup, Show } from 'what-framework';
  export const rows = signal([]);
  export const on = signal(true);
  export const log = [];

  function One() { return <p class="one">one</p>; }
  function Two() { return <><i>a</i><i>b</i></>; }
  function Text() { return 'text'; }
  function Nothing() { return null; }
  function Region(props) { return <>{props.value()}</>; }
  export function Kinds() {
    return <div class="kinds"><One /><Two /><Text /><Nothing /><Region value={() => 'r'} /></div>;
  }

  function Inner() { return <b class="inner">in</b>; }
  function Outer() { return <Inner />; }
  export function Nested() { return <section><Outer /></section>; }

  function Row(props) {
    onCleanup(() => log.push('gone ' + props.id));
    return <li class="row">{props.label}</li>;
  }
  export function List() {
    return <ul>{rows().map((row) => <Row key={row.id} id={row.id} label={row.label} />)}</ul>;
  }

  function Branch(props) {
    onCleanup(() => log.push('branch ' + props.name));
    return <span class={props.name}>{props.name}</span>;
  }
  export function Switching() {
    return <div class="switching">{on() ? <Branch name="yes" /> : <Branch name="no" />}</div>;
  }

  function App() {
    onCleanup(() => log.push('app'));
    return <main>app</main>;
  }
  // Compiled mount(<App />, el) builds App before mount() makes its root.
  export const mountApp = (el) => mount(<App />, el);

  // An element a component built under no owner, returned by another one.
  function Kept() {
    onCleanup(() => log.push('kept'));
    return <em>kept</em>;
  }
  export const makeKept = () => <Kept />;
  export function Holder(props) { return props.node; }
  // Holder built under no owner too: compiled mount(<Holder />, el).
  function LoggedHolder(props) {
    onCleanup(() => log.push('holder'));
    return props.node;
  }
  export const mountHolder = (el, node) => mount(<LoggedHolder node={node} />, el);

  // A component built under no owner, placed inside the element of another.
  export const tick = signal(0);
  function Side() {
    onCleanup(() => log.push('side'));
    effect(() => { log.push('side ran ' + tick()); });
    return <aside>side</aside>;
  }
  const side = <Side />;
  function Shell() {
    onCleanup(() => log.push('shell'));
    return <main><section>{side}</section></main>;
  }
  export const mountShell = (el) => mount(<Shell />, el);

  // A text node a component returns, and an element two components return in turn.
  export const cachedText = document.createTextNode('cached');
  function TextNode() { return cachedText; }
  export function HoldsText() { return <div class="holds-text"><TextNode /></div>; }
  export function SwitchesText() { return <div class="switches-text">{on() ? <TextNode /> : 'plain'}</div>; }
  export const shared = document.createElement('q');
  export function First() { return shared; }
  export function Second() { return shared; }
`);

const host = () => document.body.appendChild(document.createElement('div'));
const comments = (node) => [...node.childNodes].filter((n) => n.nodeType === 8).map((n) => n.data);

test('a component that returns one element is that element; any other output is bracketed', () => {
  const el = host();
  const stop = mount(h(mod.Kinds, {}), el);
  flushSync();
  const kinds = el.querySelector('.kinds');
  assert.equal(kinds.firstChild, kinds.querySelector('.one'), 'nothing before the element');
  assert.equal(kinds.innerHTML.replaceAll('<!---->', ''), '<p class="one">one</p>'
    + '<!--c:start--><i>a</i><i>b</i><!--c:end-->'
    + '<!--c:start-->text<!--c:end-->'
    + '<!--c:start--><!--c:end-->'
    + '<!--c:start--><!--fn-->r<!--/fn--><!--c:end-->');
  // Two, Text, Nothing and Region each have a pair; One has none.
  assert.equal(comments(kinds).filter((c) => c === 'c:start').length, 4);
  assert.equal(comments(kinds).filter((c) => c === 'c:end').length, 4);
  assert.equal(kinds.textContent, 'oneabtextr');
  stop();
});

test('in development the element answers for its component, the innermost when several return it', () => {
  const el = host();
  const stop = mount(h(mod.Nested, {}), el);
  flushSync();
  const inner = el.querySelector('.inner');
  assert.equal(el.querySelector('section').childNodes.length, 1, 'neither component has markers');
  assert.equal(__ownerOf(inner).Component.name, 'Inner');
  assert.equal(__ownerOf(inner.firstChild).Component.name, 'Inner', 'and so does what it holds');
  assert.deepEqual([...__ownerPath(inner)].slice(-3), ['<Nested>', '<Outer>', '<Inner>']);
  assert.equal(__ownerOf(el.querySelector('section')).Component.name, 'Nested');
  stop();
});

test('a list of components holds one node per row, and a removed row is disposed', () => {
  mod.log.length = 0;
  mod.rows([{ id: 1, label: 'a' }, { id: 2, label: 'b' }, { id: 3, label: 'c' }]);
  const el = host();
  const stop = mount(h(mod.List, {}), el);
  flushSync();
  const ul = el.querySelector('ul');
  assert.equal(ul.childNodes.length, 4, 'three rows and the list\'s end marker');
  assert.deepEqual(comments(ul), ['/list']);
  const [a, b, c] = ul.querySelectorAll('.row');

  mod.rows([mod.rows()[2], mod.rows()[1], mod.rows()[0]]);
  flushSync();
  assert.deepEqual([...ul.querySelectorAll('.row')], [c, b, a], 'the rows moved, none was rebuilt');
  assert.equal(ul.childNodes.length, 4);

  mod.rows(mod.rows().filter((row) => row.id !== 2));
  flushSync();
  assert.deepEqual([...ul.querySelectorAll('.row')], [c, a]);
  assert.deepEqual(mod.log, ['gone 2']);

  mod.rows([]);
  flushSync();
  assert.equal(ul.childNodes.length, 1);
  assert.deepEqual(mod.log.sort(), ['gone 1', 'gone 2', 'gone 3']);
  stop();
});

test('a region that switches between two components replaces one element with the other', () => {
  mod.log.length = 0;
  mod.on(true);
  const el = host();
  const stop = mount(h(mod.Switching, {}), el);
  flushSync();
  const box = el.querySelector('.switching');
  assert.equal(box.childNodes.length, 1);
  assert.equal(box.textContent, 'yes');
  mod.on(false);
  flushSync();
  assert.equal(box.childNodes.length, 1, 'nothing left behind');
  assert.equal(box.textContent, 'no');
  assert.deepEqual(mod.log, ['branch yes']);
  mod.on(true);
  flushSync();
  assert.equal(box.textContent, 'yes');
  assert.deepEqual(mod.log, ['branch yes', 'branch no']);
  stop();
  assert.deepEqual(mod.log, ['branch yes', 'branch no', 'branch yes']);
});

test('a component built before its root is adopted by it, with or without markers', () => {
  mod.log.length = 0;
  const el = host();
  const stop = mod.mountApp(el);
  flushSync();
  assert.equal(el.innerHTML, '<main>app</main>');
  stop();
  assert.deepEqual(mod.log, ['app']);
  assert.equal(el.innerHTML, '');

  // The element of a component nothing owns yet, returned by another
  // component: both are disposed with the root that holds them.
  mod.log.length = 0;
  const kept = mod.makeKept();
  const stopHolder = mount(h(mod.Holder, { node: kept }), el);
  flushSync();
  assert.equal(el.textContent, 'kept');
  stopHolder();
  assert.deepEqual(mod.log, ['kept']);
});

test('an element a component built under no owner returned keeps that component when another one built under no owner returns it', () => {
  mod.log.length = 0;
  const el = host();
  const stop = mod.mountHolder(el, mod.makeKept());
  flushSync();
  assert.equal(el.innerHTML, '<!--c:start--><em>kept</em><!--c:end-->', 'the second component brackets it: the element answers for the first');
  stop();
  assert.deepEqual(mod.log.sort(), ['holder', 'kept'], 'the root disposed both');
});

test('a component built under no owner inside another such component\'s element is adopted with it', () => {
  const el = host();
  const stop = mod.mountShell(el);
  flushSync();
  assert.equal(el.innerHTML, '<main><section><aside>side</aside></section></main>');
  mod.log.length = 0;
  mod.tick(1);
  flushSync();
  assert.deepEqual(mod.log, ['side ran 1']);

  // Every component built under no owner has its root now, so a mount does not
  // look for one: a node marked as such a component's is left as it is.
  const marked = document.createElement('p');
  marked._owner = { owner: {}, flags: 0 };
  const other = host();
  const stopOther = mount(h('div', {}, marked), other);
  assert.notEqual(marked._owner, undefined, 'mount() did not walk its tree for components to adopt');
  stopOther();

  mod.log.length = 0;
  stop();
  assert.deepEqual(mod.log.sort(), ['shell', 'side'], 'both cleanups ran');
  mod.log.length = 0;
  mod.tick(2);
  flushSync();
  assert.deepEqual(mod.log, [], 'and the inner component\'s effect went with it');
});

test('a component that returns a text node is bracketed, and a region leaves that node as it is', () => {
  const el = host();
  const stop = mount(h(mod.HoldsText, {}), el);
  flushSync();
  assert.equal(el.querySelector('.holds-text').innerHTML, '<!--c:start-->cached<!--c:end-->');
  stop();

  mod.on(true);
  const stopSwitch = mount(h(mod.SwitchesText, {}), el);
  flushSync();
  const box = el.querySelector('.switches-text');
  assert.equal(box.textContent, 'cached');
  mod.on(false);
  flushSync();
  assert.equal(box.textContent, 'plain');
  assert.equal(mod.cachedText.data, 'cached', 'the region wrote its own text, not the component\'s node');
  mod.on(true);
  flushSync();
  assert.equal(box.textContent, 'cached');
  stopSwitch();
});

test('in development an element answers for the component that returns it now, once the one before is gone', () => {
  const el = host();
  const stopFirst = mount(h(mod.First, {}), el);
  flushSync();
  assert.equal(__ownerOf(mod.shared).Component.name, 'First');
  stopFirst();
  const stopSecond = mount(h(mod.Second, {}), el);
  flushSync();
  assert.equal(__ownerOf(mod.shared).Component.name, 'Second');
  stopSecond();
});
