// Runtime helpers behind the compiler's output: lazy templates with the
// namespace flag (T2-7), the textContent fast path for a sole child (T2-3),
// classList objects and refs (T2-15), and the props object a component gets
// (T2-8).

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM();

const { signal, flushSync } = await import('../src/reactive.js');
const { _$template, insert, setClassList, setProp, applyRef, className, _$createComponent } = await import('../src/render.js');
const { h } = await import('../src/h.js');
const { mount } = await import('../src/dom.js');
const { jsx } = await import('../src/jsx-runtime.js');
const { jsxDEV } = await import('../src/jsx-dev-runtime.js');

const SVG_NS = 'http://www.w3.org/2000/svg';
const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';

let container;
beforeEach(() => {
  container = document.getElementById('app');
  container.textContent = '';
});

describe('_$template', () => {
  it('throws in development for an SVG or MathML root without the namespace flag', () => {
    // The previous compiler emitted these without a flag and relied on the
    // runtime to detect the namespace; the runtime no longer does.
    for (const html of ['<circle r="1"></circle>', '<g></g>', '<clipPath></clipPath>', '<mi>x</mi>', '<mrow></mrow>']) {
      const tmpl = _$template(html);
      assert.throws(() => tmpl(), (err) => err.code === 'ERR_TEMPLATE_NAMESPACE', html);
    }
    assert.equal(_$template('<svg><circle r="1"></circle></svg>', 2)().namespaceURI, SVG_NS);
    for (const html of ['<main></main>', '<mark></mark>', '<menu></menu>', '<meter></meter>', '<svg></svg>', '<math></math>', '<x-g></x-g>']) {
      assert.doesNotThrow(() => _$template(html)(), html);
    }
  });

  it('parses on first use, not when defined', () => {
    const original = document.createElement;
    let created = 0;
    document.createElement = function (...args) { created++; return original.apply(this, args); };
    try {
      const build = _$template('<div class=a>x');
      assert.equal(created, 0, 'defining a template touches no DOM');
      build();
      build();
      assert.equal(created, 1, 'parsed once, then cloned');
    } finally {
      document.createElement = original;
    }
  });

  it('unwraps an SVG root the compiler wrapped (flag 2)', () => {
    const path = _$template('<svg><path d=M0>', 2)();
    assert.equal(path.localName, 'path');
    assert.equal(path.namespaceURI, SVG_NS);
    assert.equal(path.getAttribute('d'), 'M0');
  });

  it('unwraps a MathML root the compiler wrapped (flag 2)', () => {
    const mi = _$template('<math><mi>x', 2)();
    assert.equal(mi.localName, 'mi');
    assert.equal(mi.namespaceURI, MATHML_NS);
  });

  it('parses minified markup: unquoted values and omitted closing tags', () => {
    const el = _$template('<div id=a class="b c"title=t><span>x</span><i>y')();
    assert.equal(el.outerHTML, '<div id="a" class="b c" title="t"><span>x</span><i>y</i></div>');
  });
});

describe('insert text fast path', () => {
  it('sets the only child with textContent', () => {
    const original = document.createTextNode;
    let created = 0;
    document.createTextNode = function (...args) { created++; return original.apply(this, args); };
    const label = signal('a');
    try {
      const p = document.createElement('p');
      insert(p, 'static');
      const q = document.createElement('p');
      insert(q, () => label());
      assert.equal(created, 0);
      assert.equal(p.textContent, 'static');
      assert.equal(q.textContent, 'a');
      label('b');
      flushSync();
      assert.equal(q.textContent, 'b');
      assert.equal(q.childNodes.length, 1, 'updates write the same text node');
    } finally {
      document.createTextNode = original;
    }
  });

  it('appends when the element already has content, and keeps an empty string as a node', () => {
    const p = document.createElement('p');
    p.appendChild(document.createElement('b'));
    insert(p, 'tail');
    assert.equal(p.innerHTML, '<b></b>tail');

    const label = signal('');
    const q = document.createElement('p');
    insert(q, () => label());
    assert.equal(q.childNodes.length, 1);
    label('now');
    flushSync();
    assert.equal(q.textContent, 'now');
  });

  it('inserts before a marker and appends for a null marker', () => {
    const p = document.createElement('p');
    const tail = document.createElement('b');
    p.appendChild(tail);
    insert(p, 'x', tail);
    insert(p, 'y', null);
    assert.equal(p.innerHTML, 'x<b></b>y');
  });
});

describe('classList', () => {
  it('toggles each key and removes keys a previous object had', () => {
    const el = document.createElement('div');
    el.className = 'keep';
    setClassList(el, { a: true, 'b c': 1, d: false });
    assert.equal(el.className, 'keep a b c');
    setClassList(el, { a: false, e: () => true });
    assert.equal(el.className, 'keep e');
    setClassList(el, null);
    assert.equal(el.className, 'keep');
  });

  it('is reactive through an accessor and never renders [object Object]', () => {
    const on = signal(false);
    const el = document.createElement('div');
    setProp(el, 'classList', () => ({ on: on(), always: true }));
    assert.equal(el.getAttribute('class'), 'always');
    on(true);
    flushSync();
    assert.equal(el.getAttribute('class'), 'always on');
  });

  it('works through h() as well', () => {
    const on = signal(true);
    mount(h('div', { classList: () => ({ on: on() }) }), container);
    assert.equal(container.firstChild.className, 'on');
    on(false);
    flushSync();
    assert.equal(container.firstChild.className, '');
  });
});

