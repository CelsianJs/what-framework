// <Head> under a DOM shim (R9).
//
// <Head> chose its server branch with `typeof document === 'undefined'`. In a
// server process that has a DOM shim loaded (jsdom or happy-dom in tests, a
// polyfill in some runtimes), a server render took the CLIENT branch: it wrote
// the request's title into the process-wide document and the response went out
// with no <title> at all, while the next request inherited the previous
// request's document.title. The branch now asks the render scope.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

let cleanup;
let h;
let Head;
let renderDocument;
let renderToStringWithHead;

before(async () => {
  ({ cleanup } = installDOM('<!DOCTYPE html><html><head><title>shell</title></head><body></body></html>'));
  ({ h, Head } = await import('what-core'));
  ({ renderDocument, renderToStringWithHead } = await import('../src/index.js'));
});
after(() => cleanup());

const page = (title) => ({
  default: () => h('main', null, h(Head, { title, meta: { name: 'description', content: `about ${title}` } }), h('p', null, title)),
});

describe('<Head> in a server render with a DOM present', () => {
  it('writes the title into the response, not into the process document', async () => {
    const html = await renderDocument(page('Alice private dashboard'));
    assert.match(html, /<title>Alice private dashboard<\/title>/);
    assert.match(html, /<meta name="description" content="about Alice private dashboard">/);
    assert.equal(document.title, 'shell');
    assert.equal(document.head.querySelectorAll('[data-what-head]').length, 0);
  });

  it('keeps concurrent requests apart', async () => {
    const [a, b] = await Promise.all([renderDocument(page('alice')), renderDocument(page('bob'))]);
    assert.match(a, /<title>alice<\/title>/);
    assert.match(b, /<title>bob<\/title>/);
    assert.ok(!a.includes('bob') && !b.includes('alice'));
  });

  it('renderToStringWithHead collects it too', () => {
    const { head } = renderToStringWithHead(h(page('x').default, {}));
    assert.match(head, /<title>x<\/title>/);
  });

  it('still updates the real document outside a render', () => {
    Head({ title: 'client title' });
    assert.equal(document.title, 'client title');
  });
});
