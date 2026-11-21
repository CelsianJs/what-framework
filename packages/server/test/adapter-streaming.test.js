// Server-mode routes stream through the deploy adapters: the document shell,
// with every waiting <Suspense> fallback, reaches the client before slow data,
// over Fetch-style hosts and over Node. Cached routes keep the buffered,
// settled render the ISR engine stores.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { h, Suspense, createResource } from 'what-core';
import { createRequestHandler } from '../src/index.js';
import { createServer } from '../src/node.js';
import { content, settle, stableIds } from './stream-helpers.js';

// The error-comment assertion below reads the error's message, which a page
// carries only in development.
process.env.NODE_ENV = 'development';

function gate() {
  let open;
  const promise = new Promise((resolve) => { open = resolve; });
  return { promise, open };
}

function routeWith(data, page = { mode: 'server' }) {
  function Rows() {
    const [rows] = createResource(() => data.promise.then(() => ['a', 'b']), { key: 'rows' });
    return h('ul', null, () => rows().map((r) => h('li', { key: r }, r)));
  }
  return [{
    path: '/',
    page,
    loader: () => ({ title: 'list' }),
    component: ({ loaderData }) => h('main', null,
      h('h1', null, loaderData.title),
      h(Suspense, { fallback: h('p', { class: 'loading' }, 'loading') }, h(Rows, {})),
      h('footer', null, 'end')),
  }];
}

async function readAll(reader) {
  let out = '';
  for (let r = await reader.read(); !r.done; r = await reader.read()) out += new TextDecoder().decode(r.value);
  return out;
}

describe('createRequestHandler streams server-mode routes', () => {
  it('answers with the shell before the data is ready', async () => {
    const data = gate();
    const handle = createRequestHandler({ routes: routeWith(data), csrf: false });
    const res = await handle(new Request('http://x/'));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    const reader = res.body.getReader();
    const shell = new TextDecoder().decode((await reader.read()).value);
    assert.match(stableIds(shell), /<h1>list<\/h1><!--b--><template id="pl-wb0"><\/template><p class="loading">loading<\/p><!--pl-wb0--><!--\/b--><footer>end<\/footer>/);
    assert.match(shell, /<script id="__what_data"/);
    data.open();
    const rest = await readAll(reader);
    assert.ok(rest.endsWith('</body></html>'));
    const body = (shell + rest).match(/<body>([\s\S]*)<\/body>/)[1];
    assert.match(content(settle(body)), /<main><h1>list<\/h1><ul><li>a<\/li><li>b<\/li><\/ul><footer>end<\/footer><\/main>/);
  });

  it('keeps the buffered render for page.stream: false', async () => {
    const data = gate();
    data.open();
    const handle = createRequestHandler({ routes: routeWith(data, { mode: 'server', stream: false }), csrf: false });
    const html = await (await handle(new Request('http://x/'))).text();
    assert.match(content(html), /<ul><li>a<\/li><li>b<\/li><\/ul>/);
    assert.doesNotMatch(html, /<template/);
  });

  it('hands the stream errors to the onError option', async () => {
    const seen = [];
    const handle = createRequestHandler({
      csrf: false,
      onError: (error, info) => seen.push([error.message, info.phase]),
      routes: [{ path: '/', page: { mode: 'server' }, component: () => h('main', null, h(() => { throw new Error('bad row'); }, {})) }],
    });
    const html = await (await handle(new Request('http://x/'))).text();
    assert.match(content(html), /<main><!-- SSR Error: bad row --><\/main>/);
    assert.deepEqual(seen, [['bad row', 'render']]);
  });

  it('a page whose shell cannot render is an error, not a 200', async () => {
    const handle = createRequestHandler({
      csrf: false,
      onError: () => {},
      // A DOM node (what-compiler output) has no server-rendered form; it fails
      // the render instead of being contained like a component error.
      routes: [{ path: '/', page: { mode: 'server' }, component: () => ({ nodeType: 1 }) }],
    });
    await assert.rejects(handle(new Request('http://x/')), { code: 'ERR_COMPILED_JSX_IN_SSR' });
  });
});

describe('the Node adapter delivers the shell first', () => {
  it('the client reads the fallback while the data is still pending', async () => {
    const data = gate();
    const server = createServer({ routes: routeWith(data), csrf: false });
    await new Promise((resolve) => server.listen(0, resolve));
    try {
      const res = await fetch(`http://localhost:${server.address().port}/`);
      const reader = res.body.getReader();
      let seen = '';
      while (!seen.includes('<footer>end</footer>')) seen += new TextDecoder().decode((await reader.read()).value);
      assert.match(seen, /class="loading"/);
      assert.doesNotMatch(seen, /<li>a<\/li>/);
      data.open();
      seen += await readAll(reader);
      assert.match(content(stableIds(seen)), /<template id="wb0"><ul><li>a<\/li><li>b<\/li><\/ul><\/template>/);
    } finally {
      server.close();
    }
  });
});
