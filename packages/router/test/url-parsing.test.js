// The URLs a router reads on a server, from a request or a prop, are
// untrusted text, and none of them can make a render throw: a URL the parser
// rejects is the root, and a path that looks like an authority
// (`//other.test/x`) is the path the request named, never another host's
// `/x`. A relative <Link> resolves against the URL the render shows, as the
// browser resolves it against the address bar, so its active class is the
// same on both sides.
//
// No DOM here: the router is on the server.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { h } = await import('what-core');
const { renderToString } = await import('../../server/src/index.js');
const { Router, Link, route } = await import('../src/index.js');

const Page = () => h('main', null, h('p', { id: 'at' }, () => `${route.path}|${route.query.q ?? ''}`));
const routes = [
  { path: '/', component: Page },
  { path: '/docs/:name', component: () => h('nav', null, h(Link, { href: 'setup', id: 'rel' }, 'Setup'), h(Link, { href: '/docs/setup', id: 'abs' }, 'Abs')) },
  { path: '/café', component: () => h('nav', null, h(Link, { href: '/café', id: 'cafe' }, 'Café')) },
  { path: '*', component: () => h('p', { id: 'at' }, () => `missing ${route.path}`) },
];
const render = (url) => renderToString(h(Router, { routes, url }));

describe('a server <Router> reads any URL without throwing', () => {
  it('a URL the parser rejects renders the root', async () => {
    for (const url of ['http://[', 'http://', 'https://%zz.example']) {
      assert.match(await render(url), /<p id="at"[^>]*>(?:<!--[^>]*-->)*\/\|/, url);
    }
  });

  it('a route written with characters the URL percent-encodes shows at its URL, and its link is active', async () => {
    for (const url of ['/café', '/caf%C3%A9']) {
      assert.match(await render(url), /<a [^>]*href="\/café" class="active exact-active"[^>]*>Café/, url);
    }
  });

  // Its link is active there too: the link's path and the URL's are compared
  // with their escapes in one case, as the route was matched. Before, the
  // route showed and the link to it was not active.
  it('a route written with characters the URL percent-encodes shows at a URL that writes its escapes in lower case, and its link is active', async () => {
    assert.match(await render('/caf%c3%a9'), /<nav><a [^>]*href="\/café" class="active exact-active"[^>]*>Café/);
  });

  it('a path that looks like an authority is that path', async () => {
    assert.match(await render('//'), /missing \/\//);
    assert.match(await render('//other.test/x?q=1'), /missing \/\/other\.test\/x/);
    assert.match(await render('//[::1'), /missing \/\/\[::1/);
  });

  it('a request whose URL is a path that looks like an authority', async () => {
    const { renderDocument } = await import('../../server/src/index.js');
    const html = await renderDocument({ default: () => h(Router, { routes }) }, { request: { url: '//other.test/x' } });
    assert.match(html, /missing \/\/other\.test\/x/);
  });
});

describe('a relative <Link> on the server', () => {
  it('resolves against the URL the render shows, and is active there as in the browser', async () => {
    const html = await render('/docs/setup');
    assert.match(html, /<a href="setup" class="active exact-active" id="rel">/);
    assert.match(html, /<a href="\/docs\/setup" class="active exact-active" id="abs">/);
    assert.doesNotMatch(await render('/docs/other'), /<a href="setup" class="active/);
  });

  it('a Link to an absolute URL the parser rejects renders blocked', async () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      for (const href of ['http://[', 'https://%zz.example', 'http://a:b:c/']) {
        const html = await renderToString(h('p', null, h(Link, { href }, 'site'), ' footer'));
        assert.match(html, /<a href="about:blank">site<\/a> footer/, href);
      }
    } finally {
      console.warn = warn;
    }
  });
});
