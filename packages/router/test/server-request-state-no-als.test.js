// The per-request route state without an async context provider (an edge
// runtime with no AsyncLocalStorage): every read inside the render's own
// slices (a layout, the page before an await, a <Suspense> boundary that
// renders later) shows its own request, and a read after an await shows no
// route state at all, never another request's.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderInterleaved } from './interleaved-renders.js';

delete process.getBuiltinModule;
delete globalThis.AsyncLocalStorage;

const { h, Suspense } = await import('what-core');
const { query } = await import('what-core/data');
const server = await import('../../server/src/index.js');
const { Router, route, useParams, useSearch, useRoute } = await import('../src/index.js');

describe('<Router> state on the server without AsyncLocalStorage', () => {
  it('shows each render its own route state, or none after an await, never another request\'s', async () => {
    const { results, client } = await renderInterleaved({ server, h, Suspense, query, Router, route, useParams, useSearch, useRoute });
    for (const { i, foreign, fields } of results) {
      assert.deepEqual(foreign, [], `render ${i} shows another request's route state`);
      assert.deepEqual(fields, { layout: 'own', before: 'own', after: 'none', later: 'own' }, `render ${i}`);
    }
    assert.deepEqual(client, { url: '/', path: '/', hash: '', params: {}, query: {} });
  });
});
