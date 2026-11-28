// reactCompat() in the three places an app runs: Vite's dev server, a dev
// server render, and a production server build. Each test builds a small app
// with real package directories under node_modules (the layout npm gives a
// scaffold; a workspace link hides these defects, because Vite treats a
// linked package as source) and holds one thing: the page, or the server
// render, has exactly one what-react, whatever a React library is called and
// whatever module format its files have.
//
// Run: node --test packages/react-compat/test/vite-plugin.test.js

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, createServer } from 'vite';
import { transform as esbuildTransform } from 'esbuild';
import { reactCompat } from '../src/vite-plugin.js';
import { mixedJsx, REACT_SOURCE_MARKER } from '../src/mixed-plugin.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const what = (await import(path.join(REPO, 'packages/compiler/src/vite-plugin.js'))).default;
const FRAMEWORK = { 'what-framework': 'what', 'what-core': 'core', 'what-router': 'router', 'what-server': 'server', 'what-react': 'react-compat' };

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'what-react-plugin-')));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

// A project with the framework installed (copied, not linked) and `files` on
// top (objects are written as JSON).
function project(name, files) {
  const root = path.join(scratch, name);
  for (const [pkg, dir] of Object.entries(FRAMEWORK)) {
    for (const entry of ['package.json', 'src']) {
      fs.cpSync(path.join(REPO, 'packages', dir, entry), path.join(root, 'node_modules', pkg, entry), { recursive: true });
    }
  }
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof text === 'string' ? text : JSON.stringify(text));
  }
  return root;
}

async function quiet(fn) {
  const { log, warn } = console;
  console.log = () => {};
  console.warn = () => {};
  try { return await fn(); } finally { console.log = log; console.warn = warn; }
}

const configOf = (root, plugins = [reactCompat()], env = { command: 'serve', mode: 'development' }) => {
  const main = plugins.flat().find((p) => p.name === 'what-react-compat');
  return main.config.call({ meta: { viteVersion: '8.0.0' } }, { root, plugins }, env);
};

test('react is the package what-react, resolved from the root, and no list of React libraries decides what is pre-bundled', () => {
  const root = project('config', {
    'package.json': { name: 'app', dependencies: { 'react-router': '1', zustand: '1', antd: '1' } },
    // Three packages the old list named: installed here, and not excluded.
    'node_modules/react-router/package.json': { name: 'react-router', type: 'module', peerDependencies: { react: '*' } },
    'node_modules/react-router/index.js': '',
    'node_modules/zustand/package.json': { name: 'zustand', type: 'module', peerDependencies: { react: '*' } },
    'node_modules/zustand/index.js': '',
    'node_modules/antd/package.json': { name: 'antd', main: 'index.js', module: 'index.js', peerDependencies: { react: '*' } },
    'node_modules/antd/index.js': '',
  });
  const config = configOf(root);
  const target = (specifier) => config.resolve.alias.find((a) => a.find.test(specifier))?.replacement;
  assert.equal(target('react'), 'what-react');
  assert.equal(target('react-dom'), 'what-react/dom');
  assert.equal(target('react-dom/client'), 'what-react/dom');
  assert.equal(target('react/jsx-runtime'), 'what-react/jsx-runtime');
  assert.equal(target('react/jsx-dev-runtime'), 'what-react/jsx-dev-runtime');
  assert.equal(target('react/compiler-runtime'), 'what-react/compiler-runtime');
  assert.equal(target('use-sync-external-store/shim'), 'what-react');
  assert.equal(target('react-dom/server'), undefined, 'only the exact specifiers are aliased');
  assert.ok(config.resolve.dedupe.includes('what-react'), 'what-react resolves from the root for every importer (pnpm)');
  assert.deepEqual([...config.optimizeDeps.exclude].sort(), ['react', 'react-dom', 'use-sync-external-store', 'what-core', 'what-framework', 'what-react', 'what-router', 'what-server']);
  assert.equal(config.optimizeDeps.include, undefined);
  assert.equal(config.ssr.noExternal[0], 'what-react', 'a server render bundles what-react');
});

