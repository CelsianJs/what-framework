import { after, before, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { interactionPage, interactionScenario, writeState } from './fixtures/random-interactions.js';
import { visibleTree } from './fixtures/storefront-observations.js';

let env;
let core;
let renderDocument;
let resetHydration;
before(async () => {
  env = installDOM();
  core = await import('what-framework');
  ({ renderDocument } = await import('what-framework/server'));
  ({ __resetHydrationData: resetHydration } = await import('what-core/internal'));
});
after(() => env.cleanup());

for (const seed of [1, 2, 3, 4, 15, 37, 49, 211, 1531, 104729]) {
  it('hydrated interaction trace matches a fresh render, seed ' + seed, { timeout: 2000 }, async () => {
    const { initial, structure, writes } = interactionScenario(seed);
    const { document } = env;
    const server = interactionPage(core, structure, initial, async () => 'stock');
    const html = await renderDocument({ default: server.Page });
    document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
    resetHydration();
    let fetches = 0;
    const client = interactionPage(core, structure, initial, async () => { fetches++; return 'stock'; });
    const freshHost = document.createElement('div');
    try {
      core.hydrate(client.vnode, document.body);
      let state = initial;
      for (const [index, field] of [null, ...writes].entries()) {
        if (field) {
          state = writeState(state, field);
          client.state(state);
          core.flushSync();
        }
        const fresh = interactionPage(core, structure, state, () => { throw new Error('unexpected fresh fetch'); }, true);
        const stop = core.mount(fresh.vnode, freshHost);
        try {
          assert.deepEqual(visibleTree(document.querySelector('main')), visibleTree(freshHost.firstElementChild),
            'step ' + index + ' (' + field + ')');
        } finally {
          stop();
        }
      }
      assert.equal(fetches, 0);
    } finally {
      core.mount(null, document.body)();
    }
  });
}
