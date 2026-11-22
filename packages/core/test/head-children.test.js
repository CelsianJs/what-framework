// <Head><title>…</title></Head> set no title: Head rendered its children in
// place, so the <title>, <meta> and <link> landed in the body. They are now the
// props they spell, hoisted into document.head with the props' dedup keys,
// whichever way the children were built (h(), the JSX runtime, compiled JSX).
// The server half is packages/server/test/ssr-head-children.test.js.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM();

const { mount, h, signal } = await import('what-framework');
const { jsx } = await import('../src/jsx-runtime.js');
const { Head, clearHead } = await import('../src/head.js');

let host;
let unmount = () => {};
beforeEach(() => {
  host = document.getElementById('app');
  unmount();
  host.textContent = '';
  clearHead();
  document.title = '';
});

function managed(selector) {
  return [...document.head.querySelectorAll(selector)];
}

const compiled = await loadCompiled(`
  import { Head } from 'what-framework';
  export const Page = (p) => (
    <main>
      <Head>
        <title>Count {p.count()}</title>
        <meta name="description" content={'about ' + p.count()} />
        <link rel="canonical" href="/page" />
        <span class="note">enable js</span>
      </Head>
      <p>body</p>
    </main>
  );
  export const WithProps = () => (
    <Head title="prop" meta={[{ name: 'description', content: 'prop' }]}>
      <title>child</title>
      <meta name="description" content="child" />
    </Head>
  );
`);

describe('Head reads <title>, <meta> and <link> children', () => {
  it('h() children set the head and leave the body', () => {
    unmount = mount(h('main', {},
      h(Head, {},
        h('title', {}, 'Hello ', () => 'world'),
        h('meta', { name: 'description', content: 'about' }),
        h('meta', { 'http-equiv': 'refresh', content: '30' }),
        h('link', { rel: 'canonical', href: '/hello' }),
        h('span', {}, 'stays'),
      ),
    ), host);
    assert.equal(document.title, 'Hello world');
    assert.equal(managed('meta[name="description"]')[0].getAttribute('content'), 'about');
    assert.equal(managed('meta[data-what-head="refresh"]')[0].getAttribute('http-equiv'), 'refresh');
    assert.equal(managed('link[rel="canonical"]')[0].getAttribute('href'), '/hello');
    assert.equal(host.querySelector('title, meta, link'), null, 'head tags must not render in the body');
    assert.equal(host.querySelector('span').textContent, 'stays', 'any other child renders in place');
  });

  it('JSX runtime children set the head', () => {
    unmount = mount(jsx(Head, { children: [jsx('title', { children: 'From jsx' }), jsx('meta', { name: 'robots', content: 'noindex' })] }), host);
    assert.equal(document.title, 'From jsx');
    assert.equal(managed('meta[name="robots"]')[0].getAttribute('content'), 'noindex');
    assert.equal(host.querySelector('title, meta'), null);
  });

  it('compiled JSX children set the head and leave the body', () => {
    const count = signal(3);
    unmount = mount(() => compiled.Page({ count }), host);
    assert.equal(document.title, 'Count 3');
    assert.equal(managed('meta[name="description"]')[0].getAttribute('content'), 'about 3');
    assert.equal(managed('link[rel="canonical"]')[0].getAttribute('href'), '/page');
    assert.equal(host.querySelector('title, meta, link'), null, 'head tags must not render in the body');
    assert.equal(host.querySelector('.note').textContent, 'enable js', 'any other child renders in place');
    assert.equal(host.querySelector('p').textContent, 'body');
  });
});

describe('Head children share the props dedup keys', () => {
  it('a child beats a prop of the same Head, with one tag per key', () => {
    unmount = mount(() => compiled.WithProps(), host);
    assert.equal(document.title, 'child');
    const description = managed('meta[name="description"]');
    assert.equal(description.length, 1);
    assert.equal(description[0].getAttribute('content'), 'child');
  });

  it('a later Head replaces an earlier one, child or prop', () => {
    unmount = mount(h('div', {},
      h(Head, {}, h('title', {}, 'first'), h('meta', { name: 'description', content: 'first' }), h('link', { rel: 'icon', href: '/a.png' })),
      h(Head, { meta: { name: 'description', content: 'second' } }, h('title', {}, 'second'), h('link', { rel: 'icon', href: '/a.png', sizes: '32x32' })),
    ), host);
    assert.equal(document.title, 'second');
    const description = managed('meta[name="description"]');
    assert.equal(description.length, 1);
    assert.equal(description[0].getAttribute('content'), 'second');
    const icon = managed('link[rel="icon"]');
    assert.equal(icon.length, 1);
    assert.equal(icon[0].getAttribute('sizes'), '32x32');
  });
});
