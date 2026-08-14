// <ErrorBoundary>, <Suspense> and <Portal> in a SERVER-RENDERED tree.
//
// None of the three is an element. Each returns an internal marker vnode
// ('__errorBoundary' / '__suspense' / '__portal') that every client path routes
// to a boundary handler instead of to createElement (dom.js createDOM). The
// server renders them correctly: a boundary emits its CHILDREN with no wrapper
// of its own, a portal emits nothing at all (its content belongs to a container
// elsewhere on the page). hydrateNode had a branch for neither, so the marker
// tag fell through to the generic ELEMENT branch and looked for a
// `<__errorBoundary>` element in the server HTML. What it found was the first
// node of the boundary's own subtree, which it warned about and destroyed:
//
//   server:  <div id="x"><p>INNER</p></div>
//   client:  <div id="x"><!--eb:start--></div>
//
// A single <ErrorBoundary> anywhere in a server-rendered page therefore blanked
// everything under it, and <Suspense> did the same. <Portal> failed differently
// and more quietly: the element branch CLAIMED the server's next real sibling
// and replaced it with the portal's placeholder comment, so the portal appeared
// to work while every node behind it was destroyed and rebuilt.
//
// These tests cover both halves of each construct: the markup surviving the
// walk, and the boundary still being a live boundary afterwards (catching,
// suspending, and resetting once the page is interactive).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.SVGElement = dom.window.SVGElement;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);

const { signal, flushSync } = await import('../src/reactive.js');
const { h } = await import('../src/h.js');
const { hydrate, spread, setProp } = await import('../src/render.js');
const { ErrorBoundary, Suspense, lazy, reportError } = await import('../src/components.js');
const { Portal } = await import('../src/helpers.js');
const { onCleanup } = await import('../src/hooks.js');
const { renderToHydratableString } = await import('../../server/src/index.js');

/**
 * SSR `tree()` into a fresh container, then hydrate a second call of the same
 * factory against that markup. Two calls, not one reused vnode: that is what a
 * real page does, and boundaries allocate their state signal per call.
 */
function boot(tree) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  container.innerHTML = renderToHydratableString(tree());
  const serverHtml = container.innerHTML;

  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(' ')); };
  try {
    hydrate(tree(), container);
  } finally {
    console.warn = realWarn;
  }
  flushSync();
  return { container, serverHtml, warnings };
}

