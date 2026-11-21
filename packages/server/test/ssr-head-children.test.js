// <title>, <meta> and <link> children of <Head> on the server. Head rendered
// its children in place, so `<Head><title>Hi</title></Head>` put the title in
// the body and the document had none. They now go to the render's head sink
// with the props' dedup keys, from h() children and from what-compiler's
// server target alike. The client half is
// packages/core/test/head-children.test.js.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { h, Head } from 'what-core';
import { loadCompiled } from '../../../test-utils/load-compiled.js';
import { renderToString, renderToStringWithHead, renderDocument } from '../src/index.js';

const compiled = await loadCompiled(`
  import { Head } from 'what-framework';
  export const Page = (p) => (
    <main>
      <Head>
        <title>A & B {p.name}</title>
        <meta name="description" content={'about "' + p.name + '"'} />
        <meta httpEquiv="refresh" content="30" />
        <link rel="canonical" href={'/' + p.name} />
        <noscript>enable js</noscript>
      </Head>
      <p>body</p>
    </main>
  );
  export const WithProps = () => (
    <div>
      <Head title="prop" meta={[{ name: 'description', content: 'prop' }]}>
        <title>child</title>
        <meta name="description" content="child" />
      </Head>
      <Head>
        <link rel="icon" href="/a.png" />
      </Head>
      <Head>
        <link rel="icon" href="/a.png" sizes="32x32" />
      </Head>
    </div>
  );
`, { pluginOptions: { generate: 'ssr' } });

function count(html, pattern) {
  return (html.match(pattern) || []).length;
}

describe('Head children in a server render', () => {
  it('h() children go to the head, once, and leave the body', () => {
    const { head, body } = renderToStringWithHead(h('main', {},
      h(Head, {},
        h('title', {}, 'Hello ', () => 'world'),
        h('meta', { name: 'description', content: 'about' }),
        h('link', { rel: 'canonical', href: '/hello' }),
        h('span', {}, 'stays'),
      ),
    ));
    assert.equal(count(head, /<title>Hello world<\/title>/g), 1);
    assert.equal(count(head, /<meta name="description" content="about">/g), 1);
    assert.equal(count(head, /<link rel="canonical" href="\/hello">/g), 1);
    assert.doesNotMatch(body, /<title|<meta|<link/, 'head tags must not render in the body');
    assert.match(body, /<span>stays<\/span>/, 'any other child renders in place');
  });

  it('compiled children go to the head, escaped once, and leave the body', () => {
    const { head, body } = renderToStringWithHead(h(compiled.Page, { name: 'x<y' }));
    assert.equal(count(head, /<title>A &amp; B x&lt;y<\/title>/g), 1);
    assert.equal(count(head, /<meta name="description" content="about &quot;x&lt;y&quot;">/g), 1);
    assert.equal(count(head, /<meta http-equiv="refresh" content="30">/g), 1);
    assert.equal(count(head, /<link rel="canonical" href="\/x&lt;y">/g), 1);
    assert.doesNotMatch(body, /<title|<meta|<link/, 'head tags must not render in the body');
    assert.match(body, /<main><noscript>enable js<\/noscript><p>body<\/p><\/main>/, 'any other child renders in place');
  });

  it('renderToString stays body-only', () => {
    const body = renderToString(h(compiled.Page, { name: 'n' }));
    assert.doesNotMatch(body, /<title|<meta|<link/);
  });

  it('a document has the title in its <head>, once', async () => {
    const html = await renderDocument({ default: () => h(compiled.Page, { name: 'doc' }) }, {}, { onError() {} });
    const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
    assert.equal(count(head, /<title>A &amp; B doc<\/title>/g), 1);
    assert.equal(count(html, /<title>/g), 1);
  });
});

describe('Head children share the props dedup keys on the server', () => {
  it('a child beats a prop of the same Head, and a later Head an earlier one', () => {
    const { head } = renderToStringWithHead(h(compiled.WithProps));
    assert.equal(count(head, /<title>/g), 1);
    assert.match(head, /<title>child<\/title>/);
    assert.equal(count(head, /name="description"/g), 1);
    assert.match(head, /<meta name="description" content="child">/);
    assert.equal(count(head, /rel="icon"/g), 1);
    assert.match(head, /<link rel="icon" href="\/a.png" sizes="32x32">/);
  });

  it('h() children dedupe against a prop in another Head', () => {
    const { head } = renderToStringWithHead(h('div', {},
      h(Head, { meta: { name: 'description', content: 'first' }, title: 'first' }),
      h(Head, {}, h('title', {}, 'second'), h('meta', { name: 'description', content: 'second' })),
    ));
    assert.equal(count(head, /<title>/g), 1);
    assert.match(head, /<title>second<\/title>/);
    assert.equal(count(head, /name="description"/g), 1);
    assert.match(head, /content="second"/);
  });
});
