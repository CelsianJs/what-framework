// Out-of-order streaming.
//
// renderToStream used to resolve <Suspense> in place: the stream stopped at the
// boundary, never sent its fallback, and held everything after it (the footer,
// the rest of the page) until the data arrived. Now the shell goes out at once
// with the fallback in place, and the boundary's content follows as a
// <template> and a swap script when its data is ready.
//
// The wire format is checked the way a browser sees it: the output is parsed
// by jsdom with scripts enabled, chunk by chunk.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { JSDOM } from 'jsdom';
import { h, Suspense, ErrorBoundary, createResource } from 'what-core';
import { renderToStream, renderDocumentStream } from '../src/index.js';
import { content, settle, stableIds } from './stream-helpers.js';

// Several assertions read errors' messages, which a page carries only in
// development.
process.env.NODE_ENV = 'development';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function gate() {
  let open;
  const promise = new Promise((resolve) => { open = resolve; });
  return { promise, open };
}

function Data({ value, wait, keyName }) {
  const [v] = createResource(() => wait.then(() => value), keyName ? { key: keyName } : {});
  return h('b', null, () => v());
}

async function chunksOf(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(stableIds(chunk));
  return chunks;
}

function quiet() {
  const errors = [];
  return { errors, onError: (error, info) => errors.push({ error, info }) };
}

describe('the shell goes out before the data', () => {
  it('sends the fallback and everything after the boundary first, then swaps the content in', async () => {
    const data = gate();
    const page = h('div', null,
      h('header', null, 'top'),
      h(Suspense, { fallback: h('p', { class: 'loading' }, 'Loading rows') }, h(Data, { value: 'ROWS', wait: data.promise })),
      h('footer', { id: 'end' }, 'end of page'));

    const stream = renderToStream(page);
    const iterator = stream[Symbol.asyncIterator]();
    const first = await iterator.next();
    first.value = stableIds(first.value);
    await stream.shellReady;
    assert.match(first.value, /<p class="loading">Loading rows<\/p>/);
    assert.match(first.value, /<footer id="end">end of page<\/footer>/);
    assert.match(first.value, /^<div><header>top<\/header><!--b--><template id="pl-wb0"><\/template><p class="loading">Loading rows<\/p><!--pl-wb0--><!--\/b--><footer/);
    assert.doesNotMatch(first.value, /ROWS/);

    data.open();
    const rest = [];
    for (let r = await iterator.next(); !r.done; r = await iterator.next()) rest.push(stableIds(r.value));
    assert.equal(rest.length, 1, 'the boundary arrives in one chunk');
    const fragment = rest[0];
    assert.ok(fragment.indexOf('data-what-data') < fragment.indexOf('<template id="wb0">'), 'data comes before the content');
    assert.ok(fragment.indexOf('<template id="wb0">') < fragment.indexOf('_$W.s("wb0")'), 'content comes before the swap');

    const dom = new JSDOM(`<!DOCTYPE html><body>${first.value}${fragment}</body>`, { runScripts: 'dangerously' });
    const doc = dom.window.document;
    assert.equal(doc.querySelector('b').textContent, 'ROWS');
    assert.equal(doc.querySelector('.loading'), null, 'the fallback is gone');
    assert.equal(doc.querySelectorAll('template').length, 0, 'no template is left behind');
    assert.ok(doc.querySelector('b').compareDocumentPosition(doc.getElementById('end')) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING, 'content sits before the footer');
    assert.equal(doc.body.innerHTML.includes('pl-wb0'), false, 'no placeholder marker is left behind');
    dom.window.close();
  });

  it('a page with nothing to wait for is one chunk with no templates or scripts', async () => {
    const chunks = await chunksOf(renderToStream(h('main', null, h(Suspense, { fallback: 'x' }, h('p', null, 'ready')))));
    assert.deepEqual(chunks, ['<main><!--b--><p>ready</p><!--/b--></main>']);
  });

  it('streams boundaries in the order their data arrives', async () => {
    const a = gate();
    const b = gate();
    const page = h('div', null,
      h(Suspense, { fallback: h('i', null, 'A...') }, h(Data, { value: 'A', wait: a.promise })),
      h(Suspense, { fallback: h('i', null, 'B...') }, h(Data, { value: 'B', wait: b.promise })));
    const stream = renderToStream(page);
    const seen = [];
    const done = (async () => { for await (const chunk of stream) seen.push(stableIds(chunk)); })();
    await stream.shellReady;
    b.open();
    await delay(5);
    a.open();
    await done;
    assert.equal(seen.length, 3);
    assert.match(content(seen[1]), /<template id="wb1"><b>B<\/b><\/template>/);
    assert.match(content(seen[2]), /<template id="wb0"><b>A<\/b><\/template>/);
    assert.equal(content(settle(seen.join(''))), '<div><b>A</b><b>B</b></div>');
  });

  it('defines the swap function once per response', async () => {
    const a = gate();
    const page = h('div', null,
      h(Suspense, { fallback: 'a' }, h(Data, { value: 'A', wait: a.promise })),
      h(Suspense, { fallback: 'b' }, h(Data, { value: 'B', wait: a.promise })));
    const stream = renderToStream(page);
    await stream.shellReady;
    a.open();
    const html = (await chunksOf(stream)).join('');
    assert.equal(html.match(/_\$W=self\._\$W\|\|\{\}\)\.s=function/g).length, 1);
    assert.equal(content(settle(html)), '<div><b>A</b><b>B</b></div>');
  });
});

