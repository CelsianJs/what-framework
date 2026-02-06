// Tests for What Framework - Hyperscript / VNode creation
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { h, Fragment } from '../src/h.js';

describe('h()', () => {
  it('should create a VNode for an element', () => {
    const vnode = h('div', { class: 'test' }, 'Hello');
    assert.equal(vnode.tag, 'div');
    assert.deepEqual(vnode.props, { class: 'test' });
    assert.deepEqual(vnode.children, ['Hello']);
    assert.equal(vnode.key, null);
    assert.equal(vnode._vnode, true);
  });

  it('should handle null props', () => {
    const vnode = h('span', null, 'text');
    assert.deepEqual(vnode.props, {});
    assert.deepEqual(vnode.children, ['text']);
  });

  it('should extract key from props', () => {
    const vnode = h('li', { key: 'a', id: 'item' }, 'A');
    assert.equal(vnode.key, 'a');
    assert.equal(vnode.props.key, undefined); // stripped
    assert.equal(vnode.props.id, 'item');
  });

  it('should flatten nested children', () => {
    const vnode = h('div', null, 'A', ['B', 'C'], 'D');
    assert.deepEqual(vnode.children, ['A', 'B', 'C', 'D']);
  });

  it('should filter out null/undefined/boolean children', () => {
    const vnode = h('div', null, 'A', null, false, undefined, true, 'B');
    assert.deepEqual(vnode.children, ['A', 'B']);
  });

  it('should convert numbers to strings', () => {
    const vnode = h('span', null, 42);
    assert.deepEqual(vnode.children, ['42']);
  });

  it('should handle component functions as tag', () => {
    function MyComp() {}
    const vnode = h(MyComp, { foo: 'bar' });
    assert.equal(vnode.tag, MyComp);
    assert.deepEqual(vnode.props, { foo: 'bar' });
  });

  it('should handle nested VNodes', () => {
    const inner = h('span', null, 'inner');
    const outer = h('div', null, inner);
    assert.equal(outer.children.length, 1);
    assert.equal(outer.children[0].tag, 'span');
  });
});

describe('Fragment', () => {
  it('should return children', () => {
    const result = Fragment({ children: ['A', 'B'] });
    assert.deepEqual(result, ['A', 'B']);
  });
});
