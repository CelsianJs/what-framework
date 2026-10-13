// Renders the --template=islands scaffold's pages the way its build.js does
// (entry-server's routes through exportStatic) and hydrates the island over the
// result. node_modules is symlinked at the workspace packages, so there is no
// npm install and no network. The real Vite build, dev server and browser are
// covered by scripts/smoke-scaffold.mjs.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, test } from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

import { installDOM } from '../../../test-utils/dom.js';

const repoRoot = resolve(import.meta.dirname, '../../..');
const createWhat = resolve(repoRoot, 'packages/create-what/index.js');

const LINKS = {
  'packages/what': 'what-framework',
  'packages/core': 'what-core',
  'packages/router': 'what-router',
  'packages/server': 'what-server',
};

const ASSETS = { script: '/assets/client-abc.js', stylesheet: '/assets/styles-abc.css' };

let workDir;
let appDir;
let rendered;
let homeHtml;
let aboutHtml;

// The same JSX settings vite.config.js gives Vite.
async function bundle(entry, outfile) {
  await build({
    entryPoints: [join(appDir, entry)],
    outfile: join(appDir, outfile),
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    jsx: 'automatic',
    jsxImportSource: 'what-framework',
    logLevel: 'silent',
  });
}

before(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'create-what-islands-'));
  const out = spawnSync(process.execPath, [createWhat, 'islands-app', '--template=islands', '--yes'], {
    cwd: workDir, encoding: 'utf8',
  });
  assert.equal(out.status, 0, out.stderr);
  appDir = join(workDir, 'islands-app');

  await mkdir(join(appDir, 'node_modules'), { recursive: true });
  for (const [dir, name] of Object.entries(LINKS)) {
    await symlink(resolve(repoRoot, dir), join(appDir, 'node_modules', name), 'dir');
  }

  await bundle('src/entry-server.js', '.ssr/entry-server.mjs');
  await bundle('src/islands/Counter.jsx', '.ssr/Counter.mjs');

  // Rendering runs in its own process: the framework decides whether it is on
  // a server when it is first imported, and this process is the browser.
  await writeFile(join(appDir, 'render.mjs'), `
    import { exportStatic } from 'what-framework/server';
    const { routes, documentOptions, renderRoute } = await import('./.ssr/entry-server.mjs');
    const { pages } = await exportStatic({
      routes,
      outDir: ${JSON.stringify(join(appDir, 'dist'))},
      documentOptions: documentOptions(${JSON.stringify(ASSETS)}),
    });
    const dev = { script: '/src/entry-client.js', stylesheet: '/src/styles.css' };
    console.log(JSON.stringify({
      pages,
      trailingSlash: await renderRoute('/about/', dev),
      unknown: await renderRoute('/nope', dev),
    }));
  `);
  const render = spawnSync(process.execPath, ['render.mjs'], { cwd: appDir, encoding: 'utf8' });
  assert.equal(render.status, 0, render.stderr);
  rendered = JSON.parse(render.stdout.trim().split('\n').pop());
  homeHtml = await readFile(join(appDir, 'dist/index.html'), 'utf8');
  aboutHtml = await readFile(join(appDir, 'dist/about/index.html'), 'utf8');
});

after(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

const parse = (html) => new JSDOM(html).window.document;

test('every route is written as its own HTML file', () => {
  assert.deepEqual([...rendered.pages].sort(), ['/', '/about']);
});

test('the home page is complete HTML with the island server-rendered inside its marker', () => {
  const doc = parse(homeHtml);
  assert.equal(doc.title, 'Home | islands-app');
  assert.equal(doc.querySelector('h1').textContent, 'A static site with islands');
  assert.deepEqual([...doc.querySelectorAll('nav a')].map((a) => a.getAttribute('href')), ['/', '/about']);

  const island = doc.querySelector('[data-island]');
  assert.equal(island.dataset.island, 'counter');
  assert.equal(island.dataset.islandMode, 'visible');
  assert.deepEqual(JSON.parse(island.dataset.islandProps), { start: 3 });
  assert.equal(island.querySelector('.counter output').textContent, '3');
  assert.equal(island.querySelectorAll('button').length, 2);

  assert.ok(doc.querySelector(`script[type="module"][src="${ASSETS.script}"]`), 'loads the hashed client entry');
  assert.ok(doc.querySelector(`link[rel="stylesheet"][href="${ASSETS.stylesheet}"]`), 'links the hashed stylesheet');
});

test('a page without islands is static HTML with no island marker', () => {
  const doc = parse(aboutHtml);
  assert.equal(doc.title, 'About | islands-app');
  assert.equal(doc.querySelector('[data-island]'), null);
  assert.match(doc.querySelector('main').textContent, /create a component in src\/pages\//);
});

test('renderRoute serves a trailing-slash path and has no page for an unknown one', () => {
  assert.equal(parse(rendered.trailingSlash).title, 'About | islands-app');
  assert.match(rendered.trailingSlash, /src="\/src\/entry-client\.js"/);
  assert.equal(rendered.unknown, null);
});

test('the island hydrates over the server markup and responds to clicks', async () => {
  const { cleanup } = installDOM(homeHtml);
  const previousObserver = globalThis.IntersectionObserver;
  // jsdom has no layout. The island is on screen as soon as it is observed.
  globalThis.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; }
    observe(target) { queueMicrotask(() => this.callback([{ isIntersecting: true, target }], this)); }
    unobserve() {}
    disconnect() {}
  };
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(' ')); };
  try {
    const { island, hydrateIslands } = await import('what-framework/server');
    const counterUrl = pathToFileURL(join(appDir, '.ssr/Counter.mjs')).href;

    const host = document.querySelector('[data-island="counter"]');
    const serverButton = host.querySelector('button[aria-label="Increase"]');
    const serverOutput = host.querySelector('output');
    const hydrated = new Promise((res) => host.addEventListener('island:hydrated', res, { once: true }));

    island('counter', () => import(counterUrl));
    hydrateIslands();
    await hydrated;

    assert.equal(host.hasAttribute('data-island'), false, 'the marker is removed once hydrated');
    assert.equal(host.querySelector('button[aria-label="Increase"]'), serverButton, 'the server button is the live one');
    assert.equal(host.querySelector('output'), serverOutput, 'the server output is the live one');

    serverButton.click();
    serverButton.click();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(serverOutput.textContent, '5');

    assert.deepEqual(warnings, []);
  } finally {
    console.warn = originalWarn;
    globalThis.IntersectionObserver = previousObserver;
    cleanup();
  }
});