describe('nested boundaries', () => {
  it('a boundary inside a streamed boundary arrives after its parent and swaps into it', async () => {
    const outer = gate();
    const inner = gate();
    function Outer() {
      const [v] = createResource(() => outer.promise.then(() => 'OUTER'));
      return h('section', null, () => v(),
        h(Suspense, { fallback: h('i', null, 'inner...') }, h(Data, { value: 'INNER', wait: inner.promise })));
    }
    const stream = renderToStream(h('main', null, h(Suspense, { fallback: h('i', null, 'outer...') }, h(Outer, {}))));
    const chunks = [];
    const done = (async () => { for await (const chunk of stream) chunks.push(stableIds(chunk)); })();
    await stream.shellReady;
    inner.open();
    await delay(5);
    outer.open();
    await done;
    const html = chunks.join('');
    assert.ok(html.indexOf('<template id="wb0">') < html.indexOf('<template id="wb1">'), 'the inner boundary went out before its parent');
    assert.equal(content(settle(html)), '<main><section>OUTER<b>INNER</b></section></main>');
  });

  it('a boundary that resolves while the shell is still waiting goes out after the shell', async () => {
    const data = gate();
    const slowShell = gate();
    async function SlowHeader() {
      await slowShell.promise;
      return h('header', null, 'header');
    }
    const stream = renderToStream(h('main', null,
      h(Suspense, { fallback: h('i', null, '...') }, h(Data, { value: 'D', wait: data.promise })),
      h(SlowHeader, {})));
    const chunks = [];
    const done = (async () => { for await (const chunk of stream) chunks.push(stableIds(chunk)); })();
    data.open();
    await delay(5);
    assert.equal(chunks.length, 0);
    slowShell.open();
    await done;
    assert.match(chunks[0], /^<main><!--b--><template id="pl-wb0">/);
    assert.equal(content(settle(chunks.join(''))), '<main><b>D</b><header>header</header></main>');
  });
});

