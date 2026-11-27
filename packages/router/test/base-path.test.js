// An app served below a base path (Vite's `base: '/app/'`, GitHub Pages, a
// reverse proxy) routes below it: its routes match the URL without the base,
// a <Link href="/x"> renders and goes to /app/x, navigate('/x') goes to
// /app/x, and route state (route.url, route.path, the params, useRoute(),
// active links, what middleware and the navigation hooks see) holds the URL
// without the base. A URL outside the base is not routed: no route shows it,
// a catch-all included, and navigate() leaves it to the browser. The server's
// side is base-path-server.test.js; Vite's base reaching the router is
// base-path-vite.test.js.
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

const { window } = installDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/app/' });
window.scrollTo = () => {};

// jsdom's Location cannot be stubbed, and it does not implement leaving the
// document: the global the router reads records it instead.
const left = [];
const real = window.location;
const recording = {
  assign: (url) => left.push(['assign', String(url)]),
  replace: (url) => left.push(['replace', String(url)]),
};
for (const key of ['href', 'origin', 'pathname', 'search', 'hash']) {
  Object.defineProperty(recording, key, { get: () => real[key] });
}
Object.defineProperty(globalThis, 'location', { configurable: true, value: recording });

const { h } = await import('../../core/src/h.js');
const { mount } = await import('../../core/src/dom.js');
const { Router, Link, route, navigate, setBase, useRoute, beforeNavigate, afterNavigate } = await import('../src/index.js');

async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

const seen = [];
const routes = [
  { path: '/', component: () => h('p', { id: 'page' }, 'home') },
  { path: '/about', component: () => h('p', { id: 'page' }, 'about') },
  {
    path: '/users/:id',
    middleware: [(ctx) => { seen.push(['middleware', ctx.path, ctx.url]); }],
    preload: ({ url, params }) => { seen.push(['preload', url, params.id]); },
    component: ({ params }) => h('p', { id: 'page' }, 'user ' + params.id),
  },
  { path: '/private', middleware: [() => '/about'], component: () => h('p', { id: 'page' }, 'private') },
  { path: '*', component: () => h('p', { id: 'page' }, 'catch-all') },
];
const Fallback = () => h('p', { id: 'page' }, 'not found');
const nav = [
  { href: '/', id: 'home' },
  { href: '/about', id: 'about' },
  { href: '/users', id: 'users' },
  { href: '8', id: 'relative' },
  { href: 'http://localhost/elsewhere', id: 'outside' },
  { href: '#x', id: 'fragment' },
  { href: '?q=2', id: 'query' },
];
const page = () => document.getElementById('page').textContent;
const link = (id) => document.getElementById(id);

let path;
before(async () => {
  setBase('/app/');
  const App = () => {
    path = useRoute().path;
    return h('div', null, h('nav', null, ...nav.map((props) => h(Link, props, props.id))), h(Router, { routes, fallback: Fallback }));
  };
  mount(h(App, {}), document.getElementById('app'));
  await flush();
});

beforeEach(() => {
  left.length = 0;
  seen.length = 0;
});

function click(id) {
  const event = new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  link(id).dispatchEvent(event);
  return event;
}

