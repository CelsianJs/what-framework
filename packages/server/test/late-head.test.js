// <Head> inside a streamed <Suspense> (functional review M4).
//
// A streamed document sends its <head> with the shell, and head tags set in a
// boundary that streamed later went into the render's head sink after it had
// been written, with no warning: the buffered page had its <title> and meta,
// the streamed one had neither. Late tags now travel with their boundary and
// are applied to document.head, by the inline script or, with noScripts, by
// applyStreamedBoundaries(); development warns once per stream.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { h, Suspense, createResource, Head, applyStreamedBoundaries } from 'what-core';
import { renderDocument, renderDocumentStream } from '../src/index.js';
import { collect } from './stream-helpers.js';

const page = {
  default: () => h('main', null, h(Suspense, { fallback: 'loading' }, h(function Post() {
    const [post] = createResource(async () => ({ title: 'My Post' }), { key: 'post' });
    return h('article', null,
      h(Head, {
        title: post().title,
        meta: [{ name: 'description', content: 'about my post' }, { name: 'x" onload="alert(1)', content: 'x' }],
        link: { rel: 'canonical', href: '/posts/1' },
      }),
      h('h1', null, post().title));
  }, {}))),
};

function quietly(fn) {
  const warn = console.warn;
  const warnings = [];
  console.warn = (message) => warnings.push(String(message));
  return Promise.resolve().then(fn).then(
    (value) => { console.warn = warn; return { value, warnings }; },
    (error) => { console.warn = warn; throw error; },
  );
}

describe('head tags set inside a streamed boundary', () => {
  it('reach document.head through the boundary\'s script', async () => {
    const { value: html, warnings } = await quietly(async () => collect(await renderDocumentStream(page, {}, { onError() {} })));
    const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
    assert.doesNotMatch(head, /<title>/, 'the shell\'s head went out before the boundary rendered');
    assert.match(html, /_\$W\.t\(/);
    const dom = new JSDOM(html, { runScripts: 'dangerously' });
    const doc = dom.window.document;
    assert.equal(doc.title, 'My Post');
    assert.equal(doc.head.querySelector('meta[name="description"]').getAttribute('content'), 'about my post');
    assert.equal(doc.head.querySelector('link[rel="canonical"]').getAttribute('href'), '/posts/1');
    assert.equal(doc.head.querySelectorAll('[onload]').length, 0, 'an unsafe attribute name was applied');
    dom.window.close();
    assert.equal(warnings.filter((w) => w.includes('ERR_SSR_LATE_HEAD')).length, 1);
  });

  it('with noScripts, ride in the boundary\'s data and are applied by applyStreamedBoundaries()', async () => {
    const { value: html } = await quietly(async () => collect(await renderDocumentStream(page, {}, { noScripts: true, onError() {} })));
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /"head":\{"[^"]+":\{"title":"My Post"/);
    const dom = new JSDOM(html);
    const saved = globalThis.document;
    globalThis.document = dom.window.document;
    try {
      const { __resetHydrationData } = await import('what-core/internal');
      __resetHydrationData();
      assert.equal(applyStreamedBoundaries(), 1);
      assert.equal(dom.window.document.title, 'My Post');
      assert.equal(dom.window.document.head.querySelector('meta[name="description"]').getAttribute('content'), 'about my post');
    } finally {
      globalThis.document = saved;
    }
    dom.window.close();
  });

  it('a late tag replaces the shell\'s tag with the same key instead of adding a second one', async () => {
    const replacing = {
      default: () => h('main', null,
        h(Head, { title: 'Loading', meta: { name: 'description', content: 'shell' } }),
        page.default()),
    };
    const { value: html } = await quietly(async () => collect(await renderDocumentStream(replacing, {}, { onError() {} })));
    const dom = new JSDOM(html, { runScripts: 'dangerously' });
    const doc = dom.window.document;
    assert.equal(doc.title, 'My Post');
    assert.equal(doc.head.querySelectorAll('title').length, 1);
    assert.equal(doc.head.querySelectorAll('meta[name="description"]').length, 1);
    assert.equal(doc.head.querySelector('meta[name="description"]').getAttribute('content'), 'about my post');
    dom.window.close();
  });

  it('the buffered document has them in its <head>', async () => {
    const html = await renderDocument(page, {}, { onError() {} });
    const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
    assert.match(head, /<title>My Post<\/title>/);
    assert.match(head, /<meta name="description" content="about my post">/);
  });
});
