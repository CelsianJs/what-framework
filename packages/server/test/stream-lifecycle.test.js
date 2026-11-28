// A stream ends exactly once and leaves nothing behind (functional review C3,
// m1, m2, m3, m4).
//
//   C3  every stream added an abort listener to options.signal and removed it
//       only if the signal fired: a long-lived signal collected one listener,
//       holding the whole render state, per stream.
//   m2  stopping a stream from the consumer side (abort(), a destroyed
//       writable, a cancelled readable, leaving the loop) did not reach the
//       loader's or the fetchers' signal.
//   m3  allReady resolved after an abort although boundaries were never sent,
//       and an aborted document was left without its closing tags.
//   m4  renderToStream gave no way to read what components set on the response.
//   m1  a fatal error after the shell made the Node adapter append a second,
//       complete "500" document to the 200 page.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import http from 'node:http';
import { h, Suspense, createResource, getResponse } from 'what-core';
import { createResponse, renderDocumentStream, renderToStream, renderDocument } from '../src/index.js';
import { createServer } from '../src/node.js';
import { collect } from './stream-helpers.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function gate() {
  let open;
  const promise = new Promise((resolve) => { open = resolve; });
  return { promise, open };
}

// An AbortSignal that counts the abort listeners currently attached to it.
function countedSignal() {
  const controller = new AbortController();
  const { signal } = controller;
  let listeners = 0;
  const add = signal.addEventListener.bind(signal);
  const remove = signal.removeEventListener.bind(signal);
  const attached = new Set();
  signal.addEventListener = (type, fn, options) => {
    if (type === 'abort' && !attached.has(fn)) { attached.add(fn); listeners++; }
    return add(type, fn, options);
  };
  signal.removeEventListener = (type, fn, options) => {
    if (type === 'abort' && attached.delete(fn)) listeners--;
    return remove(type, fn, options);
  };
  return { controller, signal, listeners: () => listeners };
}

function waitingPage(data, watch) {
  function Data() {
    const [v] = createResource((_s, { signal }) => {
      if (watch) watch(signal);
      return data.promise.then(() => 'D');
    });
    return h('b', null, () => v());
  }
  return h('main', null, h('p', null, 'shell'), h(Suspense, { fallback: h('i', null, 'fb') }, h(Data, {})));
}

describe('a long-lived signal keeps no listener per stream (C3)', () => {
  it('completed streams on one signal leave no abort listener behind', async () => {
    const counted = countedSignal();
    for (let i = 0; i < 200; i++) await collect(renderToStream(h('p', null, 'x'), { signal: counted.signal }));
    for (let i = 0; i < 50; i++) {
      const data = gate();
      data.open();
      await collect(renderToStream(waitingPage(data), { signal: counted.signal }));
    }
    for (let i = 0; i < 50; i++) {
      await collect(await renderDocumentStream({ default: () => h('p', null, 'doc') }, { signal: counted.signal }));
    }
    for (let i = 0; i < 50; i++) await renderDocument({ default: () => h('p', null, 'doc') }, { signal: counted.signal });
    assert.equal(counted.listeners(), 0);
  });

  it('a failed or aborted stream leaves none either', async () => {
    const counted = countedSignal();
    await assert.rejects(collect(renderToStream({ nodeType: 1 }, { signal: counted.signal, onError: () => {} })));
    const stream = renderToStream(waitingPage(gate()), { signal: counted.signal });
    await stream.shellReady;
    stream.abort();
    await collect(stream);
    await assert.rejects(renderDocument({ default: () => h('p', null, 'x'), loader: () => { throw new Error('loader failed'); } }, { signal: counted.signal }));
    assert.equal(counted.listeners(), 0);
  });
});

