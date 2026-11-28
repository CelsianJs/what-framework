// Status, headers and redirects from loaders and components (T3-16).
//
// The adapter answered every page with 200 and nothing on a page could change
// that: a missing record rendered a "not found" page with a 200, a login gate
// could not redirect, and a page could not set a cookie or a cache header.
// Now the loader receives `response` and components reach the same object with
// getResponse(). It is committed with the shell: before that it is the real
// status line (a redirect is a real 3xx); after it, a redirect is a script.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { h, Suspense, createResource, getResponse } from 'what-core';
import { createRequestHandler, createResponse, renderDocument, renderToStream } from '../src/index.js';
import { collect } from './stream-helpers.js';

function gate() {
  let open;
  const promise = new Promise((resolve) => { open = resolve; });
  return { promise, open };
}

const modes = { streamed: { mode: 'server' }, buffered: { mode: 'server', stream: false } };

describe('a loader sets the response', () => {
  for (const [name, page] of Object.entries(modes)) {
    it(`status and headers (${name})`, async () => {
      const handle = createRequestHandler({
        routes: [{
          path: '/post/:id',
          page,
          loader: ({ params, response }) => {
            response.setStatus(404);
            response.setHeader('x-reason', 'missing');
            response.setHeader('set-cookie', 'seen=1; Path=/');
            return { id: params.id };
          },
          component: ({ loaderData }) => h('main', null, `no post ${loaderData.id}`),
        }],
      });
      const res = await handle(new Request('http://x/post/7'));
      assert.equal(res.status, 404);
      assert.equal(res.headers.get('x-reason'), 'missing');
      const cookies = res.headers.getSetCookie();
      assert.ok(cookies.some((c) => c.startsWith('seen=1')), JSON.stringify(cookies));
      assert.ok(cookies.some((c) => c.startsWith('what-csrf=')), 'the CSRF cookie survives');
      assert.match(await res.text(), /no post 7/);
    });

    it(`a redirect is a real 3xx and skips the render (${name})`, async () => {
      let rendered = false;
      const handle = createRequestHandler({
        routes: [{
          path: '/account',
          page,
          loader: ({ response }) => {
            response.setHeader('set-cookie', 'from=account; Path=/');
            response.redirect('/login', 303);
          },
          component: () => { rendered = true; return h('main', null, 'secret'); },
        }],
      });
      const res = await handle(new Request('http://x/account'));
      assert.equal(res.status, 303);
      assert.equal(res.headers.get('location'), '/login');
      assert.ok(res.headers.getSetCookie().some((c) => c.startsWith('from=account')));
      assert.equal(await res.text(), '');
      assert.equal(rendered, false);
    });
  }
});

