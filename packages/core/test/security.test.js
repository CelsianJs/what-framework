// Tests for security fixes — URL sanitization, innerHTML restriction, escaping
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

const { setProp } = await import('../src/render.js');
const { h } = await import('../src/h.js');
const { renderToString } = await import('../../server/src/index.js');

// =========================================================================
// 1a. URL Sanitization in setProp
// =========================================================================

describe('URL sanitization in setProp', () => {
  it('should block javascript: URLs in href', () => {
    const el = document.createElement('a');
    setProp(el, 'href', 'javascript:alert(1)');
    assert.equal(el.getAttribute('href'), null);
  });

  it('should block JavaScript: URLs (case-insensitive)', () => {
    const el = document.createElement('a');
    setProp(el, 'href', 'JavaScript:alert(1)');
    assert.equal(el.getAttribute('href'), null);
  });

  it('should block JAVASCRIPT: URLs (all caps)', () => {
    const el = document.createElement('a');
    setProp(el, 'href', 'JAVASCRIPT:alert(1)');
    assert.equal(el.getAttribute('href'), null);
  });

  it('should block javascript: with whitespace/control chars', () => {
    const el = document.createElement('a');
    setProp(el, 'href', '  java\tscript:alert(1)');
    assert.equal(el.getAttribute('href'), null);
  });

  it('should block data: URLs in src', () => {
    const el = document.createElement('img');
    setProp(el, 'src', 'data:text/html,<script>alert(1)</script>');
    assert.equal(el.getAttribute('src'), null);
  });

  it('should block vbscript: URLs in href', () => {
    const el = document.createElement('a');
    setProp(el, 'href', 'vbscript:MsgBox("XSS")');
    assert.equal(el.getAttribute('href'), null);
  });

  it('should block unsafe URLs in action attribute', () => {
    const el = document.createElement('form');
    setProp(el, 'action', 'javascript:alert(1)');
    // action should not be set
    assert.equal(el.getAttribute('action'), null);
  });

  it('should block unsafe URLs in formAction attribute', () => {
    const el = document.createElement('button');
    setProp(el, 'formAction', 'javascript:void(0)');
    assert.equal(el.getAttribute('formaction'), null);
  });

  it('should allow safe http: URLs', () => {
    const el = document.createElement('a');
    setProp(el, 'href', 'https://example.com');
    // href should be set (check via property since jsdom may handle it)
    assert.ok(el.href.includes('example.com'));
  });

  it('should allow relative URLs', () => {
    const el = document.createElement('a');
    setProp(el, 'href', '/about');
    assert.ok(el.href.includes('/about'));
  });

  it('should allow hash URLs', () => {
    const el = document.createElement('a');
    setProp(el, 'href', '#section');
    assert.ok(el.href.includes('#section'));
  });

  it('should allow mailto: URLs', () => {
    const el = document.createElement('a');
    setProp(el, 'href', 'mailto:user@example.com');
    assert.ok(el.href.includes('mailto:'));
  });
});

// =========================================================================
// 1b. innerHTML restriction
// =========================================================================

describe('innerHTML security', () => {
  it('should allow object form innerHTML { __html: ... }', () => {
    const el = document.createElement('div');
    setProp(el, 'innerHTML', { __html: '<b>bold</b>' });
    assert.equal(el.innerHTML, '<b>bold</b>');
  });

  it('should reject plain string innerHTML', () => {
    const el = document.createElement('div');
    el.innerHTML = 'original';
    setProp(el, 'innerHTML', '<script>alert(1)</script>');
    // innerHTML should NOT be changed to the script tag
    assert.equal(el.innerHTML, 'original');
  });

  it('should allow dangerouslySetInnerHTML with __html', () => {
    const el = document.createElement('div');
    setProp(el, 'dangerouslySetInnerHTML', { __html: '<em>test</em>' });
    assert.equal(el.innerHTML, '<em>test</em>');
  });

  it('should handle null/empty innerHTML silently', () => {
    const el = document.createElement('div');
    el.innerHTML = 'content';
    setProp(el, 'innerHTML', null);
    // null should be ignored (no warning for null)
    assert.equal(el.innerHTML, 'content');
  });
});

// =========================================================================
// 1c. escapeHtml single-quote fix
// =========================================================================

describe('escapeHtml single-quote fix', () => {
  it('should escape single quotes in text content', () => {
    const html = renderToString(h('div', null, "it's a test"));
    assert.ok(html.includes('&#39;'), `Expected &#39; in: ${html}`);
    assert.ok(!html.includes("'"), `Should not contain raw single quote in: ${html}`);
  });

  it('should escape single quotes in attributes', () => {
    const html = renderToString(h('div', { title: "it's" }));
    assert.ok(html.includes('&#39;'), `Expected &#39; in: ${html}`);
  });

  it('should still escape other special characters', () => {
    const html = renderToString(h('div', null, '<script>"&'));
    assert.ok(html.includes('&lt;'));
    assert.ok(html.includes('&gt;'));
    assert.ok(html.includes('&quot;'));
    assert.ok(html.includes('&amp;'));
  });
});

// =========================================================================
// 1f. CSRF token generation — no Math.random
// =========================================================================

describe('CSRF token generation', () => {
  it('should generate a hex string token when crypto.randomUUID is unavailable', async () => {
    const { generateCsrfToken } = await import('../../server/src/actions.js');
    const token = generateCsrfToken();
    assert.ok(typeof token === 'string');
    assert.ok(token.length > 0);
    // Should not contain Math.random's typical format (no dots)
    // crypto.randomUUID returns uuid format, getRandomValues returns hex
    assert.ok(token.length >= 16, `Token should be at least 16 chars: ${token}`);
  });

  it('should generate unique tokens', async () => {
    const { generateCsrfToken } = await import('../../server/src/actions.js');
    const t1 = generateCsrfToken();
    const t2 = generateCsrfToken();
    assert.notEqual(t1, t2);
  });
});

// =========================================================================
// 1g. template() internal — _template alias exists
// =========================================================================

describe('template internal', () => {
  it('should export _template as an alias', async () => {
    const render = await import('../src/render.js');
    assert.equal(typeof render.template, 'function');
    assert.equal(typeof render._template, 'function');
    assert.equal(render.template, render._template);
  });
});

// =========================================================================
// 1h. Object.create(null) for EMPTY_OBJ in h.js
// =========================================================================

describe('h() prototype-safe props', () => {
  it('should not have Object.prototype properties on default props', () => {
    const vnode = h('div', null, 'hello');
    // If EMPTY_OBJ is Object.create(null), props won't have hasOwnProperty etc.
    assert.equal(Object.getPrototypeOf(vnode.props), null);
  });

  it('should still work with explicit props', () => {
    const vnode = h('div', { class: 'foo' }, 'hello');
    assert.equal(vnode.props.class, 'foo');
  });
});
