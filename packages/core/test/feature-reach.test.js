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
// Bundled from the source with the production tier's define and dev-flag
// plugin, unminified, so the functions keep their names.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTION } from '../../../scripts/build.js';

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

  it('writing the value of a select brings the option marking', async () => {
    const code = await bundle(`
      import { h, hydrate } from ${INDEX};
      hydrate(() => h('select', { value: 'b' }, h('option', {}, 'a'), h('option', {}, 'b')), document.body);
    `);
    assert.ok(has(code, 'markOptions'));
    assert.match(code, /_selectionKeeper = _keepSelection;/);
  });
});
