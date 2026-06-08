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
