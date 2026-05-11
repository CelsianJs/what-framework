import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { h } = await import('../../core/src/h.js');
const { renderToString, renderToHydratableString, renderToStream } = await import('../src/index.js');
const { createIslandStore, serializeIslandStores } = await import('../src/islands.js');

async function streamToString(vnode) {
  const chunks = [];
  for await (const chunk of renderToStream(vnode)) chunks.push(chunk);
  return chunks.join('');
}

describe('fresh-review SSR attribute hardening', () => {
  it('omits unsafe URL attributes in renderToString output', () => {
    const html = renderToString(h('a', { href: 'javascript:alert(1)', title: 'kept' }, 'bad'));

    assert.equal(html, '<a title="kept">bad</a>');
  });

  it('omits unsafe mixed-case URL attributes in renderToString output', () => {
    const html = renderToString(h('a', { HREF: 'javascript:alert(1)', title: 'kept' }, 'bad'));

    assert.equal(html, '<a title="kept">bad</a>');
  });

  it('omits unsafe URL attributes in hydratable SSR output', () => {
    const html = renderToHydratableString(h('img', { src: 'data:text/html,<script>alert(1)</script>', alt: 'x' }));

    assert.equal(html, '<img alt="x">');
  });

  it('omits unsafe srcset candidates in streaming SSR output', async () => {
    const html = await streamToString(h('img', { srcset: '/safe.png 1x, vbscript:bad 2x', alt: 'x' }));

    assert.equal(html, '<img alt="x">');
  });

  it('omits invalid attribute names without corrupting neighboring attributes', () => {
    const html = renderToString(h('div', {
      'bad name': 'x',
      'bad"quote': 'x',
      ok: 'yes',
      'data-safe': 'kept',
    }));

    assert.equal(html, '<div ok="yes" data-safe="kept"></div>');
    assert.ok(!html.includes('bad name'));
    assert.ok(!html.includes('bad&quot;quote'));
  });
});

describe('fresh-review island store script escaping', () => {
  it('escapes JSON so serialized stores can be embedded in script text', () => {
    const store = createIslandStore('fresh-review-store', {
      payload: '</script><script>alert(1)</script>&',
    });
    store.payload = '</script><script>alert(1)</script>&';

    const serialized = serializeIslandStores();

    assert.ok(!serialized.includes('<'));
    assert.ok(!serialized.includes('>'));
    assert.ok(!serialized.includes('&'));
    assert.equal(JSON.parse(serialized)['fresh-review-store'].payload, '</script><script>alert(1)</script>&');
  });
});
