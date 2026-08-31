// A compiled component body reaching a server renderer must be reported as what
// it is.
//
// what-compiler lowers a component's own JSX to a module-scope `_$template()`
// and a `cloneNode(true)`, so the component RETURNS an Element rather than a
// vnode. Every renderer here destructures `vnode.tag`, gets `undefined` off that
// Element, and fell into assertSafeTag, which threw:
//
//   [what-server] Invalid tag name in SSR: undefined      (ERR_INVALID_SSR_TAG)
//
// Measured on origin/main (27030cf), with the real compiler:
//
//   renderToString(h(AppCompiled)) THREW: Invalid tag name in SSR: undefined
//   renderToString(h(AppH))        = '<div class="app"><h1>Title</h1></div>'
//
// ERR_INVALID_SSR_TAG's documented cause is "a component that returned a raw
// object, or a value interpolated where an element was expected". Neither
// happened. Nothing in that message points at what-compiler, at `document`, or
// at the fact that this configuration has no server-rendered form at all, so the
// one limitation a developer most needs named was the one thing the error hid.
//
// The build-time guard in what-compiler's Vite plugin is the earlier seam and
// catches this before a bundle exists. This is the backstop for the paths that
// get past it, which is any process that has a DOM: jsdom in a test, or a shim
// someone installed deliberately.
//
// A DOM node is used directly here rather than running the compiler, because the
// contract under test is what-server's, and the compiler's output for this shape
// is exactly `document.createElement`-built DOM (pinned by the compiler's own
// golden-output tests). Going through Babel would test the compiler twice and
// this file's subject not at all.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();

const { h } = await import('what-core');
const { renderToString, renderToHydratableString, renderToStream } = await import('../src/index.js');

async function collectStream(vnode) {
  let out = '';
  for await (const chunk of renderToStream(vnode, {})) out += chunk;
  return out;
}

// What `function App() { return _tmpl$0(); }` returns: a cloned template.
function compiledBody() {
  const t = document.createElement('template');
  t.innerHTML = '<div class="app"><h1>Title</h1></div>';
  return t.content.firstChild.cloneNode(true);
}

function capture(fn) {
  try { fn(); } catch (e) { return e; }
  return null;
}

function assertDiagnosed(err) {
  assert.ok(err, 'expected a throw');
  assert.equal(
    err.code,
    'ERR_COMPILED_JSX_IN_SSR',
    `expected the compiled-body diagnosis, got ${err.code}: ${err.message}`,
  );
  // The old message is the regression this file exists to prevent. It named a
  // tag-name problem for something that is not a tag-name problem.
  assert.doesNotMatch(err.message, /Invalid tag name/);
  // Say the cause and both supported alternatives, or the error is still a dead
  // end with a nicer code on it.
  assert.match(err.message, /what-compiler/);
  assert.match(err.message, /h\(\)/);
  assert.match(err.message, /jsxImportSource/);
}

describe('what-server: a compiled component body is diagnosed, not mislabelled', () => {
  it('renderToString names the real cause', () => {
    assertDiagnosed(capture(() => renderToString(h(compiledBody, {}))));
  });

  it('renderToHydratableString names the real cause', () => {
    assertDiagnosed(capture(() => renderToHydratableString(h(compiledBody, {}))));
  });

  it('renderToStream names the real cause', async () => {
    let err = null;
    try { await collectStream(h(compiledBody, {})); } catch (e) { err = e; }
    assertDiagnosed(err);
  });

  it('applies to a DOM node handed in directly, not only one returned by a component', () => {
    assertDiagnosed(capture(() => renderToString(compiledBody())));
  });

  it('applies to a DOM node nested as a child of a real vnode', () => {
    // The realistic shape: an h()-authored page that renders one compiled
    // component somewhere inside it. The failure must still be named, not
    // reported as a bad tag on the child.
    assertDiagnosed(capture(() => renderToString(h('main', null, h(compiledBody, {})))));
  });

  it('a text node is diagnosed the same way (nodeType is the signal, not tagName)', () => {
    assertDiagnosed(capture(() => renderToString(document.createTextNode('x'))));
  });

});

