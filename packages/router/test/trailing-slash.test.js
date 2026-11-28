// A trailing slash on a URL is ignored when matching, except on the root:
// '/about/' shows the route written '/about', the way a static host serves
// about/index.html at '/about/' (GitHub Pages redirects '/about' there).
// Route state keeps the URL as the address bar has it. A static export of a
// page with a <Router> in it renders that page's route, and the page served
// at '/about/' hydrates onto it without a mismatch.
//
// Its own file: the router keeps module-scoped URL state, and this one starts
// at /about/.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installDOM } from '../../../test-utils/dom.js';

let env;
let core;
let internal;
let router;
let exportStatic;
before(async () => {
  env = installDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { url: 'http://app.test/about/' });
  window.scrollTo = () => {};
  core = await import('what-core');
  internal = await import('what-core/internal');
  router = await import('../src/index.js');
  ({ exportStatic } = await import('../../server/src/node.js'));
});
after(() => env.cleanup());

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
async function flush() {
  for (let i = 0; i < 5; i++) await tick();
}

describe('matchRoute and a trailing slash', () => {
  it('ignores a trailing slash on the URL', () => {
    const { matchRoute } = router;
    const routes = [{ path: '/' }, { path: '/about' }, { path: '/users/:id' }, { path: '/docs/*' }];
    assert.equal(matchRoute('/about/', routes)?.route.path, '/about');
    assert.deepEqual(matchRoute('/users/7/', routes)?.params, { id: '7' });
    assert.deepEqual(matchRoute('/docs/a/b/', routes)?.params, { rest: 'a/b' });
    assert.equal(matchRoute('/', routes)?.route.path, '/');
    assert.equal(matchRoute('/docs/', routes), null, 'a catch-all still needs a segment');
  });

  it('ignores one on the route written with it', () => {
    const { matchRoute } = router;
    const routes = [{ path: '/guide/' }];
    assert.equal(matchRoute('/guide', routes)?.route.path, '/guide/');
    assert.equal(matchRoute('/guide/', routes)?.route.path, '/guide/');
  });
});

describe('a static export of a page with a Router', () => {
  it('renders the page\'s route, which the browser at /about/ hydrates without a mismatch', async () => {
    const { h } = core;
    const routes = [
      { path: '/', component: () => h('p', null, 'home') },
      { path: '/about', component: () => h('h1', null, 'about') },
    ];
    const App = () => h(router.Router, { routes, fallback: () => h('p', null, 'not found') });
    const outDir = await mkdtemp(join(tmpdir(), 'what-trailing-slash-'));
    try {
      await exportStatic({ routes: routes.map((r) => ({ path: r.path, mode: 'static', component: App })), outDir });
      const html = await readFile(join(outDir, 'about', 'index.html'), 'utf8');
      const body = html.match(/<body>([\s\S]*?)<script/)[1];
      assert.match(body, /<h1[^>]*>about<\/h1>/);
      assert.doesNotMatch(body, /home|not found/);

      document.body.innerHTML = `<div id="app">${body}</div>`;
      internal.__resetHydrationData();
      const heading = document.querySelector('h1');
      const mismatches = [];
      const stop = core.hydrate(h(App, {}), document.getElementById('app'), { onHydrationError: (info) => mismatches.push(info) });
      await tick();
      assert.deepEqual(mismatches, []);
      assert.equal(document.querySelector('h1'), heading, 'the exported heading is adopted');
      assert.equal(document.getElementById('app').textContent, 'about');
      stop();
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});

describe('a Router at a URL with a trailing slash', () => {
  it('shows the route, keeps the URL as the address bar has it, and its links are active', async () => {
    const { h, mount } = core;
    const { Router, Link, route } = router;
    const routes = [
      { path: '/', component: () => h('p', null, 'home') },
      { path: '/about', component: () => h('h1', null, 'about') },
      { path: '/docs', component: () => h('h1', null, 'docs') },
      { path: '/docs/:page', component: ({ params }) => h('h1', null, 'doc ', params.page) },
    ];
    const Shell = ({ children }) => h('div', null,
      h('nav', null,
        h(Link, { href: '/about', id: 'about' }, 'about'),
        h(Link, { href: '/docs/', id: 'docs-slash' }, 'docs'),
        h(Link, { href: '/docs', id: 'docs' }, 'docs'),
      ),
      h('output', null, () => route.path),
      children);
    const app = document.getElementById('app');
    const unmount = mount(h(Router, { routes, globalLayout: Shell, fallback: () => h('p', null, 'not found') }), app);
    await flush();
    const cls = (id) => document.getElementById(id).getAttribute('class');
    assert.equal(app.querySelector('h1')?.textContent, 'about');
    assert.equal(app.querySelector('output').textContent, '/about/');
    assert.equal(cls('about'), 'active exact-active');

    await router.navigate('/docs/intro', { transition: false });
    await flush();
    assert.equal(app.querySelector('h1')?.textContent, 'doc intro');
    assert.equal(cls('docs-slash'), 'active', '/docs/ is active below it');
    assert.equal(cls('docs'), 'active');

    await router.navigate('/docs', { transition: false });
    await flush();
    assert.equal(cls('docs-slash'), 'active exact-active', '/docs/ is /docs');

    await router.navigate('/docs/', { transition: false });
    await flush();
    assert.equal(app.querySelector('h1')?.textContent, 'docs');
    assert.equal(cls('docs'), 'active exact-active', '/docs is /docs/');
    unmount();
  });
});
