// Consolidated hydration payload (Phase 5): renderDocument emits exactly one
// <script id="__what_data"> with { loaderData, resources, islandStores },
// XSS-safe, plus the collected <head>.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { h, Head } from 'what-core';
import { renderDocument } from '../src/index.js';

describe('renderDocument', () => {
  it('emits a single __what_data script with loader data', async () => {
    const mod = {
      loader: () => ({ message: 'hi' }),
      default: ({ loaderData }) => h('main', {}, loaderData.message),
    };
    const html = await renderDocument(mod, {});
    const scripts = html.match(/id="__what_data"/g) || [];
    assert.equal(scripts.length, 1);
    assert.match(html, /<main>hi<\/main>/);
    const json = html.match(/id="__what_data"[^>]*>([^<]*)</)[1];
    assert.deepEqual(JSON.parse(json).loaderData, { message: 'hi' });
  });

  it('injects collected <head> into the document head', async () => {
    const mod = { default: () => h('div', {}, h(Head, { title: 'Doc Title' }), 'body') };
    const html = await renderDocument(mod, {});
    assert.match(html, /<title>Doc Title<\/title>/);
  });

  it('escapes the payload so values cannot break out of the script tag', async () => {
    const mod = {
      loader: () => ({ evil: '</script><img src=x onerror=alert(1)>' }),
      default: () => h('div', {}, 'x'),
    };
    const html = await renderDocument(mod, {});
    assert.ok(!html.includes('</script><img'), 'raw </script> breakout must be escaped');
    assert.match(html, /\\u003c\/script/);
  });

  it('is a complete HTML document', async () => {
    const mod = { default: () => h('div', {}, 'hello') };
    const html = await renderDocument(mod, {});
    assert.match(html, /<!DOCTYPE html>/i);
    assert.match(html, /<html/);
    assert.match(html, /<\/html>/);
  });
});
