// An app pays only for what it can reach. Each feature below is installed by
// the first use of what needs it, so a production bundle of an app that never
// uses it must not carry its code, and one that does must:
//
//   the pull phase (checkDirty, updateComputed, the deferral of deep chains):
//     reactive.js installPull, by the first computed or selector
//   the client renderers of <ErrorBoundary> and <Portal>: carried by their
//     vnodes (`mount`), as <Suspense>'s is
//   a server render's resource store (seedFromStore): reactive.js
//     _installStoreSeedOps, by server-context.js when a server render starts,
//     not by hydrate()
//   what another copy of what-core takes from a server render it never joined
//     (the owner lookup it adopts, the refusal of its async values): put on
//     the shared store by server-context.js when a server render starts
//   the option marking hydration repeats for a select a value controls:
//     dom.js _selectionKeeper, by the first write of a select's value
//
//   the lazy getters of component children and JSX props (dom.js
//     _installLazyChildren, readLazy): reached from _$createComponent, which
//     what-compiler imports only into a module that hands a component
//     children or JSX in a prop; any other module's calls are _$createLeaf
//   insert()'s dispatch on the kind of child: what-compiler imports the
//     reactive region alone (_$reactive) into a module whose every hole
//     holds a function written in it
//   a list rendered as a value (render.js _listFragment): carried by the
//     list inserter as its `_mapArray` mark
//   the walk to the nearest <Suspense> (reactive.js _handlePending): reached
//     from what lets a component suspend (render.js renderWhenSettled) and
//     from hydration, not from every component failure
//   whether a vnode is built in an SVG element (render.js _isSvgParent):
//     asked by the vnode renderer h.js installs
//   the props of a <select> and its <option>s (dom.js selectProp, markOptions
//     and the rest): installed by a compiled module whose JSX writes one
//     (_$selects()), by h() and hydration, and by spread(), setProp() and
//     setValue() written by hand; compiled code imports those setters
//     without it (_$spread, _$setProp, _$setValue)
//   the server render store (server-context.js store, renderOwner): not
//     reached from isServerRender(), which useEffect and onMount ask
//
// Bundled from the source with the production tier's define and dev-flag
// plugin, unminified, so the functions keep their names.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTION } from '../../../scripts/build.js';
import { compileJSX } from '../../../test-utils/compile.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const INDEX = JSON.stringify(path.join(SRC, 'index.js'));
const INTERNAL = JSON.stringify(path.join(SRC, 'entries/internal.js'));

async function bundle(source) {
  const result = await build({
    stdin: { contents: source, resolveDir: SRC, loader: 'js' },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
    minify: false,
    treeShaking: true,
    logLevel: 'silent',
    define: PRODUCTION.define,
    plugins: PRODUCTION.plugins,
  });
  return result.outputFiles[0].text;
}

