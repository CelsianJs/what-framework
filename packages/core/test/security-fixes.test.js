// Tests for security fixes — innerHTML XSS prevention, SSR innerHTML safety,
// template() compiler-internal warning, CSRF enforcement, meta escaping, SSR error messages
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

// Set up DOM globals before importing framework modules
installDOM();

const { setProp, spread } = await import('../src/render.js');
const { h } = await import('../src/h.js');
const { mount } = await import('../src/dom.js');
const { flushSync } = await import('../src/reactive.js');
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

  it('_$template is exported from what-framework/render, where compiled output imports it', async () => {
    const render = await import('../../what/src/render.js');
    assert.equal(typeof render._$template, 'function');
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
  // Details reach the page only when development is positively established:
  // NODE_ENV exactly 'development'. No NODE_ENV (a server started bare) is
  // production, like any other value.
  async function streamedError(nodeEnv) {
    const saved = process.env.NODE_ENV;
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
    try {
      function BadComponent() { throw new Error('test-error-message'); }
      const chunks = [];
      for await (const chunk of renderToStream(h(BadComponent, null), { onError: () => {} })) chunks.push(chunk);
      return chunks.join('');
    } finally {
      if (saved === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = saved;
    }
  }

  it('includes error details when NODE_ENV is development', async () => {
    assert.ok((await streamedError('development')).includes('test-error-message'));
  });

  it('leaves them out with no NODE_ENV, or any other value', async () => {
    for (const nodeEnv of [undefined, 'staging', 'production', 'test']) {
      const html = await streamedError(nodeEnv);
      assert.ok(!html.includes('test-error-message'), `NODE_ENV=${nodeEnv}: ${html}`);
      assert.match(html, /<!-- SSR Error -->/);
    }
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

// =========================================================================
// An untrusted props object on an element that has a parent (w2 security #3)
// =========================================================================
// `<section><div {...block.attrs} /></section>` with attributes from a CMS:
// setProp's property fall-through wrote any key the element has as a property,
// and `outerHTML` replaced the element with its value parsed as live markup.
// The full matrix of markup and URL properties is in attr-sanitization.test.js.

describe('untrusted props objects reach no markup or script sink', () => {
  const HOSTILE = {
    outerHTML: '<img id="pwn-outer" src="x" onerror="window.__pwned=1">',
    ONCLICK: 'window.__pwned=2',
    onClick: 'window.__pwned=3',
    SrcDoc: '<script>parent.__pwned=4</script>',
    'xlink:href': 'javascript:alert(1)',
    HREF: ' jAvAsCrIpT:alert(1)',
    formAction: 'javascript:alert(1)',
  };

  function probe(apply) {
    const host = getContainer();
    const section = host.appendChild(document.createElement('section'));
    const out = {};
    for (const [key, value] of Object.entries(HOSTILE)) {
      const el = section.appendChild(document.createElement(key === 'formAction' ? 'button' : 'a'));
      const warn = console.warn;
      console.warn = () => {};
      try { apply(section, el, key, value); } finally { console.warn = warn; }
      const live = section.querySelector('a, button') || section.firstElementChild;
      out[key] = section.querySelector('#pwn-outer') ? 'replaced by markup'
        : live && [...live.attributes].some(a => a.value === value || /javascript:|__pwned/i.test(a.value)) ? 'live attribute'
          : 'blocked';
      section.textContent = '';
    }
    host.remove();
    return out;
  }

  const blocked = Object.fromEntries(Object.keys(HOSTILE).map(k => [k, 'blocked']));

  it('spread()', () => {
    assert.deepEqual(probe((section, el, key, value) => spread(el, { [key]: value })), blocked);
  });

  it('setProp()', () => {
    assert.deepEqual(probe((section, el, key, value) => setProp(el, key, value)), blocked);
  });

  it('setProp() with a reactive accessor', () => {
    assert.deepEqual(probe((section, el, key, value) => setProp(el, key, () => value)), blocked);
  });

  it('h()', () => {
    assert.deepEqual(probe((section, el, key, value) => {
      el.remove();
      mount(h(key === 'formAction' ? 'button' : 'a', { [key]: value }), section);
    }), blocked);
  });
});

