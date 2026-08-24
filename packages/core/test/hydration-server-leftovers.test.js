import { installDOM } from '../../../test-utils/dom.js';
// Hydration must not leave server markup on screen that the client never
// claimed, and must not destroy markup the client claims later.
//
// These are the two halves of one decision, and getting either one alone wrong
// is how the release before this one shipped:
//
//   - An empty reactive region deliberately claims NOTHING, because claiming
//     took the following sibling and replaced it (destroying a typed-into
//     input, an open <details>, a scroll position, and cascading a
//     warn-and-recreate through every node after it). That is right, and it
//     leaves whatever the server rendered for that region stranded: no effect
//     owns it, no update can reach it, it just stays visible. A cart badge the
//     server drew for a signed-in visitor stayed on screen for a signed-out
//     one, underneath the region meant to replace it.
//
//   - So the finished walk removes what it did not claim. Which is wrong for a
//     subtree the walk does not own: an island renders a bare host element and
//     fills it in later, from the server HTML still sitting inside it, and a
//     `mode: 'static'` island never hydrates at all.
//
// The rule that satisfies both: never destroy during the walk, remove after it,
// and only inside an element whose client tree actually declares children.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

installDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>');

const { signal, flushSync } = await import('../src/reactive.js');
const { h } = await import('../src/h.js');
const { hydrate } = await import('../src/render.js');
const { renderToString } = await import('what-server');

const root = () => document.getElementById('root');

/** SSR with `serverValue`, hydrate with `clientValue`, both into #root. */
function boot(Factory, serverValue, clientValue) {
  root().innerHTML = renderToString(h(Factory(signal(serverValue)), {}));
  const client = signal(clientValue);
  hydrate(h(Factory(client), {}), root());
  flushSync();
  return client;
}

describe('server content the client did not claim is removed', () => {
  // The region is empty on the client and was NOT empty on the server. This is
  // the ordinary shape for anything the server has to guess: a signed-in
  // header, a cart count from localStorage, a locale-dependent banner.
  const Banner = (msg) => () => h('div', {},
    h('h1', {}, 'Shop'),
    () => (msg() ? h('p', { 'data-banner': '' }, msg()) : ''),
  );

  it('does not leave a stranded element behind an empty region', () => {
    const msg = boot(Banner, 'Welcome back, Ines', '');

    assert.equal(document.querySelector('[data-banner]'), null,
      "the server's banner must not survive a client that renders none");
    assert.equal(root().textContent, 'Shop');

    // And the region still works afterwards.
    msg('Now something');
    flushSync();
    assert.equal(document.querySelectorAll('[data-banner]').length, 1);
    assert.equal(document.querySelector('[data-banner]').textContent, 'Now something');
  });

  it('removes stranded content at the root element too', () => {
    // A root-level boot gate is the canonical shape, and the root is where a
    // stranded subtree is most visible. The gate has to be a reactive CHILD,
    // not the component body: components run once, so a conditional written as
    // the body itself evaluates a single time and is never reactive at all.
    const Gate = (ready) => () => [
      () => (ready() ? h('main', { 'data-app': '' }, 'App') : ''),
    ];

    root().innerHTML = renderToString(h(Gate(signal(true)), {}));
    assert.ok(document.querySelector('[data-app]'), 'the server rendered the app');

    const ready = signal(false);
    hydrate(h(Gate(ready), {}), root());
    flushSync();

    assert.equal(document.querySelector('[data-app]'), null,
      'a client that is not ready must not show the server\'s app shell');

    ready(true);
    flushSync();
    assert.equal(document.querySelectorAll('[data-app]').length, 1,
      'and exactly one appears when it becomes ready');
  });

  it('leaves <body> alone, because the app does not own all of it', () => {
    // Scripts, the hydration payload and anything the host page put there are
    // never claimed by the walk and must never be removed by it.
    document.body.innerHTML = '<div id="host"></div><script id="payload"></script>';
    const host = document.getElementById('host');
    host.innerHTML = renderToString(h('span', {}, 'x'));

    hydrate(h('span', {}, 'x'), document.body);
    flushSync();

    assert.ok(document.getElementById('payload'), 'the script tag must survive');
    document.body.innerHTML = '<div id="root"></div>';
  });
});

describe('content the walk does not own is never removed', () => {
  it('keeps server HTML inside an element the client leaves empty', () => {
    // The island shape, reduced: the client declares a host element with no
    // children and fills it in later. Trimming on an empty child list threw the
    // server's content away and the island rebuilt it from scratch, which is
    // the opposite of what an island is for.
    root().innerHTML = '<div data-island=""><button>count 7</button></div>';
    const serverButton = root().querySelector('button');

    hydrate(h('div', { 'data-island': '' }), root());
    flushSync();

    assert.equal(root().querySelector('button'), serverButton,
      'a host element with no client children keeps what the server put in it');
  });

  it('keeps a dangerouslySetInnerHTML payload', () => {
    // The cursor never walks that subtree, so nothing in it is ever claimed.
    const html = '<p id="raw">from the server</p>';
    root().innerHTML = `<div>${html}</div>`;

    hydrate(h('div', { dangerouslySetInnerHTML: { __html: html } }), root());
    flushSync();

    assert.ok(document.getElementById('raw'), 'the raw payload survives hydration');
  });
});

describe('inline SVG survives hydration', () => {
  // nodeName is uppercased for HTML elements but case-preserved for everything
  // else, so an <svg>'s nodeName is 'svg' and could never equal
  // tag.toUpperCase(). Every inline SVG on a server-rendered page therefore
  // failed to match, warned "expected <svg>, got svg", and was rebuilt with
  // document.createElement in the HTML namespace, which does not render as SVG
  // at all. Icons, logos and charts went blank on hydration.
  const Icon = () => h('div', {},
    h('svg', { viewBox: '0 0 16 16', width: 16, 'data-icon': '' },
      h('path', { d: 'M0 0h16v16H0z' })),
  );

  it('reuses the server-rendered svg rather than rebuilding it', () => {
    globalThis.__WHAT_DEV__ = true;
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      root().innerHTML = renderToString(h(Icon, {}));
      const serverSvg = root().querySelector('[data-icon]');
      const serverPath = root().querySelector('path');

      hydrate(h(Icon, {}), root());
      flushSync();

      assert.equal(root().querySelector('[data-icon]'), serverSvg, 'the svg element is reused');
      assert.equal(root().querySelector('path'), serverPath, 'and so is its subtree');
      assert.deepEqual(warnings.filter((w) => /Hydration mismatch/.test(w)), []);
    } finally {
      console.warn = originalWarn;
      delete globalThis.__WHAT_DEV__;
    }
  });

  it('keeps the svg namespace when it does have to rebuild', () => {
    // An element created with document.createElement lands in the XHTML
    // namespace and renders as nothing, so the fallback path has to go through
    // the same namespace-aware creation the client render uses.
    root().innerHTML = '<div><span>wrong</span></div>';

    hydrate(h(Icon, {}), root());
    flushSync();

    const svg = root().querySelector('[data-icon]');
    assert.ok(svg, 'the svg is rendered');
    assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg');
    assert.equal(root().querySelector('path').namespaceURI, 'http://www.w3.org/2000/svg');
  });
});
