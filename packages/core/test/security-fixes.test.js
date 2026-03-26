// Tests for security fixes — innerHTML XSS prevention, SSR innerHTML safety,
// template() compiler-internal warning, CSRF enforcement, meta escaping, SSR error messages
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
const { mount } = await import('../src/dom.js');
const { signal, flushSync } = await import('../src/reactive.js');
const { renderToString, renderToStream, generateStaticPage } = await import('../../server/src/index.js');

function getContainer() {
  const c = document.createElement('div');
  document.body.appendChild(c);
  return c;
}
async function flush() { flushSync(); await new Promise(r => setTimeout(r, 10)); }

// =========================================================================
// HIGH-1: innerHTML in dom.js requires { __html } wrapper (XSS prevention)
// =========================================================================

describe('HIGH-1: innerHTML XSS prevention in dom.js', () => {
  it('blocks raw string innerHTML — prevents XSS', () => {
    const el = document.createElement('div');
    el.innerHTML = 'original';
    setProp(el, 'innerHTML', '<script>alert("xss")</script>');
    assert.equal(el.innerHTML, 'original', 'raw string innerHTML must be rejected');
  });

  it('allows { __html } wrapper for innerHTML', () => {
    const el = document.createElement('div');
    setProp(el, 'innerHTML', { __html: '<b>safe</b>' });
    assert.equal(el.innerHTML, '<b>safe</b>');
  });

  it('allows dangerouslySetInnerHTML with { __html }', () => {
    const el = document.createElement('div');
    setProp(el, 'dangerouslySetInnerHTML', { __html: '<em>ok</em>' });
    assert.equal(el.innerHTML, '<em>ok</em>');
  });

  it('handles null innerHTML gracefully', () => {
    const el = document.createElement('div');
    el.innerHTML = 'content';
    setProp(el, 'innerHTML', null);
    // null should not change content — just a no-op
    assert.equal(el.innerHTML, 'content');
  });

  it('handles empty __html in wrapper', () => {
    const el = document.createElement('div');
    el.innerHTML = 'old';
    setProp(el, 'innerHTML', { __html: '' });
    assert.equal(el.innerHTML, '');
  });

  it('rejects numeric innerHTML as raw string', () => {
    const el = document.createElement('div');
    el.innerHTML = 'original';
    setProp(el, 'innerHTML', 42);
    // Numeric value is not an object with __html — should be rejected
    assert.equal(el.innerHTML, 'original');
  });

  it('blocks innerHTML XSS via mount/h', async () => {
    const container = getContainer();
    mount(h('div', { id: 'xss-test', innerHTML: '<img src=x onerror=alert(1)>' }), container);
    await flush();
    const target = container.querySelector('#xss-test');
    assert.equal(target.innerHTML, '', 'raw innerHTML via h() should be blocked');
  });

  it('allows innerHTML via mount/h with __html wrapper', async () => {
    const container = getContainer();
    mount(h('div', { id: 'safe-test', innerHTML: { __html: '<b>allowed</b>' } }), container);
    await flush();
    const target = container.querySelector('#safe-test');
    assert.equal(target.innerHTML, '<b>allowed</b>');
  });
});

// =========================================================================
// HIGH-2: SSR renderToString outputs innerHTML safely
// =========================================================================

