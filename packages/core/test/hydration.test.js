// Tests for DOM hydration — server renders HTML, client reuses DOM nodes.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Set up DOM globals before importing framework modules
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.SVGElement = dom.window.SVGElement;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.queueMicrotask = global.queueMicrotask || ((fn) => Promise.resolve().then(fn));

if (!global.customElements) {
  const registry = new Map();
  global.customElements = {
    get: (name) => registry.get(name),
    define: (name, cls) => registry.set(name, cls),
  };
}

const { h } = await import('../src/h.js');
const { hydrate, isHydrating } = await import('../src/render.js');
const { renderToString, renderToHydratableString } = await import('../../server/src/index.js');

function getContainer() {
  const el = document.getElementById('app');
  el.textContent = '';
  return el;
}

// Helper: flush microtask queue
async function flush() {
  await new Promise(r => queueMicrotask(r));
  await new Promise(r => queueMicrotask(r));
}

// =========================================================================
// Basic Hydration
// =========================================================================

describe('hydrate()', () => {
  it('should reuse existing DOM elements', () => {
    const container = getContainer();
    // Simulate server-rendered HTML
    container.innerHTML = '<div><h1>Hello</h1><p>World</p></div>';

    const originalDiv = container.firstChild;
    const originalH1 = originalDiv.firstChild;
    const originalP = originalDiv.children[1];

    // Hydrate with matching vnode
    const vnode = h('div', null, h('h1', null, 'Hello'), h('p', null, 'World'));
    hydrate(vnode, container);

    // DOM nodes should be the SAME references (reused, not recreated)
    assert.equal(container.firstChild, originalDiv, 'div should be reused');
    assert.equal(container.firstChild.firstChild, originalH1, 'h1 should be reused');
    assert.equal(container.firstChild.children[1], originalP, 'p should be reused');
  });

  it('should reuse text nodes', () => {
    const container = getContainer();
    container.innerHTML = '<div>Hello World</div>';

    const originalDiv = container.firstChild;
    const originalText = originalDiv.firstChild;

    const vnode = h('div', null, 'Hello World');
    hydrate(vnode, container);

    assert.equal(container.firstChild, originalDiv);
    assert.equal(container.firstChild.firstChild, originalText);
    assert.equal(container.firstChild.textContent, 'Hello World');
  });

  it('should attach event handlers to existing elements', () => {
    const container = getContainer();
    container.innerHTML = '<button>Click me</button>';

    let clicked = false;
    const vnode = h('button', { onclick: () => { clicked = true; } }, 'Click me');
    hydrate(vnode, container);

    // Simulate click
    const btn = container.firstChild;
    btn.dispatchEvent(new dom.window.Event('click'));
    assert.ok(clicked, 'Event handler should be attached');
  });

  it('should hydrate nested components', () => {
    const container = getContainer();
    container.innerHTML = '<div><span>Greeting: Alice</span></div>';

    function Greeting({ name }) {
      return h('span', null, 'Greeting: ', name);
    }

    const vnode = h('div', null, h(Greeting, { name: 'Alice' }));
    hydrate(vnode, container);

    assert.equal(container.firstChild.textContent, 'Greeting: Alice');
  });

  it('should not be in hydrating state after hydration completes', () => {
    const container = getContainer();
    container.innerHTML = '<div>Test</div>';

    assert.equal(isHydrating(), false, 'Should not be hydrating before');
    hydrate(h('div', null, 'Test'), container);
    assert.equal(isHydrating(), false, 'Should not be hydrating after');
  });
});

// =========================================================================
// Hydration with attributes
// =========================================================================

describe('hydrate() with attributes', () => {
  it('should preserve existing attributes from SSR', () => {
    const container = getContainer();
    container.innerHTML = '<div class="my-class" id="main">Content</div>';

    const vnode = h('div', { class: 'my-class', id: 'main' }, 'Content');
    hydrate(vnode, container);

    const div = container.firstChild;
    assert.equal(div.className, 'my-class');
    assert.equal(div.id, 'main');
  });

  it('should attach delegated event handlers', () => {
    const container = getContainer();
    container.innerHTML = '<button>Click</button>';

    let clicked = false;
    const vnode = h('button', { '$$click': () => { clicked = true; } }, 'Click');
    hydrate(vnode, container);

    const btn = container.firstChild;
    assert.equal(btn.$$click != null, true, 'Delegated handler should be attached');
  });
});

// =========================================================================
// Hydration Mismatch Detection
// =========================================================================

describe('hydrate() mismatch handling', () => {
  it('should handle tag name mismatch by falling back to client render', () => {
    const container = getContainer();
    container.innerHTML = '<span>Mismatch</span>';

    // Hydrate with a div instead of span
    const vnode = h('div', null, 'Mismatch');
    hydrate(vnode, container);

    // Should fall back and create the correct element
    assert.equal(container.firstChild.tagName, 'DIV');
    assert.equal(container.firstChild.textContent, 'Mismatch');
  });

  it('should handle empty container gracefully', () => {
    const container = getContainer();
    // Container is empty

    const vnode = h('div', null, 'New content');
    hydrate(vnode, container);

    // Should create the element since there's nothing to reuse
    assert.equal(container.firstChild.tagName, 'DIV');
    assert.equal(container.firstChild.textContent, 'New content');
  });
});

// =========================================================================
// Hydratable String (server-side markers)
// =========================================================================

describe('renderToHydratableString()', () => {
  it('should render basic elements the same as renderToString', () => {
    const vnode = h('div', null, 'Hello');
    const hydratable = renderToHydratableString(vnode);
    assert.ok(hydratable.includes('<div>'));
    assert.ok(hydratable.includes('Hello'));
    assert.ok(hydratable.includes('</div>'));
  });

  it('should add data-hk attributes to component roots', () => {
    function App() {
      return h('div', null, 'App');
    }
    const hydratable = renderToHydratableString(h(App, null));
    assert.ok(hydratable.includes('data-hk='), `Expected data-hk in: ${hydratable}`);
  });

  it('should add dynamic content markers for reactive functions', () => {
    const vnode = {
      tag: 'div',
      props: {},
      children: [() => 'dynamic'],
      key: null,
      _vnode: true,
    };
    const hydratable = renderToHydratableString(vnode);
    assert.ok(hydratable.includes('<!--$-->'), `Expected <!--$--> in: ${hydratable}`);
    assert.ok(hydratable.includes('<!--/$-->'), `Expected <!--/$--> in: ${hydratable}`);
  });

  it('should add list markers for arrays', () => {
    const items = [h('li', null, 'A'), h('li', null, 'B')];
    // Render the array directly
    const hydratable = renderToHydratableString(items);
    assert.ok(hydratable.includes('<!--[]-->'), `Expected <!--[]--> in: ${hydratable}`);
    assert.ok(hydratable.includes('<!--/[]-->'), `Expected <!--/[]--> in: ${hydratable}`);
  });

  it('should produce HTML that can be hydrated', () => {
    function Greeting({ name }) {
      return h('span', null, 'Hello ', name);
    }

    const vnode = h('div', null, h(Greeting, { name: 'World' }));
    const html = renderToHydratableString(vnode);

    // Set up container with server HTML
    const container = getContainer();
    container.innerHTML = html;

    // Verify the HTML was rendered
    assert.ok(container.querySelector('span'));
    assert.ok(container.textContent.includes('Hello World'));

    // Now hydrate — should reuse existing nodes
    const originalSpan = container.querySelector('span');
    hydrate(vnode, container);

    // The span should be reused (same reference)
    assert.equal(container.querySelector('span'), originalSpan, 'Span should be reused during hydration');
  });
});
