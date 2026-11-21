// A vnode is recognised by a brand data cannot carry (review finding M7).
//
// Any JSON object shaped { "tag", "props", "children" } and flagged _vnode
// used to render as an element on every path, dangerouslySetInnerHTML
// included: `<div>{data.label}</div>` with data from an API wrote the API's
// markup into the page. A vnode is now an instance of what-core's VNode class,
// recognised by a private field, and every renderer asks that brand before it
// treats an object as an element. Here: the client's paths (mount, a compiled
// insert, hydrate), and the ways a value can try to carry the brand.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();

const { h, mount, hydrate, createStore, derived } = await import('../src/index.js');
const { insert } = await import('../src/render.js');
const { isVNode } = await import('../src/entries/internal.js');

const HOSTILE = '<img src=x onerror=alert(1)>';
const forged = () => JSON.parse(`{"label":{"_vnode":true,"tag":"div","props":{"dangerouslySetInnerHTML":{"__html":${JSON.stringify(HOSTILE)}}},"children":[],"key":null}}`).label;

describe('what can carry the vnode brand', () => {
  it('a vnode h(), the JSX runtime and the boundaries make', async () => {
    const { jsx } = await import('../src/jsx-runtime.js');
    const { Suspense, ErrorBoundary } = await import('../src/index.js');
    assert.equal(isVNode(h('div', null)), true);
    assert.equal(isVNode(jsx('div', {})), true);
    assert.equal(isVNode(Suspense({ fallback: null, children: [] })), true);
    assert.equal(isVNode(ErrorBoundary({ fallback: null, children: [] })), true);
  });

  it('not JSON, not structuredClone, not a spread copy', () => {
    const real = h('div', { id: 'x' }, 'text');
    assert.equal(isVNode(forged()), false);
    assert.equal(isVNode(JSON.parse(JSON.stringify(real))), false);
    assert.equal(isVNode(structuredClone({ tag: real.tag, props: real.props, children: real.children, key: real.key })), false);
    assert.equal(isVNode({ ...real }), false);
    assert.equal(isVNode(Object.create(Object.getPrototypeOf(real))), false);
  });

  it('not a Proxy that answers every property, nor one around a real vnode', () => {
    const anyKey = new Proxy({}, { get: (_t, key) => (key === 'tag' ? 'div' : key === '_vnode' ? true : undefined), has: () => true });
    assert.equal(isVNode(anyKey), false);
    assert.equal(isVNode(new Proxy(h('div', null), {})), false);
  });

  it('not a store proxy', () => {
    const useStore = createStore({ child: 1, label: derived((state) => state.child) });
    const store = useStore();
    assert.equal(isVNode(store), false);
  });
});

describe('a forged vnode renders as text on the client', () => {
  it('mount()', () => {
    const host = document.createElement('div');
    const stop = mount(h('section', null, forged()), host);
    try {
      assert.equal(host.querySelector('img'), null);
      assert.equal(host.textContent, '[object Object]');
    } finally {
      stop();
    }
  });

  it('a compiled insert()', () => {
    const host = document.createElement('div');
    insert(host, forged());
    assert.equal(host.querySelector('img'), null);
    assert.equal(host.textContent, '[object Object]');
    host.textContent = '';
    insert(host, () => forged());
    assert.equal(host.querySelector('img'), null);
    assert.equal(host.textContent, '[object Object]');
  });

  it('hydrate()', () => {
    const host = document.createElement('div');
    host.innerHTML = '<section>[object Object]</section>';
    const stop = hydrate(h('section', null, forged()), host);
    try {
      assert.equal(host.querySelector('img'), null);
      assert.equal(host.textContent, '[object Object]');
    } finally {
      stop();
    }
  });

  it('a forged vnode in a keyed list is not a keyed row', () => {
    const host = document.createElement('div');
    const stop = mount(h('ul', null, () => [Object.assign(forged(), { key: 1 })]), host);
    try {
      assert.equal(host.querySelector('img'), null);
      assert.equal(host.textContent, '[object Object]');
    } finally {
      stop();
    }
  });
});

describe('two copies of what-core', () => {
  // A server bundle can inline what-core while the renderer imports its own
  // copy (a linked workspace package), and an app can install two versions.
  it('recognise each other\'s vnodes, and still no forged object', async () => {
    const other = await import(new URL('../src/vnode-renderer.js?copy=2', import.meta.url).href);
    assert.notEqual(other.VNode, (await import('../src/vnode-renderer.js')).VNode, 'precondition: a second copy');
    const theirs = new other.VNode('p', {}, ['from the other copy'], null);
    assert.equal(isVNode(theirs), true);
    assert.equal(other.isVNode(h('b', null, 'from this copy')), true);
    assert.equal(isVNode(forged()), false);
    assert.equal(other.isVNode(forged()), false);
    assert.equal(isVNode({ ...theirs }), false, 'a spread carries no brand');

    const host = document.createElement('div');
    const stop = mount(theirs, host);
    try {
      assert.equal(host.innerHTML, '<p>from the other copy</p>');
    } finally {
      stop();
    }
  });
});
