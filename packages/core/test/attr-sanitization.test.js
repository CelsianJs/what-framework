// Tests for attribute sanitization on the h()/html`` runtime path (dom.js setProp),
// the compiled-JSX path (render.js setProp), and <head> attribute names (head.js).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Set up DOM globals before importing framework modules
const dom = new JSDOM('<!DOCTYPE html><html><head></head><body><div id="app"></div></body></html>');
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.SVGElement = dom.window.SVGElement;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.queueMicrotask = global.queueMicrotask || ((fn) => Promise.resolve().then(fn));

const { h } = await import('../src/h.js');
const { mount } = await import('../src/dom.js');
const { setProp } = await import('../src/render.js');
const { Head, beginHeadCollection, endHeadCollection, clearHead } = await import('../src/head.js');

function getContainer() {
  const el = document.getElementById('app');
  el.textContent = '';
  return el;
}

function silenceWarns(fn) {
  const orig = console.warn;
  console.warn = () => {};
  try { return fn(); } finally { console.warn = orig; }
}

// =========================================================================
// H3: the h() path must sanitize URLs exactly like the compiled path
// =========================================================================

describe('h() path URL sanitization (dom.js setProp)', () => {
  const cases = [
    ['a', 'href', 'javascript:alert(1)'],
    ['a', 'href', 'JaVaScRiPt:alert(1)'],
    ['a', 'href', '  java\tscript:alert(1)'],
    ['img', 'src', 'javascript:alert(1)'],
    ['img', 'src', 'data:text/html,<script>alert(1)</script>'],
    ['form', 'action', 'javascript:alert(1)'],
    ['button', 'formaction', 'javascript:alert(1)'],
    ['a', 'href', 'vbscript:MsgBox("x")'],
  ];

  for (const [tag, attr, value] of cases) {
    it(`blocks ${attr}="${value}" on <${tag}>`, () => {
      const container = getContainer();
      silenceWarns(() => mount(h(tag, { [attr]: value }), container));
      const el = container.querySelector(tag);
      assert.ok(el, 'element should still render');
      assert.equal(el.getAttribute(attr), null);
    });
  }

  it('still applies safe URLs', () => {
    const container = getContainer();
    mount(h('a', { href: '/about' }), container);
    assert.equal(container.querySelector('a').getAttribute('href'), '/about');
  });

  it('blocks unsafe URLs delivered through a reactive prop getter', () => {
    const container = getContainer();
    silenceWarns(() => mount(h('a', { href: () => 'javascript:alert(1)' }), container));
    assert.equal(container.querySelector('a').getAttribute('href'), null);
  });
});

// =========================================================================
// H2: URL_ATTRS coverage gaps: srcdoc, object[data], xlink:href, ping
// =========================================================================

describe('additional dangerous attributes', () => {
  it('refuses srcdoc outright on the h() path', () => {
    const container = getContainer();
    silenceWarns(() => mount(
      h('iframe', { srcdoc: '<script>alert(1)</script>' }),
      container,
    ));
    assert.equal(container.querySelector('iframe').getAttribute('srcdoc'), null);
  });

  it('refuses srcdoc outright on the compiled path', () => {
    const el = document.createElement('iframe');
    silenceWarns(() => setProp(el, 'srcdoc', '&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.equal(el.getAttribute('srcdoc'), null);
  });

  it('refuses srcdoc even when the value looks harmless', () => {
    const el = document.createElement('iframe');
    silenceWarns(() => setProp(el, 'srcdoc', '<p>hello</p>'));
    assert.equal(el.getAttribute('srcdoc'), null);
  });

  it('blocks javascript: in xlink:href (SVG <a> executes it)', () => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'a');
    silenceWarns(() => setProp(el, 'xlink:href', 'javascript:alert(1)'));
    assert.equal(el.getAttribute('xlink:href'), null);
  });

  it('blocks javascript: in object[data]', () => {
    const el = document.createElement('object');
    silenceWarns(() => setProp(el, 'data', 'javascript:alert(1)'));
    assert.equal(el.getAttribute('data'), null);
  });

  it('blocks javascript: in ping', () => {
    const el = document.createElement('a');
    silenceWarns(() => setProp(el, 'ping', 'javascript:alert(1)'));
    assert.equal(el.getAttribute('ping'), null);
  });

  it('leaves data-* attributes alone', () => {
    const el = document.createElement('div');
    setProp(el, 'data-src', 'javascript:alert(1)');
    assert.equal(el.getAttribute('data-src'), 'javascript:alert(1)');
  });
});

// =========================================================================
// H4: <head> attribute NAMES must be validated, not just escaped
// =========================================================================

describe('head attribute name validation', () => {
  it('drops attribute names that would break out of the quoted value (SSR)', () => {
    const sink = beginHeadCollection();
    sink.metas.set('evil', { name: 'description', 'x" onload="alert(1)': 'y' });
    const html = endHeadCollection(sink);
    assert.ok(!html.includes('onload'), `attribute name leaked: ${html}`);
    assert.ok(html.includes('name="description"'));
  });

  it('drops event-handler attribute names regardless of case (SSR)', () => {
    const sink = beginHeadCollection();
    sink.metas.set('evil', { onLoad: 'alert(1)', ONERROR: 'alert(2)', name: 'ok' });
    const html = endHeadCollection(sink);
    assert.ok(!/onload/i.test(html), `handler leaked: ${html}`);
    assert.ok(!/onerror/i.test(html), `handler leaked: ${html}`);
    assert.ok(html.includes('name="ok"'));
  });

  it('maps httpEquiv and keeps legal names (SSR)', () => {
    const sink = beginHeadCollection();
    sink.metas.set('csp', { httpEquiv: 'content-security-policy', content: "default-src 'self'" });
    const html = endHeadCollection(sink);
    assert.ok(html.includes('http-equiv="content-security-policy"'));
  });

  it('drops unsafe attribute names on the client too', () => {
    clearHead();
    Head({ meta: { name: 'description', 'x" onload="alert(1)': 'y', onLoad: 'alert(1)' } });
    const el = document.head.querySelector('[data-what-head="description"]');
    assert.ok(el);
    assert.equal(el.getAttribute('name'), 'description');
    assert.equal(el.getAttribute('onload'), null);
    assert.ok(!/onload/i.test(el.outerHTML), `handler leaked: ${el.outerHTML}`);
    clearHead();
  });
});
