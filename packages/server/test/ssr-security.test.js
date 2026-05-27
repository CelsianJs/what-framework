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
