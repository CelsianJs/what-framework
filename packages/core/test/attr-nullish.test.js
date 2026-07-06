// Regression tests: null/undefined attribute values must mean "no attribute"
// (React/Solid semantics) — NOT the literal string "undefined"/"null".
//
// Bug (2026-07-05): `<button title={maybeUndefined}>` produced
// title="undefined" in the DOM. Same family as the aria-boolean coercion bug.
// Covers BOTH client setProp paths (dom.js h()/createDOM + render.js compiler)
// and the SSR serializer, plus the preserved semantics for legitimate values:
// 0, "" (empty attr), false (boolean-attr removal), and on* handlers.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.SVGElement = dom.window.SVGElement;
global.Node = dom.window.Node;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.queueMicrotask = global.queueMicrotask || ((fn) => Promise.resolve().then(fn));
if (!global.customElements) {
  const registry = new Map();
  global.customElements = {
    get: (name) => registry.get(name),
    define: (name, cls) => registry.set(name, cls),
  };
}

const { signal, flushSync } = await import('../src/reactive.js');
const { h } = await import('../src/h.js');
const { mount, createDOM } = await import('../src/dom.js');
const { setProp, setAttr, spread } = await import('../src/render.js');
const { renderToString } = await import('../../server/src/index.js');

function el(tag) { return document.createElement(tag); }

// ---------------------------------------------------------------------------
// dom.js setProp — h() / createDOM path
// ---------------------------------------------------------------------------
describe('dom.js setProp — nullish attributes', () => {
  it('static undefined attr → attribute absent (not "undefined")', () => {
    const node = createDOM(h('button', { title: undefined }, 'x'));
    assert.equal(node.hasAttribute('title'), false);
    assert.equal(node.getAttribute('title'), null);
    assert.notEqual(node.title, 'undefined');
  });

  it('static null attr → attribute absent (not "null")', () => {
    const node = createDOM(h('button', { title: null }, 'x'));
    assert.equal(node.hasAttribute('title'), false);
    assert.notEqual(node.title, 'null');
  });

  it('undefined aria-* → attribute absent (not aria-label="undefined")', () => {
    const node = createDOM(h('div', { 'aria-label': undefined }));
    assert.equal(node.hasAttribute('aria-label'), false);
  });

  it('undefined data-* → attribute absent (not data-x="undefined")', () => {
    const node = createDOM(h('div', { 'data-x': undefined }));
    assert.equal(node.hasAttribute('data-x'), false);
  });

  it('null on a non-reflected/custom attr → absent', () => {
    const node = createDOM(h('div', { 'custom-attr': null }));
    assert.equal(node.hasAttribute('custom-attr'), false);
  });

  it('reactive attr value→undefined→value removes then re-adds', () => {
    const t = signal('hello');
    const node = createDOM(h('button', { title: () => t() }, 'x'));
    assert.equal(node.getAttribute('title'), 'hello');
    t(undefined);
    flushSync();
    assert.equal(node.hasAttribute('title'), false, 'undefined must REMOVE the attr, not stamp "undefined"');
    t('world');
    flushSync();
    assert.equal(node.getAttribute('title'), 'world');
  });

  it('reactive aria-* value→undefined removes the attribute', () => {
    const v = signal('true');
    const node = createDOM(h('div', { 'aria-checked': () => v() }));
    assert.equal(node.getAttribute('aria-checked'), 'true');
    v(undefined);
    flushSync();
    assert.equal(node.hasAttribute('aria-checked'), false);
  });

  // --- preserved semantics ---
  it('0 sets attribute "0" (falsy but defined)', () => {
    const node = createDOM(h('input', { tabindex: 0 }));
    assert.equal(node.getAttribute('tabindex'), '0');
  });

  it('empty string sets an empty attribute (present)', () => {
    const node = createDOM(h('div', { 'data-flag': '' }));
    assert.equal(node.hasAttribute('data-flag'), true);
    assert.equal(node.getAttribute('data-flag'), '');
  });

  it('false removes a boolean attribute (existing behavior)', () => {
    const node = createDOM(h('button', { disabled: false }, 'x'));
    assert.equal(node.hasAttribute('disabled'), false);
  });

  it('true sets a bare boolean attribute (existing behavior)', () => {
    const node = createDOM(h('button', { disabled: true }, 'x'));
    assert.equal(node.hasAttribute('disabled'), true);
  });

  it('on* handlers are unaffected by the nullish guard', () => {
    let clicks = 0;
    const node = createDOM(h('button', { onclick: () => { clicks++; }, title: undefined }, 'x'));
    node.click();
    assert.equal(clicks, 1);
    assert.equal(node.hasAttribute('title'), false);
  });
});

