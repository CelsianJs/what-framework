// An async page keeps reading its nearest <Router> after an `await`: the
// streamed renderer runs a component's function in its frame, and code that
// resumes after an await finds that frame through the async context
// (what-core's _runComponentAsync), so `route` and the hooks read the Router
// above it, not the request's state (round 5, R1). Also the context a
// component provides is visible to an async child after its await.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { h, createContext, useContext } from 'what-core';
import { renderToStringAsync, renderToStream } from '../../server/src/index.js';
import { Router, route, useParams } from '../src/index.js';

async function Page({ params }) {
  const before = [route.path, useParams().id];
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 1));
  return [params.id, ...before, route.path, useParams().id].join(':');
}

const options = { request: new Request('http://localhost/request/9') };
const panel = [{ path: '/panel/:id', component: Page }];

async function stream(view) {
  let html = '';
  for await (const chunk of renderToStream(view, options)) html += chunk;
  return html;
}

describe('an async page reads its Router after an await', () => {
  it('the request Router', async () => {
    const { body } = await renderToStringAsync(h(Router, { routes: [{ path: '/request/:id', component: Page }] }), options);
    assert.match(body, /9:\/request\/9:9:\/request\/9:9/);
  });

  it('a Router with its own URL', async () => {
    const { body } = await renderToStringAsync(h(Router, { routes: panel, url: '/panel/2' }), options);
    assert.match(body, /2:\/panel\/2:2:\/panel\/2:2/);
  });

  it('a nested Router and a sibling one, streamed', async () => {
    const home = [{ path: '/request/:id', component: () => h(Router, { routes: panel, url: '/panel/2' }) }];
    const sibling = [{ path: '/sibling/:id', component: Page }];
    const html = await stream(h('main', null, h(Router, { routes: home }), h(Router, { routes: sibling, url: '/sibling/3' })));
    assert.match(html, /2:\/panel\/2:2:\/panel\/2:2/);
    assert.match(html, /3:\/sibling\/3:3:\/sibling\/3:3/);
  });

  it('two concurrent streams each keep their own Router', async () => {
    const view = (id) => h(Router, { routes: panel, url: `/panel/${id}` });
    const [a, b] = await Promise.all([stream(view(4)), stream(view(5))]);
    assert.match(a, /4:\/panel\/4:4:\/panel\/4:4/);
    assert.match(b, /5:\/panel\/5:5:\/panel\/5:5/);
  });

  it('a context its parent provides', async () => {
    const Theme = createContext('none');
    async function Child() {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return `theme=${useContext(Theme)}`;
    }
    const html = await stream(h(Theme, { value: 'dark' }, h(Child)));
    assert.match(html, /theme=dark/);
  });
});
