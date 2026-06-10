// D2 (sprint/v0.11): CSRF on by default + plain-POST form fallback.
//
// Covers:
//   - createActionHandler form-encoded path (progressive enhancement):
//     303 redirect on success, CSRF from `_csrf` field, redirect safety.
//   - createRequestHandler default-on CSRF (double-submit cookie):
//     cookie + meta auto-provisioning, header validation, `csrf: false` opt-out.
//   - JSON + X-What-Action path unchanged for fetch clients.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { h } from 'what-core';
import { action } from '../src/actions.js';
import { createActionHandler } from '../src/action-handler.js';
import { createRequestHandler } from '../src/adapter/core.js';

// Server-side fixtures
const received = [];
action(async (data) => { received.push(data); return { ok: true, got: data }; }, { id: 'form-save' });
action(async (a, b) => ({ sum: a + b }), { id: 'csrf-sum' });

const TOKEN = 'tok-aaaa-bbbb-cccc';

function formHandle(extra = {}) {
  return createActionHandler({ getCsrfToken: () => TOKEN, ...extra });
}

function formReq({ fields = {}, headers = {}, query } = {}) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: fields,
    query,
  };
}

describe('createActionHandler — plain HTML form post fallback', () => {
  it('accepts a form-encoded POST without X-What-Action and redirects (303 PRG)', async () => {
    received.length = 0;
    const res = await formHandle()(formReq({
      fields: { _action: 'form-save', _csrf: TOKEN, _redirect: '/done', title: 'hello', tags: ['a', 'b'] },
    }));
    assert.equal(res.status, 303);
    assert.equal(res.headers.location, '/done');
    // Reserved fields stripped; data passed as a single object
    assert.deepEqual(received[0], { title: 'hello', tags: ['a', 'b'] });
  });

  it('falls back to the Referer path when no _redirect is given', async () => {
    const res = await formHandle()(formReq({
      fields: { _action: 'form-save', _csrf: TOKEN },
      headers: { referer: 'http://example.com/posts/new?draft=1' },
    }));
    assert.equal(res.status, 303);
    assert.equal(res.headers.location, '/posts/new?draft=1');
  });

  it('never open-redirects: protocol-relative and absolute _redirect fall back to /', async () => {
    for (const bad of ['//evil.com', 'https://evil.com', 'javascript:alert(1)']) {
      const res = await formHandle()(formReq({
        fields: { _action: 'form-save', _csrf: TOKEN, _redirect: bad },
      }));
      assert.equal(res.status, 303);
      assert.equal(res.headers.location, '/', `bad redirect ${bad} must fall back to /`);
    }
  });

  it('accepts the action name from the data-action field or ?action= query param', async () => {
    const viaField = await formHandle()(formReq({
      fields: { 'data-action': 'form-save', _csrf: TOKEN },
    }));
    assert.equal(viaField.status, 303);
    const viaQuery = await formHandle()(formReq({
      fields: { _csrf: TOKEN },
      query: { action: 'form-save' },
    }));
    assert.equal(viaQuery.status, 303);
  });

  it('400s when no action name is present anywhere', async () => {
    const res = await formHandle()(formReq({ fields: { _csrf: TOKEN } }));
    assert.equal(res.status, 400);
    assert.match(res.headers['content-type'], /text\/html/);
  });

  it('rejects a form post with a wrong _csrf token (403)', async () => {
    const res = await formHandle()(formReq({
      fields: { _action: 'form-save', _csrf: 'tok-XXXX-bbbb-cccc' },
    }));
    assert.equal(res.status, 403);
  });

  it('rejects a form post with no _csrf field at all (403)', async () => {
    const res = await formHandle()(formReq({ fields: { _action: 'form-save' } }));
    assert.equal(res.status, 403);
  });

  it('403s when CSRF is configured but the visitor has no session token', async () => {
    const handle = createActionHandler({ getCsrfToken: () => null });
    const res = await handle(formReq({ fields: { _action: 'form-save', _csrf: 'anything' } }));
    assert.equal(res.status, 403);
  });

  it('skipCsrf allows plain form posts without a token (explicit opt-out)', async () => {
    const handle = createActionHandler({ skipCsrf: true });
    const res = await handle(formReq({ fields: { _action: 'form-save', x: '1' } }));
    assert.equal(res.status, 303);
  });

  it('unknown action id -> 404 HTML page', async () => {
    const res = await formHandle()(formReq({ fields: { _action: 'nope', _csrf: TOKEN } }));
    assert.equal(res.status, 404);
    assert.match(res.headers['content-type'], /text\/html/);
  });

  it('JSON + header path is unchanged for fetch clients', async () => {
    const res = await formHandle()({
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-what-action': 'csrf-sum', 'x-csrf-token': TOKEN },
      body: { args: [2, 3] },
    });
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /application\/json/);
    assert.deepEqual(JSON.parse(res.body), { sum: 5 });
  });
});

