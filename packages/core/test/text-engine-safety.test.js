// Safety test: enabling Pretext measure mode must NOT change visible DOM output.
// The measure hook is read-only — it populates a cache but never alters text nodes.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.queueMicrotask = global.queueMicrotask || ((fn) => Promise.resolve().then(fn));
global.window = dom.window;
global.getComputedStyle = dom.window.getComputedStyle;

const { signal, flushSync } = await import('../src/reactive.js');
const { insert } = await import('../src/render.js');
const { configureText, _resetTextEngineForTests, _setPretextForTests } = await import('../src/text-engine.js');

function createContainer() {
  const el = document.createElement('div');
  el.style.width = '400px';
  el.style.fontSize = '16px';
  el.style.fontFamily = 'sans-serif';
  document.body.appendChild(el);
  return el;
}

describe('text-engine safety: measure mode does not alter DOM output', () => {
  beforeEach(() => {
    _resetTextEngineForTests();
  });

  it('static text is identical with measure on vs off', () => {
    // OFF
    const offContainer = createContainer();
    insert(offContainer, 'Hello world');

    // ON
    _resetTextEngineForTests();
    _setPretextForTests({
      prepare: (t) => ({ t }),
      layout: (p, w, lh) => ({ lines: [{ text: p.t }], lineCount: 1, height: lh }),
    });
    configureText({ measure: true });
    const onContainer = createContainer();
    insert(onContainer, 'Hello world');

    assert.equal(onContainer.textContent, offContainer.textContent);
    assert.equal(onContainer.childNodes.length, offContainer.childNodes.length);
  });

  it('reactive text is identical with measure on vs off', () => {
    // OFF
    const offContainer = createContainer();
    const offSig = signal('initial');
    insert(offContainer, () => offSig());

    // ON
    _resetTextEngineForTests();
    _setPretextForTests({
      prepare: (t) => ({ t }),
      layout: (p, w, lh) => ({ lines: [{ text: p.t }], lineCount: 1, height: lh }),
    });
    configureText({ measure: true });
    const onContainer = createContainer();
    const onSig = signal('initial');
    insert(onContainer, () => onSig());

    assert.equal(onContainer.textContent, offContainer.textContent);

    // Update both signals
    offSig('updated value');
    onSig('updated value');
    flushSync();

    assert.equal(onContainer.textContent, offContainer.textContent);
    assert.equal(onContainer.textContent, 'updated value');
  });

  it('rapid updates produce identical DOM with measure on vs off', () => {
    // OFF
    const offContainer = createContainer();
    const offSig = signal('v0');
    insert(offContainer, () => offSig());

    // ON
    _resetTextEngineForTests();
    _setPretextForTests({
      prepare: (t) => ({ t }),
      layout: (p, w, lh) => ({ lines: [{ text: p.t }], lineCount: 1, height: lh }),
    });
    configureText({ measure: true });
    const onContainer = createContainer();
    const onSig = signal('v0');
    insert(onContainer, () => onSig());

    // Rapid updates
    for (let i = 1; i <= 50; i++) {
      offSig(`v${i}`);
      onSig(`v${i}`);
      flushSync();
    }

    assert.equal(onContainer.textContent, offContainer.textContent);
    assert.equal(onContainer.textContent, 'v50');
  });

  it('mixed static and reactive children are identical', () => {
    // OFF
    const offContainer = createContainer();
    const offSig = signal('dynamic');
    insert(offContainer, 'static ');
    insert(offContainer, () => offSig());

    // ON
    _resetTextEngineForTests();
    _setPretextForTests({
      prepare: (t) => ({ t }),
      layout: (p, w, lh) => ({ lines: [{ text: p.t }], lineCount: 1, height: lh }),
    });
    configureText({ measure: true });
    const onContainer = createContainer();
    const onSig = signal('dynamic');
    insert(onContainer, 'static ');
    insert(onContainer, () => onSig());

    assert.equal(onContainer.textContent, offContainer.textContent);
    assert.equal(onContainer.textContent, 'static dynamic');
  });
});
