/**
 * Unit tests (no browser) for how devtools carries what-core diagnostics and
 * effect errors to its subscribers (the MCP client streams these to the bridge).
 *
 * Runs in its own file: installDevTools is a process-wide singleton.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../../core/src/entries/internal.js';
import { clearDiagnostics } from '../../core/src/index.js';
import { installDevTools, subscribe, getDiagnostics, getErrors } from '../src/index.js';

test('devtools diagnostics wiring', async (t) => {
  const seen = [];
  subscribe((event, data) => seen.push([event, data]));
  let hooks = null;
  installDevTools({
    ...core,
    __setDevToolsHooks(h) {
      hooks = h;
      core.__setDevToolsHooks(h);
    },
  });
  clearDiagnostics();

  await t.test('streams every core diagnostic as a "diagnostic" event', () => {
    const original = console.warn;
    console.warn = () => {};
    try {
      core.reportDiagnostic('ERR_DUPLICATE_KEY', { data: { key: '"a"' } });
    } finally {
      console.warn = original;
    }
    const forwarded = seen.filter(([event]) => event === 'diagnostic').map(([, data]) => data);
    assert.equal(forwarded.length, 1);
    assert.equal(forwarded[0].code, 'ERR_DUPLICATE_KEY');
    assert.equal(forwarded[0].count, 1);
  });

  await t.test('exposes the cursor read', () => {
    const { events, seq } = getDiagnostics();
    assert.deepEqual(events.map((e) => e.code), ['ERR_DUPLICATE_KEY']);
    assert.deepEqual(getDiagnostics({ since: seq }).events, []);
  });

  await t.test('records one thrown effect error once, with its code', () => {
    const before = getErrors().length;
    const err = Object.assign(new Error('boom'), { code: 'ERR_HOOK_OUTSIDE_COMPONENT' });
    const effectNode = { fn() {} };
    // The engine hands an effect throw to onError from two places.
    hooks.onError(err, { type: 'effect', effect: effectNode });
    hooks.onError(err, { type: 'effect', effect: effectNode });
    const added = getErrors().slice(before);
    assert.equal(added.length, 1);
    assert.equal(added[0].code, 'ERR_HOOK_OUTSIDE_COMPONENT');
    assert.equal(added[0].message, 'boom');
  });
});