// ---------------------------------------------------------------------------
// Adapter end-to-end: default-on CSRF (double-submit cookie)
// ---------------------------------------------------------------------------

const routes = [
  { path: '/', component: () => h('main', {}, 'home'), mode: 'server', page: { mode: 'server' } },
];

function getCsrfCookie(res) {
  const setCookie = res.headers.get('set-cookie') || '';
  const m = setCookie.match(/what-csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

describe('createRequestHandler — CSRF on by default', () => {
  it('provisions the token cookie and meta tag on a first HTML response', async () => {
    const handle = createRequestHandler({ routes });
    const res = await handle(new Request('http://x/'));
    assert.equal(res.status, 200);
    const token = getCsrfCookie(res);
    assert.ok(token, 'should Set-Cookie what-csrf');
    const setCookie = res.headers.get('set-cookie');
    assert.match(setCookie, /SameSite=Lax/);
    assert.ok(!/HttpOnly/i.test(setCookie), 'cookie must be JS-readable for the double-submit header');
    const html = await res.text();
    assert.ok(html.includes(`<meta name="what-csrf-token" content="${token}">`), 'meta tag embeds the same token');
  });

  it('does not re-issue the cookie when the visitor already has one', async () => {
    const handle = createRequestHandler({ routes });
    const res = await handle(new Request('http://x/', { headers: { cookie: `what-csrf=${TOKEN}` } }));
    assert.equal(res.headers.get('set-cookie'), null);
    const html = await res.text();
    assert.ok(html.includes(`content="${TOKEN}"`), 'existing token reused in the meta tag');
  });

  it('accepts a fetch action when X-CSRF-Token matches the cookie (default wiring, zero config)', async () => {
    const handle = createRequestHandler({ routes });
    const res = await handle(new Request('http://x/__what_action', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-what-action': 'csrf-sum',
        'x-csrf-token': TOKEN,
        cookie: `what-csrf=${TOKEN}`,
      },
      body: JSON.stringify({ args: [20, 22] }),
    }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { sum: 42 });
  });

  it('rejects a fetch action with a mismatched token (403)', async () => {
    const handle = createRequestHandler({ routes });
    const res = await handle(new Request('http://x/__what_action', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-what-action': 'csrf-sum',
        'x-csrf-token': 'tok-WRONG-bbbb-ccc',
        cookie: `what-csrf=${TOKEN}`,
      },
      body: JSON.stringify({ args: [1, 1] }),
    }));
    assert.equal(res.status, 403);
  });

  it('rejects a fetch action with no cookie at all (403, not 500)', async () => {
    const handle = createRequestHandler({ routes });
    const res = await handle(new Request('http://x/__what_action', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-what-action': 'csrf-sum', 'x-csrf-token': TOKEN },
      body: JSON.stringify({ args: [1, 1] }),
    }));
    assert.equal(res.status, 403);
  });

  it('accepts a plain HTML form post end-to-end (cookie + _csrf field -> 303)', async () => {
    const handle = createRequestHandler({ routes });
    const res = await handle(new Request('http://x/__what_action', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `what-csrf=${TOKEN}`,
        referer: 'http://x/contact',
      },
      body: new URLSearchParams({ _action: 'form-save', _csrf: TOKEN, name: 'kirby' }).toString(),
      redirect: 'manual',
    }));
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/contact');
  });

  it('rejects a plain HTML form post with a bad _csrf field (403)', async () => {
    const handle = createRequestHandler({ routes });
    const res = await handle(new Request('http://x/__what_action', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `what-csrf=${TOKEN}`,
      },
      body: new URLSearchParams({ _action: 'form-save', _csrf: 'tok-WRONG-bbbb-ccc' }).toString(),
    }));
    assert.equal(res.status, 403);
  });

  it('csrf: false opts out: no cookie issued, actions work without a token', async () => {
    const handle = createRequestHandler({ routes, csrf: false });
    const page = await handle(new Request('http://x/'));
    assert.equal(page.headers.get('set-cookie'), null);
    assert.ok(!(await page.text()).includes('what-csrf-token'));

    const act = await handle(new Request('http://x/__what_action', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-what-action': 'csrf-sum' },
      body: JSON.stringify({ args: [3, 4] }),
    }));
    assert.equal(act.status, 200);
    assert.deepEqual(await act.json(), { sum: 7 });
  });

  it('a custom actionHandler disables auto-provisioning (handler owns CSRF policy)', async () => {
    const handle = createRequestHandler({
      routes,
      actionHandler: createActionHandler({ skipCsrf: true }),
    });
    const page = await handle(new Request('http://x/'));
    assert.equal(page.headers.get('set-cookie'), null);
  });

  it('404 responses still provision the cookie so the next page can post', async () => {
    const handle = createRequestHandler({ routes });
    const res = await handle(new Request('http://x/missing'));
    assert.equal(res.status, 404);
    assert.ok(getCsrfCookie(res));
  });
});
