// useLoaderData() — reads the active render context's loader data on the server.
// (Client payload reading is covered in Phase 5 hydration tests.)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useLoaderData, runWithServerContext } from '../src/index.js';

describe('useLoaderData (server)', () => {
  it('returns loaderData from the active render context', () => {
    const data = { user: 'sam', n: 7 };
    const seen = runWithServerContext({ loaderData: data }, () => useLoaderData());
    assert.deepEqual(seen, data);
  });

  it('returns undefined outside of any render context (no throw)', () => {
    assert.equal(useLoaderData(), undefined);
  });

  it('is callable anywhere (not a component-scoped hook)', () => {
    // unlike useSignal, useLoaderData must not require a component context
    assert.doesNotThrow(() => useLoaderData());
  });
});
