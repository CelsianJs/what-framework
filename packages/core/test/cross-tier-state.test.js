// A process can load more than one tier of what-core and what-server: a
// component bundled for the browser (dist/*.js) that the production renderer
// (dist/*.min.js) renders, or source modules beside built ones. The state that
// is the process's, not a tier's, is kept once for all of them (Symbol.for
// keys on globalThis): the render context (getResponse(), the loader data, the
// request), the async context provider and the server-process mark; the server
// action registry; the devtools hooks; and the page's streamed-boundary hook,
// which resumes each tier's boundaries. Everything else (the signal graph, the
// caches) stays a tier's own.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repo = new URL('../../../', import.meta.url);
const tier = (path) => import(new URL('packages/' + path, repo).href);
const BUILT = existsSync(fileURLToPath(new URL('packages/core/dist/index.min.js', repo)));
const NEEDS_DIST = BUILT ? false : 'needs the built dist/ (npm run build)';

describe('state one process keeps once for every tier', { skip: NEEDS_DIST }, () => {
  it('a component from the bundler tier sees the response of a production render', async () => {
    const browser = await tier('core/dist/index.js');
    const { h } = await tier('core/dist/index.min.js');
    const { createResponse, renderToStringAsync } = await tier('server/dist/index.min.js');
    const response = createResponse();
    const Page = () => {
      browser.getResponse().setStatus(201);
      return 'created';
    };
    const { body } = await renderToStringAsync(h(Page), { response });
    assert.match(body, /created/);
    assert.equal(response.status, 201);
    const source = await tier('core/src/server-context.js');
    assert.equal(source.getServerContext(), null, 'outside the render no tier sees a context');
  });

  it("an action registered through one tier is found by another's handler", async () => {
    const fromSource = await tier('server/src/actions.js');
    const production = await tier('server/dist/actions.min.js');
    const saved = fromSource.action(async (n) => n * 2, { id: 'cross-tier-double' });
    assert.ok(saved);
    assert.ok(production.getRegisteredActions().includes('cross-tier-double'));
  });

  it('devtools hooks installed through one development tier reach the other', async () => {
    const source = await tier('core/src/reactive.js');
    const bundler = await tier('core/dist/reactive.js');
    const hooks = { onSignalCreate() {} };
    source.__setDevToolsHooks(hooks);
    try {
      assert.equal(bundler.__devtools, hooks);
      assert.equal(source.__devtools, hooks);
    } finally {
      source.__setDevToolsHooks(null);
    }
    assert.equal(bundler.__devtools, null);
  });
});
