// <ErrorBoundary> and <Suspense> must render their subtree on the server, never
// themselves, and an ErrorBoundary must actually contain an error.
//
// Neither is an element. Both return a vnode carrying an internal marker tag
// ('__errorBoundary' / '__suspense') that every CLIENT path routes to a boundary
// handler (core/src/dom.js:349-353). The server had that routing only in
// renderToString's suspense case, so the marker tags fell through to the generic
// element renderer:
//
//   <ErrorBoundary>          ->  <__errorBoundary><p>ok</p></__errorBoundary>
//   <Suspense> (hydratable)  ->  <__suspense boundary="[object Object]"
//                                            fallback="[object Object]">...
//
// An invalid element name in the response and the boundary's internal props
// stringified into attributes. Worse, and the reason this is a blocker rather
// than cosmetic: a component that threw during SSR propagated straight out of
// renderToString and renderToHydratableString, so the whole page 500'd. The one
// construct whose entire job is to keep a subtree failure from becoming a page
// failure did nothing at all on the server.
//
// Unit tests missed it because SSR tests render plain element trees and boundary
// tests mount on the client. Broken only in combination, again.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { h, ErrorBoundary, Suspense, Portal } from 'what-core';
import { renderToString, renderToHydratableString, renderToStream } from '../src/index.js';

async function collectStream(vnode) {
  let out = '';
  for await (const chunk of renderToStream(vnode)) out += chunk;
  return out;
}

/** The same tree through all three server paths, so a fix cannot land in only one. */
async function renderAllPaths(vnode) {
  const hydratable = await renderToHydratableString(vnode);
  return {
    string: renderToString(vnode),
    hydratable: typeof hydratable === 'string' ? hydratable : hydratable.html,
    stream: await collectStream(vnode),
  };
}

function eachPath(rendered, fn) {
  for (const [name, html] of Object.entries(rendered)) fn(html, name);
}

const Ok = () => h('p', {}, 'ok');
const Boom = () => { throw new Error('boom'); };

describe('SSR never emits a boundary marker tag', () => {
  it('renders <ErrorBoundary> as its children', async () => {
    const rendered = await renderAllPaths(
      h(ErrorBoundary, { fallback: ({ error }) => h('i', {}, error.message) }, h(Ok, {})),
    );
    eachPath(rendered, (html, path) => {
      assert.ok(!html.includes('__errorBoundary'), `${path} leaked the marker tag: ${html}`);
      assert.match(html, /<p[^>]*>ok<\/p>/, `${path} lost the children: ${html}`);
    });
  });

  it('renders <Suspense> as its children', async () => {
    const rendered = await renderAllPaths(
      h(Suspense, { fallback: h('i', {}, 'loading') }, h(Ok, {})),
    );
    eachPath(rendered, (html, path) => {
      assert.ok(!html.includes('__suspense'), `${path} leaked the marker tag: ${html}`);
      assert.match(html, /<p[^>]*>ok<\/p>/, `${path} lost the children: ${html}`);
    });
  });

  it('does not stringify boundary internals into attributes', async () => {
    // `<__suspense boundary="[object Object]" fallback="[object Object]">` was
    // the literal output of the hydratable path.
    const rendered = await renderAllPaths(
      h(Suspense, { fallback: h('i', {}, 'loading') }, h(Ok, {})),
    );
    eachPath(rendered, (html, path) => {
      assert.ok(!html.includes('[object Object]'), `${path} stringified a prop: ${html}`);
      assert.ok(!html.includes('errorState'), `${path} leaked internal props: ${html}`);
    });
  });
});

describe('an ErrorBoundary contains a server-side error', () => {
  it('renders the fallback instead of failing the render', async () => {
    const rendered = await renderAllPaths(
      h(ErrorBoundary, { fallback: ({ error }) => h('i', {}, `E:${error.message}`) }, h(Boom, {})),
    );
    eachPath(rendered, (html, path) => {
      assert.match(html, /E:boom/, `${path} did not render the fallback: ${html}`);
    });
  });

  it('passes the fallback one object with error and reset', async () => {
    let seen = null;
    const fallback = (arg) => { seen = arg; return h('i', {}, 'x'); };
    renderToString(h(ErrorBoundary, { fallback }, h(Boom, {})));

    assert.ok(seen && typeof seen === 'object', 'fallback got no argument object');
    assert.equal(seen.error?.message, 'boom');
    assert.equal(typeof seen.reset, 'function', 'reset must be callable, the docs show a retry button');
  });

  it('keeps the rest of the page rendering', async () => {
    // The whole point: one broken subtree must not become a 500.
    const rendered = await renderAllPaths(
      h('main', {},
        h('header', {}, 'top'),
        h(ErrorBoundary, { fallback: () => h('i', {}, 'contained') }, h(Boom, {})),
        h('footer', {}, 'bottom'),
      ),
    );
    eachPath(rendered, (html, path) => {
      assert.match(html, /top/, `${path} lost content before the boundary: ${html}`);
      assert.match(html, /contained/, `${path} lost the fallback: ${html}`);
      assert.match(html, /bottom/, `${path} lost content after the boundary: ${html}`);
    });
  });

  it('lets a suspended resource pass through to <Suspense>', async () => {
    // A thenable is a pending resource, not an error. An ErrorBoundary that
    // swallowed it would show an error page for data that was merely still
    // loading.
    const Suspends = () => { throw Promise.resolve('later'); };
    const html = renderToString(
      h(Suspense, { fallback: h('i', {}, 'loading') },
        h(ErrorBoundary, { fallback: () => h('b', {}, 'WRONG') }, h(Suspends, {}))),
    );
    assert.match(html, /loading/, `the suspense fallback should win: ${html}`);
    assert.ok(!html.includes('WRONG'), `the error boundary swallowed a suspension: ${html}`);
  });

  it('fails soft when the fallback itself throws', async () => {
    const rendered = await renderAllPaths(
      h('main', {},
        h(ErrorBoundary, { fallback: () => { throw new Error('fallback broke'); } }, h(Boom, {})),
        h('footer', {}, 'still here'),
      ),
    );
    eachPath(rendered, (html, path) => {
      assert.match(html, /still here/, `${path} lost the page to a broken fallback: ${html}`);
    });
  });

  it('accepts a non-function fallback', async () => {
    const rendered = await renderAllPaths(
      h(ErrorBoundary, { fallback: h('i', {}, 'static fallback') }, h(Boom, {})),
    );
    eachPath(rendered, (html, path) => {
      assert.match(html, /static fallback/, `${path} ignored an element fallback: ${html}`);
    });
  });
});

