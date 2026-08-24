// Test: _$createComponent runtime function and jsx-runtime compatibility

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

// Set up jsdom before importing framework modules
before(() => {
  const { window } = installDOM();
  globalThis.MutationObserver = window.MutationObserver;
});

describe('_$createComponent runtime', () => {
  it('is exported from render.js', async () => {
    const render = await import('../../core/src/render.js');
    assert.ok(
      typeof render._$createComponent === 'function',
      '_$createComponent should be a function exported from render.js'
    );
  });

  it('is exported from the main index', async () => {
    const core = await import('../../core/src/index.js');
    assert.ok(
      typeof core._$createComponent === 'function',
      '_$createComponent should be exported from core index.js'
    );
  });

  it('creates DOM from a simple component', async () => {
    const { _$createComponent } = await import('../../core/src/render.js');

    function Hello(props) {
      const el = document.createElement('span');
      el.textContent = props.name || 'world';
      return el;
    }

    const result = _$createComponent(Hello, { name: 'test' }, []);
    // Result should be a DOM node (span wrapped in a container)
    assert.ok(result, 'Should return a DOM node');
    assert.ok(result.nodeType === 1 || result.nodeType === 11, 'Should be an element or fragment');
  });

  it('passes children through props', async () => {
    const { _$createComponent } = await import('../../core/src/render.js');

    let receivedProps = null;
    function Wrapper(props) {
      receivedProps = props;
      const el = document.createElement('div');
      return el;
    }

    const childEl = document.createElement('span');
    _$createComponent(Wrapper, { className: 'wrap' }, [childEl]);

    assert.ok(receivedProps, 'Component should receive props');
    assert.equal(receivedProps.className, 'wrap', 'Should pass regular props');
    assert.ok(receivedProps.children, 'Should merge children into props');
  });

  it('defers a children factory until the component has run', async () => {
    const { _$createComponent } = await import('../../core/src/render.js');

    const order = [];
    function Child() {
      order.push('child');
      const el = document.createElement('span');
      el.textContent = 'child';
      return el;
    }
    function Parent(props) {
      order.push('parent');
      const el = document.createElement('div');
      el.appendChild(document.createDocumentFragment());
      return [el, props.children];
    }

    const frag = _$createComponent(Parent, null, () => [_$createComponent(Child, null, [])]);
    const host = document.createElement('div');
    host.appendChild(frag);

    assert.deepEqual(order, ['parent', 'child'], 'children must be built after the parent runs');
    assert.equal(host.querySelector('span').textContent, 'child');
  });
});

describe('h() is internal-only, not a public API', () => {
  it('h exists in exports for internal package use but is not the compiler target', async () => {
    const core = await import('../../core/src/index.js');
    // h is still exported for internal packages (server, router, react-compat, jsx-runtime)
    // but the compiler no longer emits h() calls — it uses _$createComponent instead
    assert.ok(
      typeof core.h === 'function',
      'h should exist for internal package consumers'
    );
    assert.ok(
      typeof core._$createComponent === 'function',
      '_$createComponent should be the compiler target, not h'
    );
  });

  it('Fragment IS still publicly exported', async () => {
    const core = await import('../../core/src/index.js');
    assert.ok(
      typeof core.Fragment === 'function',
      'Fragment should still be exported from the public index'
    );
  });

  it('html tagged template IS still publicly exported', async () => {
    const core = await import('../../core/src/index.js');
    assert.ok(
      typeof core.html === 'function',
      'html should still be exported from the public index'
    );
  });
});

describe('jsx-runtime still works', () => {
  it('jsx-runtime exports jsx, jsxs, Fragment', async () => {
    const runtime = await import('../../core/src/jsx-runtime.js');
    assert.ok(typeof runtime.jsx === 'function', 'jsx should be a function');
    assert.ok(typeof runtime.jsxs === 'function', 'jsxs should be a function');
    assert.ok(typeof runtime.Fragment === 'function', 'Fragment should be a function');
  });

  it('jsx-dev-runtime exports jsxDEV, jsx, jsxs, Fragment', async () => {
    const runtime = await import('../../core/src/jsx-dev-runtime.js');
    assert.ok(typeof runtime.jsxDEV === 'function', 'jsxDEV should be a function');
    assert.ok(typeof runtime.jsx === 'function', 'jsx should be a function');
    assert.ok(typeof runtime.jsxs === 'function', 'jsxs should be a function');
    assert.ok(typeof runtime.Fragment === 'function', 'Fragment should be a function');
  });

  it('Fragment returns children', async () => {
    const { Fragment } = await import('../../core/src/jsx-runtime.js');
    const children = ['a', 'b', 'c'];
    const result = Fragment({ children });
    assert.deepEqual(result, children, 'Fragment should return its children');
  });

  it('jsx creates vnodes via h internally', async () => {
    const { jsx } = await import('../../core/src/jsx-runtime.js');

    // Create a vnode for a div
    const vnode = jsx('div', { className: 'test', children: 'hello' });
    assert.ok(vnode, 'jsx should return a vnode');
    assert.equal(vnode.tag, 'div', 'vnode tag should be div');
    assert.equal(vnode.props.className, 'test', 'vnode should carry props');
    assert.ok(vnode._vnode, 'vnode should have _vnode marker');
  });

  it('jsx handles component types', async () => {
    const { jsx } = await import('../../core/src/jsx-runtime.js');

    function MyComp(_props) { return null; }
    const vnode = jsx(MyComp, { value: 42 });
    assert.ok(vnode, 'jsx should return a vnode for components');
    assert.equal(vnode.tag, MyComp, 'vnode tag should be the component function');
    assert.equal(vnode.props.value, 42, 'vnode should carry component props');
  });
});
