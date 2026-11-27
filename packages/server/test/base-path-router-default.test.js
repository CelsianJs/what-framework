// An app served below a base whose server sets no base of its own on the
// router (no setBase(), and what-router kept external, where it has no
// Vite base): createRequestHandler's and exportStatic's `basePath` is the
// base what-router renders below, for the renders they run. The page the
// browser shows at '/app/about' renders, with its links below the base, and
// two handlers with different bases in one process each render their own.
// Before, the router had no base on the server: it rendered its fallback and
// linked to '/about' while the browser showed the page (a hydration mismatch).
//
// Its own file: setBase() is never called here, and what-router keeps the
// base it sets for the process.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { h } from 'what-core';
import { Router, Link, redirect } from 'what-router';
import { createRequestHandler } from '../src/index.js';
import { exportStatic } from '../src/adapter/static.js';

let outDir;
before(async () => { outDir = await mkdtemp(join(tmpdir(), 'whatbase-')); });
after(async () => { await rm(outDir, { recursive: true, force: true }); });

const pages = [
  { path: '/', component: () => h('p', null, 'home') },
  { path: '/about', component: () => h('h1', null, 'about') },
  { path: '/old', component: () => redirect('/about') },
];
const App = () => h('div', null,
  h('nav', null, h(Link, { href: '/' }, 'home'), h(Link, { href: '/about' }, 'about')),
  h(Router, { routes: pages, fallback: () => h('p', null, 'not found') }));

describe('createRequestHandler basePath, with no base set on the router', () => {
  it('renders the page below the base, with links below it', async () => {
    const routes = [{ path: '*', component: App, mode: 'server' }];
    for (const basePath of ['/app', 'app/']) {
      const handler = createRequestHandler({ routes, basePath, csrf: false });
      const html = await (await handler(new Request('http://app.test/app/about'))).text();
      assert.match(html, /<h1[^>]*>about<\/h1>/, basePath);
      assert.doesNotMatch(html, /not found/, basePath);
      assert.match(html, /<a [^>]*href="\/app\/"[^>]*>home/, basePath);
      assert.match(html, /<a [^>]*href="\/app\/about"[^>]*>about/, basePath);
      const moved = await handler(new Request('http://app.test/app/old'));
      assert.equal(moved.headers.get('location'), '/app/about', basePath);
    }
  });

  it('renders each handler\'s requests below its own base when two run at once', async () => {
    const gates = new Map();
    const loader = ({ request }) => new Promise((resolve) => gates.set(new URL(request.url).pathname, resolve));
    const routes = [{ path: '*', component: App, loader, mode: 'server' }];
    const first = createRequestHandler({ routes, basePath: '/one', csrf: false });
    const second = createRequestHandler({ routes, basePath: '/two', csrf: false });
    const one = first(new Request('http://app.test/one/about'));
    const two = second(new Request('http://app.test/two/about'));
    while (gates.size < 2) await new Promise((resolve) => setTimeout(resolve, 1));
    gates.get('/two/about')();
    gates.get('/one/about')();
    const [htmlOne, htmlTwo] = await Promise.all([one, two].map(async (response) => (await response).text()));
    assert.match(htmlOne, /<h1[^>]*>about<\/h1>/);
    assert.match(htmlOne, /<a [^>]*href="\/one\/about"/);
    assert.doesNotMatch(htmlOne, /\/two\//);
    assert.match(htmlTwo, /<h1[^>]*>about<\/h1>/);
    assert.match(htmlTwo, /<a [^>]*href="\/two\/about"/);
    assert.doesNotMatch(htmlTwo, /\/one\//);
  });
});

describe('exportStatic basePath, with no base set on the router', () => {
  it('renders each page below the base, with links below it', async () => {
    for (const basePath of ['/app/', 'app']) {
      const routes = ['/about', '/old'].map((path) => ({ path, page: { mode: 'static' }, component: App }));
      const { pages: written, redirects } = await exportStatic({ routes, outDir, basePath });
      assert.deepEqual(written, ['/about'], basePath);
      const html = await readFile(join(outDir, 'about/index.html'), 'utf8');
      assert.match(html, /<h1[^>]*>about<\/h1>/, basePath);
      assert.doesNotMatch(html, /not found/, basePath);
      assert.match(html, /<a [^>]*href="\/app\/about"[^>]*>about/, basePath);
      assert.deepEqual(redirects.map((r) => [r.path, r.location]), [['/old', '/app/about']], basePath);
    }
  });
});
