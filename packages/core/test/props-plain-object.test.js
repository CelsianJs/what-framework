// The props objects What builds are plain objects, as React's are.
//
// React hands a component a plain object, and code calls
// `props.hasOwnProperty(k)`, `String(props)`, `props.valueOf()` on it and on
// any `{ ...rest }` taken from it: Headless UI's <Dialog> calls
// `props.hasOwnProperty('open')`, classnames asks `arg.toString`, and
// lodash's isPlainObject checks the prototype. What's props objects had no
// prototype, and each of those threw or answered false. They now inherit from
// Object.prototype and carry a mark no listing shows (dom.js _newProps), which
// is what keeps their getters live through every copy and merge.
//
// Each object a component sees is checked: the props a compiled component
// receives (with a live prop, and without), a rest element (_$omit), a
// spread's merge (_$merge), and the props of an h() component. Then what no
// copy may do: set a prototype with a key named `__proto__`, write that key
// onto an element, or take a key written onto Object.prototype as a prop.

/* eslint-disable no-prototype-builtins -- calling them on the object is what is tested */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

let cleanup;
let mod;
let core;
let dom;
let render;

before(async () => {
  ({ cleanup } = installDOM());
  core = await import('../src/index.js');
  dom = await import('../src/dom.js');
  render = await import('../src/render.js');
  mod = await loadCompiled(`
    import { signal, h, mount } from 'what-framework';
    export const n = signal(1);
    export const seen = {};
    function Live(props) { seen.live = props; return null; }
    function Static(props) { seen.static = props; return null; }
    function Rest({ z, ...rest }) { seen.rest = rest; return <i id="rest" {...rest}>{z}</i>; }
    function Merged(props) { seen.merged = props; return <b id="merged" {...props} />; }
    function Vnode(props) { seen.vnode = props; return null; }
    export function App() {
      const extra = { c: 3 };
      return <div>
        <Live a={n()} b="x" />
        <Static a={1} b="x" />
        <Rest z={0} a={n()} b="x" />
        <Merged {...extra} a={n()} b="x" />
        {h(Vnode, { a: 1, b: 'x' })}
      </div>;
    }
    export const run = (el) => mount(App, el);
  `);
  mod.run(document.body.appendChild(document.createElement('div')));
});
after(() => cleanup());

const KINDS = ['live', 'static', 'rest', 'merged', 'vnode'];
const data = (x) => Object.keys(x).filter((k) => k !== 'children');
// lodash 4's isPlainObject and is-plain-obj 4's test, as they are written.
const lodashIsPlainObject = (value) => {
  if (value == null || typeof value !== 'object' || Object.prototype.toString.call(value) !== '[object Object]') return false;
  const proto = Object.getPrototypeOf(value);
  if (proto === null) return true;
  const Ctor = Object.prototype.hasOwnProperty.call(proto, 'constructor') && proto.constructor;
  return typeof Ctor === 'function' && Ctor instanceof Ctor && Function.prototype.toString.call(Ctor) === Function.prototype.toString.call(Object);
};
const isPlainObj = (v) => {
  const p = Object.getPrototypeOf(v);
  return (p === null || p === Object.prototype || Object.getPrototypeOf(p) === null) && !(Symbol.toStringTag in v) && !(Symbol.iterator in v);
};

