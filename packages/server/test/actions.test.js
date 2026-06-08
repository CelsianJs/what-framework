// Served server actions (Phase 3). Wires the missing /__what_action HTTP path:
// createActionHandler (framework-agnostic core) + Node middleware + fetch handler.
// Also the first real coverage of actions.js round-trip + CSRF.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { action, handleActionRequest, getRegisteredActions } from '../src/actions.js';
import {
  createActionHandler,
  nodeActionMiddleware,
  fetchActionHandler,
} from '../src/action-handler.js';

// Register fixtures once (server-side registration: typeof window === 'undefined').
action(async (a, b) => ({ sum: a + b }), { id: 'sum' });
action(async () => { throw new Error('SECRET internal detail'); }, { id: 'boom' });

function mockReq(method, url, headers, bodyStr) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = headers || {};
  queueMicrotask(() => {
    if (bodyStr) req.emit('data', Buffer.from(bodyStr));
    req.emit('end');
  });
  return req;
}
function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    ended: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    writeHead(s, h) { this.statusCode = s; if (h) for (const k in h) this.headers[k.toLowerCase()] = h[k]; return this; },
    end(b) { this.body = b || ''; this.ended = true; },
  };
}

describe('actions registry + handleActionRequest', () => {
  it('registers actions server-side', () => {
    assert.ok(getRegisteredActions().includes('sum'));
  });

  it('round-trips a registered action (skipCsrf)', async () => {
    const r = await handleActionRequest({ headers: {} }, 'sum', [2, 3], { skipCsrf: true });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { sum: 5 });
  });

  it('unknown action id -> 404', async () => {
    const r = await handleActionRequest({ headers: {} }, 'nope', [], { skipCsrf: true });
    assert.equal(r.status, 404);
  });

  it('non-array args -> 400 (prototype-pollution guard)', async () => {
    const r = await handleActionRequest({ headers: {} }, 'sum', { 0: 1 }, { skipCsrf: true });
    assert.equal(r.status, 400);
  });

  it('masks thrown errors as a generic 500', async () => {
    const r = await handleActionRequest({ headers: {} }, 'boom', [], { skipCsrf: true });
    assert.equal(r.status, 500);
    assert.equal(r.body.message, 'Action failed');
    assert.ok(!JSON.stringify(r.body).includes('SECRET'));
  });
});

describe('createActionHandler (core)', () => {
  it('dispatches by X-What-Action header and returns JSON', async () => {
    const handle = createActionHandler({ skipCsrf: true });
    const res = await handle({ method: 'POST', headers: { 'x-what-action': 'sum' }, body: { args: [10, 5] } });
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'] || res.headers['Content-Type'], /application\/json/);
    assert.deepEqual(JSON.parse(res.body), { sum: 15 });
  });

  it('rejects non-POST with 405', async () => {
    const handle = createActionHandler({ skipCsrf: true });
    const res = await handle({ method: 'GET', headers: {}, body: undefined });
    assert.equal(res.status, 405);
  });

  it('missing X-What-Action header -> 400', async () => {
    const handle = createActionHandler({ skipCsrf: true });
    const res = await handle({ method: 'POST', headers: {}, body: { args: [] } });
    assert.equal(res.status, 400);
  });

  it('accepts a valid CSRF token', async () => {
    const token = 'csrf-token-aaaa';
    const handle = createActionHandler({ getCsrfToken: () => token });
    const res = await handle({
      method: 'POST',
      headers: { 'x-what-action': 'sum', 'x-csrf-token': token },
      body: { args: [1, 1] },
    });
    assert.equal(res.status, 200);
  });

  it('rejects an invalid CSRF token with 403', async () => {
    const handle = createActionHandler({ getCsrfToken: () => 'csrf-token-aaaa' });
    const res = await handle({
      method: 'POST',
      headers: { 'x-what-action': 'sum', 'x-csrf-token': 'csrf-token-bbbb' },
      body: { args: [1, 1] },
    });
    assert.equal(res.status, 403);
  });

  it('fails closed (500) when CSRF is required but no session token is configured', async () => {
    const handle = createActionHandler({ getCsrfToken: () => undefined });
    const res = await handle({
      method: 'POST',
      headers: { 'x-what-action': 'sum', 'x-csrf-token': 'whatever' },
      body: { args: [1, 1] },
    });
    assert.equal(res.status, 500);
  });
});

describe('nodeActionMiddleware', () => {
  it('handles a POST to /__what_action end-to-end', async () => {
    const mw = nodeActionMiddleware({ skipCsrf: true });
    const req = mockReq('POST', '/__what_action', { 'x-what-action': 'sum' }, JSON.stringify({ args: [4, 5] }));
    const res = mockRes();
    await mw(req, res, () => { throw new Error('should not call next'); });
    assert.ok(res.ended);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { sum: 9 });
  });

  it('passes non-matching requests through to next()', async () => {
    const mw = nodeActionMiddleware({ skipCsrf: true });
    let nexted = false;
    await mw(mockReq('GET', '/something-else', {}), mockRes(), () => { nexted = true; });
    assert.ok(nexted);
  });
});

describe('fetchActionHandler', () => {
  it('handles a Request and returns a Response', async () => {
    const fh = fetchActionHandler({ skipCsrf: true });
    const request = new Request('http://x/__what_action', {
      method: 'POST',
      headers: { 'x-what-action': 'sum', 'content-type': 'application/json' },
      body: JSON.stringify({ args: [6, 7] }),
    });
    const response = await fh(request);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { sum: 13 });
  });
});
