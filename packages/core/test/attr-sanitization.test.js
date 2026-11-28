// Tests for attribute sanitization on the h()/html`` runtime path (dom.js setProp),
// the compiled-JSX path (render.js setProp), and <head> attribute names (head.js).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

// Set up DOM globals before importing framework modules
const { dom } = installDOM('<!DOCTYPE html><html><head></head><body><div id="app"></div></body></html>');

const { h } = await import('../src/h.js');
const { mount, _isUnsafeAttr } = await import('../src/dom.js');
const { setProp, spread } = await import('../src/render.js');
const { flushSync } = await import('../src/reactive.js');
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

// =========================================================================
// Uppercase/mixed-case handler props must never reach setAttribute on the
// CLIENT paths (dom.js setProp, render.js spread/setProp, hydrateElementProps).
// =========================================================================

describe('client handler-prop case sensitivity', () => {
  const variants = ['ONCLICK', 'OnClick', 'onCLICK', 'ONMOUSEOVER'];

  it('h() path does not set uppercase handler props as attributes', () => {
    for (const key of variants) {
      const container = getContainer();
      silenceWarns(() => mount(h('div', { [key]: 'alert(1)' }), container));
      const el = container.querySelector('div');
      assert.ok(el, `no element rendered for ${key}`);
      assert.ok(!/alert\(1\)/.test(el.outerHTML), `${key} leaked a live handler: ${el.outerHTML}`);
      assert.equal(el.getAttribute(key.toLowerCase()), null, `${key} was set as an attribute`);
    }
  });

  it('compiled setProp does not set uppercase handler props as attributes', () => {
    for (const key of variants) {
      const el = document.createElement('div');
      silenceWarns(() => setProp(el, key, 'alert(1)'));
      assert.ok(!/alert\(1\)/.test(el.outerHTML), `${key} leaked a live handler: ${el.outerHTML}`);
      assert.equal(el.getAttribute(key.toLowerCase()), null, `${key} was set as an attribute`);
    }
  });

  it('compiled spread does not set uppercase handler props as attributes', async () => {
    const { spread } = await import('../src/render.js');
    for (const key of variants) {
      const el = document.createElement('div');
      silenceWarns(() => spread(el, { [key]: 'alert(1)' }));
      assert.ok(!/alert\(1\)/.test(el.outerHTML), `${key} leaked a live handler: ${el.outerHTML}`);
      assert.equal(el.getAttribute(key.toLowerCase()), null, `${key} was set as an attribute`);
    }
  });

  it('still attaches normal lowercase and camelCase handlers', () => {
    const container = getContainer();
    let clicks = 0;
    mount(h('button', { onClick: () => { clicks++; } }, 'go'), container);
    container.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click'));
    assert.equal(clicks, 1);
  });
});

// =========================================================================
// Non-string URL values must be coerced before the protocol check: a boxed
// String or an object with toString() still lands a live javascript: href.
// =========================================================================

describe('non-string URL attribute values', () => {
  const hostile = [
    ['boxed String', () => new String('javascript:alert(1)')],
    ['toString object', () => ({ toString: () => 'javascript:alert(1)' })],
    ['boxed String vbscript', () => new String('vbscript:alert(1)')],
  ];

  for (const [label, make] of hostile) {
    it(`h() path blocks a ${label} href`, () => {
      const container = getContainer();
      silenceWarns(() => mount(h('a', { href: make() }, 'x'), container));
      const el = container.querySelector('a');
      assert.equal(el.getAttribute('href'), null, `href leaked: ${el.outerHTML}`);
    });

    it(`compiled setProp blocks a ${label} href`, () => {
      const el = document.createElement('a');
      silenceWarns(() => setProp(el, 'href', make()));
      assert.equal(el.getAttribute('href'), null, `href leaked: ${el.outerHTML}`);
    });
  }

  it('still allows a boxed String with a safe URL', () => {
    const el = document.createElement('a');
    setProp(el, 'href', new String('/safe'));
    assert.equal(el.getAttribute('href'), '/safe');
  });
});

// =========================================================================
// Coercing the URL value must not become a new crash: String() throws on a
// value with no usable toString, and {toString: null} arrives straight from
// JSON data. A throw means "refuse the attribute", never "abort the render".
// =========================================================================

describe('non-coercible URL attribute values', () => {
  const shapes = [
    ['null-prototype object', () => Object.create(null)],
    ['toString: null', () => ({ toString: null })],
    ['toString and valueOf nulled', () => Object.assign(Object.create(null), { x: 1 })],
  ];

  for (const [label, make] of shapes) {
    it(`refuses a ${label} href without throwing`, () => {
      assert.equal(_isUnsafeAttr('href', make()), true);
    });

    it(`does not crash the h() render for a ${label} href`, () => {
      const container = getContainer();
      silenceWarns(() => mount(h('a', { href: make() }, 'x'), container));
      const el = container.querySelector('a');
      assert.ok(el, 'render aborted');
      assert.equal(el.getAttribute('href'), null);
    });

    it(`does not crash compiled setProp for a ${label} href`, () => {
      const el = document.createElement('a');
      silenceWarns(() => setProp(el, 'href', make()));
      assert.equal(el.getAttribute('href'), null);
    });
  }

  it('leaves non-URL attributes alone even when non-coercible', () => {
    assert.equal(_isUnsafeAttr('id', Object.create(null)), false);
  });
});

