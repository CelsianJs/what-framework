// Deploy adapters: cookies, disconnects and streamed bodies.
//
//   R5a  A client that disconnected did not stop anything: the Node adapter's
//        Request had no live signal, so the loader, the render and every
//        server fetcher ran to completion for nobody.
//   R5b  The CSRF cookie was assigned over the route's own Set-Cookie on a
//        visitor's first request, so a login route's session cookie was lost.
//   R5c  The Node adapter copied headers with setHeader one at a time, which
//        replaces, so only the last Set-Cookie reached the client.
//   The Node adapter also buffered every body with `await webRes.text()`, so
//   nothing streamed to a Node client, and it had no backpressure.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { h, Suspense, createResource } from 'what-core';
import { createRequestHandler } from '../src/index.js';
import { createServer, toNodeListener } from '../src/node.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function listen(server) {
  await new Promise((resolve) => server.listen(0, resolve));
  return server.address().port;
}

describe('a client disconnect stops the work (R5a)', () => {
  it('aborts the loader signal and never renders', async () => {
    const log = [];
    let loaderSignal;
    const routes = [{
      path: '/slow',
      page: { mode: 'server' },
      loader: async ({ signal }) => {
        loaderSignal = signal;
        signal.addEventListener('abort', () => log.push('loader aborted'));
        await delay(200);
        return { n: 1 };
      },
      component: () => { log.push('render ran'); return h('p', null, 'slow'); },
    }];
    const server = createServer({ routes, csrf: false });
    const port = await listen(server);
    try {
      const req = http.get({ port, path: '/slow' });
      req.on('error', () => {});
      await delay(40);
      req.destroy();
      await delay(300);
      assert.equal(loaderSignal.aborted, true);
      assert.deepEqual(log, ['loader aborted']);
    } finally {
      server.close();
    }
  });

  it('hands every server resource fetcher a signal that follows the request', async () => {
    let fetcherSignal;
    let fetcherRequest;
    let release;
    const started = new Promise((resolve) => { release = resolve; });
    function Data() {
      const [v] = createResource((_source, { signal, request }) => {
        fetcherSignal = signal;
        fetcherRequest = request;
        release();
        return new Promise(() => {});
      });
      return h('b', null, () => v());
    }
    const handle = createRequestHandler({
      routes: [{ path: '/', page: { mode: 'server' }, component: () => h(Suspense, { fallback: '...' }, h(Data, {})) }],
      csrf: false,
    });
    const controller = new AbortController();
    const request = new Request('http://x/', { signal: controller.signal });
    const res = await handle(request);
    await started;
    assert.ok(fetcherSignal instanceof AbortSignal);
    assert.equal(fetcherSignal.aborted, false);
    controller.abort();
    assert.equal(fetcherSignal.aborted, true, 'the client going away reaches the fetcher while the render runs');
    assert.equal(fetcherRequest, request);
    await res.text();
  });
});

describe('every Set-Cookie reaches the client', () => {
  it('keeps a route cookie next to the CSRF cookie (R5b)', async () => {
    const handle = createRequestHandler({
      routes: [{ path: '/', page: { mode: 'server' }, component: () => h('p', null, 'x') }],
      render: async () => ({ html: '<p>x</p>', status: 200, headers: { 'set-cookie': ['session=abc; Path=/; HttpOnly', 'theme=dark; Path=/'] } }),
    });
    const res = await handle(new Request('http://localhost/'));
    const cookies = res.headers.getSetCookie();
    assert.equal(cookies.length, 3, JSON.stringify(cookies));
    assert.ok(cookies.some((c) => c.startsWith('session=abc')));
    assert.ok(cookies.some((c) => c.startsWith('theme=dark')));
    assert.ok(cookies.some((c) => c.startsWith('what-csrf=')));
  });

  it('keeps cookies from a cache engine result too', async () => {
    const handle = createRequestHandler({
      routes: [{ path: '/', page: { mode: 'static' }, component: () => h('p', null, 'x') }],
      cache: { handle: async () => ({ html: '<p>x</p>', status: 200, headers: { 'set-cookie': 'ab=1; Path=/', 'x-cache': 'HIT' } }) },
    });
    const res = await handle(new Request('http://localhost/'));
    assert.equal(res.headers.get('x-cache'), 'HIT');
    assert.equal(res.headers.getSetCookie().length, 2);
  });

  it('the Node adapter sends all of them (R5c)', async () => {
    const server = http.createServer(toNodeListener(async () => {
      const headers = new Headers({ 'content-type': 'text/plain' });
      headers.append('set-cookie', 'a=1; Path=/');
      headers.append('set-cookie', 'b=2; Path=/');
      return new Response('ok', { headers });
    }));
    const port = await listen(server);
    try {
      const res = await fetch(`http://localhost:${port}/`);
      assert.deepEqual(res.headers.getSetCookie(), ['a=1; Path=/', 'b=2; Path=/']);
      assert.equal(await res.text(), 'ok');
    } finally {
      server.close();
    }
  });
});

describe('the Node adapter streams the body', () => {
  it('sends the first chunk before the body has finished', async () => {
    let release;
    const server = http.createServer(toNodeListener(async () => new Response(new ReadableStream({
      async start(controller) {
        controller.enqueue(new TextEncoder().encode('<p>shell</p>'));
        await new Promise((resolve) => { release = resolve; });
        controller.enqueue(new TextEncoder().encode('<p>late</p>'));
        controller.close();
      },
    }))));
    const port = await listen(server);
    try {
      const res = await fetch(`http://localhost:${port}/`);
      const reader = res.body.getReader();
      const first = await reader.read();
      assert.equal(new TextDecoder().decode(first.value), '<p>shell</p>');
      release();
      let rest = '';
      for (let r = await reader.read(); !r.done; r = await reader.read()) rest += new TextDecoder().decode(r.value);
      assert.equal(rest, '<p>late</p>');
    } finally {
      server.close();
    }
  });

  it('stops reading while the socket is full and resumes on drain', async () => {
    let pulls = 0;
    const body = new ReadableStream({
      pull(controller) {
        pulls++;
        if (pulls > 5) controller.close();
        else controller.enqueue(new Uint8Array([pulls]));
      },
    }, { highWaterMark: 0 });
    const res = Object.assign(new EventEmitter(), {
      statusCode: 0,
      headersSent: false,
      destroyed: false,
      writableFinished: false,
      writes: [],
      ended: false,
      setHeader() {},
      write(chunk) { this.writes.push(chunk); return false; },
      end() { this.ended = true; this.writableFinished = true; },
    });
    const req = Object.assign(new EventEmitter(), { method: 'GET', url: '/', headers: { host: 'x' } });
    const done = toNodeListener(async () => new Response(body))(req, res);
    await delay(20);
    assert.equal(res.writes.length, 1, 'kept writing into a full socket');
    res.emit('drain');
    await delay(20);
    assert.equal(res.writes.length, 2);
    for (let i = 0; i < 5; i++) { res.emit('drain'); await delay(5); }
    await done;
    assert.equal(res.writes.length, 5);
    assert.equal(res.ended, true);
  });

  it('cancels the body when the client goes away', async () => {
    let cancelled = false;
    const server = http.createServer(toNodeListener(async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(1024))); },
      cancel() { cancelled = true; },
    }))));
    const port = await listen(server);
    try {
      const req = http.get({ port, path: '/' }, (res) => {
        res.once('data', () => req.destroy());
      });
      req.on('error', () => {});
      for (let i = 0; i < 50 && !cancelled; i++) await delay(10);
      assert.equal(cancelled, true);
    } finally {
      server.close();
    }
  });
});