describe('stopping a stream from the consumer side stops its work (m2)', () => {
  it('abort() aborts the fetchers\' signal', async () => {
    let fetcherSignal;
    const stream = renderToStream(waitingPage(gate(), (s) => { fetcherSignal = s; }));
    await stream.shellReady;
    stream.abort();
    assert.equal(fetcherSignal.aborted, true);
  });

  it('a destroyed writable aborts the fetchers\' signal', async () => {
    let fetcherSignal;
    const stream = renderToStream(waitingPage(gate(), (s) => { fetcherSignal = s; }));
    const sink = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    stream.pipe(sink);
    await stream.shellReady;
    await delay(5);
    sink.destroy();
    await delay(5);
    assert.equal(fetcherSignal.aborted, true);
  });

  it('cancelling readable, or leaving the loop, aborts it too', async () => {
    let first;
    const a = renderToStream(waitingPage(gate(), (s) => { first = s; }));
    await a.shellReady;
    await a.readable.cancel();
    assert.equal(first.aborted, true);

    let second;
    const b = renderToStream(waitingPage(gate(), (s) => { second = s; }));
    for await (const _chunk of b) break;
    assert.equal(second.aborted, true);
  });

  it('the loader of a streamed document gets the render\'s signal, which follows the request', async () => {
    let loaderSignal;
    const controller = new AbortController();
    const stream = await renderDocumentStream({
      loader: ({ signal }) => { loaderSignal = signal; return {}; },
      default: () => waitingPage(gate()),
    }, { signal: controller.signal });
    await stream.shellReady;
    assert.equal(loaderSignal.aborted, false);
    stream.abort();
    assert.equal(loaderSignal.aborted, true);
  });
});

describe('allReady and an aborted document (m3)', () => {
  it('after an abort past the shell, allReady rejects and the document is closed', async () => {
    const stream = await renderDocumentStream({ default: () => waitingPage(gate()) }, {});
    const reading = collect(stream);
    await stream.shellReady;
    stream.abort(new Error('client left'));
    const html = await reading;
    await assert.rejects(stream.allReady, /client left/);
    assert.ok(html.endsWith('</body></html>'), html.slice(-80));
    assert.match(html, /<i>fb<\/i>/);
  });

  it('a finished stream resolves allReady, and a later abort changes nothing', async () => {
    const data = gate();
    data.open();
    const stream = await renderDocumentStream({ default: () => waitingPage(data) }, {});
    const html = await collect(stream);
    await stream.allReady;
    stream.abort();
    assert.equal(html.match(/<\/body><\/html>/g).length, 1);
  });
});

describe('a body stream exposes its response (m4)', () => {
  it('stream.response is what components set, final once the shell is ready', async () => {
    function Page() {
      getResponse().setStatus(404);
      getResponse().setHeader('x-page', 'missing');
      return h('p', null, 'not here');
    }
    const stream = renderToStream(h(Page, {}));
    await stream.shellReady;
    assert.equal(stream.response.status, 404);
    assert.equal(stream.response.headers.get('x-page'), 'missing');
    assert.equal(stream.response.committed, true);
    await collect(stream);
  });

  it('options.response is used when given', async () => {
    const response = createResponse();
    function Page() { getResponse().redirect('/login'); return h('p', null, 'x'); }
    const stream = renderToStream(h(Page, {}), { response });
    await stream.shellReady;
    assert.equal(stream.response, response);
    assert.equal(response.location, '/login');
    await collect(stream);
  });
});

describe('a fatal error after the shell (m1)', () => {
  it('the Node adapter cuts the connection instead of appending a second document', async () => {
    const data = gate();
    function Late() {
      const [v] = createResource(() => data.promise.then(() => 'x'));
      return v() ? { nodeType: 1 } : null;
    }
    const routes = [{ path: '/', page: { mode: 'server' }, component: () => h('main', null, h('h1', null, 'title'), h(Suspense, { fallback: 'fb' }, h(Late, {}))) }];
    const error = console.error;
    console.error = () => {};
    const server = createServer({ routes, csrf: false, onError: () => {} });
    await new Promise((resolve) => server.listen(0, resolve));
    try {
      const body = await new Promise((resolve) => {
        const req = http.get({ port: server.address().port, path: '/' }, (res) => {
          let text = '';
          res.on('data', (chunk) => {
            text += chunk;
            if (text.includes('<h1>title</h1>')) data.open();
          });
          res.on('end', () => resolve({ text, status: res.statusCode, aborted: false }));
          res.on('aborted', () => resolve({ text, status: res.statusCode, aborted: true }));
          res.on('error', () => resolve({ text, status: res.statusCode, aborted: true }));
        });
        req.on('error', () => {});
      });
      assert.equal(body.status, 200);
      assert.equal(body.aborted, true, 'the response must end abnormally');
      assert.equal(body.text.match(/<!DOCTYPE html>/g).length, 1, body.text);
      assert.doesNotMatch(body.text, /500/);
    } finally {
      server.close();
      console.error = error;
    }
  });
});