describe('an app served below a base path', () => {
  it('matches its routes below the base, and route state holds the URL without it', () => {
    assert.equal(location.pathname, '/app/');
    assert.equal(page(), 'home');
    assert.equal(route.url, '/');
    assert.equal(route.path, '/');
    assert.equal(path(), '/');
  });

  it('renders a <Link> to a path of the app below the base, and leaves a relative one as written', () => {
    assert.equal(link('home').getAttribute('href'), '/app/');
    assert.equal(link('about').getAttribute('href'), '/app/about');
    assert.equal(link('relative').getAttribute('href'), '8');
    assert.equal(link('outside').getAttribute('href'), 'http://localhost/elsewhere');
  });

  it('prefetches a link to a path of the app below the base', () => {
    link('about').dispatchEvent(new window.MouseEvent('mouseenter'));
    const hrefs = [...document.head.querySelectorAll('link[rel="prefetch"]')].map((el) => el.getAttribute('href'));
    assert.deepEqual(hrefs, ['/app/about']);
  });

  it('goes below the base on a click, and marks the active links by the path without it', async () => {
    assert.equal(click('about').defaultPrevented, true);
    await flush();
    assert.equal(location.pathname, '/app/about');
    assert.equal(route.path, '/about');
    assert.equal(page(), 'about');
    assert.equal(link('about').className, 'active exact-active');
    assert.equal(link('home').className, '');
  });

  it('navigate() goes below the base; the route, its middleware, preload and hooks see the URL without it', async () => {
    const hooks = [];
    const stops = [beforeNavigate((to, from) => { hooks.push(['before', to, from]); }), afterNavigate((to, from) => { hooks.push(['after', to, from]); })];
    try {
      await navigate('/users/7?tab=a#top', { transition: false });
    } finally {
      for (const stop of stops) stop();
    }
    await flush();
    assert.equal(location.pathname + location.search + location.hash, '/app/users/7?tab=a#top');
    assert.equal(route.url, '/users/7?tab=a#top');
    assert.equal(route.path, '/users/7');
    assert.deepEqual({ ...route.params }, { id: '7' });
    assert.deepEqual({ ...route.query }, { tab: 'a' });
    assert.equal(path(), '/users/7');
    assert.equal(page(), 'user 7');
    assert.equal(link('users').className, 'active');
    assert.deepEqual(seen, [['middleware', '/users/7', '/users/7?tab=a#top'], ['preload', '/users/7?tab=a#top', '7']]);
    assert.deepEqual(hooks, [['before', '/users/7?tab=a#top', '/about'], ['after', '/users/7?tab=a#top', '/about']]);
  });

  it('resolves a relative link against the URL on screen, below the base', async () => {
    assert.equal(click('relative').defaultPrevented, true);
    await flush();
    assert.equal(location.pathname, '/app/users/8');
    assert.equal(page(), 'user 8');
  });

  it('follows back and forward below the base', async () => {
    history.back();
    await flush();
    assert.equal(location.pathname, '/app/users/7');
    assert.equal(route.path, '/users/7');
    assert.equal(page(), 'user 7');
    history.forward();
    await flush();
    assert.equal(route.path, '/users/8');
  });

  it('redirects below the base', async () => {
    await navigate('/private', { transition: false });
    await flush();
    assert.equal(location.pathname, '/app/about');
    assert.equal(page(), 'about');
  });

  it('leaves a URL of this origin outside the base to the browser', async () => {
    await navigate('http://localhost/elsewhere?x=1');
    await navigate('http://localhost/application', { replace: true });
    assert.deepEqual(left, [['assign', 'http://localhost/elsewhere?x=1'], ['replace', 'http://localhost/application']]);
    // jsdom reports the document navigation it does not implement.
    const realError = console.error;
    console.error = () => {};
    try {
      assert.equal(click('outside').defaultPrevented, false);
    } finally {
      console.error = realError;
    }
    await flush();
    assert.equal(route.path, '/about', 'the route state stays');
  });

  it('routes no URL outside the base, a catch-all included', async () => {
    history.replaceState(null, '', '/application/users/1');
    setBase('/app');
    await flush();
    assert.equal(route.url, '');
    assert.equal(route.path, '');
    assert.equal(page(), 'not found');
    assert.equal(link('about').className, '');
  });

  it('shows the base itself, with or without its slash, as the root', async () => {
    history.replaceState(null, '', '/app?from=bare');
    setBase('/app/');
    await flush();
    assert.equal(route.url, '/?from=bare');
    assert.equal(page(), 'home');
  });

  it('takes a base as Vite writes it or without either slash, and no base from one that is not a path', async () => {
    history.replaceState(null, '', '/app/about');
    for (const [base, url] of [['/app/', '/about'], ['/app', '/about'], ['app', '/about'], ['app/', '/about'], ['/app//', '/about'], ['/', '/app/about'], ['./', '/app/about'], ['.', '/app/about'], ['', '/app/about'], ['https://cdn.example/app/', '/app/about'], ['//cdn.example/app/', '/app/about'], ['/\\cdn.example/app/', '/app/about'], [undefined, '/app/about']]) {
      setBase(base);
      assert.equal(route.url, url, String(base));
    }
    setBase('/app/');
    await flush();
    assert.equal(page(), 'about');
  });

  // The browser keeps the path of the page for a '#x' or '?q' reference, so
  // relative URLs resolve on the new entry as they did before it.
  it('keeps the path the address bar shows for a fragment or query navigation at the base itself', async () => {
    const shown = () => location.pathname + location.search + location.hash;
    for (const [bar, to, written, url] of [
      ['/app', '#x', '/app#x', '/#x'],
      ['/app', '?q=1', '/app?q=1', '/?q=1'],
      ['/app?q=1', '#y', '/app?q=1#y', '/?q=1#y'],
      ['/app/', '#x', '/app/#x', '/#x'],
      ['/app/', '?q=1', '/app/?q=1', '/?q=1'],
      ['/app', '/#x', '/app/#x', '/#x'],
    ]) {
      history.replaceState(null, '', bar);
      setBase('/app/');
      await navigate(to, { transition: false });
      await flush();
      assert.equal(shown(), written, `${to} at ${bar}`);
      assert.equal(route.url, url, `${to} at ${bar}`);
      assert.equal(page(), 'home');
    }
    for (const [id, written] of [['fragment', '/app#x'], ['query', '/app?q=2']]) {
      history.replaceState(null, '', '/app');
      setBase('/app/');
      await flush();
      assert.equal(click(id).defaultPrevented, true);
      await flush();
      assert.equal(shown(), written, id);
      assert.equal(page(), 'home');
    }
  });
});
