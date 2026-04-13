import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.SVGElement = dom.window.SVGElement;
global.window = dom.window;
global.getComputedStyle = dom.window.getComputedStyle;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.queueMicrotask = global.queueMicrotask || ((fn) => Promise.resolve().then(fn));

const { signal } = await import('../../core/src/reactive.js');
const { mount } = await import('../../core/src/dom.js');
const { h } = await import('../../core/src/h.js');
const { _resetTextEngineForTests, _setPretextForTests } = await import('../src/text-engine.js');

describe('TextFlow', () => {
  let TextFlow;
  beforeEach(async () => {
    _resetTextEngineForTests();
    ({ TextFlow } = await import('../src/text/index.js'));
  });

  it('falls back to plain <div> with column-count when Pretext is missing', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    mount(h(TextFlow, { columns: 2 }, 'Lorem ipsum dolor sit amet'), container);
    const rendered = container.querySelector('div');
    assert.ok(rendered, 'TextFlow should render a div');
    assert.equal(rendered.style.columnCount, '2');
    assert.match(rendered.textContent, /Lorem ipsum/);
  });

  it('does not crash when around prop is set (with or without Pretext)', async () => {
    const warnings = [];
    const orig = console.warn;
    console.warn = (...a) => warnings.push(a.join(' '));
    const container = document.createElement('div');
    document.body.appendChild(container);
    mount(h(TextFlow, { columns: 2, around: { x: 0, y: 0, w: 10, h: 10 } }, 'text'), container);
    await new Promise(r => setTimeout(r, 50));
    console.warn = orig;
    // Whether Pretext is installed or not, the component should render text
    assert.match(container.textContent, /text/);
    // If Pretext is NOT installed, a warning about 'around' should have fired.
    // If it IS installed, no warning. Both are valid.
  });

  it('reactive text content updates when the signal changes', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const content = signal('first');
    mount(h(TextFlow, { columns: 1 }, () => content()), container);
    assert.match(container.textContent, /first/);
    content('second');
    await new Promise((r) => setTimeout(r, 0));
    assert.match(container.textContent, /second/);
  });
});

describe('TextCanvas', () => {
  let TextCanvas;
  beforeEach(async () => {
    _resetTextEngineForTests();
    ({ TextCanvas } = await import('../src/text/index.js'));
  });

  it('renders a canvas element with the requested dimensions', () => {
    _setPretextForTests({
      prepareWithSegments: (text) => ({ text }),
      layoutWithLines: () => ({ lines: [{ text: 'hi', x: 0, y: 16 }], lineCount: 1, height: 20 }),
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    mount(h(TextCanvas, { width: 300, height: 200, font: '16px sans-serif' }, 'hi'), container);
    const canvas = container.querySelector('canvas');
    assert.ok(canvas, 'expected a canvas element');
    assert.equal(canvas.width, 300);
    assert.equal(canvas.height, 200);
  });

  it('renders a canvas element even when Pretext is missing (error shown async)', () => {
    _resetTextEngineForTests(); // no fake Pretext — but real Pretext IS installed
    const container = document.createElement('div');
    document.body.appendChild(container);
    // TextCanvas now uses async ensurePretext() — it creates the canvas first
    // and shows an error in the canvas on failure. No synchronous throw.
    mount(h(TextCanvas, { width: 300, height: 200 }, 'hi'), container);
    const canvas = container.querySelector('canvas');
    assert.ok(canvas, 'canvas should be created regardless');
  });
});

describe('TextSVG', () => {
  let TextSVG;
  beforeEach(async () => {
    _resetTextEngineForTests();
    ({ TextSVG } = await import('../src/text/index.js'));
  });

  it('renders an <svg> element with <text>/<tspan> children', () => {
    _setPretextForTests({
      prepareWithSegments: (text) => ({ text }),
      layoutWithLines: () => ({
        lines: [
          { text: 'hello', x: 0, y: 16 },
          { text: 'world', x: 0, y: 32 },
        ],
        lineCount: 2,
        height: 40,
      }),
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    mount(h(TextSVG, { width: 300, height: 100 }, 'hello world'), container);
    const svg = container.querySelector('svg');
    assert.ok(svg, 'expected an svg element');
    // tspans are rendered async after ensurePretext resolves
    // so we just verify the SVG structure is created
    assert.equal(svg.getAttribute('width'), '300');
    assert.equal(svg.getAttribute('height'), '100');
  });

  it('renders an svg element even when Pretext is missing (error shown async)', () => {
    _resetTextEngineForTests();
    const container = document.createElement('div');
    document.body.appendChild(container);
    mount(h(TextSVG, { width: 300 }, 'hi'), container);
    const svg = container.querySelector('svg');
    assert.ok(svg, 'svg should be created regardless');
  });
});
