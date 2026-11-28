// Streamed boundaries cannot be named or hijacked by page markup (security
// review #5 and #10).
//
// Boundary ids were `wb0`, `wb1`, ... and the swap looked both nodes up with
// getElementById, with no tag check. Any user-chosen id on the page before a
// <Suspense> (a heading slug, a profile anchor) could take over the swap:
// `id="pl-wb0"` received the boundary's private content and every sibling
// after it was deleted; `id="wb0"` kept the boundary from ever showing with
// noScripts. idPrefix went into ids, a comment and an inline script unchecked.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { h, Suspense, createResource, applyStreamedBoundaries } from 'what-core';
import { renderToStream, renderDocumentStream } from '../src/index.js';
import { collect } from './stream-helpers.js';

const ID = /<template id="pl-([^"]+)">/;

function page(value = 'Your balance: $1,234') {
  function Private() {
    const [v] = createResource(() => Promise.resolve(value));
    return h('section', { class: 'comments' }, h('p', { class: 'private' }, () => v()));
  }
  return h('main', null,
    h('h2', { id: 'USER_ID' }, 'user heading'),
    h('p', { class: 'c1' }, 'first comment'),
    h(Suspense, { fallback: h('p', null, 'loading...') }, h(Private, {})),
    h('p', { class: 'c2' }, 'second comment'));
}

function parse(html, { scripts }) {
  return new JSDOM(`<!DOCTYPE html><html><head></head><body>${html}</body></html>`, scripts ? { runScripts: 'dangerously' } : {});
}

describe('boundary ids', () => {
  it('carry a random part that is new for every stream, after the prefix', async () => {
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push(ID.exec(await collect(renderToStream(page())))[1]);
    for (const id of ids) assert.match(id, /^wb[0-9a-z]{2,}-0$/);
    assert.equal(new Set(ids).size, ids.length, `ids repeat: ${ids}`);
    const custom = ID.exec(await collect(renderToStream(page(), { idPrefix: 'side_bar-2' })))[1];
    assert.match(custom, /^side_bar-2[0-9a-z]{2,}-0$/);
  });
});

describe('page markup cannot take over a boundary', () => {
  it('an element with the placeholder\'s id is ignored by the swap, even when the id is known', async () => {
    const html = await collect(renderToStream(page()));
    const id = ID.exec(html)[1];
    const forged = html.replace('id="USER_ID"', `id="pl-${id}"`);
    const dom = parse(forged, { scripts: true });
    const doc = dom.window.document;
    assert.equal(doc.querySelector('.private').textContent, 'Your balance: $1,234');
    assert.equal(doc.querySelector('h2').textContent, 'user heading', 'the forged element was replaced');
    assert.ok(doc.querySelector('.c1') && doc.querySelector('.c2'), 'siblings were deleted');
    assert.equal(doc.querySelector('.private').closest('main').querySelector('h2 + p.c1 + section.comments + p.c2') !== null, true);
    assert.doesNotMatch(doc.body.innerHTML, /loading\.\.\./);
    dom.window.close();
  });

  it('the review\'s guess, id="pl-wb0", does not even match an id', async () => {
    const html = (await collect(renderToStream(page()))).replace('id="USER_ID"', 'id="pl-wb0"');
    const dom = parse(html, { scripts: true });
    assert.equal(dom.window.document.querySelector('.private').textContent, 'Your balance: $1,234');
    assert.ok(dom.window.document.querySelector('.c2'));
    dom.window.close();
  });

  it('with noScripts, an element with the content\'s id does not stop the boundary from showing', async () => {
    const html = await collect(renderToStream(page(), { noScripts: true }));
    const id = ID.exec(html)[1];
    const dom = parse(html.replace('id="USER_ID"', `id="${id}"`), { scripts: false });
    const saved = globalThis.document;
    globalThis.document = dom.window.document;
    try {
      assert.equal(applyStreamedBoundaries(), 1);
    } finally {
      globalThis.document = saved;
    }
    const doc = dom.window.document;
    assert.equal(doc.querySelector('.private').textContent, 'Your balance: $1,234');
    assert.equal(doc.querySelector('h2').textContent, 'user heading');
    assert.ok(doc.querySelector('.c2'));
    dom.window.close();
  });

  it('a user <template id="pl-..."> with no end marker is left alone', async () => {
    const dom = new JSDOM('<!DOCTYPE html><body><template id="pl-mine"><b>x</b></template><p>after</p></body>');
    const saved = globalThis.document;
    globalThis.document = dom.window.document;
    try {
      assert.equal(applyStreamedBoundaries(), 0);
      assert.ok(dom.window.document.querySelector('template#pl-mine'));
    } finally {
      globalThis.document = saved;
    }
    dom.window.close();
  });
});

describe('idPrefix is validated', () => {
  const bad = ['"><img src=x onerror=alert(1)><!--', 'a"b', 'x--y>', '1abc', '', 'a b', 'a</script>', 7];

  it('renderToStream throws ERR_SSR_INVALID_ID_PREFIX for anything but a letter followed by letters, digits, _ or -', () => {
    for (const idPrefix of bad) {
      assert.throws(() => renderToStream(h('p', null, 'x'), { idPrefix }), { code: 'ERR_SSR_INVALID_ID_PREFIX' }, String(idPrefix));
    }
  });

  it('renderDocumentStream rejects before running the loader', async () => {
    let loaderRan = false;
    await assert.rejects(
      renderDocumentStream({ default: () => h('p', null, 'x'), loader: () => { loaderRan = true; } }, {}, { idPrefix: bad[0] }),
      { code: 'ERR_SSR_INVALID_ID_PREFIX' },
    );
    assert.equal(loaderRan, false);
  });

  it('a valid prefix is used as given', async () => {
    const html = await collect(renderToStream(page(), { idPrefix: 'Sidebar' }));
    assert.match(html, /<template id="pl-Sidebar[0-9a-z]+-0">/);
  });
});
