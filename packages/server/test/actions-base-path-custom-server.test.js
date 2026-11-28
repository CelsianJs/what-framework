// A custom server's action endpoint below a base path, with no base set on
// the server (no setBase, and what-server kept external, where Vite's base
// is not defined): the action client and a <Form> post to the endpoint below
// their base ('/app/__what_action'), so that path names the base, and a path
// the action redirects to goes below it, in X-What-Redirect and in a no-JS
// post's 303 alike. Before, the server had no base: the action's
// redirect('/login') answered '/login', which the browser loaded outside
// the app.
//
// Its own file: setBase() is never called here, and what-router keeps the
// base it sets for the process.

import http from 'node:http';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getResponse } from 'what-core';
import { action, createActionHandler, fetchActionHandler, nodeActionMiddleware } from '../src/index.js';

action(async () => {
  getResponse().redirect('/login?next=x');
  return { ok: true };
}, { id: 'custom-base/login' });

const json = (url) => new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-what-action': 'custom-base/login' }, body: JSON.stringify({ args: [] }) });
const form = (url) => new Request(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: '_action=custom-base%2Flogin' });

describe('a custom server\'s action endpoint below a base, with no base set on the server', () => {
  it('fetchActionHandler answers a redirect below the base the endpoint is at', async () => {
    const handle = fetchActionHandler({ skipCsrf: true });
    assert.equal((await handle(json('http://site.test/app/__what_action'))).headers.get('x-what-redirect'), '/app/login?next=x');
    assert.equal((await handle(form('http://site.test/app/__what_action'))).headers.get('location'), '/app/login?next=x');
    assert.equal((await handle(json('http://site.test/__what_action'))).headers.get('x-what-redirect'), '/login?next=x');
  });

  it('nodeActionMiddleware does the same', async () => {
    const middleware = nodeActionMiddleware({ skipCsrf: true, basePath: '/shop/__what_action' });
    const server = http.createServer((req, res) => middleware(req, res, () => { res.writeHead(404); res.end(); }));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
      const res = await fetch(json(`http://127.0.0.1:${port}/shop/__what_action`));
      assert.equal(res.headers.get('x-what-redirect'), '/shop/login?next=x');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('a base that names another host is no base', async () => {
    const handle = createActionHandler({ skipCsrf: true });
    for (const url of ['http://site.test//evil.example/__what_action', 'http://site.test/\\evil.example/__what_action']) {
      const out = await handle({ method: 'POST', headers: { 'content-type': 'application/json', 'x-what-action': 'custom-base/login' }, body: { args: [] }, url });
      assert.equal(out.headers['x-what-redirect'], '/login?next=x', url);
    }
  });
});
