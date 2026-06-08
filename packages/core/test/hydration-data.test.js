// Client hydration payload reader (Phase 5). Single source of truth for
// useLoaderData + createResource on the client.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let dom;
before(() => {
  dom = new JSDOM(
    '<!DOCTYPE html><html><body>' +
    '<script id="__what_data" type="application/json">' +
    JSON.stringify({ loaderData: { user: 'sam' }, resources: { thing: 'LOADED' }, islandStores: {} }) +
    '</script></body></html>'
  );
  global.document = dom.window.document;
  global.window = dom.window;
});
after(() => { delete global.document; delete global.window; });

describe('hydration-data', () => {
  it('reads the consolidated payload', async () => {
    const { __readHydrationData, getLoaderData, getResource } = await import('../src/hydration-data.js');
    const data = __readHydrationData();
    assert.deepEqual(data.loaderData, { user: 'sam' });
    assert.deepEqual(getLoaderData(), { user: 'sam' });
    assert.equal(getResource('thing'), 'LOADED');
  });

  it('getResource returns undefined for an unknown key', async () => {
    const { getResource } = await import('../src/hydration-data.js');
    assert.equal(getResource('missing'), undefined);
  });
});
