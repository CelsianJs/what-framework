// A props object is marked as What's (Symbol.for('what-core.props.v1'), dom.js
// _markProps) only when it holds a getter: a live prop, or the lazy getter of
// children or of JSX passed in a prop. The mark is what keeps those getters
// getters through a copy, a merge and a rest element; an object with none is
// the same marked or not, so it is left unmarked. Each edge where a getter
// can arrive after the object was made, or leave with a copy, is checked: a
// static object forwarded into a component with a live prop, a rest element
// of a static object, and lazy children added to an object that was not
// marked.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

const MARK = Symbol.for('what-core.props.v1');
const marked = (x) => Object.getOwnPropertySymbols(x).includes(MARK);

let cleanup;
let core;
let dom;
let render;
let mod;
let host;

before(async () => {
  ({ cleanup } = installDOM());
  core = await import('../src/index.js');
  dom = await import('../src/dom.js');
  render = await import('../src/render.js');
  mod = await loadCompiled(`
    import { signal, mount, createContext, useContext } from 'what-framework';
    export const n = signal(1);
    export const seen = {};
    export let kids = 0;
    const Where = createContext('outside');
    function Static(props) { seen.static = props; return null; }
    function Live(props) { seen.live = props; return null; }
    function Inner(props) { (seen.inner ||= []).push(props); return <i id="fwd" title={props.a}>{props.b}</i>; }
    function Outer(props) { seen.outer = props; return <Inner {...props} b={n()} />; }
    function Plain(props) { seen.plain = props; return <u id="plain" title={props.a}>{props.c}</u>; }
    function Wrap(props) { seen.wrap = props; return <Plain {...props} c="z" />; }
    function Rest({ z, ...rest }) { seen.rest = rest; return <i id="rest" {...rest}>{z}</i>; }
    function RestFwd({ z, ...rest }) { seen.restFwd = rest; return <Inner {...rest} b={n() * 10} />; }
    function Drop({ a, ...rest }) { seen.drop = rest; return <s>{a}</s>; }
    function Kid() { kids++; return <b id="kid">{useContext(Where)}</b>; }
    function Frame(props) { seen.frame = props; return <Where value="frame"><section id="card">{props.children}{props.header}</section></Where>; }
    function Card(props) { seen.card = props; return <Frame {...props} />; }
    export function App() {
      return <div>
        <Static a={1} b="x" />
        <Live a={n()} b="x" />
        <Outer a="1" />
        <Wrap a="2" />
        <Rest z={0} a="1" b="x" />
        <RestFwd z={0} a="3" />
        <Drop a={n()} b="x" />
        <Card title="t" header={<em id="hdr">{useContext(Where)}</em>}><Kid /></Card>
      </div>;
    }
    export const run = (el) => mount(App, el);
  `);
  host = document.body.appendChild(document.createElement('div'));
  mod.run(host);
  core.flushSync();
});
after(() => cleanup());

describe('a props object is marked only when it holds a getter', () => {
  it('a component\'s static props are not marked; with a live prop they are', () => {
    assert.equal(marked(mod.seen.static), false);
    assert.deepEqual({ ...mod.seen.static }, { a: 1, b: 'x' });
    assert.equal(marked(mod.seen.live), true);
    assert.equal(dom._isLiveProp(mod.seen.live, 'a'), true);
  });

  it('static props forwarded through {...props} into a component with a live prop: the merge is marked and live', () => {
    assert.equal(marked(mod.seen.outer), false);
    const [inner] = mod.seen.inner;
    assert.equal(marked(inner), true);
    assert.equal(dom._isLiveProp(inner, 'b'), true);
    assert.equal(dom._isLiveProp(inner, 'a'), false);
    const fwd = host.querySelector('#fwd');
    assert.equal(fwd.textContent, '1');
    assert.equal(fwd.getAttribute('title'), '1');
    mod.n(2);
    core.flushSync();
    assert.equal(fwd.textContent, '2');
    assert.equal(fwd.getAttribute('title'), '1');
    mod.n(1);
    core.flushSync();
  });

  it('static props forwarded with static props only: no mark, the same values', () => {
    assert.equal(marked(mod.seen.wrap), false);
    assert.equal(marked(mod.seen.plain), false);
    assert.deepEqual({ ...mod.seen.plain }, { a: '2', c: 'z' });
    assert.equal(host.querySelector('#plain').getAttribute('title'), '2');
    assert.equal(host.querySelector('#plain').textContent, 'z');
  });

  it('a rest element of a static object is not marked, and spreads and forwards as before', () => {
    assert.equal(marked(mod.seen.rest), false);
    assert.deepEqual({ ...mod.seen.rest }, { a: '1', b: 'x' });
    const rest = host.querySelector('#rest');
    assert.equal(rest.getAttribute('a'), '1');
    assert.equal(rest.getAttribute('b'), 'x');
    assert.equal(rest.textContent, '0');
    assert.equal(marked(mod.seen.restFwd), false);
    assert.equal(marked(mod.seen.inner[1]), true);
    assert.equal(mod.seen.inner[1].a, '3');
    mod.n(4);
    core.flushSync();
    assert.equal(host.querySelectorAll('#fwd')[1].textContent, '40', 'a live prop added to a forwarded rest stays live');
    mod.n(1);
    core.flushSync();
  });

  it('a rest element that leaves out the only live prop holds no getter and is not marked', () => {
    assert.deepEqual({ ...mod.seen.drop }, { b: 'x' });
    assert.equal(marked(mod.seen.drop), false);
  });

  it('lazy children added to props that were not marked mark them: a forward keeps the getters and builds where they are placed', () => {
    assert.equal(marked(mod.seen.card), true);
    assert.equal(marked(mod.seen.frame), true);
    assert.notEqual(Object.getOwnPropertyDescriptor(mod.seen.frame, 'children').get, undefined);
    assert.notEqual(Object.getOwnPropertyDescriptor(mod.seen.frame, 'header').get, undefined);
    assert.equal(host.querySelector('#kid').textContent, 'frame', 'built under the place, inside its provider');
    assert.equal(host.querySelector('#hdr').textContent, 'frame');
    assert.equal(mod.kids, 1, 'built once, where it is placed');
  });
});

describe('the runtime\'s copies and merges', () => {
  it('a hand-written object is copied by value, its getters read once, and the copy is not marked', () => {
    let seen;
    const Probe = (props) => { seen = props; return null; };
    const source = { b: 'x', get a() { return mod.n(); } };
    render._$createComponent(Probe, source, []);
    assert.notEqual(seen, source);
    assert.equal(marked(seen), false);
    assert.equal(Object.getOwnPropertyDescriptor(seen, 'a').value, 1);
  });

  it('_$merge and _$omit mark their result when they keep a getter, and only then', () => {
    const live = render._$marked({ get a() { return mod.n(); }, b: 'x' });
    assert.equal(marked(render._$merge({ a: 1 }, { b: 2 })), false);
    assert.equal(marked(render._$merge({ a: 1 }, live)), true);
    assert.equal(marked(render._$merge({ __proto__: null, get a() { return mod.n(); } })), true);
    assert.equal(marked(render._$omit(live, ['b'])), true);
    assert.equal(marked(render._$omit(live, ['a'])), false);
    assert.equal(marked(render._$omit({ a: 1, b: 2 }, ['a'])), false);
    assert.equal(marked(dom._copyProps(live)), true);
    assert.equal(marked(dom._copyProps({ a: 1 })), false);
    assert.equal(marked(dom._copyProps(null)), false);
    assert.equal(dom._isLiveProp(render._$omit(render._$merge({ c: 0 }, live), ['b']), 'a'), true);
  });
});