describe('props, a rest element and a merge are plain objects', () => {
  for (const kind of KINDS) {
    it(`${kind}: Object.prototype, with its methods`, () => {
      const x = mod.seen[kind];
      assert.equal(Object.getPrototypeOf(x), Object.prototype);
      assert.equal(x instanceof Object, true);
      assert.equal(x.constructor, Object);
      assert.equal(x.__proto__, Object.prototype);
      assert.equal(x.hasOwnProperty('a'), true);
      assert.equal(x.hasOwnProperty('nope'), false);
      assert.equal(x.propertyIsEnumerable('a'), true);
      assert.equal(x.isPrototypeOf({}), false);
      assert.equal(x.toString(), '[object Object]');
      assert.equal(x.toLocaleString(), '[object Object]');
      assert.equal(x.valueOf(), x);
      assert.equal(String(x), '[object Object]');
      assert.equal(`${x}`, '[object Object]');
      assert.equal(lodashIsPlainObject(x), true);
      assert.equal(isPlainObj(x), true);
    });

    it(`${kind}: keys, entries, for...in, JSON, a spread, Object.assign and structuredClone see its props only`, () => {
      const x = mod.seen[kind];
      const keys = kind === 'merged' ? ['c', 'a', 'b'] : ['a', 'b'];
      assert.deepEqual(data(x), keys);
      const listed = [];
      for (const k in x) if (k !== 'children') listed.push(k);
      assert.deepEqual(listed, keys);
      assert.deepEqual(Object.keys({ ...x }).filter((k) => k !== 'children'), keys);
      assert.deepEqual(Reflect.ownKeys({ ...x }).filter((k) => k !== 'children'), keys, 'the mark is not copied by a spread');
      assert.deepEqual(Reflect.ownKeys(Object.assign({}, x)).filter((k) => k !== 'children'), keys, 'nor by Object.assign');
      assert.equal(JSON.parse(JSON.stringify(x, (k, v) => (k === 'children' ? undefined : v))).b, 'x');
      const { children, ...values } = x;
      assert.deepEqual(structuredClone(values), Object.fromEntries(keys.map((k) => [k, x[k]])));
      assert.deepEqual({ ...x, children: undefined }, { ...Object.fromEntries(keys.map((k) => [k, x[k]])), children: undefined });
    });
  }

  it('classnames\' object branch takes them', () => {
    // classnames 2.5: an object whose toString is Object.prototype's lists its truthy keys.
    const classNames = (arg) => (arg.toString !== Object.prototype.toString && !arg.toString.toString().includes('[native code]')
      ? arg.toString() : Object.keys(arg).filter((k) => arg[k] && k !== 'children').join(' '));
    for (const kind of KINDS) assert.equal(classNames(mod.seen[kind]).split(' ').includes('b'), true, kind);
  });

  it('live props stay live through the rest element, the merge and a spread of either', () => {
    mod.n(2);
    core.flushSync();
    assert.equal(mod.seen.live.a, 2);
    assert.equal(mod.seen.rest.a, 2);
    assert.equal(mod.seen.merged.a, 2);
    assert.equal(document.getElementById('rest').getAttribute('a'), '2');
    assert.equal(document.getElementById('merged').getAttribute('a'), '2');
    mod.n(1);
    core.flushSync();
    assert.equal(document.getElementById('rest').getAttribute('a'), '1');
  });

  it('are frozen in development, as before', () => {
    for (const kind of ['live', 'static', 'merged', 'vnode']) assert.equal(Object.isFrozen(mod.seen[kind]), true, kind);
  });

  it('compiled JSX may mark its literal instead: the component gets it in place, the mark hidden, its getters live', () => {
    let seen;
    const Probe = (props) => { seen = props; return null; };
    const literal = { [render._$props]: true, b: 'x', get a() { return mod.n(); } };
    render._$createComponent(Probe, literal, []);
    assert.equal(seen, literal, 'no copy');
    assert.equal(Object.getPrototypeOf(seen), Object.prototype);
    assert.equal(Object.prototype.propertyIsEnumerable.call(seen, render._$props), false);
    assert.deepEqual(Reflect.ownKeys({ ...seen }), ['b', 'a']);
    assert.equal(dom._isLiveProp(seen, 'a'), true);
    assert.equal(dom._isLiveProp(seen, 'b'), false);
    assert.equal(render._$props, Symbol.for('what-core.props.v1'));
  });

  it('compiled JSX marks its literal with _$marked: the component gets it in place, the mark hidden, its getters live', () => {
    let seen;
    const Probe = (props) => { seen = props; return null; };
    const literal = { b: 'x', get a() { return mod.n(); } };
    assert.equal(render._$marked(literal), literal);
    render._$createComponent(Probe, literal, []);
    assert.equal(seen, literal, 'no copy');
    assert.equal(Object.getPrototypeOf(seen), Object.prototype);
    assert.equal(Object.prototype.propertyIsEnumerable.call(seen, render._$props), false);
    assert.deepEqual(Reflect.ownKeys({ ...seen }), ['b', 'a']);
    assert.equal(dom._isLiveProp(seen, 'a'), true);
    assert.equal(dom._isLiveProp(seen, 'b'), false);
  });

  it('another copy of what-core takes them as its own, and its own as this copy\'s', async () => {
    const other = await import(`../src/dom.js?copy=${Date.now()}`);
    const getter = render._$merge({ __proto__: null, get a() { return mod.n(); } });
    assert.equal(other._isLiveProp(getter, 'a'), true);
    assert.equal(other._isLiveProp(mod.seen.live, 'a'), true);
    assert.equal(dom._isLiveProp(other._copyProps(mod.seen.live), 'a'), true);
    assert.equal(other._isLiveProp({ get a() { return 1; } }, 'a'), false, 'a user object\'s getter is not a live prop');
  });
});

