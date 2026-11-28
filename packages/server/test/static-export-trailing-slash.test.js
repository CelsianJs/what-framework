// A static export writes the page '/about' as `about/index.html`, a
// directory's index, which a static host serves at '/about/' (redirecting
// '/about' there). The page is rendered at that URL, so what the browser
// hydrates it with agrees with the render: route.path is '/about/' on both
// sides, and a relative link resolves against '/about/' on both. Before, the
// export rendered '/about', so a page that shows route.path hydrated with a
// mismatch, and a relative link was resolved against another page.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installDOM } from '../../../test-utils/dom.js';

let env;
let outDir;
let core;
let internal;
let router;
let exportStatic;
before(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'whatslash-'));
  env = installDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://site.test/app/about/' });
  core = await import('what-core');
  internal = await import('what-core/internal');
  router = await import('what-router');
  ({ exportStatic } = await import('../src/adapter/static.js'));
});
after(async () => {
  router.setBase('');
  env.cleanup();
  await rm(outDir, { recursive: true, force: true });
});

function app() {
  const { h } = core;
  const { Router, Link, route } = router;
  const pages = [
    { path: '/', component: () => h('p', { id: 'page' }, 'home') },
    { path: '/about', component: () => h('p', { id: 'page' }, 'about') },
    { path: '/about/team', component: () => h('p', { id: 'page' }, 'team') },
  ];
  return () => h('div', { id: 'shell' },
    h('p', { id: 'path' }, () => route.path),
    h(Link, { href: '.', activeClass: 'here', exactActiveClass: 'exact' }, 'this page'),
    h(Link, { href: 'team', activeClass: 'here' }, 'team'),
    h(Router, { routes: pages, fallback: () => h('p', { id: 'page' }, 'not found') }));
}

describe('a static export below a base, hydrated at the URL a host serves it at', () => {
  it('renders the page at its directory\'s URL, and hydrates with no mismatch', async () => {
    const App = app();
    const routes = ['/about'].map((path) => ({ path, page: { mode: 'static' }, component: App }));
    const { pages } = await exportStatic({ routes, outDir, basePath: '/app' });
    assert.deepEqual(pages, ['/about']);
    const html = await readFile(join(outDir, 'about/index.html'), 'utf8');
    assert.match(html, /<p id="path">(<!--[^>]*-->)?\/about\/(<!--[^>]*-->)?<\/p>/);
    assert.match(html, /<p[^>]* id="page"[^>]*>about<\/p>/);
    assert.match(html, /<a [^>]*href="\." class="here exact"[^>]*>this page/, 'the relative link resolves to the page it is on');

    // The browser's router has the base from Vite's `base` (here, setBase).
    router.setBase('/app/');
    const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
    document.body.innerHTML = body;
    internal.__resetHydrationData();
    const mismatches = [];
    const stop = core.hydrate(core.h(App, {}), document.body, { onHydrationError: (info) => mismatches.push(info) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(mismatches, []);
    assert.equal(document.getElementById('path').textContent, '/about/');
    assert.equal(router.route.path, '/about/');
    assert.equal(document.querySelector('a[href="."]').className, 'here exact');
    assert.equal(document.querySelector('a[href="team"]').className, '');
    stop();
  });
});