describe('errors after the shell went out', () => {
  it('an <ErrorBoundary> around a streamed boundary sends its fallback as the content', async () => {
    const data = gate();
    function Boom() {
      const [v] = createResource(() => data.promise.then(() => 'x'));
      v();
      throw new Error('kaboom');
    }
    const { errors, onError } = quiet();
    const stream = renderToStream(h('main', null,
      h(ErrorBoundary, { fallback: ({ error }) => h('p', { class: 'err' }, `failed: ${error.message}`) },
        h(Suspense, { fallback: h('i', null, '...') }, h(Boom, {})))), { onError });
    await stream.shellReady;
    data.open();
    const html = (await chunksOf(stream)).join('');
    assert.equal(content(settle(html)), '<main><p class="err">failed: kaboom</p></main>');
    assert.equal(errors.length, 1);
    assert.equal(errors[0].info.phase, 'boundary');
    assert.equal(stableIds(errors[0].info.boundaryId), 'wb0');
  });

  it('without one, the component is replaced by an error comment and onError hears it', async () => {
    const data = gate();
    function Boom() {
      const [v] = createResource(() => data.promise.then(() => 'x'));
      v();
      throw new Error('kaboom');
    }
    const { errors, onError } = quiet();
    const stream = renderToStream(h('main', null, h(Suspense, { fallback: h('i', null, '...') }, h('p', null, 'kept'), h(Boom, {}))), { onError });
    await stream.shellReady;
    data.open();
    const html = (await chunksOf(stream)).join('');
    assert.match(html, /<template id="wb0"><p>kept<\/p><!-- SSR Error: kaboom --><\/template>/);
    assert.deepEqual(errors.map((e) => ({ ...e.info, boundaryId: stableIds(e.info.boundaryId) })), [{ phase: 'render', boundaryId: 'wb0' }]);
  });

  it('a boundary that never resolves keeps its fallback and is reported as failed', async () => {
    let attempts = 0;
    function Never() {
      attempts++;
      throw Promise.resolve();
    }
    const { errors, onError } = quiet();
    const stream = renderToStream(h('main', null, h(Suspense, { fallback: h('i', null, 'fallback') }, h(Never, {}))), { onError });
    const html = (await chunksOf(stream)).join('');
    assert.equal(attempts, 13);
    assert.match(html, /<script type="application\/json" data-what-data>\{"failed":\{"wb0":\{"message":"[^"]*pending after 12 attempts[^"]*","code":"ERR_SSR_SUSPENSE_TIMEOUT"\}\}\}<\/script><script>/);
    // The failed boundary's swap drops the placeholder and its end marker, so
    // the fallback stands alone, as a fallback the server rendered would: the
    // client hydrates it as one and renders the region itself.
    assert.match(html, /_\$W\.s\("wb0",1\)<\/script>$/);
    assert.equal(content(settle(html)), '<main><i>fallback</i></main>');
    assert.equal(errors[0].info.phase, 'boundary');
  });

  it('a failure before the shell rejects shellReady and the stream', async () => {
    const { errors, onError } = quiet();
    const stream = renderToStream(h('main', null, h('bad tag', null)), { onError });
    await assert.rejects(stream.shellReady, { code: 'ERR_INVALID_SSR_TAG' });
    await assert.rejects(chunksOf(stream), { code: 'ERR_INVALID_SSR_TAG' });
    assert.equal(errors[0].info.phase, 'shell');
  });

  it('calls onError for an error an <ErrorBoundary> contained in the shell', async () => {
    const { errors, onError } = quiet();
    const Boom = () => { throw new Error('contained'); };
    const html = (await chunksOf(renderToStream(h(ErrorBoundary, { fallback: h('i', null, 'fb') }, h(Boom, {})), { onError }))).join('');
    assert.equal(html, '<!--b!--><i>fb</i><!--/b-->');
    assert.equal(errors[0].error.message, 'contained');
    assert.equal(errors[0].info.phase, 'boundary');
  });

  it('an error boundary that discards a region also drops the boundaries streamed from it', async () => {
    const data = gate();
    function Late() {
      throw new Error('after the boundary');
    }
    const { onError } = quiet();
    const stream = renderToStream(h('main', null,
      h(ErrorBoundary, { fallback: h('i', null, 'eb') },
        h(Suspense, { fallback: '...' }, h(Data, { value: 'D', wait: data.promise })),
        h(Late, {}))), { onError });
    data.open();
    const html = (await chunksOf(stream)).join('');
    assert.equal(html, '<main><!--b!--><i>eb</i><!--/b--></main>');
  });
});

