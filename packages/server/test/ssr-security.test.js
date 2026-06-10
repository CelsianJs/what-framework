/**
 * SSR security tests — isUnsafeUrlAttribute blocks dangerous protocols
 * in server-rendered HTML output.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { h } from 'what-core';
import { renderToString } from '../src/index.js';

// =========================================================================
// isUnsafeUrlAttribute — tested via renderToString (renderAttrs path)
// =========================================================================

describe('SSR URL attribute sanitization', () => {
  it('blocks href="data:text/html,<script>"', () => {
    const html = renderToString(h('a', { href: 'data:text/html,<script>' }, 'link'));
    assert.ok(!html.includes('data:text/html'), `data: should be stripped: ${html}`);
  });

  it('blocks href="javascript:alert(1)"', () => {
    const html = renderToString(h('a', { href: 'javascript:alert(1)' }, 'link'));
    assert.ok(!html.includes('javascript:'), `javascript: should be stripped: ${html}`);
  });

  it('allows href="https://example.com"', () => {
    const html = renderToString(h('a', { href: 'https://example.com' }, 'link'));
    assert.ok(html.includes('https://example.com'), `https should be allowed: ${html}`);
  });

  it('blocks src="data:image/png;base64,abc"', () => {
    const html = renderToString(h('img', { src: 'data:image/png;base64,abc' }));
    assert.ok(!html.includes('data:image'), `data: in src should be stripped: ${html}`);
  });

  it('blocks action="javascript:void(0)"', () => {
    const html = renderToString(h('form', { action: 'javascript:void(0)' }, ''));
    assert.ok(!html.includes('javascript:'), `javascript: in action should be stripped: ${html}`);
  });

  it('blocks vbscript: in href', () => {
    const html = renderToString(h('a', { href: 'vbscript:msgbox' }, 'link'));
    assert.ok(!html.includes('vbscript:'), `vbscript: should be stripped: ${html}`);
  });

  it('blocks javascript: with mixed case', () => {
    const html = renderToString(h('a', { href: 'JaVaScRiPt:alert(1)' }, 'link'));
    assert.ok(!html.includes('JaVaScRiPt:'), `mixed case should be stripped: ${html}`);
  });

  it('blocks javascript: with leading whitespace/control chars', () => {
    const html = renderToString(h('a', { href: '  \t\njavascript:alert(1)' }, 'link'));
    assert.ok(!html.includes('javascript:'), `whitespace-padded should be stripped: ${html}`);
  });

  it('allows relative href', () => {
    const html = renderToString(h('a', { href: '/about' }, 'About'));
    assert.ok(html.includes('/about'), `relative href should be allowed: ${html}`);
  });

  it('allows mailto: href', () => {
    const html = renderToString(h('a', { href: 'mailto:user@example.com' }, 'Email'));
    assert.ok(html.includes('mailto:'), `mailto should be allowed: ${html}`);
  });

  it('non-URL attributes are not affected', () => {
    const html = renderToString(h('div', { title: 'javascript:not-a-url' }));
    assert.ok(html.includes('javascript:not-a-url'), `title should not be sanitized: ${html}`);
  });
});

// =========================================================================
// Attribute NAME validation — names are emitted verbatim, so unsafe names
// must be skipped entirely (values are escaped; names cannot be).
// =========================================================================

describe('SSR attribute name validation', () => {
  function captureWarns(fn) {
    const origWarn = console.warn;
    const warns = [];
    console.warn = (...args) => warns.push(args.join(' '));
    try {
      return { html: fn(), warns };
    } finally {
      console.warn = origWarn;
    }
  }

  it('blocks attribute injection via attribute name (exact repro)', () => {
    const untrusted = { 'x" onload="alert(1)': 'v' };
    const { html, warns } = captureWarns(() => renderToString(h('div', { ...untrusted })));
    assert.ok(!html.includes('onload'), `injected attr name must be skipped: ${html}`);
    assert.ok(!html.includes('alert(1)'), `injected payload must not appear: ${html}`);
    assert.equal(html, '<div></div>');
    // The dev-warning is suppressed under NODE_ENV=production (no console spam in prod);
    // the security behavior above (attr stripped) holds in both modes.
    if (process.env.NODE_ENV !== 'production') {
      assert.ok(warns.some(w => w.includes('invalid attribute name')), 'should dev-warn');
    }
  });

  it('blocks names containing spaces, equals, quotes, and angle brackets', () => {
    for (const bad of ['a b', 'a=b', 'a"b', "a'b", 'a>b', 'a<b', 'a/b', 'a\nb', '']) {
      const { html } = captureWarns(() => renderToString(h('div', { [bad]: 'x' })));
      assert.equal(html, '<div></div>', `name ${JSON.stringify(bad)} must be skipped, got: ${html}`);
    }
  });

  it('blocks boolean-true attributes with unsafe names (bare emission path)', () => {
    const { html } = captureWarns(() => renderToString(h('div', { 'x onmouseover=alert(1)': true })));
    assert.equal(html, '<div></div>', `bare attr injection must be skipped: ${html}`);
  });

  it('allows data-* attributes', () => {
    const html = renderToString(h('div', { 'data-test-id': 'abc' }));
    assert.ok(html.includes('data-test-id="abc"'), html);
  });

  it('allows aria-* attributes', () => {
    const html = renderToString(h('div', { 'aria-label': 'Close', 'aria-hidden': true }));
    assert.ok(html.includes('aria-label="Close"'), html);
    assert.ok(html.includes('aria-hidden="true"'), html);
  });

  it('allows namespaced attributes like xlink:href', () => {
    const html = renderToString(h('use', { 'xlink:href': '#icon' }));
    assert.ok(html.includes('xlink:href="#icon"'), html);
  });

  it('allows SVG dashed and dotted names (stroke-width, edge.case)', () => {
    const html = renderToString(h('path', { 'stroke-width': '2', 'e.g': 'ok', _private: '1' }));
    assert.ok(html.includes('stroke-width="2"'), html);
    assert.ok(html.includes('e.g="ok"'), html);
    assert.ok(html.includes('_private="1"'), html);
  });
});

// =========================================================================
// innerHTML rejection in SSR
// =========================================================================

describe('SSR innerHTML security', () => {
  it('renders dangerouslySetInnerHTML.__html as raw HTML', () => {
    const html = renderToString(
      h('div', { dangerouslySetInnerHTML: { __html: '<b>bold</b>' } }),
    );
    assert.ok(html.includes('<b>bold</b>'));
  });

  it('rejects plain string innerHTML in SSR (XSS prevention)', () => {
    // Capture the warning to avoid test noise
    const origWarn = console.warn;
    const warns = [];
    console.warn = (...args) => warns.push(args.join(' '));
    try {
      const html = renderToString(
        h('div', { innerHTML: '<script>alert(1)</script>' }),
      );
      // Plain string innerHTML should be rejected — no script in output
      assert.ok(!html.includes('<script>'), `raw innerHTML should be rejected: ${html}`);
    } finally {
      console.warn = origWarn;
    }
  });

  it('allows innerHTML with __html wrapper in SSR', () => {
    const html = renderToString(
      h('div', { innerHTML: { __html: '<em>safe</em>' } }),
    );
    assert.ok(html.includes('<em>safe</em>'));
  });
});
