// The string renderer's fast paths must not change a single byte of output or
// weaken a single check.
//
//   - escapeHtml is one search plus one pass instead of five chained replace()
//     calls. It has to agree with the five-replace version on every input.
//   - renderAttrs decides everything it can from a prop's NAME once and caches
//     it (alias, event skip, name validation, refusal, URL check, enumerated
//     rules). Values still have to be resolved, URL-checked and escaped on
//     every render, and the cache must stay bounded because spread props can
//     carry attacker-chosen keys.
//   - assertSafeTag caches names that passed; a bad name must still throw.
//   - A style object's property names are checked and written in kebab-case
//     once per name, in a bounded cache, and a value made only of characters
//     the declaration grammar gives no meaning to skips the character walk.
//     Every other value is still read by the grammar, on every render.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { h } from 'what-core';
import { _escapeHtml } from 'what-core/internal';
import { renderToString, renderToHydratableString, renderToStream } from '../src/index.js';
import { ATTR_INFO_CACHE_SIZE, CSS_NAME_CACHE_SIZE, PLAIN_CSS_VALUE, SAFE_TAG_CACHE_SIZE, _attrInfo, _cssNames, _oneDeclaration, _safeTags } from '../src/html.js';
import { collect } from './stream-helpers.js';

function fiveReplaceEscape(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Deterministic PRNG so a failure reproduces.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = ['&', '<', '>', '"', "'", 'a', 'Z', '0', ' ', '\n', '\t', ';', '#', 'é', ' ', '😀', '\ud800', '\u0000', '&amp;', '<script>'];

function randomString(rand) {
  const length = Math.floor(rand() * 40);
  let s = '';
  for (let i = 0; i < length; i++) {
    s += rand() < 0.7
      ? ALPHABET[Math.floor(rand() * ALPHABET.length)]
      : String.fromCharCode(Math.floor(rand() * 0x10000));
  }
  return s;
}

describe('escapeHtml', () => {
  it('equals the five-replace escape on 20,000 random strings', () => {
    const rand = prng(0xC0FFEE);
    for (let i = 0; i < 20000; i++) {
      const input = randomString(rand);
      assert.equal(_escapeHtml(input), fiveReplaceEscape(input), `input ${JSON.stringify(input)}`);
    }
  });

  it('handles the edges: empty, clean, all-special, special at both ends', () => {
    for (const input of ['', 'plain text', '&<>"\'', '<a>', 'x&', '&x', '\'"', 'a&b<c>d"e\'f']) {
      assert.equal(_escapeHtml(input), fiveReplaceEscape(input));
    }
  });

  it('returns a clean string unchanged', () => {
    const input = 'nothing to escape here';
    assert.equal(_escapeHtml(input), input);
  });
});

describe('the attribute decision cache', () => {
  it('stays bounded however many distinct attribute names a render sees', () => {
    const props = {};
    for (let i = 0; i < ATTR_INFO_CACHE_SIZE * 3; i++) props[`data-k${i}`] = 'v';
    const html = renderToString(h('div', props));
    assert.ok(_attrInfo.size <= ATTR_INFO_CACHE_SIZE, `cache grew to ${_attrInfo.size}`);
    // Names past the bound are still rendered, i.e. computed without caching.
    assert.match(html, new RegExp(`data-k${ATTR_INFO_CACHE_SIZE * 3 - 1}="v"`));
  });

  it('keeps refusing unsafe names and values once the cache is full', () => {
    const filler = {};
    for (let i = 0; i < ATTR_INFO_CACHE_SIZE + 10; i++) filler[`data-fill${i}`] = 'v';
    renderToString(h('div', filler));
    assert.ok(_attrInfo.size <= ATTR_INFO_CACHE_SIZE);

    const html = renderToString(h('iframe', {
      'x" onload="alert(1)': '',
      'onClickUncached': 'alert(1)',
      'SrcDocUncached': 'not refused, just an unknown attribute',
      srcdoc: '<script>alert(1)</script>',
      SRCDOC: '<script>alert(1)</script>',
      href: 'javascript:alert(1)',
      HREF: ' JaVaScRiPt:alert(1)',
      'xlink:href': 'data:text/html,x',
      title: '"><script>alert(1)</script>',
    }));
    assert.ok(!html.includes('onload'), html);
    assert.ok(!html.includes('alert(1)"'), html);
    assert.ok(!/srcdoc=/i.test(html), html);
    assert.ok(!/javascript:/i.test(html), html);
    assert.ok(!html.includes('data:text/html'), html);
    assert.ok(!html.includes('onClickUncached'), html);
    assert.match(html, /title="&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;"/);
  });

  it('checks the value every time even when the name is cached', () => {
    const safe = renderToString(h('a', { href: 'https://example.com' }, 'ok'));
    assert.match(safe, /href="https:\/\/example.com"/);
    const unsafe = renderToString(h('a', { href: 'java\tscript:alert(1)' }, 'no'));
    assert.ok(!/href=/.test(unsafe), unsafe);
    const thunk = renderToString(h('a', { href: () => 'javascript:alert(1)' }, 'no'));
    assert.ok(!/href=/.test(thunk), thunk);
  });

  it('applies the same rules on every server path', async () => {
    const tree = () => h('a', {
      className: 'c',
      htmlFor: 'f',
      onclick: () => {},
      href: 'vbscript:x',
      'aria-hidden': false,
      'data-open': true,
      hidden: true,
      disabled: false,
      srcdoc: 'x',
      'bad name': 'x',
    }, 'x');
    const expected = '<a class="c" for="f" aria-hidden="false" data-open="true" hidden>x</a>';
    assert.equal(renderToString(tree()), expected);
    assert.equal(await collect(renderToStream(tree())), expected);
    assert.match(renderToHydratableString(tree()), /^<a class="c" for="f" aria-hidden="false" data-open="true" hidden>x<\/a>$/);
  });
});

describe('the tag-name cache', () => {
  it('stays bounded and still rejects a bad tag once full', () => {
    const tags = [];
    for (let i = 0; i < SAFE_TAG_CACHE_SIZE * 2; i++) tags.push(h(`x-el-${i}`, null));
    renderToString(h('div', null, ...tags));
    assert.ok(_safeTags.size <= SAFE_TAG_CACHE_SIZE, `cache grew to ${_safeTags.size}`);
    assert.throws(() => renderToString(h('div onload=alert(1) x', null)), { code: 'ERR_INVALID_SSR_TAG' });
    assert.throws(() => renderToString(h('<script>', null)), { code: 'ERR_INVALID_SSR_TAG' });
  });

  it('a streamed bad tag is still refused, not emitted', async () => {
    const original = console.error;
    console.error = () => {};
    let html;
    try {
      html = await collect(renderToStream(h(() => h('div', null, h('img src=x onerror=alert(1)', null)), {})));
    } finally {
      console.error = original;
    }
    assert.ok(!html.includes('<img'), html);
    assert.match(html, /^<div data-hk="0"><\/div><!-- SSR Error/);
  });
});

describe('innerHTML still requires { __html } on every path', () => {
  it('drops a raw string and keeps a wrapped one', async () => {
    const original = console.warn;
    console.warn = () => {};
    try {
      const raw = h('div', { innerHTML: '<img src=x onerror=alert(1)>' });
      const wrapped = h('div', { innerHTML: { __html: '<b>ok</b>' } });
      for (const html of [renderToString(raw), renderToHydratableString(raw), await collect(renderToStream(raw))]) {
        assert.equal(html, '<div></div>');
      }
      for (const html of [renderToString(wrapped), await collect(renderToStream(wrapped))]) {
        assert.equal(html, '<div><b>ok</b></div>');
      }
    } finally {
      console.warn = original;
    }
  });
});

describe('a style object\'s fast paths', () => {
  it('a value the fast path takes is one the declaration grammar takes', () => {
    // Every string over the fast path's alphabet and a few characters outside
    // it, up to four characters: none is accepted by the fast path and
    // refused by the grammar.
    const alphabet = ['a', 'Z', '0', '_', '#', '%', '.', ',', '+', '-', ' ', ';', ':', '(', ')', '"', "'", '\\', '/', '*', '{', '}', '\n', '\t', '\u0000', '\u007f', '\u00e9'];
    let accepted = 0;
    const walk = (text, depth) => {
      if (PLAIN_CSS_VALUE.test(text)) {
        accepted++;
        assert.ok(_oneDeclaration(text), JSON.stringify(text));
      }
      if (depth < 4) for (const c of alphabet) walk(text + c, depth + 1);
    };
    walk('', 0);
    assert.ok(accepted > 10000);
    for (const text of ['red;background:url(//x)', 'a\\', 'x{y}', 'a/*b*/', 'url(a b)', '"open', 'a\u0000b', 'a\nb;c']) {
      assert.ok(!PLAIN_CSS_VALUE.test(text), JSON.stringify(text));
    }
  });

  // An empty value (left) sets nothing on the client and is left out.
  it('writes the same text as before for names and values of every kind', () => {
    const style = {
      color: 'red', backgroundColor: '#1b1b1b', WebkitLineClamp: 3, msTransform: 'none', '--gap': '4px', '--Mixed-Case': 'a b',
      width: 'calc(100% - 2px)', margin: '0 auto', opacity: 0.5, fontFamily: "'A B', serif", transform: 'translate(-50%, 10px)',
      'not a property': 'x', 'color;x': 'y', content: '"a;b"', background: 'red;background:url(//tracker)', top: '1px}', left: '',
    };
    assert.equal(renderToString(h('div', { style })),
      '<div style="color:red;background-color:#1b1b1b;-webkit-line-clamp:3;ms-transform:none;--gap:4px;--Mixed-Case:a b;width:calc(100% - 2px);'
      + 'margin:0 auto;opacity:0.5;font-family:&#39;A B&#39;, serif;transform:translate(-50%, 10px);content:&quot;a;b&quot;"></div>');
  });

  it('names that differ only in case are different names, whichever is seen first', () => {
    // fontSize is font-size and fontsize is fontsize: a cache that told names
    // apart by anything less than the name would write one for the other.
    const pairs = [['fontSize', 'fontsize', 'font-size'], ['lineHeight', 'lineheight', 'line-height'], ['WebkitBoxFlex', 'webkitBoxFlex', '-webkit-box-flex', 'webkit-box-flex']];
    for (const order of ['camel first', 'lower first']) {
      _cssNames.clear();
      for (const [camel, lower, written, writtenLower = lower] of pairs) {
        const a = () => renderToString(h('div', { style: { [camel]: '1' } }));
        const b = () => renderToString(h('div', { style: { [lower]: '1' } }));
        const got = order === 'camel first' ? [a(), b()] : [b(), a()].reverse();
        assert.deepEqual(got, [`<div style="${written}:1"></div>`, `<div style="${writtenLower}:1"></div>`], `${camel} and ${lower}, ${order}`);
        // And again, from the cache.
        assert.deepEqual([a(), b()], got);
      }
      // Both in one object.
      assert.equal(renderToString(h('div', { style: { fontsize: '1', fontSize: '2', FontSize: '3' } })), '<div style="fontsize:1;font-size:2;-font-size:3"></div>');
    }
    assert.equal(_cssNames.get('fontSize'), 'font-size');
    assert.equal(_cssNames.get('fontsize'), 'fontsize');
  });

  it('the name cache stays bounded, and names past the bound are still checked', () => {
    const style = {};
    for (let i = 0; i < CSS_NAME_CACHE_SIZE * 2; i++) style[`--custom-${i}`] = '1px';
    const html = renderToString(h('div', { style }));
    assert.ok(_cssNames.size <= CSS_NAME_CACHE_SIZE, `cache grew to ${_cssNames.size}`);
    assert.ok(html.includes(`--custom-${CSS_NAME_CACHE_SIZE * 2 - 1}:1px`));
    assert.equal(renderToString(h('div', { style: { 'x;y:z': 'a', 'bad name': 'b', fontSize: '12px', 'color}': 'c' } })), '<div style="font-size:12px"></div>');
  });
});