describe('className', () => {
  it('writes className; null, undefined and false write no attribute, and 0 is its text, as on the server', () => {
    const el = document.createElement('div');
    className(el, 'a');
    assert.equal(el.className, 'a');
    className(el, 0);
    assert.equal(el.className, '0');
    for (const none of [null, undefined, false]) {
      className(el, 'a');
      className(el, none);
      assert.equal(el.getAttribute('class'), null, String(none));
    }
    const cls = signal('x');
    className(el, () => cls());
    cls('y');
    flushSync();
    assert.equal(el.className, 'y');
  });
});

describe('applyRef', () => {
  it('calls a callback, sets a ref object and hands back the element otherwise', () => {
    const el = document.createElement('div');
    const seen = [];
    const fn = (node) => seen.push(node);
    assert.equal(applyRef(fn, el), fn);
    assert.deepEqual(seen, [el]);
    const ref = { current: null };
    assert.equal(applyRef(ref, el), ref);
    assert.equal(ref.current, el);
    assert.equal(applyRef(undefined, el), el);
    assert.equal(applyRef(null, el), el);
  });

  it('hands back the new element when the ref still holds an earlier one', () => {
    const old = document.createElement('input');
    const next = document.createElement('input');
    assert.equal(applyRef(old, next), next);
    assert.equal('current' in old, false);
  });

  it('keeps a compiled let ref on the live element when a branch re-creates it', async () => {
    const mod = await loadCompiled(`
      import { signal } from 'what-framework';
      export const editing = signal(true);
      export let getInput;
      function Editor() {
        let input;
        getInput = () => input;
        return <div>{editing() ? <input ref={input} /> : <span>view</span>}</div>;
      }
      export const App = () => <Editor />;
    `);
    const unmount = mount(mod.App, container);
    assert.equal(mod.getInput(), container.querySelector('input'));
    mod.editing(false);
    flushSync();
    mod.editing(true);
    flushSync();
    const live = container.querySelector('input');
    assert.equal(mod.getInput(), live);
    assert.ok(live.isConnected);
    unmount();
  });
});

describe('component props', () => {
  it('are a plain object, as React\'s props are', () => {
    let seen;
    function Probe(props) { seen = props; return null; }
    _$createComponent(Probe, { a: 1 }, ['kid']);
    assert.equal(seen.a, 1);
    assert.equal(seen.children, 'kid');
    assert.equal(Object.getPrototypeOf(seen), Object.prototype);
    assert.equal(seen.hasOwnProperty('a'), true); // eslint-disable-line no-prototype-builtins
    assert.deepEqual(Object.keys(seen), ['a', 'children']);
  });

  it('reject writes in development', () => {
    function Writer(props) { props.a = 2; return null; }
    assert.throws(() => _$createComponent(Writer, { a: 1 }, []), TypeError);
  });

  it('come from the caller unchanged: no copy of the caller object is written to', () => {
    const shared = { a: 1 };
    function Probe() { return null; }
    _$createComponent(Probe, shared, ['kid']);
    assert.deepEqual(Object.keys(shared), ['a']);
  });
});

describe('automatic JSX runtime', () => {
  it('builds one props object without key or children', () => {
    const vnode = jsx('div', { id: 'x', children: ['a', 'b'] }, 'k');
    assert.equal(vnode.key, 'k');
    assert.deepEqual(Object.keys(vnode.props), ['id']);
    assert.deepEqual(vnode.children, ['a', 'b']);
  });

  it('takes the key from the argument over a spread-in key', () => {
    assert.equal(jsx('div', { key: 'spread' }, 'arg').key, 'arg');
    assert.equal(jsx('div', { key: 'spread' }).key, 'spread');
    assert.equal(jsx('div', {}).key, null);
    assert.equal('key' in jsx('div', { key: 'spread' }).props, false);
  });

  it('flattens children like h()', () => {
    const fromJsx = jsx('ul', { children: [['a', null, ['b']], false, 1] });
    const fromH = h('ul', null, ['a', null, ['b']], false, 1);
    assert.deepEqual(fromJsx.children, fromH.children);
  });

  it('copies own props only', () => {
    const props = Object.assign(Object.create({ title: 'inherited' }), { id: 'own' });
    const vnode = jsx('div', props);
    assert.deepEqual(Object.keys(vnode.props), ['id']);
    const unmount = mount(vnode, container);
    assert.equal(container.firstChild.id, 'own');
    assert.equal(container.firstChild.title, '');
    unmount();
  });

  it('is the dev runtime too', () => {
    assert.equal(jsxDEV('p', { children: 'x' }, undefined).children[0], 'x');
  });

  it('h() strips key without leaving it on props', () => {
    const vnode = h('li', { key: 3, title: 't' });
    assert.equal(vnode.key, 3);
    assert.deepEqual(Object.keys(vnode.props), ['title']);
  });
});
