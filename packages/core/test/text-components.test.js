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

const { signal } = await import('../src/reactive.js');
const { mount } = await import('../src/dom.js');
const { h } = await import('../src/h.js');
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
      prepare: (text) => ({ text }),
      layout: () => ({ lines: [{ text: 'hi', x: 0, y: 16 }] }),
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    mount(h(TextCanvas, { width: 300, height: 200, font: '16px sans-serif' }, 'hi'), container);
    const canvas = container.querySelector('canvas');
    assert.ok(canvas, 'expected a canvas element');
    assert.equal(canvas.width, 300);
    assert.equal(canvas.height, 200);
  });

  it('throws a clear error when Pretext is missing', () => {
    _resetTextEngineForTests(); // ensure no fake Pretext
    const container = document.createElement('div');
    document.body.appendChild(container);
    assert.throws(
      () => mount(h(TextCanvas, { width: 300, height: 200 }, 'hi'), container),
      (err) => {
        assert.match(err.message, /TextCanvas.*@chenglou\/pretext/);
        return true;
      }
    );
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
      prepare: (text) => ({ text }),
      layout: () => ({
        lines: [
          { text: 'hello', x: 0, y: 16 },
          { text: 'world', x: 0, y: 32 },
        ],
      }),
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    mount(h(TextSVG, { width: 300, height: 100 }, 'hello world'), container);
    const svg = container.querySelector('svg');
    assert.ok(svg, 'expected an svg element');
    const tspans = svg.querySelectorAll('tspan');
    assert.equal(tspans.length, 2);
    assert.equal(tspans[0].textContent, 'hello');
    assert.equal(tspans[1].textContent, 'world');
  });

  it('throws a clear error when Pretext is missing', () => {
    _resetTextEngineForTests();
    const container = document.createElement('div');
    document.body.appendChild(container);
    assert.throws(
      () => mount(h(TextSVG, { width: 300 }, 'hi'), container),
      (err) => {
        assert.match(err.message, /TextSVG.*@chenglou\/pretext/);
        return true;
      }
    );
  });
});
