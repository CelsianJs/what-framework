// Regression for the missing element brand found in the 2026-08-09 parity audit.
//
// Ecosystem libraries do not duck-type React elements, they check
// `element.$$typeof`. MUI, emotion, styled-components, recharts and react-select
// all gate on it before treating a value as renderable, so compat elements were
// classified as plain objects and silently rendered nothing.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createElement, isValidElement, memo, lazy, Suspense, forwardRef } from '../src/index.js';

const REACT_ELEMENT_TYPE = Symbol.for('react.element');

describe('elements carry the React brand', () => {
  it('brands host elements', () => {
    assert.equal(createElement('div', null, 'hi').$$typeof, REACT_ELEMENT_TYPE);
  });

  it('brands component elements', () => {
    const Comp = () => null;
    assert.equal(createElement(Comp, null).$$typeof, REACT_ELEMENT_TYPE);
  });

  it('uses the exact symbol libraries compare against', () => {
    // Symbol.for is cross-realm, which is the whole point: a library resolving
    // the symbol from its own module must get the identical value.
    const el = createElement('span', null);
    assert.equal(el.$$typeof, Symbol.for('react.element'));
    assert.equal(typeof el.$$typeof, 'symbol');
  });

  it('still exposes the props and type libraries read alongside the brand', () => {
    const Comp = () => null;
    const el = createElement(Comp, { title: 'x' }, 'child');
    assert.equal(el.type, Comp, 'element.type must stay the original component');
    assert.equal(el.props.title, 'x');
    assert.equal(el.props.children, 'child');
  });

  it('isValidElement accepts a branded element', () => {
    assert.equal(isValidElement(createElement('div', null)), true);
  });

  // The brand is what makes React elements XSS-safe against JSON injection: a
  // symbol cannot survive JSON.parse, so attacker-supplied data can never
  // impersonate an element.
  it('a JSON payload cannot forge an element', () => {
    const forged = JSON.parse(JSON.stringify(createElement('div', { dangerous: true })));
    assert.equal(forged.$$typeof, undefined, 'the brand must not survive serialization');
  });
});

describe('component wrappers carry their own brands', () => {
  it('memo brands itself and exposes the wrapped component for unwrapping', () => {
    const Comp = () => null;
    const Memoized = memo(Comp);
    assert.equal(Memoized.$$typeof, Symbol.for('react.memo'));
    assert.equal(Memoized.type, Comp, 'libraries unwrap via .type to reach the component');
  });

  it('lazy is branded', () => {
    assert.equal(lazy(async () => ({ default: () => null })).$$typeof, Symbol.for('react.lazy'));
  });

  it('Suspense is branded', () => {
    assert.equal(Suspense.$$typeof, Symbol.for('react.suspense'));
  });

  it('forwardRef keeps its existing brand', () => {
    assert.equal(forwardRef(() => null).$$typeof, Symbol.for('react.forward_ref'));
  });
});