test('a production server build bundles CommonJS-only React packages and what React packages depend on; the dev server leaves both to Node', () => {
  const root = project('ssr-packages', {
    'package.json': { name: 'app', dependencies: { 'esm-kit': '1', 'cjs-kit': '1', 'plain-util': '1', 'server-only-db': '1' } },
    'node_modules/esm-kit/package.json': { name: 'esm-kit', type: 'module', peerDependencies: { react: '*' }, dependencies: { 'dom-bits': '1', 'plain-util': '1' } },
    'node_modules/cjs-kit/package.json': { name: 'cjs-kit', main: 'index.js', peerDependencies: { react: '*' } },
    // Not React packages: plain-util is also a dependency of a React package, dom-bits only that.
    'node_modules/plain-util/package.json': { name: 'plain-util', main: 'index.js' },
    'node_modules/dom-bits/package.json': { name: 'dom-bits', main: 'cjs/index.js', dependencies: { 'deep-bit': '1' } },
    'node_modules/deep-bit/package.json': { name: 'deep-bit', main: 'index.js' },
    'node_modules/server-only-db/package.json': { name: 'server-only-db', main: 'index.js' },
  });
  assert.deepEqual(configOf(root).ssr.noExternal, ['what-react', 'esm-kit']);
  assert.deepEqual(configOf(root, [reactCompat()], { command: 'build', mode: 'production' }).ssr.noExternal.sort(), ['cjs-kit', 'deep-bit', 'dom-bits', 'esm-kit', 'plain-util', 'what-react'], 'not the app\'s own server-side dependency');
  assert.deepEqual(configOf(root, [reactCompat({ autoDetect: false })]).ssr.noExternal, ['what-react'], 'what-react also when the packages are not looked for');
});

// @emotion/hash 0.8 (a dependency of @ant-design/cssinjs, which antd
// uses): no exports map, a CommonJS main that sets __esModule and
// exports.default, and an ES module build. Node, loading the main, makes
// the whole exports object the default import, which is not callable; a
// bundler takes the module build. The dev server bundles such a dependency
// of a React package, so it renders what a production server build renders.
const SPLIT = {
  'node_modules/css-kit/package.json': { name: 'css-kit', type: 'module', main: 'index.js', peerDependencies: { react: '*' }, dependencies: { 'split-hash': '1' } },
  'node_modules/css-kit/index.js': "import { createElement } from 'react';\nimport hash from 'split-hash';\nexport function Styled() { return createElement('b', { className: 'css-' + hash('x') }, 'styled'); }\n",
  'node_modules/split-hash/package.json': { name: 'split-hash', main: 'cjs.js', module: 'esm.js' },
  'node_modules/split-hash/cjs.js': "'use strict';\nObject.defineProperty(exports, '__esModule', { value: true });\nexports.default = function hash(text) { return 'h' + text.length; };\n",
  'node_modules/split-hash/esm.js': "export default function hash(text) { return 'h' + text.length; }\n",
};

test('dev server render: a React package\'s dependency that Node and a bundler load differently is bundled, so its default import is the module\'s', async () => {
  const root = project('ssr-split', {
    'package.json': { name: 'app', type: 'module', dependencies: { 'css-kit': '1' } },
    ...SPLIT,
    'entry.js': "import { renderToString } from 'what-framework/server';\nimport { h } from 'what-framework';\nimport { ReactIsland } from 'what-react/mixed';\nimport { createElement } from 'react';\nimport { Styled } from 'css-kit';\nexport function render() { return renderToString(h(ReactIsland, { view: () => createElement(Styled) })); }\n",
  });
  assert.ok(configOf(root).ssr.noExternal.includes('split-hash'), 'bundled in the dev server');
  const server = await quiet(() => createServer({
    root, configFile: false, logLevel: 'silent', appType: 'custom', plugins: [reactCompat()],
    cacheDir: path.join(root, 'node_modules/.vite'),
    server: { middlewareMode: true, ws: false, hmr: false },
  }));
  try {
    const mod = await server.ssrLoadModule('/entry.js');
    const html = await quiet(() => mod.render());
    assert.match(html, /<b class="css-h1">styled<\/b>/);
  } finally {
    await server.close();
  }
});

