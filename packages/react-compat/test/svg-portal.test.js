// what-react — SVG portal namespace + camelCase SVG attribute mapping (jsdom).
// Run: node --test packages/react-compat/test/svg-portal.test.js
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
for (const k of ['HTMLElement', 'Element', 'Node', 'SVGElement', 'CustomEvent', 'Event', 'MouseEvent', 'KeyboardEvent', 'getComputedStyle', 'DocumentFragment', 'Text', 'Comment']) {
  try { if (!(k in global)) global[k] = dom.window[k]; } catch (e) { /* read-only global */ }
}
try { global.navigator = dom.window.navigator; } catch (e) { /* read-only getter */ }
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);

const React = await import('../src/index.js');
const ReactDOM = await import('../src/dom.js');
const { createElement: h, act } = React;
const { createRoot, createPortal } = ReactDOM;
const SVG_NS = 'http://www.w3.org/2000/svg';

afterEach(() => { document.body.innerHTML = ''; });

function host() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

test('children portaled into an SVG container are created in the SVG namespace', () => {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const gTarget = document.createElementNS(SVG_NS, 'g');
  svg.appendChild(gTarget);
  document.body.appendChild(svg);

  function App() {
    return createPortal(h('path', { d: 'M0 0 L10 10' }), gTarget);
  }
  const root = createRoot(host());
  act(() => root.render(h(App)));

  const path = gTarget.querySelector('path');
  assert.ok(path, 'path should be portaled into the <g>');
  assert.equal(path.namespaceURI, SVG_NS, 'portaled SVG child must be in the SVG namespace');
});

test('camelCase SVG presentation props map to kebab-case attributes', () => {
  function App() {
    return h('svg', null,
      h('path', { d: 'M0 0', strokeWidth: 2, fillOpacity: 0.5, strokeDasharray: '3 3', clipPath: 'url(#c)' }));
  }
  const container = host();
  const root = createRoot(container);
  act(() => root.render(h(App)));

  const path = container.querySelector('path');
  assert.ok(path);
  assert.equal(path.getAttribute('stroke-width'), '2');
  assert.equal(path.getAttribute('fill-opacity'), '0.5');
  assert.equal(path.getAttribute('stroke-dasharray'), '3 3');
  assert.equal(path.getAttribute('clip-path'), 'url(#c)');
});

test('font camelCase SVG props map to kebab-case attributes (recharts tick/axis path)', () => {
  function App() {
    return h('svg', null,
      h('text', {
        fontSize: 12,
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'bold',
      }, 'label'));
  }
  const container = host();
  const root = createRoot(container);
  act(() => root.render(h(App)));

  const text = container.querySelector('text');
  assert.ok(text, '<text> element should be rendered');

  // kebab-case attributes must be set
  assert.equal(text.getAttribute('font-size'), '12', 'font-size attribute should be "12"');
  assert.equal(text.getAttribute('font-family'), 'Arial, sans-serif', 'font-family attribute should be set');
  assert.equal(text.getAttribute('font-weight'), 'bold', 'font-weight attribute should be set');

  // camelCase attributes must NOT be set (invalid in SVG)
  assert.equal(text.getAttribute('fontSize'), null, 'fontSize camelCase must not appear as an attribute');
  assert.equal(text.getAttribute('fontFamily'), null, 'fontFamily camelCase must not appear as an attribute');
  assert.equal(text.getAttribute('fontWeight'), null, 'fontWeight camelCase must not appear as an attribute');
});
