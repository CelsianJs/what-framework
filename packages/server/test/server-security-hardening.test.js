// Track C (sprint/v0.11): server security hardening.
//
// Covers three findings:
//   1. Open redirect via backslash smuggling in the form `_redirect` field.
//   2. Action body cap (MAX_BODY_BYTES) enforced on the Web-Fetch / adapter
//      path, not just the Node connect/express middleware -> 413.
//   3. CSRF double-submit cookie marked Secure on HTTPS (kept off for plain
//      http localhost dev).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { h } from 'what-core';
import { action } from '../src/actions.js';
import {
  createActionHandler,
  fetchActionHandler,
  readFetchBodyCapped,
} from '../src/action-handler.js';
import { createRequestHandler } from '../src/adapter/core.js';

const TOKEN = 'tok-aaaa-bbbb-cccc';

// Server-side fixtures (ids unique to this file to avoid cross-test clashes).
action(async (data) => ({ ok: true, got: data }), { id: 'sec-form-save' });
action(async (a, b) => ({ sum: a + b }), { id: 'sec-sum' });

function formReq({ fields = {}, headers = {}, query } = {}) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: fields,
    query,
  };
}

// ---------------------------------------------------------------------------
// Finding 1: open redirect via backslash in _redirect
// ---------------------------------------------------------------------------

describe('safeRedirectTarget — open redirect hardening', () => {
  const handle = createActionHandler({ getCsrfToken: () => TOKEN });

  async function redirectFor(redirect) {
    const res = await handle(formReq({
      fields: { _action: 'sec-form-save', _csrf: TOKEN, _redirect: redirect },
    }));
    assert.equal(res.status, 303);
    return res.headers.location;
  }

  it('rejects slash-backslash smuggling (/\\evil.com -> /)', async () => {
    // Without canonicalization, new URL('/\\evil.com','http://localhost')
    // resolves to http://evil.com — a classic open redirect.
    assert.equal(await redirectFor('/\\evil.com'), '/');
  });

  it('rejects double-backslash (/\\\\evil.com -> /)', async () => {
    assert.equal(await redirectFor('/\\\\evil.com'), '/');
  });

  it('rejects protocol-relative (//evil.com -> /)', async () => {
    assert.equal(await redirectFor('//evil.com'), '/');
  });

  it('rejects absolute https URL (https://evil.com -> /)', async () => {
    assert.equal(await redirectFor('https://evil.com'), '/');
  });

  it('rejects any backslash anywhere in the path (/blog\\x -> /)', async () => {
    assert.equal(await redirectFor('/blog\\x'), '/');
  });

  it('accepts a valid same-origin local path (/blog/x kept, canonicalized)', async () => {
    assert.equal(await redirectFor('/blog/x'), '/blog/x');
  });

  it('preserves query string on a valid path (/blog/x?p=1)', async () => {
    assert.equal(await redirectFor('/blog/x?p=1'), '/blog/x?p=1');
  });
});

// ---------------------------------------------------------------------------
// Finding 2: body cap on the Web-Fetch / adapter path
// ---------------------------------------------------------------------------

describe('readFetchBodyCapped — DoS body cap', () => {
  it('flags an over-cap body via streaming (spoofed/absent Content-Length)', async () => {
    const big = 'x'.repeat(1024 * 1024 + 16); // > 1 MB
    // Build a Request whose stream exceeds the cap; do not set Content-Length.
    const req = new Request('http://x/__what_action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: big,
    });
    const read = await readFetchBodyCapped(req);
    assert.equal(read.tooLarge, true);
  });

  it('flags an over-cap body via Content-Length fast-path', async () => {
    const req = new Request('http://x/__what_action', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(1024 * 1024 + 1) },
      body: 'small',
    });
    const read = await readFetchBodyCapped(req);
    assert.equal(read.tooLarge, true);
  });

  it('accepts an under-cap body and returns the raw text', async () => {
    const req = new Request('http://x/__what_action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ args: [1, 2] }),
    });
    const read = await readFetchBodyCapped(req);
    assert.equal(read.tooLarge, undefined);
    assert.deepEqual(JSON.parse(read.raw), { args: [1, 2] });
  });
});

describe('fetchActionHandler — returns 413 on over-cap body', () => {
  it('413s a > 1 MB action body', async () => {
    const handler = fetchActionHandler({ skipCsrf: true });
    const big = 'x'.repeat(1024 * 1024 + 16);
    const res = await handler(new Request('http://x/__what_action', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-what-action': 'sec-sum' },
      body: big,
    }));
    assert.equal(res.status, 413);
  });
});

describe('createRequestHandler — 413 on over-cap action body (Vercel/CF/Node-adapter path)', () => {
  const routes = [
    { path: '/', component: () => h('main', {}, 'home'), mode: 'server', page: { mode: 'server' } },
  ];

  it('413s an over-cap fetch action body before dispatch', async () => {
    const handle = createRequestHandler({ routes, csrf: false });
    const big = 'x'.repeat(1024 * 1024 + 16);
    const res = await handle(new Request('http://x/__what_action', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-what-action': 'sec-sum' },
      body: big,
    }));
    assert.equal(res.status, 413);
  });

  it('still dispatches a normal-size action (under cap)', async () => {
    const handle = createRequestHandler({ routes, csrf: false });
    const res = await handle(new Request('http://x/__what_action', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-what-action': 'sec-sum' },
      body: JSON.stringify({ args: [40, 2] }),
    }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { sum: 42 });
  });
});

// ---------------------------------------------------------------------------
// Finding 3: CSRF cookie Secure flag
// ---------------------------------------------------------------------------

describe('createRequestHandler — CSRF cookie Secure flag', () => {
  const routes = [
    { path: '/', component: () => h('main', {}, 'home'), mode: 'server', page: { mode: 'server' } },
  ];

  it('omits Secure for plain-http localhost dev (cookie still sets)', async () => {
    // Force dev semantics regardless of the ambient NODE_ENV.
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const handle = createRequestHandler({ routes });
      const res = await handle(new Request('http://x/'));
      const setCookie = res.headers.get('set-cookie');
      assert.ok(setCookie, 'cookie must still be set in dev');
      assert.match(setCookie, /SameSite=Lax/);
      assert.ok(!/;\s*Secure/i.test(setCookie), 'no Secure on plain http');
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
    }
  });

  it('adds Secure when the request URL is https', async () => {
    const handle = createRequestHandler({ routes });
    const res = await handle(new Request('https://x/'));
    const setCookie = res.headers.get('set-cookie');
    assert.match(setCookie, /;\s*Secure/i);
  });

  it('adds Secure behind a proxy via x-forwarded-proto=https', async () => {
    const handle = createRequestHandler({ routes });
    const res = await handle(new Request('http://x/', {
      headers: { 'x-forwarded-proto': 'https' },
    }));
    const setCookie = res.headers.get('set-cookie');
    assert.match(setCookie, /;\s*Secure/i);
  });
});