// The same with antd itself (the package matrix's install): its Table island
// rendered empty in the dev server, with "(0 , __vite_ssr_import_0__.default)
// is not a function" from @ant-design/cssinjs.
const MATRIX = path.join(HERE, 'fixtures/matrix');
const hasAntd = fs.existsSync(path.join(MATRIX, 'node_modules/antd/package.json'));
test('dev server render: an antd Table island renders on the server', { skip: hasAntd ? false : 'the package matrix is not installed (npm ci --prefix packages/react-compat/test/fixtures/matrix)' }, async () => {
  const dir = path.join(MATRIX, 'src', '__antd_dev_ssr');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'page.jsx'), "import { h } from 'what-framework';\nimport { renderToHydratableString } from 'what-framework/server';\nimport { Table } from 'antd';\nconst columns = [{ title: 'Name', dataIndex: 'name' }];\nfunction Page() { return <section><Table pagination={false} columns={columns} dataSource={[{ key: 1, name: 'Ada' }]} /></section>; }\nexport function render() { return renderToHydratableString(h(Page)); }\n");
  const warnings = [];
  const server = await quiet(() => createServer({
    root: MATRIX, configFile: false, logLevel: 'silent', appType: 'custom', plugins: [what({ hydratable: true }), reactCompat()],
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, ws: false, hmr: false, watch: null },
  }));
  const warn = console.warn;
  try {
    const mod = await server.ssrLoadModule('/src/__antd_dev_ssr/page.jsx');
    console.warn = (...a) => warnings.push(a.join(' '));
    const html = mod.render();
    console.warn = warn;
    assert.deepEqual(warnings, []);
    assert.match(html, /<table[^>]*>/);
    assert.match(html, />Ada</);
  } finally {
    console.warn = warn;
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A React library with a CommonJS-only dependency, under a name the old list
// excluded from pre-bundling (react-router and its `cookie`): its files were
// served one by one, and the browser cannot import the CommonJS one.
const ROUTER = {
  'node_modules/react-router/package.json': { name: 'react-router', type: 'module', main: 'index.js', peerDependencies: { react: '*' }, dependencies: { cookie: '1' } },
  'node_modules/react-router/index.js': "import { useState } from 'react';\nimport { parse } from 'cookie';\nexport function useCookie(text) { return useState(() => parse(text))[0]; }\n",
  'node_modules/cookie/package.json': { name: 'cookie', main: 'index.js' },
  'node_modules/cookie/index.js': "exports.parse = function parse(text) { return Object.fromEntries(String(text).split('; ').map((pair) => pair.split('='))); };\n",
};

test('dev server: a React library with a CommonJS dependency is pre-bundled, and its react is the page\'s one what-react', async () => {
  const root = project('dev', {
    'package.json': { name: 'app', type: 'module', dependencies: { 'react-router': '1' } },
    ...ROUTER,
    'index.html': '<div id="main"></div><script type="module" src="/main.jsx"></script>',
    'main.jsx': "import { createRoot } from 'react-dom/client';\nimport { useCookie } from 'react-router';\nfunction App() { return <b>{useCookie('a=1').a}</b>; }\ncreateRoot(document.getElementById('main')).render(<App />);\n",
  });
  const server = await quiet(() => createServer({
    root, configFile: false, logLevel: 'silent', plugins: [reactCompat()],
    cacheDir: path.join(root, 'node_modules/.vite'),
    server: { middlewareMode: true, ws: false },
  }));
  try {
    const client = server.environments.client;
    // What the browser is told to import for each specifier of the entry.
    const entry = (await server.transformRequest('/main.jsx')).code;
    await client.depsOptimizer?.scanProcessing;
    const urlOf = (pattern) => (entry.match(pattern) || [])[1];
    const routerUrl = urlOf(/from "([^"]*react-router[^"]*)"/);
    assert.match(routerUrl, /\/node_modules\/\.vite\/deps\/react-router\.js/, `react-router is served from the pre-bundle (${routerUrl})`);
    const reactUrl = urlOf(/from "([^"]*what-react\/src\/dom\.js[^"]*)"/);
    assert.ok(reactUrl, `react-dom/client is what-react's dom.js:\n${entry}`);

    // The pre-bundle: the CommonJS dependency is inside it, converted, and
    // `react` is still an import, which the dev server resolves to what-react.
    const bundle = (await server.transformRequest(routerUrl)).code;
    assert.match(bundle, /function parse\(/, 'cookie is in the bundle');
    assert.doesNotMatch(bundle, /function renderInstance\(|function newInstance\(/, 'what-react is not inlined into the bundle');
    assert.match(bundle, /from "\/node_modules\/what-react\/src\/index\.js(\?[^"]*)?"/, `the bundle imports the page's what-react:\n${bundle.slice(0, 600)}`);
  } finally {
    await server.close();
  }
});

// @mui/material's shape: an ES module package that imports one CommonJS file
// of a bundled React package by path, a file that requires react and a
// sibling.
const UI_KIT = {
  'node_modules/ui-kit/package.json': { name: 'ui-kit', main: 'cjs/index.js', module: 'esm/index.js', peerDependencies: { react: '*' } },
  'node_modules/ui-kit/esm/index.js': "import { useContext } from 'react';\nimport Context from 'ui-kit/cjs/Context.js';\nimport { label, version } from 'ui-kit/cjs/names.js';\nexport function Kit() { return label + ':' + version + ':' + useContext(Context); }\nexport { Context };\n",
  'node_modules/ui-kit/cjs/Context.js': '"use strict";\n\nexports.__esModule = true;\nexports.default = void 0;\nvar _react = _interopRequireDefault(require("react"));\nvar _names = require("./names.js");\nfunction _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }\nvar _default = _react.default.createContext(_names.label);\nexports.default = _default;\nmodule.exports = exports.default;\n',
  'node_modules/ui-kit/cjs/names.js': '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.label = "kit";\nObject.defineProperty(exports, "version", { enumerable: true, get: function () { return 3; } });\nexports.file = __filename;\n',
};

test('dev server render: a CommonJS file of a bundled React package runs, and its require("react") is what-react', async () => {
  const root = project('ssr-dev', {
    'package.json': { name: 'app', type: 'module', dependencies: { 'ui-kit': '1' } },
    ...UI_KIT,
    'entry.js': "import * as React from 'react';\nimport { Kit, Context } from 'ui-kit';\nimport * as names from 'ui-kit/cjs/names.js';\nexport { React, Kit, Context, names };\n",
  });
  const server = await quiet(() => createServer({
    root, configFile: false, logLevel: 'silent', appType: 'custom', plugins: [reactCompat()],
    cacheDir: path.join(root, 'node_modules/.vite'),
    server: { middlewareMode: true, ws: false, hmr: false },
  }));
  try {
    const mod = await server.ssrLoadModule('/entry.js');
    assert.equal(typeof mod.Kit, 'function');
    assert.equal(mod.Context.$$typeof, mod.React.createContext('x').$$typeof, 'the context was made by the what-react the app imports');
    assert.equal(mod.Context._currentValue, 'kit', 'a sibling CommonJS file was required');
    assert.deepEqual({ label: mod.names.label, version: mod.names.version, default: mod.names.default.label }, { label: 'kit', version: 3, default: 'kit' }, 'named exports, and module.exports as the default');
    assert.equal(mod.names.file, path.join(root, 'node_modules/ui-kit/cjs/names.js'), '__filename is the file');
  } finally {
    await server.close();
  }
});

// A native page with a React island that calls a hook, and its server entry.
const ISLAND_APP = {
  'node_modules/store-kit/package.json': { name: 'store-kit', type: 'module', main: 'index.js', peerDependencies: { react: '*' }, dependencies: { 'use-sync-external-store': '1' } },
  'node_modules/store-kit/index.js': "import { useState } from 'react';\nimport { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector';\nconst subscribe = () => () => {};\nexport function Bears() {\n  const [n] = useState(3);\n  const more = useSyncExternalStoreWithSelector(subscribe, () => 4, () => 4, (v) => v);\n  return n + more;\n}\n",
  'node_modules/use-sync-external-store/package.json': { name: 'use-sync-external-store', main: 'index.js', peerDependencies: { react: '*' } },
  'node_modules/use-sync-external-store/index.js': "module.exports = require('react');\n",
  'node_modules/use-sync-external-store/with-selector.js': "module.exports = require('react');\n",
  'src/Page.jsx': "import { Bears } from 'store-kit';\nexport function Page() { return <main><Bears /></main>; }\n",
  'src/entry-server.js': "import { h } from 'what-framework';\nimport { renderToHydratableString } from 'what-framework/server';\nimport { Page } from './Page.jsx';\nexport function render() { return renderToHydratableString(h(Page)); }\n",
};

async function serverBuild(root, extra = {}) {
  const outDir = path.join(root, 'dist-server');
  await quiet(() => build({
    root, configFile: false, logLevel: 'silent', plugins: [what(), reactCompat()],
    build: { ssr: 'src/entry-server.js', outDir, emptyOutDir: true },
    ...extra,
  }));
  return path.join(outDir, fs.readdirSync(outDir).find((f) => /^entry-server\.m?js$/.test(f)));
}

test('production server build: an island that calls hooks renders its HTML (one what-react in the bundle)', async () => {
  const root = project('ssr-build', { 'package.json': { name: 'app', type: 'module', dependencies: { 'store-kit': '1' } }, ...ISLAND_APP });
  const file = await serverBuild(root);
  const code = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(code, /from ["']what-react(\/[^"']*)?["']/, 'what-react is bundled, not imported from node_modules');
  const { render } = await import(pathToFileURL(file).href);
  assert.match(await render(), /<main[^>]*><!--\[\]-->7<!--\/\[\]--><\/main>/);
});

test('production server build: what a bundled React package imports is bundled too (Node refuses a directory import)', async () => {
  const root = project('ssr-dir-import', {
    'package.json': { name: 'app', type: 'module', dependencies: { 'fade-kit': '1' } },
    // react-transition-group's shape: an ES module that imports a directory of a CommonJS package.
    'node_modules/fade-kit/package.json': { name: 'fade-kit', type: 'module', main: 'index.js', peerDependencies: { react: '*' }, dependencies: { 'dom-bits': '1' } },
    'node_modules/fade-kit/index.js': "import { useState } from 'react';\nimport addClass from 'dom-bits/addClass';\nexport function Fade() { return addClass(useState('fade')[0]); }\n",
    'node_modules/dom-bits/package.json': { name: 'dom-bits', main: 'cjs/index.js' },
    'node_modules/dom-bits/cjs/index.js': "exports.addClass = require('./addClass.js');\n",
    'node_modules/dom-bits/cjs/addClass.js': "module.exports = function addClass(name) { return name + '-enter'; };\n",
    'node_modules/dom-bits/addClass/package.json': { name: 'dom-bits/addClass', private: true, main: '../cjs/addClass.js' },
    'src/Page.jsx': "import { Fade } from 'fade-kit';\nexport function Page() { return <main><Fade /></main>; }\n",
    'src/entry-server.js': ISLAND_APP['src/entry-server.js'],
  });
  const file = await serverBuild(root);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /from ["']dom-bits/, 'dom-bits is bundled');
  const { render } = await import(pathToFileURL(file).href);
  assert.match(await render(), /<main[^>]*><!--\[\]-->fade-enter<!--\/\[\]--><\/main>/);
});

test('production server build: a bundle with two copies of what-react is refused', async () => {
  const root = project('ssr-two', { 'package.json': { name: 'app', type: 'module', dependencies: { 'store-kit': '1' } }, ...ISLAND_APP });
  // what-react forced external: the with-selector shim still bundles its
  // what-react sibling, so the runtime would be there twice.
  await assert.rejects(() => serverBuild(root, { ssr: { external: ['what-react'] } }), /two copies of what-react/);
});

test('what-compiler still sees that a file is a React file after esbuild has transformed it (Vite 6 and earlier)', async () => {
  const root = project('marker', {
    'package.json': { name: 'app', type: 'module' },
    'src/Card.jsx': "import { useState } from 'react';\nexport function Card() { const [n] = useState(1); return <b>{n}</b>; }\n",
  });
  const plugin = mixedJsx();
  plugin.configResolved({ root });
  const file = path.join(root, 'src/Card.jsx');
  const out = await plugin.transform.call({ resolve: async () => null, environment: null }, fs.readFileSync(file, 'utf8'), file);
  assert.match(out.code, /createElement\("b"/, 'the React file is lowered');
  // Vite 6 runs esbuild on every .jsx module between the two plugins.
  const afterEsbuild = (await esbuildTransform(out.code, { loader: 'jsx' })).code;
  assert.ok(afterEsbuild.includes(REACT_SOURCE_MARKER), `the marker survives esbuild:\n${afterEsbuild.slice(-200)}`);
});