/** Hydration warnings only. Anything else a component logs is not our business. */
function mismatches(warnings) {
  return warnings.filter((w) => w.includes('Hydration mismatch'));
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

// =========================================================================
// <ErrorBoundary>
// =========================================================================

describe('hydrating <ErrorBoundary>', () => {
  it('keeps the subtree the server rendered', () => {
    const tree = () => h('div', { id: 'x' },
      h(ErrorBoundary, { fallback: () => h('p', {}, 'FALLBACK') },
        h('p', { class: 'inner' }, 'INNER'),
      ),
    );

    const { container, serverHtml, warnings } = boot(tree);

    assert.match(serverHtml, /INNER/, 'precondition: the server must emit the subtree');
    const inner = container.querySelector('p.inner');
    assert.ok(inner, `boundary subtree was dropped on hydration: ${container.innerHTML}`);
    assert.equal(inner.textContent, 'INNER');
    assert.deepEqual(mismatches(warnings), []);
  });

  it('reuses the server nodes instead of rebuilding them', () => {
    const tree = () => h('div', {},
      h(ErrorBoundary, { fallback: () => h('p', {}, 'FALLBACK') },
        h('p', { class: 'inner' }, 'INNER'),
      ),
    );

    const container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = renderToHydratableString(tree());
    const serverNode = container.querySelector('p.inner');

    hydrate(tree(), container);
    flushSync();

    assert.equal(container.querySelector('p.inner'), serverNode,
      'the boundary rebuilt its children rather than hydrating them');
  });

  it('claims exactly its own children and leaves the sibling behind it alone', () => {
    // Cursor bookkeeping. The boundary opens a region at the cursor, hydrates
    // an arbitrary number of children into it, and closes it: get any of those
    // three steps wrong and the node AFTER the boundary is claimed, trimmed, or
    // ends up inside the region.
    const tree = () => h('div', {},
      h(ErrorBoundary, { fallback: () => h('p', {}, 'FALLBACK') },
        h('p', { class: 'a' }, 'A'),
        h('p', { class: 'b' }, 'B'),
      ),
      h('p', { class: 'c' }, 'C'),
    );

    const container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = renderToHydratableString(tree());
    const [a, b, c] = ['p.a', 'p.b', 'p.c'].map((s) => container.querySelector(s));

    hydrate(tree(), container);
    flushSync();

    assert.equal(container.querySelector('p.a'), a);
    assert.equal(container.querySelector('p.b'), b);
    assert.equal(container.querySelector('p.c'), c, 'the sibling after the boundary was rebuilt');
    assert.equal(
      [...container.firstChild.children].map((el) => el.className).join(' '),
      'a b c',
      'the boundary moved its siblings',
    );
    // c must sit OUTSIDE the region, or the boundary would take it down with it.
    const end = [...container.firstChild.childNodes].find((n) => n.nodeType === 8 && n.textContent === 'eb:end');
    assert.ok(end, 'the region was never closed');
    assert.equal(end.nextSibling, c, 'the trailing sibling was swallowed by the region');
  });

  it('keeps the boundary live: a later error swaps in the fallback, reset() swaps back', async () => {
    const boom = signal(false);
    function Bad() { throw new Error('boom'); }

    let resetBoundary = null;
    const tree = () => h('div', {},
      h(ErrorBoundary, {
        fallback: ({ error, reset }) => {
          resetBoundary = reset;
          return h('p', { class: 'fb' }, `CAUGHT ${error.message}`);
        },
      },
        h('section', {}, () => (boom() ? h(Bad, {}) : h('p', { class: 'ok' }, 'OK'))),
      ),
    );

    const { container } = boot(tree);
    assert.ok(container.querySelector('p.ok'), 'precondition: happy path must hydrate');

    // A component created AFTER hydration throws. reportError walks the child's
    // _parentCtx chain looking for a boundary, so this only works if the
    // hydrated boundary put its own context on that chain.
    boom(true);
    flushSync();
    await tick();

    const fallback = container.querySelector('p.fb');
    assert.ok(fallback, `the hydrated boundary did not catch: ${container.innerHTML}`);
    assert.equal(fallback.textContent, 'CAUGHT boom');
    assert.equal(container.querySelector('p.ok'), null, 'the failed arm was left on screen');

    // And the boundary is still a boundary after it has fired.
    boom(false);
    resetBoundary();
    flushSync();
    await tick();

    assert.ok(container.querySelector('p.ok'), `reset() did not restore the children: ${container.innerHTML}`);
    assert.equal(container.querySelector('p.fb'), null);
  });

  it('catches an error reported DURING the walk and replaces the server markup', () => {
    // The boundary's effect does not exist yet when this fires, so its very
    // first run is the one that has to notice the signal is already set and
    // throw away the markup the walk just claimed.
    function Reporter() {
      reportError(new Error('during hydration'));
      return h('p', { class: 'ok' }, 'OK');
    }

    const tree = () => h('div', {},
      h(ErrorBoundary, { fallback: ({ error }) => h('p', { class: 'fb' }, `CAUGHT ${error.message}`) },
        h(Reporter, {}),
      ),
    );

    const { container, serverHtml } = boot(tree);

    assert.match(serverHtml, /OK/, 'precondition: the server has no boundary to report to');
    assert.equal(container.querySelector('p.fb')?.textContent, 'CAUGHT during hydration',
      `the boundary did not catch a report made while hydrating: ${container.innerHTML}`);
    assert.equal(container.querySelector('p.ok'), null,
      'the claimed server markup was left behind under the fallback');
  });

  it('leaves the cursor where the end marker is when it swaps DURING the walk', () => {
    // Cursor desync, the regression this whole section exists to pin down.
    //
    // The boundary's effect is created synchronously while `_hydrationCursor`
    // still indexes into the parent, and when the state is already set on that
    // first run it removes R nodes from the region and inserts I of its own.
    // The cursor was fixed at endComment+1 before any of that happened, so it
    // is left off by (R - I) and the rest of the walk pays for it.
    //
    // Here R=2 (the <h1> and the portal's placeholder) and I=1 (the fallback),
    // so the cursor drifts FORWARD by one and skips the <footer> entirely: the
    // walk warned "expected <footer>, got nothing" and rendered a second one.
    // TWO footers on a page whose server HTML had one.
    //
    // The trailing sibling is the whole point of the test. Every earlier case
    // in this file happens to have R === I or nothing behind the boundary,
    // which is exactly the shape where drift is invisible.
    const target = document.createElement('div');
    document.body.appendChild(target);
    function Broken() { throw new Error('modal blew up'); }

    const tree = () => h('div', { id: 'page' },
      h(ErrorBoundary, { fallback: ({ error }) => h('p', { class: 'msg' }, error.message) },
        h('h1', { class: 'title' }, 'Dashboard'),
        // Renders nothing on the server and throws on the client, which is how
        // the boundary ends up catching mid-walk with real server markup for
        // the children arm already claimed.
        h(Portal, { target }, h(Broken, {})),
      ),
      h('footer', { class: 'ft' }, 'FOOTER'),
    );

    const container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = renderToHydratableString(tree());
    const serverFooter = container.querySelector('footer.ft');
    assert.ok(serverFooter, 'precondition: the server emits the footer once');

    const warnings = [];
    const realWarn = console.warn;
    const realError = console.error;
    console.warn = (...args) => { warnings.push(args.join(' ')); };
    console.error = () => {}; // the deliberate component failure logs; not our business
    try {
      hydrate(tree(), container);
    } finally {
      console.warn = realWarn;
      console.error = realError;
    }
    flushSync();

    const page = container.firstChild;
    assert.equal(page.querySelectorAll('footer.ft').length, 1,
      `the sibling behind the boundary was rendered twice: ${page.innerHTML}`);
    assert.equal(page.querySelector('footer.ft'), serverFooter,
      'the sibling behind the boundary was rebuilt instead of claimed');
    assert.equal(page.querySelector('p.msg')?.textContent, 'modal blew up',
      'precondition: the boundary must have caught and swapped in its fallback');
    assert.deepEqual(mismatches(warnings), [],
      'a boundary swapping its own contents is not a mismatch for its siblings');
  });

  it('survives a fallback with MORE nodes than the markup it replaces', () => {
    // The other drift direction. R=1 (the portal placeholder) and I=2 (the
    // fallback's message plus its retry button), so the cursor drifts BACKWARD
    // and lands on the boundary's own 'eb:end'. claimNode had no skip entry for
    // it, so the <footer> claimed the end marker, called it a mismatch, and
    // replaceChild()'d it away. The region was then unterminated: the next
    // update walked startComment.nextSibling to the end of the parent, ate
    // every sibling, and died on a swallowed NotFoundError. Clicking the
    // fallback's own Retry collapsed the page to a lone <!--eb:start-->.
    const target = document.createElement('div');
    document.body.appendChild(target);
    function Broken() { throw new Error('modal blew up'); }

    let resetBoundary = null;
    const tree = () => h('div', { id: 'page2' },
      h(ErrorBoundary, {
        fallback: ({ error, reset }) => {
          resetBoundary = reset;
          return [h('p', { class: 'msg' }, error.message), h('button', { class: 'retry' }, 'Retry')];
        },
      },
        h(Portal, { target }, h(Broken, {})),
      ),
      h('footer', { class: 'ft2' }, 'FOOTER'),
    );

    const container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = renderToHydratableString(tree());
    const serverFooter = container.querySelector('footer.ft2');

    const realError = console.error;
    console.error = () => {};
    try {
      hydrate(tree(), container);
    } finally {
      console.error = realError;
    }
    flushSync();

    const page = container.firstChild;
    const end = [...page.childNodes].find((n) => n.nodeType === 8 && n.textContent === 'eb:end');
    assert.ok(end, `the sibling behind the boundary claimed the end marker: ${page.innerHTML}`);
    assert.equal(page.querySelectorAll('footer.ft2').length, 1);
    assert.equal(page.querySelector('footer.ft2'), serverFooter,
      'the sibling behind the boundary was rebuilt instead of claimed');
    assert.equal(end.nextSibling, serverFooter, 'the footer ended up inside the region');

    // And the region is still usable. This is where the unterminated region
    // used to take the whole subtree down with it.
    const errors = [];
    console.error = (...args) => { errors.push(args.join(' ')); };
    try {
      resetBoundary();
      flushSync();
    } finally {
      console.error = realError;
    }
    assert.equal(page.querySelector('footer.ft2'), serverFooter,
      `reset() destroyed the sibling behind the boundary: ${page.innerHTML}`);
    assert.deepEqual(errors.filter((e) => e.includes('NotFoundError')), [],
      'the boundary walked past its own end marker');
  });

  it('does not dispose the component that owns the boundary when the boundary swaps', async () => {
    const boom = signal(false);
    let cleaned = false;
    function Bad() { throw new Error('boom'); }

    function Owner() {
      onCleanup(() => { cleaned = true; });
      return h(ErrorBoundary, { fallback: ({ error }) => h('p', { class: 'fb' }, error.message) },
        h('section', {}, () => (boom() ? h(Bad, {}) : h('p', { class: 'ok' }, 'OK'))),
      );
    }

    const { container } = boot(() => h('div', {}, h(Owner, {})));
    assert.ok(container.querySelector('p.ok'));

    boom(true);
    flushSync();
    await tick();

    assert.ok(container.querySelector('p.fb'), 'precondition: the boundary must have swapped');
    assert.equal(cleaned, false,
      'the owning component was disposed when the boundary replaced its content');
  });
});

// =========================================================================
// <Suspense>
// =========================================================================

describe('hydrating <Suspense>', () => {
  it('keeps the resolved subtree the server rendered', () => {
    const tree = () => h('div', { id: 'y' },
      h(Suspense, { fallback: h('p', {}, 'LOADING') },
        h('p', { class: 'inner' }, 'INNER'),
      ),
    );

    const { container, serverHtml, warnings } = boot(tree);

    assert.match(serverHtml, /INNER/, 'precondition: the server must emit the resolved subtree');
    const inner = container.querySelector('p.inner');
    assert.ok(inner, `suspense subtree was dropped on hydration: ${container.innerHTML}`);
    assert.equal(inner.textContent, 'INNER');
    assert.deepEqual(mismatches(warnings), []);
  });

  it('keeps the boundary live: a later suspension shows the fallback, then the content', async () => {
    let resolveLazy;
    const loaded = new Promise((resolve) => { resolveLazy = resolve; });
    const Lazy = lazy(() => loaded);
    const show = signal(false);

    const tree = () => h('div', {},
      h(Suspense, { fallback: h('p', { class: 'load' }, 'LOADING') },
        h('section', {}, () => (show() ? h(Lazy, {}) : h('p', { class: 'ok' }, 'OK'))),
      ),
    );

    const { container } = boot(tree);
    assert.ok(container.querySelector('p.ok'), 'precondition: happy path must hydrate');

    // suspend() walks the same _parentCtx chain reportError does.
    show(true);
    flushSync();
    await tick();
    assert.ok(container.querySelector('p.load'),
      `the hydrated boundary did not take the suspension: ${container.innerHTML}`);

    resolveLazy({ default: () => h('p', { class: 'lz' }, 'LAZY') });
    await tick();
    flushSync();
    await tick();

    assert.ok(container.querySelector('p.lz'), `resolved content never arrived: ${container.innerHTML}`);
    assert.equal(container.querySelector('p.load'), null);
  });

  it('takes a suspension thrown DURING the walk', async () => {
    // The case that is ALWAYS true on a real first load, and the one the
    // section above cannot see because it suspends after hydration is over.
    // hydrate() runs while the dynamic-import chunk is still in flight, so the
    // lazy() child throws its promise from inside the walk.
    //
    // hydrateNode's component branch used to swallow that: console.error, then
    // return null. `loading` never flipped, so the region came out EMPTY, the
    // server's markup for the boundary went unclaimed and was trimmed, and the
    // chunk landing re-rendered nothing. A <Suspense> around a lazy route was
    // permanently blank, which is the one outcome Suspense exists to prevent.
    // A thrown thenable is a suspension, not a failure, exactly as it is in
    // createComponent.
    let resolveChunk;
    const chunk = new Promise((resolve) => { resolveChunk = resolve; });
    const Chunked = lazy(() => chunk);

    const tree = () => h('div', { id: 'q' },
      h(Suspense, { fallback: h('p', { class: 'load' }, 'LOADING') },
        h(Chunked, {}),
      ),
      h('footer', { class: 'ft' }, 'FOOT'),
    );

    const container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = renderToHydratableString(tree());

    hydrate(tree(), container);
    flushSync();

    // The server and the client are on DIFFERENT arms here, and nothing in the
    // server's bytes says where a boundary's arm begins or ends, so the region
    // rebuilds rather than reuses and the node behind it is warn-and-recreated.
    // That is the documented mismatch fallback, not a lost node: what must hold
    // is that the page is correct and stays correct.
    assert.ok(container.querySelector('p.load'),
      `the boundary swallowed the suspension and rendered nothing: ${container.innerHTML}`);
    assert.equal(container.querySelectorAll('footer.ft').length, 1,
      `the sibling behind the boundary was duplicated: ${container.innerHTML}`);

    resolveChunk({ default: () => h('p', { class: 'lz' }, 'LAZY') });
    await tick();
    flushSync();
    await tick();

    assert.ok(container.querySelector('p.lz'),
      `the chunk landed and the boundary never re-rendered: ${container.innerHTML}`);
    assert.equal(container.querySelector('p.load'), null, 'the fallback outlived the suspension');
    assert.equal(container.querySelectorAll('footer.ft').length, 1);
  });
});

// =========================================================================
// spread() — the compiled path's prop applier
// =========================================================================
//
// Not a boundary, but it lives in the same file as the boundary hydration
// branches (packages/core/src/render.js) and was found alongside them.

describe('spread()', () => {
  it('hands a function ref the element instead of calling it as a getter', () => {
    // `ref` is the one prop whose FUNCTION form is a callback taking the
    // element rather than an accessor returning a value. dom.js applyProps and
    // render.js setProp both special-case it before their reactive-prop test;
    // spread() did not, so a function ref fell into the reactive branch and was
    // invoked as value() with NO ARGUMENT. Every `{...register('email')}`-shaped
    // API broke in silence on the compiled path: the ref saw undefined, its own
    // guard returned, and nothing threw to say the element was never registered.
    const seen = [];
    const el = document.createElement('input');
    spread(el, { name: 'email', ref: (node) => { seen.push(node); } });

    assert.deepEqual(seen, [el], 'the ref was not called with its element');
    assert.equal(el.getAttribute('name'), 'email', 'the rest of the bag still applied');
  });

  it('assigns an object ref, matching setProp', () => {
    const viaSpread = { current: null };
    const a = document.createElement('input');
    spread(a, { ref: viaSpread });

    const viaSetProp = { current: null };
    const b = document.createElement('input');
    setProp(b, 'ref', viaSetProp);

    assert.equal(viaSpread.current, a);
    assert.equal(viaSetProp.current, b);
  });

  it('does not install a reactive effect for the ref', () => {
    // The reactive branch registers its disposer on el._propEffects so
    // disposeTree can tear it down. A ref has nothing to tear down, and an
    // entry under 'ref' is the fingerprint of it having taken that branch.
    const el = document.createElement('input');
    spread(el, { ref: () => {} });
    assert.ok(!el._propEffects || !el._propEffects.ref,
      'the ref was installed as a reactive prop effect');
  });
});

// =========================================================================
// <Portal>
// =========================================================================

describe('hydrating <Portal>', () => {
  it('mounts into its target without claiming a server node at its own position', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);

    const tree = () => h('div', { id: 'z' },
      h('p', { class: 'a' }, 'A'),
      h(Portal, { target }, h('em', { class: 'p' }, 'PORTALED')),
      h('p', { class: 'b' }, 'B'),
    );

    const container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = renderToHydratableString(tree());
    assert.equal(container.innerHTML, '<div id="z"><p class="a">A</p><p class="b">B</p></div>',
      'precondition: the server emits nothing for a portal');
    const serverB = container.querySelector('p.b');

    const warnings = [];
    const realWarn = console.warn;
    console.warn = (...args) => { warnings.push(args.join(' ')); };
    try {
      hydrate(tree(), container);
    } finally {
      console.warn = realWarn;
    }
    flushSync();

    assert.equal(target.querySelector('em.p')?.textContent, 'PORTALED',
      'portal content did not reach its target container');
    assert.equal(container.querySelector('p.b'), serverB,
      'the portal destroyed the server node that followed it');
    assert.deepEqual(mismatches(warnings), [],
      'a portal has no server markup to mismatch against');
  });
});
