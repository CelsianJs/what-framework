// what-react in the bundles an app ships. The jsdom suites load the sources
// directly, so they cannot see what a bundler does with them:
//   - a production bundle keeps core's vnode renderer only when something in
//     it makes a vnode through core's producer (packages/core/src/h.js);
//   - Vite applies a string alias to every subpath under it;
//   - Vite pre-bundles an installed package it is not told to leave alone, and
//     a pre-bundled what-framework carries its own copy of what-core.
// So the fixture app (fixtures/bundle) is built by esbuild and by Vite for
// production and run in jsdom, served by the Vite dev server from a real
// node_modules layout and driven in Chromium, and every framework subpath is
// resolved through the compat plugin.
//
// Run: node --test packages/react-compat/test/bundle.test.js

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build as esbuild } from 'esbuild';
import { build as viteBuild, createServer } from 'vite';
import { chromium } from 'playwright';
import { reactCompat } from '../src/vite-plugin.js';
import { installDOM } from '../../../test-utils/dom.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const FIXTURE = join(HERE, 'fixtures', 'bundle');

const PACKAGE_DIRS = {
  'what-framework': 'what',
  'what-core': 'core',
  'what-router': 'router',
  'what-server': 'server',
  'what-react': 'react-compat',
};

// The `production` condition resolves the framework to dist/*.min.js, which
// `npm run build` writes. CI's test job does not build; its build and
// scaffold-smoke jobs do, and the scaffold smoke runs the compat scaffold
// against that dist.
const DIST_BUILT = ['core', 'what', 'router', 'server']
  .every((dir) => existsSync(join(REPO, 'packages', dir, 'dist', 'index.min.js')));
const NEEDS_DIST = DIST_BUILT ? false : 'needs the built dist/ (npm run build)';

// Built from the source rather than the dist: the client conditions without
// `production`, and without `module`, which resolves the bundler tier
// (dist/*.js).
const SOURCE_CONDITIONS = ['browser'];

const scratch = mkdtempSync(join(tmpdir(), 'what-react-bundle-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

// The file a framework specifier names under one export condition, read from
// the package's own exports.
function exportTarget(specifier, condition) {
  const [, name, subpath = ''] = specifier.match(/^(what-[a-z]+)(\/.+)?$/);
  const dir = join(REPO, 'packages', PACKAGE_DIRS[name]);
  const entry = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).exports['.' + subpath];
  return join(dir, entry[condition]);
}

const SUBPATHS = [
  'what-framework',
  'what-framework/ui',
  'what-framework/form',
  'what-framework/a11y',
  'what-framework/router',
  'what-framework/server',
  'what-framework/render',
  'what-core',
  'what-core/internal',
  'what-core/render',
];

// The built HTML's entry script, as a file path.
function htmlEntry(outDir, page) {
  const html = readFileSync(join(outDir, page), 'utf8');
  const src = html.match(/<script type="module"[^>]* src="\/([^"]+)"/)[1];
  return join(outDir, src);
}

