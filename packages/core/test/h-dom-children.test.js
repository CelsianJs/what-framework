// Regression: h(Component, props, ...children) where a child is a live DOM
// node (e.g. when JSX has been pre-realized by the compiler before being
// handed to a wrapper component like Link). Before the fix, the DOM node
// was stringified to "[object HTMLDivElement]".

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { h } from '../src/h.js';

describe('h() child handling', () => {
  it('preserves a DOM node child as-is (single-child path)', () => {
    // Fake DOM node — duck-typed via nodeType, matching the new contract.
    const fakeDom = { nodeType: 1, nodeName: 'DIV' };
    const vnode = h('a', { href: '/x' }, fakeDom);
    assert.equal(vnode.children.length, 1);
    assert.strictEqual(vnode.children[0], fakeDom);
  });

  it('preserves multiple DOM node children (multi-child path)', () => {
    const a = { nodeType: 1, nodeName: 'DIV' };
    const b = { nodeType: 1, nodeName: 'BUTTON' };
    const vnode = h('a', null, a, b);
    assert.equal(vnode.children.length, 2);
    assert.strictEqual(vnode.children[0], a);
    assert.strictEqual(vnode.children[1], b);
  });

  it('preserves a DOM node nested inside an array child', () => {
    const a = { nodeType: 1, nodeName: 'DIV' };
    const vnode = h('a', null, [a, 'literal']);
    assert.equal(vnode.children.length, 2);
    assert.strictEqual(vnode.children[0], a);
    assert.equal(vnode.children[1], 'literal');
  });

  it('still stringifies plain objects that are not DOM nodes', () => {
    const plain = { foo: 'bar' };
    const vnode = h('a', null, plain);
    assert.equal(vnode.children.length, 1);
    assert.equal(typeof vnode.children[0], 'string');
    assert.equal(vnode.children[0], '[object Object]');
  });

  it('still passes through vnodes via the vnode branch', () => {
    const child = { _vnode: true, tag: 'span', props: {}, children: [], key: null };
    const vnode = h('div', null, child);
    assert.strictEqual(vnode.children[0], child);
  });
});