const has = (code, name) => code.includes(`function ${name}(`);
const RENDER = JSON.stringify(path.join(SRC, 'render.js'));
// A compiled module as a production build bundles it, from the source.
const compiled = (jsx) => bundle(compileJSX(jsx, { production: true })
  .replace(/(['"])what-framework(\/render)?\1/g, (_, _quote, render) => (render ? RENDER : INDEX)));
const LAZY_PROPS = ['_installLazyChildren', 'readLazy', 'lazyProps'];
const SELECT_CODE = ['selectProp', '_setSelectValue', 'markOptions', 'setSelectDefault', 'refollow'];
const PULL_PHASE = ['checkDirty', 'updateComputed', 'settleDeferred', 'markPending', 'unwatched'];

describe('feature reach in production bundles', () => {
  it('an app of signals and effects carries no pull phase', async () => {
    const code = await bundle(`
      import { signal, effect, h, mount } from ${INDEX};
      const n = signal(0);
      effect(() => { document.title = String(n()); });
      mount(h('button', { onclick: () => n((c) => c + 1) }, () => n()), document.body);
    `);
    assert.deepEqual(PULL_PHASE.filter((name) => has(code, name)), []);
  });

  it('an app with an error boundary and no computed carries no pull phase', async () => {
    const code = await bundle(`
      import { signal, h, mount, ErrorBoundary } from ${INDEX};
      const n = signal(0);
      const fallback = ({ error, reset }) => h('button', { onclick: reset }, error.message);
      mount(h(ErrorBoundary, { fallback }, h('p', {}, () => n())), document.body);
    `);
    assert.ok(has(code, 'createErrorBoundary'), 'the boundary renderer is there');
    assert.deepEqual(PULL_PHASE.filter((name) => has(code, name)), []);
  });

  for (const [what, source] of [
    ['a computed', `import { computed } from ${INDEX}; export const c = computed(() => 1);`],
    ['a selector', `import { signal, createSelector } from ${INDEX}; export const s = createSelector(signal(0));`],
  ]) {
    it(`${what} brings the pull phase`, async () => {
      const code = await bundle(source);
      assert.deepEqual(PULL_PHASE.filter((name) => !has(code, name)), []);
    });
  }

  it('an h() app without an error boundary or a portal carries neither renderer', async () => {
    const code = await bundle(`
      import { h, mount } from ${INDEX};
      mount(h('p', {}, 'hi'), document.body);
    `);
    assert.ok(has(code, 'createDOM'), 'the vnode renderer is there');
    assert.ok(!has(code, 'createErrorBoundary'));
    assert.ok(!has(code, 'createPortalDOM'));
  });

  it('<ErrorBoundary> and <Portal> bring their renderers', async () => {
    const code = await bundle(`
      import { h, mount, ErrorBoundary, Portal } from ${INDEX};
      mount(h(ErrorBoundary, { fallback: 'x' }, h(Portal, { target: document.body }, 'p')), document.body);
    `);
    assert.ok(has(code, 'createErrorBoundary'));
    assert.ok(has(code, 'createPortalDOM'));
  });

  it('a hydrating app with an async value does not carry the server store', async () => {
    const code = await bundle(`
      import { hydrate, computed } from ${INDEX};
      const user = computed(async () => (await fetch('/u')).json());
      hydrate(() => user(), document.body);
    `);
    assert.ok(has(code, 'adopt'), 'a hydrated value is adopted from the page');
    assert.ok(!has(code, 'seedFromStore'));
    assert.ok(!has(code, 'storeSettled'));
  });

  it('starting a server render brings the server store', async () => {
    const code = await bundle(`
      import { computed } from ${INDEX};
      import { runWithServerContext } from ${INTERNAL};
      export const render = (ctx) => runWithServerContext(ctx, () => computed(async () => 1));
    `);
    assert.ok(has(code, 'seedFromStore'));
    assert.ok(has(code, 'storeSettled'));
    assert.ok(code.includes('rootFor(engine)'), 'the lookup another copy adopts');
    assert.ok(code.includes('ERR_FOREIGN_ENGINE_IN_SSR'), 'the refusal of its async values');
  });

  it('an app with a computed does not carry the refusal of the async values of a second copy', async () => {
    const code = await bundle(`
      import { computed } from ${INDEX};
      export const c = computed(() => 1);
    `);
    assert.ok(has(code, '_seedFor'), 'an async-capable value asks where it starts from');
    assert.ok(!code.includes('ERR_FOREIGN_ENGINE_IN_SSR'));
  });

  it('an app that reads the server context does not carry what another copy adopts from a render', async () => {
    const code = await bundle(`
      import { getServerContext } from ${INTERNAL};
      export const ctx = getServerContext();
    `);
    assert.ok(has(code, 'getServerContext'));
    assert.ok(!code.includes('rootFor(engine)'), 'the lookup another copy adopts');
  });

  it('a hydrating app that never writes the value of a select carries no option marking', async () => {
    const code = await bundle(`
      import { hydrate } from ${INDEX};
      hydrate(() => null, document.body);
    `);
    assert.ok(has(code, 'dropUnrendered'), 'hydration rewrites attributes');
    assert.ok(!has(code, 'markOptions'));
  });

  it('a compiled app with fields but no select carries no select code', async () => {
    const code = await compiled(`
      import { mount, signal } from 'what-framework';
      function App(props) {
        const text = signal('a');
        return <form><input value={text()} onInput={(e) => text(e.target.value)} /><textarea value={text()} /><input {...props.field} /></form>;
      }
      mount(<App field={{ name: 'x' }} />, document.body);
    `);
    assert.ok(has(code, '_setFieldProp'), 'a field writes its value');
    assert.ok(has(code, 'showControlled'), 'and is controlled');
    assert.deepEqual(SELECT_CODE.filter((name) => has(code, name)), []);
  });

  for (const [what, jsx] of [
    ['a select', '<select value={v()}><option>a</option><option>b</option></select>'],
    ['an option', '<option value={v()}>a</option>'],
    ['a spread on a select', '<select {...p} />'],
  ]) {
    it(`a compiled module whose JSX writes a prop of ${what} brings it, once, at module scope`, async () => {
      const source = `
        import { mount, signal } from 'what-framework';
        const v = signal('a');
        const App = (p) => ${jsx};
        mount(<App />, document.body);
      `;
      assert.equal(compileJSX(source, { production: true }).match(/^_\$selects\(\);$/gm)?.length, 1);
      const code = await compiled(source);
      assert.deepEqual(SELECT_CODE.filter((name) => !has(code, name)), []);
    });
  }

  it('a module whose select or options have only markup attributes does not bring it', () => {
    const out = compileJSX('export const A = () => <select name="s"><option value="a" selected>a</option></select>;', { production: true });
    assert.doesNotMatch(out, /_\$selects/);
  });

  for (const [what, source] of [
    ['h()', `import { h, mount } from ${INDEX}; mount(h('main', {}), document.body);`],
    ['spread() written by hand', `import { spread } from ${RENDER}; spread(document.body, { id: 'x' });`],
    ['setProp() written by hand', `import { setProp } from ${RENDER}; setProp(document.body, 'id', 'x');`],
    ['setValue() written by hand', `import { setValue } from ${RENDER}; setValue(document.body, 'x');`],
  ]) {
    it(`${what} brings the select code`, async () => {
      const code = await bundle(source);
      assert.deepEqual(SELECT_CODE.filter((name) => !has(code, name)), []);
    });
  }

  it('useEffect on the client does not carry the server render store', async () => {
    const code = await bundle(`
      import { useEffect, mount, h } from ${INDEX};
      function App() { useEffect(() => { document.title = 'x'; }); return null; }
      mount(h(App, {}), document.body);
    `);
    assert.ok(has(code, 'isServerRender'));
    assert.ok(!has(code, 'renderOwner'));
    assert.ok(!has(code, 'store'));
  });

  it('a compiled app whose components are handed no children carries no lazy getters', async () => {
    const code = await compiled(`
      import { mount, signal } from 'what-framework';
      function Badge(props) { return <b>{props.n}</b>; }
      function App() { const n = signal(0); return <main><Badge n={n()} /></main>; }
      mount(<App />, document.body);
    `);
    assert.ok(has(code, '_$createFn'), 'its components are plain functions');
    assert.ok(has(code, '_renderComponent'), 'the component lifecycle is there');
    assert.ok(!has(code, '_toFunctionComponent'), 'no class component bridge');
    assert.deepEqual(LAZY_PROPS.filter((name) => has(code, name)), []);
  });

  for (const [what, jsx] of [
    ['children', '<Box><p>x</p></Box>'],
    ['JSX in a prop', '<Box header={<p>x</p>} />'],
  ]) {
    it(`handing a component ${what} brings the lazy getters`, async () => {
      const code = await compiled(`
        import { mount } from 'what-framework';
        function Box(props) { return <div>{props.header}{props.children}</div>; }
        mount(${jsx}, document.body);
      `);
      assert.deepEqual(LAZY_PROPS.filter((name) => !has(code, name)), []);
    });
  }

  it('a compiled app whose holes all hold a function written in them carries the region, not insert()', async () => {
    const code = await compiled(`
      import { mount, signal } from 'what-framework';
      function App() { const n = signal(0); return <p>{n()}<b>{n() + 1}</b></p>; }
      mount(<App />, document.body);
    `);
    assert.ok(has(code, 'insertReactive'));
    assert.ok(has(code, 'reconcileNodes'), 'the region shows any value');
    assert.ok(!has(code, 'insert'));
  });

  it('any other hole brings insert()', async () => {
    const code = await compiled(`
      import { mount } from 'what-framework';
      function App(props) { return <p>{props.node}</p>; }
      mount(<App node={document.createElement('b')} />, document.body);
    `);
    assert.ok(has(code, 'insert'));
  });

  it('an app without a list carries no list fragment, and a list brings it', async () => {
    const without = await compiled(`
      import { mount, signal } from 'what-framework';
      function App() { const n = signal(0); return <><p>{n()}</p><p>{() => n()}</p></>; }
      mount(<App />, document.body);
    `);
    assert.ok(has(without, '_region'), 'a function rendered as a value is a region');
    assert.ok(!has(without, '_listFragment'));
    const withList = await compiled(`
      import { mount, signal } from 'what-framework';
      const rows = signal([{ id: 1 }]);
      function App() { return <>{rows().map((r) => <li key={r.id}>{r.id}</li>)}</>; }
      mount(<App />, document.body);
    `);
    assert.ok(has(withList, '_listFragment'));
    assert.match(withList, /inserter\._mapArray = _listFragment;/);
  });

  it('an app that cannot suspend does not carry the walk to a <Suspense>', async () => {
    const code = await compiled(`
      import { mount, signal, ErrorBoundary } from 'what-framework';
      function App() { const n = signal(0); return <ErrorBoundary fallback={<i>x</i>}><p>{n()}</p></ErrorBoundary>; }
      mount(<App />, document.body);
    `);
    assert.ok(has(code, 'componentFailed'));
    assert.ok(has(code, '_handleError'), 'a failure still finds its error boundary');
    assert.ok(!has(code, '_handlePending'));
    assert.ok(!has(code, 'renderWhenSettled'));
  });

  for (const [what, source] of [
    ['lazy()', `import { lazy } from ${INDEX}; export const L = lazy(() => Promise.resolve({ default: () => null }));`],
    ['<Suspense>', `import { h, Suspense } from ${INDEX}; export const s = () => h(Suspense, { fallback: 'x' });`],
    ['a computed', `import { computed } from ${INDEX}; export const c = computed(() => 1);`],
    ['hydrate()', `import { hydrate } from ${INDEX}; hydrate(() => null, document.body);`],
  ]) {
    it(`${what} brings the walk to a <Suspense>`, async () => {
      const code = await bundle(source);
      assert.ok(has(code, '_handlePending'));
    });
  }

  it('only the vnode renderer asks whether a vnode is built in an SVG element', async () => {
    const without = await compiled(`
      import { mount, signal } from 'what-framework';
      function App() { const n = signal(0); return <svg><text>{n()}</text></svg>; }
      mount(<App />, document.body);
    `);
    assert.ok(has(without, 'valuesToNodes'));
    assert.ok(!has(without, '_isSvgParent'));
    const withVNodes = await bundle(`
      import { h, mount } from ${INDEX};
      mount(h('svg', {}, () => h('circle', {})), document.body);
    `);
    assert.ok(has(withVNodes, '_isSvgParent'));
    assert.match(withVNodes, /createDOM\(vnode, parent, isSvg \|\| inParent === 1 && _isSvgParent\(parent\)\)/);
  });

  it('writing the value of a select brings the option marking', async () => {
    const code = await bundle(`
      import { h, hydrate } from ${INDEX};
      hydrate(() => h('select', { value: 'b' }, h('option', {}, 'a'), h('option', {}, 'b')), document.body);
    `);
    assert.ok(has(code, 'markOptions'));
    assert.match(code, /_selectionKeeper = _keepSelection;/);
  });
});