describe('a key named __proto__, and keys written onto Object.prototype', () => {
  const hostile = () => JSON.parse('{"__proto__": {"polluted": true, "dangerouslySetInnerHTML": {"__html": "<img>"}}, "a": 1, "title": "t"}');

  it('a prop named __proto__ is a property like any other: no copy sets a prototype with it', () => {
    let seen;
    const Probe = (props) => { seen = props; return null; };
    for (const [how, make] of [
      ['_$createComponent', () => render._$createComponent(Probe, hostile(), [])],
      ['_$merge', () => render._$createComponent(Probe, render._$merge(hostile(), { b: 2 }), [])],
      ['_$omit', () => render._$createComponent(Probe, render._$omit(hostile(), ['a']), [])],
      ['_$omit of a merge', () => render._$createComponent(Probe, render._$omit(render._$merge(hostile()), ['a']), [])],
      ['h()', () => core.mount(core.h(Probe, hostile()), document.createElement('div'))],
      ['h() with children', () => core.mount(core.h(Probe, hostile(), 'kid'), document.createElement('div'))],
    ]) {
      seen = undefined;
      make();
      assert.equal(Object.getPrototypeOf(seen), Object.prototype, how);
      assert.equal(Object.hasOwn(seen, '__proto__'), true, how);
      assert.equal(seen.polluted, undefined, how);
      assert.equal(seen.dangerouslySetInnerHTML, undefined, how);
      assert.equal(({}).polluted, undefined, how);
    }
  });

  it('is never written onto an element: a spread, h() and a spread with other writers', async () => {
    const spread = await loadCompiled(`
      import { mount } from 'what-framework';
      export const run = (el, a, b) => mount(() => <div>
        <p id="one" {...a} />
        <p id="many" title="first" {...a} {...b} />
      </div>, el);
    `);
    const el = document.createElement('div');
    spread.run(el, hostile(), { b: 'x' });
    core.mount(core.h('p', { ...hostile(), id: 'vnode' }), el.appendChild(document.createElement('div')));
    for (const id of ['one', 'many', 'vnode']) {
      const p = el.querySelector(`#${id}`);
      assert.equal(Object.getPrototypeOf(p), Object.getPrototypeOf(document.createElement('p')), id);
      assert.equal(p.hasAttribute('__proto__'), false, id);
      assert.equal(p.innerHTML, '', id);
      assert.equal(p.getAttribute('title'), 't', id);
    }
  });

  it('a key written onto Object.prototype is no prop: copies, merges and spreads take own keys only', async () => {
    const spread = await loadCompiled(`
      import { mount } from 'what-framework';
      function Rest({ a, ...rest }) { return <p id="rest" {...rest} />; }
      function Fwd(props) { return <p id="fwd" {...props} />; }
      export const run = (el, n) => mount(() => <div><Rest a={n} b="1" /><Fwd {...{ b: '2' }} /></div>, el);
    `);
    Object.prototype.onclick = 'onclick';
    Object.prototype.title = 'injected';
    try {
      const el = document.createElement('div');
      spread.run(el, 1);
      for (const id of ['rest', 'fwd']) {
        const p = el.querySelector(`#${id}`);
        assert.equal(p.hasAttribute('title'), false, id);
        assert.equal(p.hasAttribute('onclick'), false, id);
      }
      assert.deepEqual(Object.keys(render._$omit(render._$merge({ a: 1 }), [])), ['a']);
    } finally {
      delete Object.prototype.onclick;
      delete Object.prototype.title;
    }
  });

  it('a prop named like a method shadows it on that object alone, as on React\'s props', () => {
    let seen;
    let other;
    const Probe = (props) => { seen = props; return null; };
    const Other = (props) => { other = props; return null; };
    render._$createComponent(Probe, render._$merge({ hasOwnProperty: 5, toString: 'x' }, { a: 1 }), []);
    render._$createComponent(Other, { a: 1 }, []);
    assert.equal(seen.hasOwnProperty, 5);
    assert.equal(seen.toString, 'x');
    assert.equal(other.hasOwnProperty('a'), true);
    // Copied and spread onto an element through What's own paths.
    const el = document.createElement('div');
    core.mount(core.h('div', { ...render._$omit(seen, ['a']), id: 'kept' }), el);
    assert.notEqual(el.querySelector('#kept'), null);
  });
});
