// Node adapter integration (Phase 7): a real http.Server + real fetch, and a
// concurrent-request isolation check (loader/head must not bleed across reqs).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { h, Head } from 'what-core';
import { createServer } from '../src/adapter/node.js';

const routes = [
  {
    path: '/a',
    component: ({ loaderData }) => h('main', {}, h(Head, { title: 'A' }), `data:${loaderData.who}`),
    loader: async () => { await new Promise((r) => setTimeout(r, 15)); return { who: 'alpha' }; },
    mode: 'server', page: { mode: 'server' },
  },
  {
    path: '/b',
    component: ({ loaderData }) => h('main', {}, h(Head, { title: 'B' }), `data:${loaderData.who}`),
    loader: async () => { await new Promise((r) => setTimeout(r, 5)); return { who: 'bravo' }; },
    mode: 'server', page: { mode: 'server' },
  },
];

let server, base;
before(async () => {
  server = createServer({ routes });
  await new Promise((res) => server.listen(0, res));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

describe('Node adapter', () => {
  it('serves a rendered document over HTTP', async () => {
    const res = await fetch(`${base}/a`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<!DOCTYPE html>/i);
    assert.match(html, /data:alpha/);
    assert.match(html, /<title>A<\/title>/);
  });

  it('404s unknown routes', async () => {
    const res = await fetch(`${base}/missing`);
    assert.equal(res.status, 404);
  });

  it('does not bleed loader/head state across concurrent requests', async () => {
    // /b resolves faster than /a — if context leaked, /a could pick up B's data.
    const [ra, rb] = await Promise.all([fetch(`${base}/a`), fetch(`${base}/b`)]);
    const [ha, hb] = await Promise.all([ra.text(), rb.text()]);
    assert.match(ha, /data:alpha/);
    assert.match(ha, /<title>A<\/title>/);
    assert.match(hb, /data:bravo/);
    assert.match(hb, /<title>B<\/title>/);
    assert.doesNotMatch(ha, /bravo/);
    assert.doesNotMatch(hb, /alpha/);
  });
});

// The node adapter buffered the whole request body before a Request object
// existed, so the fetch-path 413 ran too late to stop an unauthenticated
// unbounded-buffering DoS on the primary adapter.
describe('Node adapter body cap', () => {
  const OVER = 2 * 1024 * 1024;

  it('rejects an oversized body with 413 instead of buffering it', async () => {
    const res = await fetch(`${base}/a`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: Buffer.alloc(OVER, 'x'),
    });
    assert.equal(res.status, 413);
  });

  it('rejects an oversized chunked body with a lying content-length', async () => {
    const res = await fetch(`${base}/a`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      duplex: 'half',
      body: new ReadableStream({
        start(controller) {
          for (let i = 0; i < 32; i++) controller.enqueue(new Uint8Array(128 * 1024));
          controller.close();
        },
      }),
    });
    assert.equal(res.status, 413);
  });

  it('still accepts a body under the cap', async () => {
    const res = await fetch(`${base}/a`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    });
    assert.equal(res.status, 200);
  });
});