describe('a component sets the response', () => {
  it('before the shell is sent: a real status and a real redirect', async () => {
    const gone = createRequestHandler({
      routes: [{ path: '/', page: { mode: 'server' }, component: () => { getResponse().setStatus(410); return h('p', null, 'gone'); } }],
    });
    assert.equal((await gone(new Request('http://x/'))).status, 410);

    const moved = createRequestHandler({
      routes: [{ path: '/', page: { mode: 'server' }, component: () => { getResponse().redirect('/new', 301); return h('p', null, 'old'); } }],
    });
    const res = await moved(new Request('http://x/'));
    assert.equal(res.status, 301);
    assert.equal(res.headers.get('location'), '/new');
  });

  it('after the shell: a redirect from a streamed boundary becomes a script with the nonce', async () => {
    const data = gate();
    function Guard() {
      const [user] = createResource(() => data.promise.then(() => null));
      if (user() === null) getResponse().redirect('/login');
      return h('p', null, 'welcome');
    }
    const stream = renderToStream(h('main', null, h(Suspense, { fallback: h('i', null, '...') }, h(Guard, {}))), { nonce: 'abc' });
    await stream.shellReady;
    data.open();
    const html = await collect(stream);
    assert.match(html, /<script nonce="abc">location\.replace\("\/login"\)<\/script>/);
  });

  it('after the shell, setStatus has no effect', async () => {
    const data = gate();
    let response;
    function Late() {
      const [v] = createResource(() => data.promise.then(() => 'x'));
      response = getResponse();
      if (v()) response.setStatus(500);
      return h('p', null, () => v());
    }
    const warn = console.warn;
    const warnings = [];
    console.warn = (message) => warnings.push(message);
    try {
      const stream = renderToStream(h(Suspense, { fallback: 'f' }, h(Late, {})));
      await stream.shellReady;
      data.open();
      await collect(stream);
    } finally {
      console.warn = warn;
    }
    assert.equal(response.committed, true);
    assert.equal(response.status, 200);
    assert.match(warnings.join('\n'), /setStatus\(500\) after the response was committed/);
  });

  it('a late redirect without scripts is reported, not dropped silently', async () => {
    const data = gate();
    function Guard() {
      const [v] = createResource(() => data.promise.then(() => 'x'));
      if (v()) getResponse().redirect('/login');
      return h('p', null, 'x');
    }
    const errors = [];
    const stream = renderToStream(h(Suspense, { fallback: 'f' }, h(Guard, {})), { noScripts: true, onError: (e, info) => errors.push([e.code, info.phase]) });
    await stream.shellReady;
    data.open();
    const html = await collect(stream);
    assert.doesNotMatch(html, /location\.replace/);
    assert.deepEqual(errors, [['ERR_LATE_REDIRECT', 'stream']]);
  });
});

describe('response safety and shape', () => {
  it('refuses a script, protocol-relative or absolute redirect target, and redirects to "/" instead', async () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      for (const target of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'data:text/html,x', '//evil.example', '/\\evil.example', 'https://evil.example/']) {
        const response = createResponse();
        await renderDocument({
          loader: ({ response: r }) => r.redirect(target),
          default: () => h('p', null, 'x'),
        }, { response });
        assert.equal(response.location, '/', target);
        assert.equal(response.status, 302, target);
      }
    } finally {
      console.warn = warn;
    }
  });

  it('rejects statuses that are not statuses or not redirects', async () => {
    await assert.rejects(renderDocument({ loader: ({ response }) => response.setStatus(99), default: () => null }), RangeError);
    await assert.rejects(renderDocument({ loader: ({ response }) => response.redirect('/x', 200), default: () => null }), RangeError);
  });

  it('a custom server reads the response it passed to renderDocument', async () => {
    const response = createResponse();
    const html = await renderDocument({
      default: () => {
        getResponse().setHeader('cache-control', 'max-age=60');
        getResponse().setStatus(202);
        return h('p', null, 'accepted');
      },
    }, { response });
    assert.match(html, /accepted/);
    assert.equal(response.status, 202);
    assert.equal(response.headers.get('cache-control'), 'max-age=60');
    assert.equal(response.committed, true);

    const redirected = createResponse();
    const empty = await renderDocument({ loader: ({ response: r }) => r.redirect('/elsewhere'), default: () => h('p', null, 'never') }, { response: redirected });
    assert.equal(redirected.location, '/elsewhere');
    assert.equal(redirected.status, 302);
    assert.doesNotMatch(empty, /never/);
  });

  it('a 204 from the page is sent without a body', async () => {
    const handle = createRequestHandler({
      routes: [{ path: '/', page: { mode: 'server' }, loader: ({ response }) => response.setStatus(204), component: () => h('p', null, 'x') }],
      csrf: false,
    });
    const res = await handle(new Request('http://x/'));
    assert.equal(res.status, 204);
    assert.equal(await res.text(), '');
  });

  it('getResponse() outside a server render is inert', () => {
    const response = getResponse();
    response.setStatus(500);
    response.redirect('/x');
    assert.equal(response.status, 200);
    assert.equal(response.location, null);
  });
});