describe('<Portal> renders nothing on the server, with or without a DOM shim', () => {
  // Portal is client-only by the framework's own decision: it returns null when
  // there is no `document` (helpers.js:153). But that guard is ENVIRONMENTAL,
  // not a server check, so SSR under a DOM shim (jsdom, happy-dom, a test
  // harness, any runtime polyfilling document) walked straight past it, built
  // the vnode, and handed the server a '__portal' tag it had no branch for:
  //
  //   <__portal container="[object HTMLDivElement]"><p>inside</p></__portal>
  //
  // Invalid element, a DOM node stringified into an attribute, and the portal's
  // content emitted inline at the portal's own position instead of at its
  // target, which hydration would then have to move.
  const realDocument = globalThis.document;

  before(() => {
    // Minimal shim: enough for Portal to find a container and build its vnode.
    const host = { nodeType: 1, nodeName: 'DIV' };
    globalThis.document = { querySelector: () => host };
  });
  after(() => {
    if (realDocument === undefined) delete globalThis.document;
    else globalThis.document = realDocument;
  });

  it('emits nothing for the portal and keeps the rest of the page', async () => {
    const rendered = await renderAllPaths(
      h('main', {}, h(Portal, { target: '#host' }, h('p', {}, 'inside')), h('p', {}, 'normal')),
    );
    eachPath(rendered, (html, path) => {
      assert.ok(!html.includes('__portal'), `${path} leaked the marker tag: ${html}`);
      assert.ok(!html.includes('[object'), `${path} stringified a DOM node: ${html}`);
      assert.ok(!html.includes('inside'), `${path} emitted portal content inline: ${html}`);
      assert.match(html, /<p>normal<\/p>/, `${path} lost the rest of the page: ${html}`);
    });
  });

  it('matches what the same app renders with no document at all', async () => {
    // The whole point of skipping rather than inlining: identical HTML whether
    // or not a shim happens to be loaded.
    const tree = () => h('main', {}, h(Portal, { target: '#host' }, h('p', {}, 'inside')), h('p', {}, 'normal'));
    const withShim = renderToString(tree());

    const shim = globalThis.document;
    delete globalThis.document;
    let withoutShim;
    try { withoutShim = renderToString(tree()); } finally { globalThis.document = shim; }

    assert.equal(withShim, withoutShim, 'a DOM shim changed the server output');
  });
});

describe('data-hk is injected once per element', () => {
  it('does not stack a key per component in a chain', async () => {
    // Every component injects into the first element of its own output, and a
    // component returning a component resolves to the SAME element at every
    // level. `Outer -> Middle -> Inner -> <p>` emitted
    // `<p data-hk="h0" data-hk="h1" data-hk="h2">`: a duplicate attribute, which
    // is invalid HTML, and browsers keep only the first. This is the most
    // ordinary composition there is, so it affected essentially every page.
    const Inner = () => h('p', {}, 'hi');
    const Middle = () => h(Inner, {});
    const Outer = () => h(Middle, {});

    const r = await renderToHydratableString(h(Outer, {}));
    const html = typeof r === 'string' ? r : r.html;
    assert.equal((html.match(/data-hk=/g) || []).length, 1, `duplicate hydration keys: ${html}`);
  });

  it('still keys sibling elements distinctly', async () => {
    const Item = () => h('p', {}, 'hi');
    const r = await renderToHydratableString(h('div', {}, h(Item, {}), h(Item, {})));
    const html = typeof r === 'string' ? r : r.html;
    const keys = [...html.matchAll(/data-hk="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(keys.length, 2, `expected one key per sibling: ${html}`);
    assert.notEqual(keys[0], keys[1], `siblings share a key: ${html}`);
  });

  it('does not mistake a similarly named attribute for a key', async () => {
    const A = () => h('p', { 'data-hkx': '1' }, 'z');
    const r = await renderToHydratableString(h(A, {}));
    const html = typeof r === 'string' ? r : r.html;
    assert.match(html, /data-hk="/, `a lookalike attribute suppressed the key: ${html}`);
  });

  it('keys a void element and preserves its attributes', async () => {
    const A = () => h('img', { src: '/a.png' });
    const r = await renderToHydratableString(h(A, {}));
    const html = typeof r === 'string' ? r : r.html;
    assert.match(html, /data-hk="/, `void element lost its key: ${html}`);
    assert.match(html, /src="\/a\.png"/, `void element lost its attributes: ${html}`);
  });
});