// =========================================================================
// Every element property that parses markup or loads a URL, on every path
// =========================================================================
// An untrusted props object (attributes from a CMS, JSON, a URL) reaches the
// property fall-through of setProp for any key the element has as a property,
// and `outerHTML` used to be written through: it replaced the element with its
// value parsed as live markup. Each property below parses its value as markup
// (outerHTML, innerHTML, srcdoc) or navigates or loads with a URL that can run
// script (href, src, action, formAction, data, ping, xlink:href). Each must be
// refused, or pass the URL check, on the compiled path (an explicit attribute
// and a spread), on h(), through setProp and through spread, with a plain value
// and through a reactive accessor.

const MARKUP = '<img id="pwn" src="x">';
const SINKS = [
  // [prop, tag, hostile value, svg]
  ['outerHTML', 'div', MARKUP],
  ['OuterHTML', 'div', MARKUP],
  ['innerHTML', 'div', MARKUP],
  ['srcdoc', 'iframe', MARKUP],
  ['srcDoc', 'iframe', MARKUP],
  ['href', 'a', 'javascript:alert(1)'],
  ['href', 'area', 'javascript:alert(1)'],
  ['src', 'iframe', 'javascript:alert(1)'],
  ['src', 'embed', 'javascript:alert(1)'],
  ['action', 'form', 'javascript:alert(1)'],
  ['formAction', 'button', 'javascript:alert(1)'],
  ['formaction', 'input', 'javascript:alert(1)'],
  ['data', 'object', 'javascript:alert(1)'],
  ['ping', 'a', 'javascript:alert(1)'],
  ['xlink:href', 'a', 'javascript:alert(1)', true],
  ['href', 'a', 'javascript:alert(1)', true],
];

// The sink is closed when the element is still in place, nothing parsed from
// the value is in the document, and no attribute or property holds the value.
function assertClosed(host, el, prop, value, label) {
  assert.ok(el && el.isConnected, `${label}: the element was replaced`);
  assert.equal(host.querySelector('#pwn'), null, `${label}: markup from the value is live`);
  for (const name of [prop, prop.toLowerCase()]) {
    assert.notEqual(el.getAttribute(name), value, `${label}: attribute ${name} holds the value`);
  }
  if (prop in el && typeof el[prop] === 'string') {
    assert.ok(!el[prop].includes(value) && !/^javascript:/i.test(el[prop]), `${label}: property ${prop} is ${el[prop]}`);
  }
}

const tags = [...new Set(SINKS.map(([, tag, , svg]) => (svg ? 'svg:' : '') + tag))];
const compiledSinks = await loadCompiled(
  tags.map((t, i) => {
    const tag = t.replace('svg:', '');
    const el = `<${tag} {...p.attrs} />`;
    return `export const S${i} = (p) => <section>${t.startsWith('svg:') ? `<svg>${el}</svg>` : el}</section>;`;
  }).join('\n') + `
  export const Outer = (p) => <section><div outerHTML={p.value()} /></section>;
  export const OuterStatic = (p) => <section><div outerHTML={p.value} /></section>;
`);

function renderPath(path, tag, svg, props) {
  const container = getContainer();
  const host = container.appendChild(document.createElement('section'));
  const wrap = svg ? host.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg')) : host;
  let el;
  if (path === 'compiled') {
    const Component = compiledSinks[`S${tags.indexOf((svg ? 'svg:' : '') + tag)}`];
    silenceWarns(() => mount(() => Component({ attrs: props }), host));
    el = host.querySelector(`section > ${svg ? 'svg > ' : ''}${tag}`);
  } else if (path === 'h()') {
    const vnode = svg ? h('svg', {}, h(tag, props)) : h(tag, props);
    silenceWarns(() => mount(h('div', {}, vnode), host));
    el = host.querySelector(`div > ${svg ? 'svg > ' : ''}${tag}`);
  } else {
    el = wrap.appendChild(svg ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag));
    silenceWarns(() => {
      if (path === 'setProp') for (const key in props) setProp(el, key, props[key]);
      else spread(el, props);
    });
  }
  flushSync();
  return { host: container, el };
}

describe('markup and URL property sinks on every path', () => {
  for (const path of ['compiled', 'h()', 'setProp', 'spread']) {
    for (const [prop, tag, value, svg] of SINKS) {
      const label = `${path}: ${prop} on ${svg ? 'svg ' : ''}<${tag}>`;
      it(label, () => {
        const plain = renderPath(path, tag, svg, { [prop]: value });
        assertClosed(plain.host, plain.el, prop, value, label);
        const reactive = renderPath(path, tag, svg, { [prop]: () => value });
        assertClosed(reactive.host, reactive.el, prop, value, `${label} (accessor)`);
      });
    }
  }

  it('compiled: an explicit outerHTML attribute is refused, plain and reactive', () => {
    for (const [Component, value] of [[compiledSinks.OuterStatic, MARKUP], [compiledSinks.Outer, () => MARKUP]]) {
      const container = getContainer();
      silenceWarns(() => mount(() => Component({ value }), container));
      assertClosed(container, container.querySelector('section > div'), 'outerHTML', MARKUP, 'explicit outerHTML');
    }
  });

  it('still applies safe values and the explicit innerHTML form', () => {
    const container = getContainer();
    mount(h('div', {}, h('a', { href: '/ok' }), h('p', { innerHTML: { __html: '<b>x</b>' } })), container);
    assert.equal(container.querySelector('a').getAttribute('href'), '/ok');
    assert.equal(container.querySelector('p b').textContent, 'x');
    const el = document.createElement('div');
    spread(el, { innerHTML: { __html: '<i>y</i>' }, title: 't' });
    assert.equal(el.innerHTML, '<i>y</i>');
    assert.equal(el.title, 't');
  });
});

