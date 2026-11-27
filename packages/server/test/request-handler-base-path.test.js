// createRequestHandler({ basePath }) strips the base from a request's path on a
// segment boundary before matching: '/app/x' matches '/x' and '/app' matches
// '/', written '/app' or '/app/' (as Vite writes its base), while
// '/application' is not below '/app' and is matched as it is. Before, the
// prefix was cut wherever it matched, so '/application' was matched as
// 'lication', and a base written with its trailing slash left '/app/x' as
// 'x', which no route matches.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { h } from 'what-core';
import { createRequestHandler } from '../src/index.js';

const routes = [
  { path: '/', component: () => h('p', null, 'home'), mode: 'server' },
  { path: '/x', component: () => h('p', null, 'page x'), mode: 'server' },
  { path: '/application', component: () => h('p', null, 'application page'), mode: 'server' },
];

async function get(handler, path) {
  const response = await handler(new Request('http://app.test' + path));
  return { status: response.status, body: await response.text() };
}

describe('createRequestHandler basePath', () => {
  for (const basePath of ['/app', '/app/']) {
    it(`strips ${basePath} on a segment boundary`, async () => {
      const handler = createRequestHandler({ routes, basePath, csrf: false });
      assert.match((await get(handler, '/app/x')).body, /page x/);
      assert.match((await get(handler, '/app/')).body, /home/);
      assert.match((await get(handler, '/app')).body, /home/);
      assert.match((await get(handler, '/app?q=1')).body, /home/);
      assert.match((await get(handler, '/application')).body, /application page/);
    });
  }
});
