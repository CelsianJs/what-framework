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
