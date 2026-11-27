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
