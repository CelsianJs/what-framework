/**
 * Tests for text-engine.js — the internal adapter for @chenglou/pretext.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const {
  configureText,
  getTextConfig,
  _resetTextEngineForTests,
} = await import('../src/text-engine.js');

// ─────────────────────────────────────────────
// Task 1: Config skeleton
// ─────────────────────────────────────────────

describe('text-engine config', () => {
  beforeEach(() => {
    _resetTextEngineForTests();
  });

  it('default config has measure=false, cacheSize=1000', () => {
    const config = getTextConfig();
    assert.equal(config.measure, false);
    assert.equal(config.cacheSize, 1000);
  });

  it('configureText enables measure', () => {
    configureText({ measure: true });
    assert.equal(getTextConfig().measure, true);
  });

  it('configureText overrides cacheSize', () => {
    configureText({ cacheSize: 500 });
    assert.equal(getTextConfig().cacheSize, 500);
  });

  it('unknown keys are ignored without throwing', () => {
    assert.doesNotThrow(() => {
      configureText({ unknown: true, alsoUnknown: 'yes', measure: true });
    });
    const config = getTextConfig();
    assert.equal(config.unknown, undefined);
    assert.equal(config.measure, true);
  });

  it('getTextConfig returns a copy (not a reference)', () => {
    const config = getTextConfig();
    config.measure = true;
    assert.equal(getTextConfig().measure, false);
  });
});
