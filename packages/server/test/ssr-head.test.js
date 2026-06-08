// SSR head collection (Phase 1). <Head> declared anywhere in the tree is
// captured during renderToStringWithHead and emitted as escaped <head> HTML.
// renderToString stays body-only and must not throw when a tree uses <Head>.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { h, Head } from 'what-core';
import { renderToString, renderToStringWithHead } from '../src/index.js';

describe('SSR head collection', () => {
  it('collects <title> from a Head component', () => {
    function Page() {
      return h('div', {}, h(Head, { title: 'Hello World' }), h('p', {}, 'body'));
    }
    const { body, head } = renderToStringWithHead(h(Page));
    assert.match(head, /<title>Hello World<\/title>/);
    assert.match(body, /<p>body<\/p>/);
  });

  it('collects meta tags and de-dupes by name (last wins)', () => {
    function Page() {
      return h(
        'div',
        {},
        h(Head, { meta: [{ name: 'description', content: 'first' }] }),
        h(Head, { meta: [{ name: 'description', content: 'second' }] })
      );
    }
    const { head } = renderToStringWithHead(h(Page));
    const matches = head.match(/name="description"/g) || [];
    assert.equal(matches.length, 1, 'description meta must be de-duped');
    assert.match(head, /content="second"/);
    assert.doesNotMatch(head, /content="first"/);
  });

  it('collects link tags', () => {
    function Page() {
      return h(Head, { link: [{ rel: 'canonical', href: 'https://x.com/p' }] });
    }
    const { head } = renderToStringWithHead(h(Page));
    assert.match(head, /<link[^>]*rel="canonical"[^>]*>/);
    assert.match(head, /href="https:\/\/x\.com\/p"/);
  });

  it('escapes head attribute/title values to prevent breakout', () => {
    function Page() {
      return h(Head, {
        title: '</title><script>alert(1)</script>',
        meta: [{ name: 'x', content: '"><img src=x onerror=alert(1)>' }],
      });
    }
    const { head } = renderToStringWithHead(h(Page));
    assert.doesNotMatch(head, /<script>alert\(1\)/);
    assert.ok(!head.includes('"><img'), 'raw attribute breakout must be escaped');
  });

  it('renderToString still returns body-only and does not throw with <Head>', () => {
    function Page() {
      return h('div', {}, h(Head, { title: 'ignored' }), h('p', {}, 'hi'));
    }
    const body = renderToString(h(Page));
    assert.equal(typeof body, 'string');
    assert.match(body, /<p>hi<\/p>/);
    assert.doesNotMatch(body, /<title>/, 'head must not leak into body');
  });

  it('Head renders its children into the body on the server', () => {
    function Page() {
      return h(Head, { title: 'T' }, h('span', {}, 'child'));
    }
    const { body } = renderToStringWithHead(h(Page));
    assert.match(body, /<span>child<\/span>/);
  });

  it('does not leak head between sequential renders', () => {
    const a = renderToStringWithHead(h(() => h(Head, { title: 'A' })));
    const b = renderToStringWithHead(h(() => h('div', {}, 'no head')));
    assert.match(a.head, /<title>A<\/title>/);
    assert.doesNotMatch(b.head, /<title>/, 'second render must start with a fresh sink');
  });
});
