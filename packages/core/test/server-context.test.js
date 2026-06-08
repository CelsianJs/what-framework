// Render-scoped server context (SSR keystone). The sync renderer relies on a
// module-global set/cleared within one synchronous tick; async paths must thread
// the ctx explicitly. These tests lock the get/set/run semantics + restoration.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getServerContext,
  setServerContext,
  runWithServerContext,
} from '../src/server-context.js';

describe('server-context', () => {
  it('returns null when no context is active', () => {
    assert.equal(getServerContext(), null);
  });

  it('exposes the context inside runWithServerContext and clears it after', () => {
    const ctx = { loaderData: { a: 1 } };
    const seen = runWithServerContext(ctx, () => getServerContext());
    assert.equal(seen, ctx);
    assert.equal(getServerContext(), null, 'context must be cleared after run');
  });

  it('returns the callback result from runWithServerContext', () => {
    const out = runWithServerContext({}, () => 42);
    assert.equal(out, 42);
  });

  it('restores the previous context even if the callback throws', () => {
    const ctx = { loaderData: 'x' };
    assert.throws(() =>
      runWithServerContext(ctx, () => {
        throw new Error('boom');
      })
    );
    assert.equal(getServerContext(), null, 'context restored after throw');
  });

  it('restores the OUTER context for nested runs (no leak between renders)', () => {
    const outer = { id: 'outer' };
    const inner = { id: 'inner' };
    runWithServerContext(outer, () => {
      assert.equal(getServerContext(), outer);
      runWithServerContext(inner, () => {
        assert.equal(getServerContext(), inner);
      });
      assert.equal(getServerContext(), outer, 'outer restored after inner run');
    });
    assert.equal(getServerContext(), null);
  });

  it('setServerContext returns the previous context (for manual restore)', () => {
    const a = { id: 'a' };
    const prev = setServerContext(a);
    assert.equal(prev, null);
    const prev2 = setServerContext(null);
    assert.equal(prev2, a);
    assert.equal(getServerContext(), null);
  });
});
