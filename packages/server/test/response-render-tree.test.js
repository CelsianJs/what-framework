// Status, headers and redirects set from inside the render tree, by a
// component that decides them from data it loaded (a query), through every
// server renderer and both kinds of adapter.
//
// The rule: the response is committed with the first byte. A buffered render
// (renderToString, renderToStringAsync, renderDocument) sends nothing before
// it has finished, so whatever a component sets counts. A streamed render
// sends its shell first: what the shell's components set counts, including a
// status decided by data read outside any <Suspense> (the shell waits for
// it); what a boundary streamed after the shell sets does not (setStatus and
// setHeader are ignored, a redirect becomes a script).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { h, Suspense, getResponse } from 'what-core';
import { query } from 'what-core/data';
import {
  createRequestHandler, createCloudflareHandler, createResponse,
  renderToString, renderToStringAsync, renderToStream,
} from '../src/index.js';
import { toNodeListener } from '../src/node.js';
import { collect } from './stream-helpers.js';

let n = 0;
const later = (value, ms = 5) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

// A page that answers 404 for a missing post, decided from the post itself.
function Post({ id }) {
  const post = query(['post', id, ++n], () => later(id === 'missing' ? null : { title: 'Hello' }));
  return h('article', null, () => {
    const value = post();
    if (value === null) {
      getResponse().setStatus(404);
      getResponse().setHeader('x-reason', 'no such post');
      return h('p', null, 'not found');
    }
    return h('h1', null, value.title);
  });
}

describe('a component sets the response from data it loaded', () => {
  it('renderToString: a status set synchronously is read from the response passed in', () => {
    const response = createResponse();
    const html = renderToString(h(() => {
      getResponse().setStatus(410);
      getResponse().setHeader('cache-control', 'no-store');
      return h('p', null, 'gone');
    }), { response });
    assert.match(html, /gone/);
    assert.equal(response.status, 410);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });

  it('renderToStringAsync waits for the query, then the status it set is on the result', async () => {
    const result = await renderToStringAsync(h(Suspense, { fallback: h('p', null, '…') }, h(Post, { id: 'missing' })));
    assert.match(result.body, /not found/);
    assert.equal(result.response.status, 404);
    assert.equal(result.response.headers.get('x-reason'), 'no such post');
  });

  it('renderToStream: data read outside a <Suspense> decides the status before the first byte', async () => {
    const response = createResponse();
    const stream = renderToStream(h(Post, { id: 'missing' }), { response });
    await stream.shellReady;
    assert.equal(response.status, 404, 'the shell waited for the query');
    assert.equal(response.committed, true);
    assert.match(await collect(stream), /not found/);
  });

  it('renderToStream: a boundary streamed after the shell cannot change the status', async () => {
    const response = createResponse();
    const warnings = [];
    const original = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      const stream = renderToStream(h('main', null, h(Suspense, { fallback: h('p', null, 'loading') }, h(Post, { id: 'missing' }))), { response });
      await stream.shellReady;
      assert.equal(response.status, 200, 'the shell went out with 200');
      const html = await collect(stream);
      assert.match(html, /not found/, 'the boundary still streams');
      assert.equal(response.status, 200, 'a late setStatus has no effect');
    } finally {
      console.warn = original;
    }
  });
});

const routes = [
  { path: '/post/:id', page: { mode: 'server' }, component: ({ id }) => h(Post, { id }) },
  { path: '/buffered/:id', page: { mode: 'server', stream: false }, component: ({ id }) => h(Suspense, { fallback: h('p', null, '…') }, h(Post, { id })) },
  { path: '/old', page: { mode: 'server' }, component: () => { getResponse().redirect('/post/1', 308); return h('p', null, 'old'); } },
];

describe('the adapters send what the render tree set', () => {
  it('the edge (Cloudflare) adapter: streamed and buffered 404, and a redirect', async () => {
    const worker = createCloudflareHandler({ routes });
    for (const path of ['/post/missing', '/buffered/missing']) {
      const res = await worker.fetch(new Request('https://edge.example' + path), {}, {});
      assert.equal(res.status, 404, path);
      assert.equal(res.headers.get('x-reason'), 'no such post', path);
      assert.match(await res.text(), /not found/, path);
    }
    const found = await worker.fetch(new Request('https://edge.example/post/1'), {}, {});
    assert.equal(found.status, 200);
    const moved = await worker.fetch(new Request('https://edge.example/old'), {}, {});
    assert.equal(moved.status, 308);
    assert.equal(moved.headers.get('location'), '/post/1');
  });

  it('the Node adapter: the status line and headers on the wire', async () => {
    const server = http.createServer(toNodeListener(createRequestHandler({ routes })));
    await new Promise((resolve) => server.listen(0, resolve));
    const base = `http://localhost:${server.address().port}`;
    try {
      const res = await fetch(base + '/post/missing');
      assert.equal(res.status, 404);
      assert.equal(res.headers.get('x-reason'), 'no such post');
      assert.match(await res.text(), /not found/);
      const moved = await fetch(base + '/old', { redirect: 'manual' });
      assert.equal(moved.status, 308);
      assert.equal(moved.headers.get('location'), '/post/1');
    } finally {
      server.close();
    }
  });
});
