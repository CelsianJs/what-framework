// A hydrated page must end up with the same DOM a client-only render produces.
//
// The server stamps `data-hk="h<n>"` onto each component's root element so the
// client can correlate the two trees. The client never actually reads it: the
// only mention of it outside the server writer is `if (key === 'data-hk')
// continue` in the prop-application loop, which SKIPS the key. Nothing ever
// matches on it, and islands find themselves through `data-island`.
//
// So the attribute is consumed by nobody and left in the document forever. A
// hydrated page and a client-rendered page therefore disagree on every
// component root, permanently. That is invisible in normal use and very
// visible the moment anything compares the two: snapshot tests, DOM diffing,
// and the differential fuzzer all had to filter it out to get a signal.
//
// Stripping it belongs at the CLAIM site, not in a sweep over the container.
// An element the client declares empty is deliberately left alone (an island
// renders a bare host and fills it in later from the server markup still
// inside it), and a sweep would reach into exactly those subtrees the walk
// promised not to touch.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();

const { h } = await import('../src/h.js');
const { hydrate } = await import('../src/render.js');
const { mount } = await import('../src/dom.js');
const { renderToHydratableString } = await import('../../server/src/index.js');

function freshContainer(id) {
  const el = document.createElement('div');
  el.id = id;
  document.body.appendChild(el);
  return el;
}

function Leaf(props) {
  return h('span', { class: 'leaf' }, props.label);
}

function Panel() {
  return h('section', { id: 'panel' }, h(Leaf, { label: 'one' }), h(Leaf, { label: 'two' }));
}

function App() {
  return h('div', { class: 'app' }, h('h1', null, 'Title'), h(Panel, null));
}

describe('hydration leaves no server-only markers behind', () => {
  it('strips data-hk from every element the walk claims', () => {
    const container = freshContainer('hk-strip');
    container.innerHTML = renderToHydratableString(h(App, null));

    assert.ok(
      container.querySelectorAll('[data-hk]').length > 0,
      'precondition: the server markup must carry data-hk'
    );

    hydrate(h(App, null), container);

    assert.equal(
      container.querySelectorAll('[data-hk]').length,
      0,
      `data-hk survived hydration: ${container.innerHTML}`
    );
  });

  it('produces the same elements and attributes as a client-only render', () => {
    const hydrated = freshContainer('hk-parity-ssr');
    hydrated.innerHTML = renderToHydratableString(h(App, null));
    hydrate(h(App, null), hydrated);

    const clientOnly = freshContainer('hk-parity-client');
    mount(h(App, null), clientOnly);

    // Comments are excluded deliberately, and this is the one real difference
    // left between the two trees. A client-only render wraps each component's
    // output in `<!--c:start-->`/`<!--c:end-->`; the server emits no equivalent
    // and hydration does not synthesise them, so a hydrated component subtree
    // has no boundary comments at all.
    //
    // That is structural, not functional. It was checked rather than assumed:
    // component disposal (onCleanup and useEffect teardown) fires identically
    // on both paths, and a keyed list of components hydrates, reorders and
    // removes identically. Nothing observable depends on the comments, so
    // asserting on them here would only lock in an implementation detail.
    const stripComments = (html) => html.replace(/<!--[^>]*-->/g, '');
    assert.equal(stripComments(hydrated.innerHTML), stripComments(clientOnly.innerHTML));
  });

  // Controls: the strip must be narrow.

  it('still emits data-hk on the server', () => {
    const html = renderToHydratableString(h(App, null));
    assert.match(html, /data-hk="/);
  });

  it('keeps data-* attributes that are not hydration markers', () => {
    const container = freshContainer('hk-other-data');
    container.innerHTML = '<div data-hk="h0" data-island="Counter" data-testid="root"></div>';

    hydrate(h('div', { 'data-island': 'Counter', 'data-testid': 'root' }), container);

    const el = container.firstChild;
    assert.equal(el.getAttribute('data-island'), 'Counter');
    assert.equal(el.getAttribute('data-testid'), 'root');
    assert.equal(el.hasAttribute('data-hk'), false);
  });

  it('leaves markers inside a subtree the walk never claims', () => {
    // The island shape: the client declares the host empty, so hydrate() walks
    // no children and trimUnclaimed is skipped. The server content stays, and
    // so must its markers, because the island will hydrate that markup later.
    const container = freshContainer('hk-island');
    container.innerHTML =
      '<div data-hk="h0" data-island="Counter"><span data-hk="h1">server</span></div>';

    hydrate(h('div', { 'data-island': 'Counter' }), container);

    const host = container.firstChild;
    assert.equal(host.hasAttribute('data-hk'), false, 'the claimed host is stripped');
    assert.equal(host.innerHTML, '<span data-hk="h1">server</span>');
  });
});
