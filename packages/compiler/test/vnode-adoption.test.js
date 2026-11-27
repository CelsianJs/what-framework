// In a client build what-compiler/vite compiles for hydration, what-core's
// adoption of every vnode but a component's (render.js _adoptVNodeKinds: an
// h() element, <Suspense>, <ErrorBoundary>, a <Portal>) is installed by the
// vnode producers instead of being reached from hydrate(): the plugin serves
// a stand-in for what-core's vnode-adoption.js (vite-plugin.js
// vnodeAdoptionStandIn). A compiled-only app then carries none of it
// (core/test/feature-reach.test.js); these tests check that the plugin serves
// the stand-in where it should and nowhere else, and that a client built with
// it hydrates the vnodes it makes as before: the page what-server rendered,
// built with Vite and run on that page.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import whatVitePlugin from '../src/vite-plugin.js';
import { installDOM } from '../../../test-utils/dom.js';

const { window } = installDOM();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const CORE_SRC = path.join(REPO, 'packages/core/src');
const CORE_INDEX = path.join(CORE_SRC, 'index.js');

const tmpDir = mkdtempSync(path.join(tmpdir(), 'what-vnode-adoption-'));
after(() => rmSync(tmpDir, { recursive: true, force: true }));

describe('the vnode adoption stand-in', () => {
  const loadFor = (options, id, loadOptions) => {
    const plugin = whatVitePlugin(options);
    plugin.configResolved({ root: REPO, command: 'build', appType: 'custom', build: {} });
    return plugin.load.call({}, id, loadOptions);
  };
  const SOURCE_FILE = path.join(CORE_SRC, 'vnode-adoption.js');

  it('stands in for what-core\'s file in a client build compiled for hydration, from its source or a dist tier', () => {
    assert.match(loadFor({ hydratable: true }, SOURCE_FILE), /from '\.\/render\.js'/);
    assert.match(loadFor({ hydratable: true }, SOURCE_FILE), /export var adoptVNodeKinds, adoptVNodeRows;/);
    const minified = loadFor({ hydratable: true }, path.join(REPO, 'packages/core/dist/vnode-adoption.min.js'));
    assert.match(minified, /from '\.\/render\.min\.js'/);
    assert.match(minified, /from '\.\/vnode-renderer\.min\.js'/);
  });

  it('leaves it alone in a server build, a build not compiled for hydration, and for anyone else\'s file', () => {
    assert.equal(loadFor({ hydratable: true }, SOURCE_FILE, { ssr: true }), undefined);
    assert.equal(loadFor({ hydratable: false }, SOURCE_FILE), undefined);
    assert.equal(loadFor({ hydratable: true }, path.join(tmpDir, 'src/vnode-adoption.js')), null);
  });
});

// The page: a component written with h(), whose vnodes are the kinds the
// stand-in installs the adoption of, keyed rows included. The client entry is compiled JSX, as an
// app's is.
const APP_SOURCE = `
  import { h, signal, Suspense, ErrorBoundary, Portal } from ${JSON.stringify(CORE_INDEX)};
  export function App() {
    const count = signal(0);
    const items = signal(['a', 'b']);
    return h('main', { class: 'app', 'data-kind': 'element' },
      h('button', { id: 'inc', onClick: () => count(count() + 1) }, () => String(count())),
      h('ul', null, () => items().map((item) => h('li', { key: item, id: 'item-' + item }, item))),
      h(Suspense, { fallback: h('p', null, 'loading') }, h('p', { id: 'in-suspense' }, 'ready')),
      h(ErrorBoundary, { fallback: () => h('p', null, 'failed') }, h('p', { id: 'in-boundary' }, 'fine')),
      h(Portal, { target: '#portal' }, h('p', { id: 'portaled' }, 'elsewhere')),
    );
  }
`;

let built = 0;

// The client, built by a production `vite build` with what-compiler/vite
// compiling for hydration, and the modules the stand-in was served for.
async function buildClient(entrySource) {
  const { build } = await import('vite');
  const n = built++;
  const dir = path.join(tmpDir, `client-${n}`);
  const entry = path.join(dir, 'entry-client.jsx');
  const app = path.join(dir, 'app.js');
  const sources = new Map([[entry, entrySource], [app, APP_SOURCE]]);
  const standIns = [];
  const output = await build({
    configFile: false,
    root: REPO,
    logLevel: 'silent',
    mode: 'production',
    plugins: [
      { name: 'client-sources', enforce: 'pre', resolveId: (id, importer) => {
        const file = id.startsWith('./') && importer ? path.join(path.dirname(importer), id) : id;
        return sources.has(file) ? file : null;
      }, load: (id) => sources.get(id) ?? null },
      whatVitePlugin({ hydratable: true, prodBundles: false }),
      { name: 'observe', enforce: 'post', transform(code, id) {
        if (id.endsWith('vnode-adoption.js') && code.includes('export var adoptVNodeKinds')) standIns.push(id);
        return null;
      } },
    ],
    resolve: { alias: [{ find: /^what-framework\/render$/, replacement: path.join(CORE_SRC, 'render.js') }, { find: /^what-framework$/, replacement: CORE_INDEX }] },
    build: { write: false, minify: false, target: 'es2022', modulePreload: false, rollupOptions: { input: entry } },
  });
  const code = (Array.isArray(output) ? output : [output]).flatMap((o) => o.output).filter((o) => o.type === 'chunk').map((c) => c.code).join('\n');
  const file = path.join(tmpDir, `client-${n}.mjs`);
  writeFileSync(file, code);
  return { file, standIns };
}

describe('a client built with the stand-in hydrates the vnodes it makes', () => {
  it('keeps the server\'s nodes for h() elements, keyed rows, <Suspense>, <ErrorBoundary> and a <Portal>, and binds them', async () => {
    const { h } = await import(pathToFileURL(CORE_INDEX).href);
    const { renderToString } = await import('../../server/src/index.js');
    const appFile = path.join(tmpDir, 'app-server.mjs');
    writeFileSync(appFile, APP_SOURCE);
    const { App } = await import(pathToFileURL(appFile).href);

    const client = await buildClient(`
      import { hydrate } from 'what-framework';
      import { App } from './app.js';
      globalThis.__mismatches = [];
      hydrate(<App />, document.getElementById('app'), { onHydrationError: (info) => globalThis.__mismatches.push(info.kind) });
    `);
    assert.equal(client.standIns.length, 1, 'the build is served the stand-in');

    document.body.innerHTML = '<div id="app"></div><div id="portal"></div>';
    const container = /** @type {HTMLElement} */ (document.getElementById('app'));
    container.innerHTML = renderToString(h(App));
    const kept = ['main', '#inc', '#item-a', '#item-b', '#in-suspense', '#in-boundary'];
    const server = kept.map((selector) => container.querySelector(selector));
    assert.ok(server.every((node) => node !== null), 'the server rendered every part');

    await import(pathToFileURL(client.file).href);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(/** @type {any} */ (globalThis).__mismatches, []);
    kept.forEach((selector, i) => {
      assert.equal(container.querySelector(selector), server[i], `the server's ${selector} is kept`);
    });
    assert.equal(document.querySelector('#portal #portaled').textContent, 'elsewhere');
    server[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(server[1].textContent, '1');
  });
});