// Run a built entry in a fresh jsdom and collect everything it printed.
async function inJsdom(entryFile, drive) {
  const { document, window, cleanup } = installDOM();
  const printed = [];
  const { error, warn } = console;
  console.error = (...args) => printed.push(`error: ${args.join(' ')}`);
  console.warn = (...args) => printed.push(`warn: ${args.join(' ')}`);
  try {
    await import(pathToFileURL(entryFile).href);
    return { result: await drive(document, window), printed };
  } finally {
    console.error = error;
    console.warn = warn;
    cleanup();
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

// Render, update each kind of state, then unmount: the signal, a store read
// through useSyncExternalStore and a useState inside a compat component, and
// the unmount must reach the compat effect cleanups through the bridge.
async function driveApp(document, window) {
  const text = () => ['count', 'bears', 'clicks'].map((id) => document.getElementById(id)?.textContent);
  const initial = text();
  for (const id of ['inc', 'add', 'clicks']) document.getElementById(id).click();
  await tick();
  const updated = text();
  window.__unmount();
  await tick();
  return { initial, updated, log: window.__log, left: document.getElementById('app').innerHTML };
}

function assertAppRan({ result, printed }) {
  assert.deepEqual(printed, [], 'nothing printed');
  assert.deepEqual(result.initial, ['0', '0 bears', 'clicks 0'], 'rendered');
  assert.deepEqual(result.updated, ['1', '1 bears', 'clicks 1'], 'every kind of state updated the DOM');
  assert.deepEqual(result.log, ['Clicks unmounted'], 'unmounting ran the compat effect cleanup');
  assert.equal(result.left, '', 'unmounting removed the app');
}

async function esbuildApp(outdir, conditions, entry = 'main') {
  await esbuild({
    absWorkingDir: FIXTURE,
    entryPoints: [`src/${entry}.jsx`],
    outdir,
    bundle: true,
    format: 'esm',
    minify: true,
    conditions,
    jsx: 'automatic',
    jsxImportSource: 'react',
    alias: { react: 'what-react', 'react-dom/client': 'what-react/dom', 'react-dom': 'what-react/dom' },
    define: { __WHAT_DEV__: 'false', 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });
  return join(outdir, `${entry}.js`);
}

// Vite sets process.env.NODE_ENV for the whole process when it resolves a
// config (`production` for a build, `development` for a dev server) unless it
// is set already, and the export conditions follow it. Each Vite call here sets
// the one it means and puts the previous value back.
async function withNodeEnv(value, fn) {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = value;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
}

// Build a fixture page; returns its entry script and every module file the
// build loaded.
async function viteBuildFixture(outDir, { conditions, page = 'index.html' } = {}) {
  const loaded = new Set();
  const record = {
    name: 'record-loads',
    load(id) {
      if (!id.startsWith('\0')) loaded.add(realpathSync(id.split('?')[0]));
      return null;
    },
  };
  await withNodeEnv('production', () => viteBuild({
    root: FIXTURE,
    configFile: false,
    logLevel: 'silent',
    plugins: [reactCompat(), record],
    resolve: conditions ? { conditions } : {},
    build: {
      outDir,
      emptyOutDir: true,
      modulePreload: { polyfill: false },
      rollupOptions: { input: join(FIXTURE, page) },
    },
  }));
  return { entry: htmlEntry(outDir, page), loaded };
}

function devServer(root, server) {
  return withNodeEnv('development', () => createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    cacheDir: mkdtempSync(join(scratch, 'vite-cache-')),
    plugins: [reactCompat()],
    server,
  }));
}

test('esbuild production bundle, source: renders, updates, unmounts cleanly', async () => {
  assertAppRan(await inJsdom(await esbuildApp(join(scratch, 'esbuild-src'), []), driveApp));
});

test('esbuild production bundle, `production` condition: renders, updates, unmounts cleanly', { skip: NEEDS_DIST }, async () => {
  assertAppRan(await inJsdom(await esbuildApp(join(scratch, 'esbuild-dist'), ['production']), driveApp));
});

test('Vite production build, source: renders, updates, unmounts cleanly', async () => {
  const { entry, loaded } = await viteBuildFixture(join(scratch, 'vite-src'), { conditions: SOURCE_CONDITIONS });
  assert.ok(loaded.has(exportTarget('what-core', 'import')), 'built from the source');
  assertAppRan(await inJsdom(entry, driveApp));
});

test('Vite production build, `production` condition: renders, updates, unmounts cleanly', { skip: NEEDS_DIST }, async () => {
  const { entry, loaded } = await viteBuildFixture(join(scratch, 'vite-dist'));
  assert.ok(loaded.has(exportTarget('what-core', 'production')), 'built from the dist');
  assertAppRan(await inJsdom(entry, driveApp));
});

// fixtures/bundle/src/class-app.jsx: a class marked `isReactComponent` by hand,
// in a program with no Component in it. Class components come with
// Component's definition, or with `what-react/class`, which what-react's Vite
// plugin imports into a module that has the marker. Before either existed, a
// production bundle that dropped Component called the class as a function
// ("Class constructor ... cannot be invoked without 'new'") and rendered
// nothing; without the install it is refused with a coded error now.
async function driveClass(document, window) {
  const text = () => document.getElementById('marked')?.textContent ?? null;
  const initial = text();
  document.getElementById('next').click();
  await tick();
  const updated = text();
  window.__unmount();
  await tick();
  return { initial, updated, log: window.__log, left: document.getElementById('app').innerHTML };
}

// The class wrapper's code: only it reads this lifecycle method.
const CLASS_CODE = /getSnapshotBeforeUpdate/;
// Component's and PureComponent's definitions.
const COMPONENT_CODE = /isPureReactComponent\s*=(?!=)/;

function assertClassRan({ result, printed }, code) {
  assert.deepEqual(printed, [], 'nothing printed');
  assert.equal(result.initial, 'first', 'the marked class rendered');
  assert.equal(result.updated, 'second', 'it rendered its new props');
  assert.deepEqual(result.log, ['mounted first', 'updated first -> second', 'unmounted'], 'its lifecycle ran');
  assert.equal(result.left, '', 'unmounting removed it');
  assert.ok(!COMPONENT_CODE.test(code), 'Component and PureComponent were dropped');
}

test('esbuild production bundle, source, no plugin: a class marked isReactComponent with no Component in the program is refused with ERR_CLASS_COMPONENT_NOT_INSTALLED', async () => {
  const entry = await esbuildApp(join(scratch, 'esbuild-class'), [], 'class');
  assert.ok(!CLASS_CODE.test(readFileSync(entry, 'utf8')), 'no class code in the bundle');
  let thrown = null;
  const { printed } = await inJsdom(entry, () => null).catch((error) => {
    thrown = error;
    return { printed: [] };
  });
  const said = thrown !== null ? `${thrown.code} ${thrown.message}` : printed.join('\n');
  assert.match(said, /ERR_CLASS_COMPONENT_NOT_INSTALLED/);
  assert.match(said, /is a class component/);
  assert.match(said, /what-react\/class/);
});

test('esbuild production bundle, source, no plugin: with what-react/class imported, a class marked isReactComponent renders', async () => {
  const entry = await esbuildApp(join(scratch, 'esbuild-class-installed'), [], 'class-installed');
  assertClassRan(await inJsdom(entry, driveClass), readFileSync(entry, 'utf8'));
});

test('Vite production build, source: the plugin installs class components for a class marked isReactComponent with no Component in the program', async () => {
  const { entry } = await viteBuildFixture(join(scratch, 'vite-class'), { conditions: SOURCE_CONDITIONS, page: 'class.html' });
  assertClassRan(await inJsdom(entry, driveClass), readFileSync(entry, 'utf8'));
});

test('Vite production build, `production` condition: the plugin installs class components for a class marked isReactComponent with no Component in the program', { skip: NEEDS_DIST }, async () => {
  const { entry } = await viteBuildFixture(join(scratch, 'vite-class-dist'), { page: 'class.html' });
  assertClassRan(await inJsdom(entry, driveClass), readFileSync(entry, 'utf8'));
});

test('an app with no class and no isReactComponent carries no class code (esbuild, and Vite with the plugin)', async () => {
  const esbuilt = await esbuildApp(join(scratch, 'esbuild-noclass'), []);
  assert.ok(!CLASS_CODE.test(readFileSync(esbuilt, 'utf8')), 'esbuild');
  // The framework's own files read the marker (what-react's, what-core's):
  // the plugin adds no install for them.
  const { entry } = await viteBuildFixture(join(scratch, 'vite-noclass'), { conditions: SOURCE_CONDITIONS });
  assert.ok(!CLASS_CODE.test(readFileSync(entry, 'utf8')), 'Vite');
});

test('compat plugin resolves each framework subpath to its own export, and no alias captures a subpath', async () => {
  const server = await devServer(FIXTURE, { middlewareMode: true, ws: false });
  try {
    const container = server.environments.client.pluginContainer;
    const importer = join(FIXTURE, 'src', 'kits.js');
    for (const specifier of SUBPATHS) {
      const resolved = await container.resolveId(specifier, importer);
      assert.equal(resolved && realpathSync(resolved.id), exportTarget(specifier, 'import'), specifier);
    }
    const react = await container.resolveId('react', importer);
    assert.equal(realpathSync(react.id), join(REPO, 'packages/react-compat/src/index.js'));
    // Only the exact specifier is aliased: react-dom/server is not dom.js/server.
    const domServer = await container.resolveId('react-dom/server', importer);
    assert.ok(!domServer || !domServer.id.includes('dom.js'), `react-dom/server resolved to ${domServer?.id}`);
  } finally {
    await server.close();
  }
});

test('Vite production build of every subpath: each is its `production` export, one engine', { skip: NEEDS_DIST }, async () => {
  const { entry, loaded } = await viteBuildFixture(join(scratch, 'vite-kits'), { page: 'kits.html' });

  for (const specifier of SUBPATHS) {
    assert.ok(loaded.has(exportTarget(specifier, 'production')), `${specifier} -> ${exportTarget(specifier, 'production')}`);
  }
  const framework = [...loaded].filter((id) => /packages\/(core|what|router|server)\//.test(id));
  assert.deepEqual(framework.filter((id) => !id.includes('/dist/')), [], 'no framework source module next to the dist');

  const { result, printed } = await inJsdom(entry, (document, window) => window.__kits);
  assert.deepEqual(printed, []);
  for (const [name, type] of Object.entries(result)) assert.equal(type, 'function', name);
});

// An installed layout: real package directories under node_modules, the way
// npm lays out a scaffold, rather than the workspace links Vite treats as
// source.
function installedProject(dir) {
  for (const [name, pkgDir] of Object.entries(PACKAGE_DIRS)) {
    for (const entry of ['package.json', 'src']) {
      cpSync(join(REPO, 'packages', pkgDir, entry), join(dir, 'node_modules', name, entry), { recursive: true });
    }
  }
  for (const entry of ['index.html', 'kits.html', 'src']) cpSync(join(FIXTURE, entry), join(dir, entry), { recursive: true });
  return dir;
}

test('Vite dev server over installed packages: one engine, every subpath loads, the bridge cleans up', async () => {
  const root = installedProject(join(scratch, 'installed'));
  const server = await devServer(root, { host: '127.0.0.1', port: 0 });
  await server.listen();
  const browser = await chromium.launch();
  try {
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;
    const page = await browser.newPage();
    const printed = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') printed.push(`${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => printed.push(`pageerror: ${e.message}`));

    await page.goto(base + '/');
    await page.waitForSelector('#bears', { timeout: 10000 });
    const text = () => page.evaluate(() => ['count', 'bears', 'clicks'].map((id) => document.getElementById(id).textContent));
    assert.deepEqual(await text(), ['0', '0 bears', 'clicks 0']);
    for (const id of ['inc', 'add', 'clicks']) await page.click('#' + id);
    await page.waitForFunction(() => document.getElementById('clicks').textContent === 'clicks 1', null, { timeout: 10000 });
    assert.deepEqual(await text(), ['1', '1 bears', 'clicks 1']);

    // The framework packages are served as source: a pre-bundled
    // what-framework would carry a second what-core.
    const optimized = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes('/.vite/deps/what-')));
    assert.deepEqual(optimized, [], 'no framework package is pre-bundled');

    await page.evaluate(() => window.__unmount());
    await page.waitForFunction(() => window.__log.length > 0, null, { timeout: 10000 });
    assert.deepEqual(await page.evaluate(() => window.__log), ['Clicks unmounted']);
    assert.deepEqual(printed, [], 'no errors or diagnostics (ERR_CLEANUP_WITHOUT_OWNER among them)');

    await page.goto(base + '/kits.html');
    await page.waitForFunction(() => window.__kits, null, { timeout: 10000 });
    for (const [name, type] of Object.entries(await page.evaluate(() => window.__kits))) assert.equal(type, 'function', name);
    assert.deepEqual(printed, []);
  } finally {
    await browser.close();
    await server.close();
  }
});
