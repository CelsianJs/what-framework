// A <Head> that runs again in the browser, as every component does when a
// server-rendered page hydrates, adopts the tags the server already wrote
// instead of adding a second copy of each. The server writes them without the
// data-what-head key the client looks its own tags up by, so the client
// recognises them by the identity the server deduplicates by: a meta's name,
// property or http-equiv, a link's rel and href. Checked for the buffered
// document and for both stream modes, whose late tags are applied by the
// boundary's script or by applyStreamedBoundaries().

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { h, Suspense, createResource, Head, applyStreamedBoundaries } from 'what-core';
import { __resetHydrationData } from 'what-core/internal';
import { renderDocument, renderDocumentStream } from '../src/index.js';
import { collect } from './stream-helpers.js';

const TAGS = {
  meta: [{ name: 'description', content: 'about' }, { property: 'og:title', content: 'Post' }, { httpEquiv: 'refresh', content: '30' }],
  link: [{ rel: 'canonical', href: '/posts/1' }, { rel: 'icon', href: '/favicon.svg' }],
};

const shellPage = { default: () => h('main', null, h(Head, { title: 'Post', ...TAGS }), h('h1', null, 'Post')) };
const streamedPage = {
  default: () => h('main', null, h(Suspense, { fallback: 'loading' }, h(function Post() {
    const [post] = createResource(async () => 'Post', { key: 'post' });
    return h('article', null, h(Head, { title: post(), ...TAGS }), h('h1', null, post()));
  }, {}))),
};

const quiet = async (fn) => {
  const warn = console.warn;
  console.warn = () => {};
  try { return await fn(); } finally { console.warn = warn; }
};

// Run the client <Head> against `doc`, the way hydration runs it.
function hydrateHead(doc, props = { title: 'Post', ...TAGS }) {
  const saved = globalThis.document;
  globalThis.document = doc;
  try {
    Head(props);
  } finally {
    globalThis.document = saved;
  }
}

function headCounts(doc) {
  const head = doc.head;
  return {
    description: head.querySelectorAll('meta[name="description"]').length,
    og: head.querySelectorAll('meta[property="og:title"]').length,
    refresh: head.querySelectorAll('meta[http-equiv="refresh"]').length,
    canonical: head.querySelectorAll('link[rel="canonical"]').length,
    icon: head.querySelectorAll('link[rel="icon"]').length,
  };
}

const ONE_EACH = { description: 1, og: 1, refresh: 1, canonical: 1, icon: 1 };

describe('<Head> hydrating a server-rendered document', () => {
  it('buffered (renderDocument): adopts the tags in <head>', async () => {
    const dom = new JSDOM(await renderDocument(shellPage));
    assert.deepEqual(headCounts(dom.window.document), ONE_EACH);
    hydrateHead(dom.window.document);
    assert.deepEqual(headCounts(dom.window.document), ONE_EACH);
    dom.window.close();
  });

  it('streamed with scripts: adopts the tags the boundary\'s script applied', async () => {
    const html = await quiet(async () => collect(await renderDocumentStream(streamedPage, {}, { onError() {} })));
    const dom = new JSDOM(html, { runScripts: 'dangerously' });
    assert.deepEqual(headCounts(dom.window.document), ONE_EACH);
    hydrateHead(dom.window.document);
    assert.deepEqual(headCounts(dom.window.document), ONE_EACH);
    dom.window.close();
  });

  it('streamed with noScripts: adopts the tags applyStreamedBoundaries() applied', async () => {
    const html = await quiet(async () => collect(await renderDocumentStream(streamedPage, {}, { noScripts: true, onError() {} })));
    const dom = new JSDOM(html);
    const saved = globalThis.document;
    globalThis.document = dom.window.document;
    try {
      __resetHydrationData();
      assert.equal(applyStreamedBoundaries(), 1);
    } finally {
      globalThis.document = saved;
    }
    assert.deepEqual(headCounts(dom.window.document), ONE_EACH);
    hydrateHead(dom.window.document);
    assert.deepEqual(headCounts(dom.window.document), ONE_EACH);
    dom.window.close();
  });

  it('an adopted tag is the one later updates go to', async () => {
    const dom = new JSDOM(await renderDocument(shellPage));
    const doc = dom.window.document;
    hydrateHead(doc);
    hydrateHead(doc, { meta: { name: 'description', content: 'changed' }, link: { rel: 'canonical', href: '/posts/1', hreflang: 'en' } });
    assert.deepEqual(headCounts(doc), ONE_EACH);
    assert.equal(doc.head.querySelector('meta[name="description"]').getAttribute('content'), 'changed');
    assert.equal(doc.head.querySelector('link[rel="canonical"]').getAttribute('hreflang'), 'en');
    dom.window.close();
  });

  it('a tag with a different identity is still added', async () => {
    const dom = new JSDOM(await renderDocument(shellPage));
    const doc = dom.window.document;
    hydrateHead(doc, { meta: { name: 'keywords', content: 'k' }, link: { rel: 'canonical', href: '/other' } });
    assert.equal(doc.head.querySelectorAll('meta[name="keywords"]').length, 1);
    assert.equal(doc.head.querySelectorAll('link[rel="canonical"]').length, 2);
    dom.window.close();
  });
});