describe('HIGH-2: SSR innerHTML safety', () => {
  it('rejects raw string innerHTML in renderToString', () => {
    const html = renderToString(h('div', { innerHTML: '<script>xss</script>' }));
    assert.equal(html, '<div></div>', 'raw innerHTML should be rejected in SSR');
  });

  it('allows innerHTML with __html wrapper in renderToString', () => {
    const html = renderToString(h('div', { innerHTML: { __html: '<b>ok</b>' } }));
    assert.equal(html, '<div><b>ok</b></div>');
  });

  it('allows dangerouslySetInnerHTML in renderToString', () => {
    const html = renderToString(h('div', { dangerouslySetInnerHTML: { __html: '<em>safe</em>' } }));
    assert.equal(html, '<div><em>safe</em></div>');
  });

  it('rejects raw string innerHTML in renderToStream', async () => {
    const chunks = [];
    for await (const chunk of renderToStream(h('div', { innerHTML: '<script>xss</script>' }))) {
      chunks.push(chunk);
    }
    const html = chunks.join('');
    assert.equal(html, '<div></div>', 'raw innerHTML should be rejected in stream SSR');
  });

  it('allows innerHTML with __html wrapper in renderToStream', async () => {
    const chunks = [];
    for await (const chunk of renderToStream(h('div', { innerHTML: { __html: '<b>ok</b>' } }))) {
      chunks.push(chunk);
    }
    const html = chunks.join('');
    assert.equal(html, '<div><b>ok</b></div>');
  });

  it('dangerouslySetInnerHTML takes priority over innerHTML in SSR', () => {
    const html = renderToString(h('div', {
      innerHTML: '<span>A</span>',
      dangerouslySetInnerHTML: { __html: '<span>B</span>' },
    }));
    assert.equal(html, '<div><span>B</span></div>');
  });
});

// =========================================================================
// MEDIUM-1: template() compiler-internal warning
// =========================================================================

describe('MEDIUM-1: template() compiler-internal safety', () => {
  it('exports _$template as compiler-internal (no warning)', async () => {
    const render = await import('../src/render.js');
    assert.equal(typeof render._$template, 'function');
    // _$template should work the same as template but without warning
    const factory = render._$template('<div class="t">hello</div>');
    const el = factory();
    assert.equal(el.tagName.toLowerCase(), 'div');
    assert.equal(el.className, 't');
  });

  it('template() still works (with dev warning)', async () => {
    const render = await import('../src/render.js');
    // template() should still produce correct DOM even though it warns
    const factory = render.template('<span>test</span>');
    const el = factory();
    assert.equal(el.tagName.toLowerCase(), 'span');
    assert.equal(el.textContent, 'test');
  });

  it('_template legacy alias still works', async () => {
    const render = await import('../src/render.js');
    assert.equal(typeof render._template, 'function');
    const factory = render._template('<p>legacy</p>');
    const el = factory();
    assert.equal(el.tagName.toLowerCase(), 'p');
  });

  it('_$template is exported from index.js', async () => {
    const core = await import('../src/index.js');
    assert.equal(typeof core._$template, 'function');
  });
});

// =========================================================================
// LOW-1: wrapDocument meta name escaping
// =========================================================================

describe('LOW-1: meta name key escaping in wrapDocument', () => {
  it('escapes meta name keys in generated pages', () => {
    const page = {
      component: () => h('div', null, 'test'),
      title: 'Test',
      meta: {
        'description" onload="alert(1)': 'xss attempt',
        'author': 'safe',
      },
      mode: 'static',
    };
    const html = generateStaticPage(page);
    // The meta name should be escaped, not contain raw quotes
    assert.ok(!html.includes('onload="alert(1)"'), 'meta name should be escaped');
    assert.ok(html.includes('&quot;'), 'meta name quotes should be escaped');
    assert.ok(html.includes('name="author"'), 'normal meta names work');
  });
});

// =========================================================================
// LOW-2: SSR error messages hidden in production
// =========================================================================

describe('LOW-2: SSR error messages in production mode', () => {
  it('includes error details in dev mode stream SSR', async () => {
    // In dev mode (NODE_ENV !== 'production'), errors should include details
    function BadComponent() { throw new Error('test-error-message'); }
    const chunks = [];
    for await (const chunk of renderToStream(h(BadComponent, null))) {
      chunks.push(chunk);
    }
    const html = chunks.join('');
    // In test env (dev mode), error message should be included
    assert.ok(html.includes('test-error-message'), 'dev mode should include error details');
  });
});

// =========================================================================
// MEDIUM-2: CSRF enforcement in enhanceForms
// =========================================================================

describe('MEDIUM-2: CSRF enforcement', () => {
  it('enhanceForms module exports exist', async () => {
    const islands = await import('../../server/src/islands.js');
    assert.equal(typeof islands.enhanceForms, 'function');
  });
});