describe('CSP and script-free streaming', () => {
  it('puts the nonce on every script', async () => {
    const data = gate();
    const stream = renderToStream(h('main', null, h(Suspense, { fallback: 'x' }, h(Data, { value: 'D', wait: data.promise }))), { nonce: 'r4nd"om' });
    await stream.shellReady;
    data.open();
    const html = (await chunksOf(stream)).join('');
    const scripts = html.match(/<script\b[^>]*>/g);
    assert.ok(scripts.length >= 2);
    for (const tag of scripts) assert.match(tag, / nonce="r4nd&quot;om"/);
    assert.equal(content(settle(html)), '<main><b>D</b></main>');
  });

  it('noScripts sends templates only, and applyStreamedBoundaries swaps them on the client', async () => {
    const outer = gate();
    const inner = gate();
    function Outer() {
      const [v] = createResource(() => outer.promise.then(() => 'O'));
      return h('section', null, () => v(), h(Suspense, { fallback: 'i...' }, h(Data, { value: 'I', wait: inner.promise })));
    }
    const stream = renderToStream(h('main', null, h(Suspense, { fallback: 'o...' }, h(Outer, {}))), { noScripts: true });
    await stream.shellReady;
    outer.open();
    inner.open();
    const html = (await chunksOf(stream)).join('');
    assert.doesNotMatch(html, /<script(?![^>]*type="application\/json")/);

    const dom = new JSDOM(`<!DOCTYPE html><body>${html}</body>`, { runScripts: 'dangerously' });
    const previous = globalThis.document;
    globalThis.document = dom.window.document;
    try {
      const { applyStreamedBoundaries } = await import('what-core');
      assert.equal(applyStreamedBoundaries(), 2);
      for (const el of dom.window.document.querySelectorAll('script')) el.remove();
      assert.equal(content(dom.window.document.body.innerHTML), '<main><section>O<b>I</b></section></main>');
    } finally {
      if (previous === undefined) delete globalThis.document;
      else globalThis.document = previous;
      dom.window.close();
    }
  });
});

describe('consumers', () => {
  const page = (data) => h('main', null, h('p', null, 'shell'), h(Suspense, { fallback: 'x' }, h(Data, { value: 'D', wait: data.promise })));

  it('pipe() writes into a Node writable and honours backpressure', async () => {
    const data = gate();
    const written = [];
    let release;
    const sink = new Writable({
      highWaterMark: 1,
      write(chunk, _encoding, callback) {
        written.push(chunk.toString());
        if (written.length === 1) release = callback;
        else callback();
      },
    });
    const stream = renderToStream(page(data));
    stream.pipe(sink);
    await stream.shellReady;
    data.open();
    await delay(10);
    assert.equal(written.length, 1, 'wrote past a full writable');
    release();
    await new Promise((resolve) => sink.on('finish', resolve));
    assert.equal(written.length, 2);
    assert.equal(content(settle(written.join(''))), '<main><p>shell</p><b>D</b></main>');
  });

  it('readable is a pull-based ReadableStream of UTF-8 bytes', async () => {
    const data = gate();
    const stream = renderToStream(page(data));
    const reader = stream.readable.getReader();
    const first = await reader.read();
    assert.ok(first.value instanceof Uint8Array);
    assert.match(new TextDecoder().decode(first.value), /<p>shell<\/p>/);
    data.open();
    let rest = '';
    for (let r = await reader.read(); !r.done; r = await reader.read()) rest += new TextDecoder().decode(r.value);
    assert.match(content(stableIds(rest)), /<template id="wb0"><b>D<\/b><\/template>/);
  });

  it('can only be consumed once', async () => {
    const stream = renderToStream(h('p', null, 'x'));
    void stream.readable;
    assert.throws(() => stream.pipe(new Writable({ write(_c, _e, cb) { cb(); } })), /already being consumed/);
    assert.throws(() => stream[Symbol.asyncIterator](), /already being consumed/);
  });

  it('allReady resolves when the last boundary went out', async () => {
    const data = gate();
    const stream = renderToStream(page(data));
    let all = false;
    stream.allReady.then(() => { all = true; });
    const reading = chunksOf(stream);
    await stream.shellReady;
    await delay(5);
    assert.equal(all, false);
    data.open();
    await reading;
    await stream.allReady;
    assert.equal(all, true);
  });
});

