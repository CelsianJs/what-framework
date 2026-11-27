// A server action called from the page of an app served below a base path
// ('/app'), behind a proxy that forwards only '/app/*' to the app: the call
// posts to the action endpoint below the base, which the request handler's
// `basePath` serves, and a redirect the action makes is a URL of the app,
// which a page with no <Router> loads below the base. Before, the call posted
// to '/__what_action' at the root, which never reached the app.
//
// The actions are defined before the DOM is installed, so the server half
// registers them; called once it is, they post as a page's code does.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getResponse } from 'what-core';
import { installDOM } from '../../../test-utils/dom.js';
import { action, createRequestHandler } from '../src/index.js';

const ping = action(async (fields) => ({ pong: fields.n }), { id: 'base/ping' });
const leave = action(async () => {
  getResponse().redirect('/page#saved');
  return { ok: true };
}, { id: 'base/leave' });

let env;
let router;
const reached = [];
before(async () => {
  const handle = createRequestHandler({ routes: [], basePath: '/app', csrf: false });
  env = installDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://app.test/app/page' });
  globalThis.fetch = async (url, init) => {
    const target = new URL(url, location.href);
    reached.push(target.pathname);
    if (!target.pathname.startsWith('/app/')) return new Response('Not Found', { status: 404 });
    return handle(new Request(target, init));
  };
  router = await import('what-router');
  router.setBase('/app');
});
after(() => {
  router.setBase('');
  env.cleanup();
});

describe('a server action called below a base path', () => {
  it('posts to the action endpoint below the base', async () => {
    assert.deepEqual(await ping({ n: 1 }), { pong: 1 });
    assert.deepEqual(reached, ['/app/__what_action']);
  });

  it('follows its redirect below the base on a page with no Router', async () => {
    assert.deepEqual(await leave(), { ok: true });
    for (let i = 0; i < 20 && location.hash === ''; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(location.pathname + location.hash, '/app/page#saved');
  });
});
