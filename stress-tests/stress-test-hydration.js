// Stress Test: Hydration - render to string, parse HTML, hydrate, verify DOM reuse
import { describe, it } from 'node:test';
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

const { h } = await import('../packages/core/src/h.js');
const { hydrate } = await import('../packages/core/src/render.js');
const { renderToString, renderToHydratableString } = await import('../packages/server/src/index.js');

function getContainer() {
  const el = document.getElementById('app');
  el.textContent = '';
  return el;
}

describe('STRESS: Full SSR -> Hydration round-trip', () => {

  it('SSR simple element -> hydrate -> DOM reused', () => {
    const vnode = h('div', { class: 'test' }, h('h1', null, 'Title'), h('p', null, 'Body'));
    const html = renderToString(vnode);

    assert.ok(html.includes('<div'), 'SSR should produce div');
    assert.ok(html.includes('Title'), 'SSR should include title');

    const container = getContainer();
    container.innerHTML = html;

    const originalDiv = container.firstChild;
    const originalH1 = originalDiv.firstChild;

    hydrate(vnode, container);

    assert.equal(container.firstChild, originalDiv, 'Root div should be reused');
    assert.equal(container.firstChild.firstChild, originalH1, 'h1 should be reused');
  });

  it('SSR component -> hydrate -> text content preserved', () => {
    function Card({ title, body }) {
      return h('div', { class: 'card' },
        h('h2', null, title),
        h('p', null, body)
      );
    }

    const vnode = h(Card, { title: 'Hello', body: 'World' });
    const html = renderToString(vnode);

    assert.ok(html.includes('Hello'), 'SSR should include component content');

    const container = getContainer();
    container.innerHTML = html;
    hydrate(vnode, container);

    assert.ok(container.textContent.includes('Hello'));
    assert.ok(container.textContent.includes('World'));
  });

  it('SSR nested components -> hydrate -> correct structure', () => {
    function Inner({ text }) {
      return h('span', null, text);
    }
    function Outer() {
      return h('div', null,
        h(Inner, { text: 'A' }),
        h(Inner, { text: 'B' }),
        h(Inner, { text: 'C' })
      );
    }

    const vnode = h(Outer, null);
    const html = renderToString(vnode);

    const container = getContainer();
    container.innerHTML = html;
    hydrate(vnode, container);

    const spans = container.querySelectorAll('span');
    assert.ok(spans.length >= 3, `Expected at least 3 spans, got ${spans.length}`);
  });

  it('SSR list -> hydrate -> items preserved', () => {
    const items = ['Apple', 'Banana', 'Cherry'];
    const vnode = h('ul', null,
      ...items.map(item => h('li', null, item))
    );

    const html = renderToString(vnode);
    assert.ok(html.includes('Apple'));

    const container = getContainer();
    container.innerHTML = html;

    const originalUl = container.firstChild;
    hydrate(vnode, container);

    assert.equal(container.firstChild, originalUl, 'ul should be reused');
    assert.equal(container.querySelectorAll('li').length, 3);
  });

  it('SSR with attributes -> hydrate -> attributes preserved', () => {
    const vnode = h('input', {
      type: 'text',
      placeholder: 'Enter name',
      'data-testid': 'name-input',
      'aria-label': 'Name',
    });

    const html = renderToString(vnode);
    assert.ok(html.includes('placeholder'));

    const container = getContainer();
    container.innerHTML = html;

    const originalInput = container.firstChild;
    hydrate(vnode, container);

    const input = container.firstChild;
    assert.equal(input, originalInput, 'Input should be reused');
    assert.equal(input.getAttribute('type'), 'text');
    assert.equal(input.getAttribute('data-testid'), 'name-input');
  });

  it('SSR -> hydrate -> event handlers work after hydration', () => {
    let clicked = false;
    const vnode = h('button', { onclick: () => { clicked = true; } }, 'Click');

    const html = renderToString(vnode);
    const container = getContainer();
    container.innerHTML = html;

    hydrate(vnode, container);

    const btn = container.querySelector('button') || container.firstChild;
    btn.dispatchEvent(new dom.window.Event('click'));
    assert.ok(clicked, 'Event handler should work after hydration');
  });

  it('renderToHydratableString -> hydrate full round trip', () => {
    function App() {
      return h('main', null,
        h('header', null, h('h1', null, 'My App')),
        h('section', null,
          h('p', null, 'Welcome'),
          h('ul', null,
            h('li', null, 'Feature 1'),
            h('li', null, 'Feature 2')
          )
        ),
        h('footer', null, 'Copyright 2024')
      );
    }

    const vnode = h(App, null);
    const html = renderToHydratableString(vnode);

    assert.ok(html.includes('My App'));
    assert.ok(html.includes('Feature 1'));

    const container = getContainer();
    container.innerHTML = html;

    const originalHeader = container.querySelector('header');
    hydrate(vnode, container);

    // Verify structure is correct
    assert.ok(container.querySelector('header'), 'header should exist');
    assert.ok(container.querySelector('main'), 'main should exist');
    assert.equal(container.querySelectorAll('li').length, 2);
  });

  it('hydrate mismatch: different tag should fall back gracefully', () => {
    const container = getContainer();
    container.innerHTML = '<span>Old</span>';

    const vnode = h('div', null, 'New');
    hydrate(vnode, container);

    // Should create correct element despite mismatch
    assert.equal(container.firstChild.tagName, 'DIV');
    assert.equal(container.firstChild.textContent, 'New');
  });

  it('hydrate empty container creates fresh DOM', () => {
    const container = getContainer();
    // Container is empty

    const vnode = h('div', null, h('p', null, 'Fresh'));
    hydrate(vnode, container);

    assert.equal(container.firstChild.tagName, 'DIV');
    assert.equal(container.querySelector('p').textContent, 'Fresh');
  });
});
