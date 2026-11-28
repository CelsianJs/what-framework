// The queries a page reads are on the page's path as the app writes it:
// without the base and without a trailing slash, as its route matches it.
// So invalidatePath('/users') (a server action's `revalidate: ['/users']`,
// the path the server's cache purges) refetches what the page at
// /app/users/ reads, and a navigation there goes on until the data its page
// reads has landed. Before, a query read in a page was on the address bar's
// path ('/app/users/'), which neither reached.
//
// A path's percent escapes are in one case there, as its route matches
// them: what a page at '/app/caf%c3%a9' reads is on '/caf%C3%A9', the path
// the URL parser writes for '/café'.
//
// Its own file: the router keeps module-scoped URL state and its base.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { withResolvers } from '../../../test-utils/with-resolvers.js';

const env = installDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/app/users/' });
window.scrollTo = () => {};

const { h, mount } = await import('what-core');
const { query, invalidatePath } = await import('what-core/data');
const { Router, navigate, route, setBase } = await import('../src/index.js');
setBase('/app');
after(() => {
  setBase('');
  env.cleanup();
});

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const users = [];
const feed = [];
function Users() {
  const list = query(['users'], () => {
    const call = withResolvers();
    users.push(call);
    return call.promise;
  });
  return h('p', null, () => (list() ?? []).join(','));
}
function Feed() {
  const items = query(['feed'], () => {
    const call = withResolvers();
    feed.push(call);
    return call.promise;
  });
  return h('ul', null, () => (items() ?? []).join(','));
}

const cafe = [];
function Cafe() {
  const menu = query(['menu'], () => {
    const call = withResolvers();
    cafe.push(call);
    return call.promise;
  });
  return h('p', null, () => (menu() ?? []).join(','));
}

const app = document.getElementById('app');
mount(h('div', null,
  h('i', null, () => (route.isNavigating ? 'busy ' : 'idle ')),
  h(Router, { routes: [{ path: '/users', component: Users }, { path: '/feed', component: Feed }, { path: '/café', component: Cafe }] })), app);

describe('the data a page reads below a base path', () => {
  it('is refetched by invalidatePath() of the page\'s path as the app writes it', async () => {
    await tick();
    users[0].resolve(['ada']);
    await tick();
    assert.equal(app.textContent, 'idle ada');
    const revalidated = invalidatePath('/users');
    await tick();
    assert.equal(users.length, 2, 'the query refetched');
    users[1].resolve(['ada', 'grace']);
    await revalidated;
    await tick();
    assert.equal(app.textContent, 'idle ada,grace');
  });

  it('holds a navigation there until it has landed', async () => {
    let done = false;
    const going = navigate('/feed/', { transition: false }).then(() => { done = true; });
    await tick(5);
    assert.equal(location.pathname, '/app/feed/');
    assert.equal(feed.length, 1);
    assert.equal(app.textContent.startsWith('busy'), true, 'the navigation goes on while the page\'s data loads');
    assert.equal(done, false);
    feed[0].resolve(['one']);
    await going;
    await tick();
    assert.equal(app.textContent, 'idle one');
  });
});

describe('the data a page reads at a URL that writes its escapes in lower case', () => {
  it('is on the path with its escapes in upper case', async () => {
    const going = navigate('/caf%c3%a9', { transition: false });
    await tick(5);
    assert.equal(cafe.length, 1);
    cafe[0].resolve(['tea']);
    await going;
    await tick();
    assert.equal(app.textContent, 'idle tea');
    const revalidated = invalidatePath(new URL('http://x/café').pathname);
    await tick();
    assert.equal(cafe.length, 2, 'the query refetched');
    cafe[1].resolve(['tea', 'cake']);
    await revalidated;
    await tick();
    assert.equal(app.textContent, 'idle tea,cake');
  });
});