// ---------------------------------------------------------------------------
// render.js setProp — compiler / spread path (exported)
// ---------------------------------------------------------------------------
describe('render.js setProp — nullish attributes', () => {
  it('static undefined attr → absent (not "undefined")', () => {
    const node = el('button');
    setProp(node, 'title', undefined);
    assert.equal(node.hasAttribute('title'), false);
    assert.notEqual(node.title, 'undefined');
  });

  it('static null attr → absent', () => {
    const node = el('button');
    setProp(node, 'title', null);
    assert.equal(node.hasAttribute('title'), false);
  });

  it('undefined aria-* / data-* → absent', () => {
    const node = el('div');
    setProp(node, 'aria-label', undefined);
    setProp(node, 'data-x', null);
    assert.equal(node.hasAttribute('aria-label'), false);
    assert.equal(node.hasAttribute('data-x'), false);
  });

  it('value→undefined→value round trip', () => {
    const node = el('button');
    setProp(node, 'title', 'hi');
    assert.equal(node.getAttribute('title'), 'hi');
    setProp(node, 'title', undefined);
    assert.equal(node.hasAttribute('title'), false);
    setProp(node, 'title', 'bye');
    assert.equal(node.getAttribute('title'), 'bye');
  });

  it('preserves 0 / "" / false semantics', () => {
    const a = el('input');
    setProp(a, 'tabindex', 0);
    assert.equal(a.getAttribute('tabindex'), '0');
    const b = el('div');
    setProp(b, 'data-flag', '');
    assert.equal(b.getAttribute('data-flag'), '');
    const c = el('button');
    setProp(c, 'disabled', false);
    assert.equal(c.hasAttribute('disabled'), false);
  });

  it('spread with undefined values leaves attributes absent', () => {
    const node = el('button');
    spread(node, { title: undefined, 'aria-label': null, id: 'ok' });
    assert.equal(node.hasAttribute('title'), false);
    assert.equal(node.hasAttribute('aria-label'), false);
    assert.equal(node.getAttribute('id'), 'ok');
  });

  it('setAttr already removes on nullish (guard for regression)', () => {
    const node = el('div');
    setAttr(node, 'data-y', 'v');
    setAttr(node, 'data-y', undefined);
    assert.equal(node.hasAttribute('data-y'), false);
  });
});

// ---------------------------------------------------------------------------
// SSR — renderToString must not serialize attr="undefined"
// ---------------------------------------------------------------------------
describe('renderToString — nullish attributes', () => {
  it('undefined attr is not serialized', () => {
    const html = renderToString(h('button', { title: undefined }, 'x'));
    assert.equal(html.includes('undefined'), false);
    assert.equal(html.includes('title='), false);
  });

  it('null attr is not serialized', () => {
    const html = renderToString(h('div', { 'aria-label': null, id: 'ok' }));
    assert.equal(html.includes('null'), false);
    assert.equal(html.includes('aria-label'), false);
    assert.equal(html.includes('id="ok"'), true);
  });

  it('preserves 0, empty string, and boolean attrs', () => {
    assert.equal(renderToString(h('input', { tabindex: 0 })).includes('tabindex="0"'), true);
    assert.equal(renderToString(h('div', { 'data-flag': '' })).includes('data-flag=""'), true);
    assert.equal(renderToString(h('button', { disabled: false }, 'x')).includes('disabled'), false);
    assert.equal(renderToString(h('button', { disabled: true }, 'x')).includes('disabled'), true);
  });
});
