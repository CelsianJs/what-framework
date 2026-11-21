// The buffered renderers are built on the streaming engine (functional review
// M5), static export follows the response (M6), and a boundary the server
// could not render hydrates without disturbing its siblings (m5).
//
//   M5  renderToStringAsync (and renderDocument, ISR, static export and
//       page.stream: false on top of it) waited only for resources inside a
//       <Suspense>: a resource read outside one rejected with a bare Promise,
//       a lazy() component shipped its fallback as the final HTML, and an
//       async component threw "Invalid tag name in SSR: undefined", on pages
//       the default streamed route rendered fine.
//   M6  exportStatic exported a loader redirect as a blank page and a 404 as a
//       normal page.
//   m5  nothing on the client read a failed boundary: its leftover placeholder
//       sent hydration down the mismatch path, and the sibling after it was
//       torn down and rebuilt.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import * as core from 'what-core';
import * as internal from 'what-core/internal';
import { renderDocument, renderToStringAsync, renderToStream } from '../src/index.js';
import { exportStatic } from '../src/node.js';
import { collect, content } from './stream-helpers.js';

const { h, Suspense, createResource, lazy } = core;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the buffered render waits for what the stream waits for', () => {
  it('a resource read outside any <Suspense>', async () => {
    function Page() {
      const [v] = createResource(async () => 'DATA');
      return h('p', null, () => v());
    }
    assert.equal(content((await renderToStringAsync(h(Page, {}))).body), '<p>DATA</p>');
    assert.match(content(await renderDocument({ default: Page })), /<body><p>DATA<\/p>/);
  });

  it('a lazy() component inside a <Suspense>', async () => {
    const Chart = lazy(async () => { await delay(5); return { default: () => h('figure', null, 'chart') }; });
    const html = await renderDocument({ default: () => h('main', null, h(Suspense, { fallback: h('i', null, 'loading chart') }, h(Chart, {}))) });
    assert.match(content(html), /<main><figure>chart<\/figure><\/main>/);
    assert.doesNotMatch(html, /loading chart/);
  });

  it('an async component', async () => {
    async function Profile() {
      await delay(2);
      return h('section', null, 'profile');
    }
    const out = await renderToStringAsync(h('main', null, h(Profile, {})));
    assert.equal(content(out.body), '<main><section>profile</section></main>');
  });

  it('matches the settled stream for the same tree', async () => {
    const Lazy = lazy(async () => ({ default: () => h('b', null, 'lazy') }));
    async function Late() { await delay(3); return h('i', null, 'late'); }
    function Data() { const [v] = createResource(async () => 'data', { key: 'd' }); return h('u', null, () => v()); }
    const tree = () => h('main', null, h(Data, {}), h(Suspense, { fallback: 'fb' }, h(Lazy, {}), h(Late, {})));
    const buffered = (await renderToStringAsync(tree())).body;
    const dom = new JSDOM(`<!DOCTYPE html><body>${await collect(renderToStream(tree()))}</body>`, { runScripts: 'dangerously' });
    for (const el of dom.window.document.body.querySelectorAll('script, template')) el.remove();
    assert.equal(buffered, dom.window.document.body.innerHTML);
    dom.window.close();
  });

  it('rejects with the Error that failed the render, never a bare Promise', async () => {
    const failures = [
      renderToStringAsync({ nodeType: 1 }),
      renderDocument({ default: () => ({ nodeType: 1 }) }),
    ];
    for (const failure of failures) {
      await assert.rejects(failure, (error) => {
        assert.ok(error instanceof Error, `rejected with ${Object.prototype.toString.call(error)}`);
        assert.equal(error.code, 'ERR_COMPILED_JSX_IN_SSR');
        return true;
      });
    }
  });

  it('a component that keeps suspending outside a <Suspense> ends in an Error, not a hang or a Promise', async () => {
    const errors = [];
    function Forever() { throw Promise.resolve(); }
    const out = await renderToStringAsync(h('main', null, h(Forever, {})), undefined, { onError: (e) => errors.push(e) });
    assert.match(out.body, /^<main><!-- SSR Error/);
    assert.equal(errors.length, 1);
    assert.ok(errors[0] instanceof Error);
    assert.equal(errors[0].code, 'ERR_SSR_SUSPENSE_TIMEOUT');
  });

  it('a redirect from a component during a buffered render is a real redirect, not a script', async () => {
    const { createResponse } = await import('../src/index.js');
    const res = createResponse();
    function Gate() {
      const [v] = createResource(async () => 'x');
      if (v()) core.getResponse().redirect('/login');
      return h('p', null, 'x');
    }
    const Guard = () => h(Suspense, { fallback: 'f' }, h(Gate, {}));
    const html = await renderDocument({ default: Guard }, { response: res });
    assert.equal(res.location, '/login');
    assert.equal(res.status, 302);
    assert.doesNotMatch(html, /location\.replace/);
  });
});

