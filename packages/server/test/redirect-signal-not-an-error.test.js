// A redirect() from a component body, in a server render, redirects the
// render's response: the server acts on the signal, as the browser does. It
// is not an error, so it never reaches the render's `onError` (an app's error
// tracker) nor its console as one: every renderer, streamed or buffered, sync
// or async, in the shell or in a boundary streamed after it. Before, each one
// reported it as ERR_REDIRECT_NOT_CAUGHT, "[what-router] redirect to /login",
// for a redirect that had been caught and answered.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { h, Suspense, ErrorBoundary, createResource } from 'what-core';
import { Router, redirect } from 'what-router';
import { createRequestHandler, createResponse, renderToString, renderToHydratableString } from '../src/index.js';

const LateRedirect = () => {
  const [data] = createResource(() => new Promise((resolve) => setTimeout(() => resolve(1), 5)));
  data();
  redirect('/login');
};
const pages = [
  { path: '/guarded', component: () => redirect('/login') },
  { path: '/thunk', component: () => h('div', null, () => redirect('/login')) },
  { path: '/boundary', component: () => h(ErrorBoundary, { fallback: () => h('p', null, 'failed') }, h(() => redirect('/login'))) },
  { path: '/late', component: () => h('div', null, 'shell', h(Suspense, { fallback: 'loading' }, h(LateRedirect))) },
];
const App = () => h(Router, { routes: pages });

// What the console printed while `fn` ran.
async function consoleOf(fn) {
  const printed = [];
  const { warn, error } = console;
  console.warn = (...args) => printed.push(args.join(' '));
  console.error = (...args) => printed.push(args.join(' '));
  try {
    return { value: await fn(), printed };
  } finally {
    Object.assign(console, { warn, error });
  }
}

describe('a redirect() from a component in a server render', () => {
  for (const [name, page] of Object.entries({ streamed: { mode: 'server' }, buffered: { mode: 'server', stream: false }, cached: { mode: 'static' } })) {
    it(`redirects the response and reports no error (${name})`, async () => {
      for (const url of ['/guarded', '/thunk', '/boundary', '/late']) {
        const errors = [];
        const handler = createRequestHandler({ routes: [{ path: '*', page, component: App }], basePath: '/app', csrf: false, onError: (error) => errors.push(error.code ?? error.message) });
        const { value: res, printed } = await consoleOf(async () => {
          const response = await handler(new Request('http://site.test/app' + url));
          await response.text();
          return response;
        });
        if (url === '/late' && name === 'streamed') assert.equal(res.status, 200, url);
        else assert.equal(res.headers.get('location'), '/app/login', `${name} ${url}`);
        assert.deepEqual(errors, [], `${name} ${url}`);
        assert.deepEqual(printed, [], `${name} ${url}`);
      }
    });
  }

  it('prints nothing from renderToString or renderToHydratableString', async () => {
    for (const render of [renderToString, renderToHydratableString]) {
      for (const url of ['/guarded', '/thunk', '/boundary']) {
        const response = createResponse('/app');
        const { printed } = await consoleOf(() => (render === renderToString
          ? render(h(Router, { routes: pages, url }), { response })
          : render(h(Router, { routes: pages, url }))));
        if (render === renderToString) assert.equal(response.location, '/app/login', url);
        assert.deepEqual(printed, [], `${render.name} ${url}`);
      }
    }
  });
});

// A component outside every <Router> that calls redirect() in its body: a
// synchronous renderer acts on it as the async ones and the browser do. The
// response redirects (below its base), the component renders nothing, and
// the rest of the page renders. Before, renderToString and
// renderToHydratableString let the signal escape to their caller, with the
// response untouched, while renderToStringAsync redirected it.
describe('a redirect() from a component outside a Router, rendered synchronously', () => {
  const Private = () => redirect('/login');
  const page = () => h('main', null, h('p', null, 'before'), h(Private), h('p', null, 'after'));

  it('redirects the response renderToString was given, and renders the rest', () => {
    const response = createResponse('/app');
    const html = renderToString(page(), { response });
    assert.equal(response.status, 302);
    assert.equal(response.location, '/app/login');
    assert.match(html, /before.*after/);
  });

  it('renderToHydratableString acts on it too', () => {
    const html = renderToHydratableString(page());
    assert.match(html, /before.*after/);
  });
});
