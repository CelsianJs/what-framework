// A relative redirect target ('login', '../home', '?tab=2') resolves against
// the URL the server render shows, as navigate() resolves one there and as
// the browser resolves it on the client: a middleware verdict and redirect()
// in a component answer with the resolved path. Before, the response refused
// the unresolved target and redirected to '/'.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { h } from 'what-core';
import { Router, redirect, navigate } from '../src/index.js';
import { createResponse, renderToStringAsync } from '../../server/src/index.js';

const routes = [
  { path: '/account/settings', middleware: [() => 'login?next=settings'], component: () => h('p', null, 'settings') },
  { path: '/account/old', component: () => redirect('../home') },
  { path: '/account/tab', component: () => redirect('?tab=2') },
  { path: '/account/go', component: () => { navigate('login'); return null; } },
];

async function locationOf(url) {
  const response = createResponse();
  await renderToStringAsync(h(Router, { routes }), { request: new Request('http://app.test' + url), response });
  return response.location;
}

describe('a relative redirect in a server render', () => {
  it('resolves against the URL the render shows', async () => {
    assert.equal(await locationOf('/account/settings'), '/account/login?next=settings');
    assert.equal(await locationOf('/account/old'), '/home');
    assert.equal(await locationOf('/account/tab'), '/account/tab?tab=2');
    assert.equal(await locationOf('/account/go'), '/account/login');
  });
});

// Below a base, a relative target can resolve outside it ('../../x' at
// '/app/a/b' is '/x'): the browser goes there, and so does the client's
// navigate() (location.assign) and a click on a <Link> to it. The server
// answers the same Location, a path of this origin; one that would name
// another host once it is a Location ('../..//evil.example' resolves to the
// path '//evil.example') is refused and goes to the app's root, with
// ERR_SSR_UNSAFE_REDIRECT naming that root. Before, every target outside the
// base was refused on the server and the page went to '/app/'.
describe('a relative redirect in a server render below a base', () => {
  const below = [
    { path: '/a/b', middleware: [() => '../../x?y=1#z'], component: () => h('p', null, 'b') },
    { path: '/a/c', component: () => redirect('../x') },
    { path: '/a/d', component: () => { navigate('/%2e%2e/out'); return null; } },
    { path: '/a/e', component: () => redirect('../..//evil.example/x') },
    { path: '/a/f', component: () => { navigate('/ /x'); return null; } },
  ];

  async function answer(url) {
    const response = createResponse('/app');
    const warnings = [];
    const warn = console.warn;
    console.warn = (message) => warnings.push(String(message));
    try {
      await renderToStringAsync(h(Router, { routes: below }), { request: new Request('http://app.test/app' + url), response });
    } finally {
      console.warn = warn;
    }
    return { location: response.location, warnings };
  }

  it('answers the path the browser goes to, outside the base or not', async () => {
    assert.deepEqual(await answer('/a/b'), { location: '/x?y=1#z', warnings: [] });
    assert.deepEqual(await answer('/a/c'), { location: '/app/x', warnings: [] });
    assert.deepEqual(await answer('/a/d'), { location: '/out', warnings: [] });
  });

  it('refuses a path that would name another host, and one the browser refuses, naming the root it goes to', async () => {
    for (const url of ['/a/e', '/a/f']) {
      const { location, warnings } = await answer(url);
      assert.equal(location, '/app/', url);
      assert.equal(warnings.length, 1, url);
      assert.match(warnings[0], /redirecting to "\/app\/" instead.*ERR_SSR_UNSAFE_REDIRECT/, url);
    }
  });
});