// Every render path here degrades rather than 500s, which is right for a runtime
// error and wrong for this one: it reports a toolchain that has no server form,
// so no retry or fallback can ever succeed. Degrading it produced silent data
// loss. Measured on origin/main (27030cf), with the error's OLD code:
//
//   renderToString(h('main', null, () => compiledBody()))
//     -> "<main></main>"
//   renderToHydratableString(h('main', null, () => compiledBody()))
//     -> "<main><!--$--><!--/$--></main>"
//   renderToStream(h('main', null, h(compiledBody, {})))
//     -> "<main><!-- SSR Error: ... --></main>"
//
// The component vanished from the page. The console.warn that accompanies it is
// gated on dev mode, so in production nothing at all was logged and the server
// reported success on a page with a hole in it.
describe('what-server: the diagnosis cannot be swallowed by a degrading path', () => {
  it('a reactive thunk child does not silently drop it (renderToString)', () => {
    assertDiagnosed(capture(() => renderToString(h('main', null, () => compiledBody()))));
  });

  it('a reactive thunk child does not silently drop it (renderToHydratableString)', () => {
    assertDiagnosed(capture(() => renderToHydratableString(h('main', null, () => compiledBody()))));
  });

  it('a streamed component does not degrade it to an SSR-error comment', async () => {
    let err = null;
    try { await collectStream(h('main', null, h(compiledBody, {}))); } catch (e) { err = e; }
    assertDiagnosed(err);
  });

  it('a streamed reactive thunk does not silently drop it', async () => {
    let err = null;
    try { await collectStream(h('main', null, () => compiledBody())); } catch (e) { err = e; }
    assertDiagnosed(err);
  });

  it('an <ErrorBoundary> does not absorb it into its fallback', async () => {
    // A boundary exists to keep a subtree's RUNTIME failure off the page. This
    // is a build misconfiguration: absorbing it renders the fallback on every
    // request forever while the developer is never told why.
    const { ErrorBoundary } = await import('what-core');
    assertDiagnosed(capture(() => renderToString(
      h(ErrorBoundary, { fallback: () => h('p', null, 'oops') }, h(compiledBody, {})),
    )));
  });

  it('an <ErrorBoundary> whose FALLBACK is compiled is diagnosed, not emptied', async () => {
    // _boundaryFallback catches a throwing fallback and returns null, so a
    // compiled fallback rendered the boundary as nothing at all while the
    // developer was told only in dev, and only in a warning.
    const { ErrorBoundary } = await import('what-core');
    assertDiagnosed(capture(() => renderToString(
      h(
        ErrorBoundary,
        { fallback: () => h(compiledBody, {}) },
        h(() => { throw new Error('boom'); }, {}),
      ),
    )));
  });

  // --- negative controls: pass on BOTH arms, and must -----------------------

  it('an ordinary runtime error in a thunk STILL degrades, and does not 500 the page', () => {
    // The degrading behaviour is deliberate and must survive. Only the
    // unrenderable-configuration code is exempt from it.
    assert.equal(renderToString(h('main', null, () => { throw new Error('boom'); })), '<main></main>');
  });

  it('an ordinary runtime error still reaches an <ErrorBoundary> fallback', async () => {
    const { ErrorBoundary } = await import('what-core');
    const html = renderToString(
      h(ErrorBoundary, { fallback: () => h('p', null, 'oops') }, h(() => { throw new Error('boom'); }, {})),
    );
    assert.match(html, /<p[^>]*>oops<\/p>/);
  });
});

describe('what-server: compiled-body diagnosis, negative controls', () => {

  it('a genuinely invalid tag still reports ERR_INVALID_SSR_TAG', () => {
    // Widening the DOM-node branch far enough to swallow this would trade one
    // wrong diagnosis for another, and lose a security-relevant guard: tag names
    // are emitted verbatim into the HTML.
    const err = capture(() => renderToString({ tag: 'div onload=alert(1) x', props: {}, children: [] }));
    assert.ok(err);
    assert.equal(err.code, 'ERR_INVALID_SSR_TAG');
  });

  it('a component returning a plain object still reports ERR_INVALID_SSR_TAG', () => {
    const err = capture(() => renderToString(h(() => ({ name: 'a' }), {})));
    assert.ok(err);
    assert.equal(err.code, 'ERR_INVALID_SSR_TAG');
  });

  it('an h()-authored equivalent still renders', () => {
    const AppH = () => h('div', { class: 'app' }, h('h1', null, 'Title'));
    assert.equal(renderToString(h(AppH, {})), '<div class="app"><h1>Title</h1></div>');
  });
});