describe('exportStatic follows the response (M6)', () => {
  let outDir;
  before(async () => { outDir = await mkdtemp(join(tmpdir(), 'what-static-')); });
  after(async () => { await rm(outDir, { recursive: true, force: true }); });

  it('writes a redirect stub for a redirect and skips a page with another status', async () => {
    const warn = console.warn;
    const warnings = [];
    console.warn = (message) => warnings.push(String(message));
    let result;
    try {
      result = await exportStatic({
        outDir,
        routes: [
          { path: '/old', page: { mode: 'static' }, loader: ({ response }) => { response.redirect('/new', 301); return {}; }, component: () => h('p', null, 'old content') },
          { path: '/missing', page: { mode: 'static' }, loader: ({ response }) => { response.setStatus(404); return { missing: true }; }, component: () => h('p', null, 'not found page') },
          { path: '/ok', page: { mode: 'static' }, component: () => h('p', null, 'fine') },
        ],
      });
    } finally {
      console.warn = warn;
    }
    assert.deepEqual(result.pages, ['/ok']);
    assert.deepEqual(result.redirects, [{ path: '/old', location: '/new', status: 301 }]);
    assert.deepEqual(result.skipped, [{ path: '/missing', status: 404 }]);
    const stub = await readFile(join(outDir, 'old', 'index.html'), 'utf8');
    assert.match(stub, /<meta http-equiv="refresh" content="0; url=\/new">/);
    assert.match(stub, /<link rel="canonical" href="\/new">/);
    assert.doesNotMatch(stub, /old content/);
    await assert.rejects(stat(join(outDir, 'missing', 'index.html')), { code: 'ENOENT' });
    assert.match(warnings.join('\n'), /\/missing rendered with status 404/);
    assert.match(content(await readFile(join(outDir, 'ok', 'index.html'), 'utf8')), /<p>fine<\/p>/);
  });
});

describe('a boundary the server could not render (m5)', () => {
  function render() {
    let n = 0;
    function Flaky() {
      const onServer = internal.getServerContext() != null;
      const [v] = createResource(() => delay(1).then(() => 'DATA'), { key: onServer ? `k${n++}` : 'k' });
      return h('p', { id: 'content' }, () => v() ?? 'client-loading');
    }
    return () => h('main', null, h(Suspense, { fallback: h('i', { id: 'fb' }, 'fallback') }, h(Flaky, {})), h('footer', null, 'end'));
  }

  it('its fallback stands alone in the page, and the sibling after it survives hydration', async () => {
    const App = render();
    const html = await collect(renderToStream(h(App, {}), { onError: () => {} }));
    assert.match(html, /"failed":\{"[^"]+":\{"message":"[^"]+","code":"ERR_SSR_SUSPENSE_TIMEOUT"\}\}/);
    const dom = new JSDOM(`<!DOCTYPE html><body><div id="app">${html}</div></body>`, { runScripts: 'dangerously' });
    const doc = dom.window.document;
    assert.equal(doc.querySelectorAll('#app template').length, 0, 'the placeholder was left in the page');
    assert.doesNotMatch(doc.getElementById('app').innerHTML, /<!--pl-/);
    const footer = doc.querySelector('footer');
    const saved = { window: globalThis.window, document: globalThis.document };
    Object.assign(globalThis, { window: dom.window, document: doc });
    const warn = console.warn;
    const warnings = [];
    console.warn = (message) => warnings.push(String(message));
    try {
      internal.__resetHydrationData();
      core.hydrate(h(App, {}), doc.getElementById('app'));
      await delay(30);
    } finally {
      console.warn = warn;
      Object.assign(globalThis, saved);
    }
    assert.equal(doc.querySelector('footer'), footer, 'the footer was torn down and rebuilt');
    assert.ok(!warnings.some((w) => /expected <footer>/.test(w)), warnings.join('\n'));
    assert.equal(doc.getElementById('content').textContent, 'DATA');
    dom.window.close();
  });

  it('with noScripts, applyStreamedBoundaries() drops the placeholder and keeps the fallback', async () => {
    const App = render();
    const html = await collect(renderToStream(h(App, {}), { noScripts: true, onError: () => {} }));
    const dom = new JSDOM(`<!DOCTYPE html><body>${html}</body>`);
    const saved = globalThis.document;
    globalThis.document = dom.window.document;
    try {
      internal.__resetHydrationData();
      assert.equal(core.applyStreamedBoundaries(), 0);
    } finally {
      globalThis.document = saved;
    }
    const body = dom.window.document.body.innerHTML;
    assert.match(body, /<main data-hk="0"><!--b!--><i id="fb">fallback<\/i><!--\/b--><footer>end<\/footer><\/main>/, 'the failed boundary is marked as showing its fallback');
    dom.window.close();
  });
});