describe('abort', () => {
  it('stops the render and ends the stream after the shell', async () => {
    const data = gate();
    const controller = new AbortController();
    let fetcherSignal;
    function Watched() {
      const [v] = createResource((_s, { signal }) => { fetcherSignal = signal; return data.promise.then(() => 'never shown'); });
      return h('b', null, () => v());
    }
    const stream = renderToStream(h('main', null, h(Suspense, { fallback: h('i', null, 'fb') }, h(Watched, {}))), { signal: controller.signal });
    const reading = chunksOf(stream);
    await stream.shellReady;
    controller.abort();
    assert.equal(fetcherSignal.aborted, true);
    data.open();
    const chunks = await reading;
    assert.equal(chunks.join(''), '<main><!--b--><template id="pl-wb0"></template><i>fb</i><!--pl-wb0--><!--/b--></main>');
  });

  it('rejects shellReady when aborted before the shell', async () => {
    const controller = new AbortController();
    controller.abort();
    const stream = renderToStream(h('p', null, 'x'), { signal: controller.signal });
    await assert.rejects(stream.shellReady);
  });

  it('breaking out of the loop aborts the render', async () => {
    const data = gate();
    let attempts = 0;
    function Counted() {
      attempts++;
      const [v] = createResource(() => data.promise.then(() => 'x'));
      return h('b', null, () => v());
    }
    const stream = renderToStream(h(Suspense, { fallback: 'f' }, h(Counted, {})));
    for await (const chunk of stream) {
      assert.match(stableIds(chunk), /pl-wb0/);
      break;
    }
    data.open();
    await delay(10);
    assert.equal(attempts, 1, 'the boundary was retried after the consumer left');
  });

  it('cancelling readable aborts the render', async () => {
    const data = gate();
    let attempts = 0;
    function Counted() {
      attempts++;
      const [v] = createResource(() => data.promise.then(() => 'x'));
      return h('b', null, () => v());
    }
    const stream = renderToStream(h(Suspense, { fallback: 'f' }, h(Counted, {})));
    await stream.readable.cancel();
    data.open();
    await delay(10);
    assert.equal(attempts, 1, 'the boundary was retried after the reader cancelled');
    // The boundary was never sent, so allReady does not claim it was.
    await assert.rejects(stream.allReady);
  });
});

describe('renderDocumentStream', () => {
  it('streams a whole document: head and payload in the shell, boundaries after, closed at the end', async () => {
    const data = gate();
    const { Head } = await import('what-core');
    const pageModule = {
      loader: async ({ signal }) => ({ user: 'ann', aborted: signal.aborted }),
      default: ({ loaderData }) => h('main', null,
        h(Head, { title: `hi ${loaderData.user}` }),
        h(Suspense, { fallback: h('i', null, '...') }, h(Data, { value: 'D', wait: data.promise, keyName: 'd' }))),
    };
    const stream = await renderDocumentStream(pageModule, { request: new Request('http://x/') }, { clientEntry: '/app.js', nonce: 'n1' });
    const chunks = [];
    const reading = (async () => { for await (const chunk of stream) chunks.push(chunk); })();
    await stream.shellReady;
    data.open();
    await reading;
    const shell = chunks[0];
    assert.match(shell, /^<!DOCTYPE html><html lang="en"><head>.*<title>hi ann<\/title><\/head><body><main data-hk="0">/);
    assert.match(shell, /<script id="__what_data" type="application\/json" nonce="n1">\{"loaderData":\{"user":"ann","aborted":false\},"resources":\{\},"islandStores":\{\}\}<\/script><script type="module" src="\/app.js" nonce="n1"><\/script>$/);
    const last = chunks[chunks.length - 1];
    assert.match(last, /\{"resources":\{"d":"D"\}\}/);
    assert.ok(last.endsWith('</body></html>'));
  });
});
