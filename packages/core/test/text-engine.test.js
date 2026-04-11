/**
 * Tests for text-engine.js — the internal adapter for @chenglou/pretext.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const {
  configureText,
  getTextConfig,
  _resetTextEngineForTests,
  _markMounted,
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

// ─────────────────────────────────────────────
// Task 2: Timing contract (warn-after-mount)
// ─────────────────────────────────────────────

describe('text-engine timing contract', () => {
  beforeEach(() => {
    _resetTextEngineForTests();
  });

  it('no warning when configured before mount', () => {
    const warnings = [];
    const original = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      configureText({ measure: true });
      assert.equal(warnings.length, 0);
    } finally {
      console.warn = original;
    }
  });

  it('warning fires when configured after _markMounted()', () => {
    const warnings = [];
    const original = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      _markMounted();
      configureText({ measure: true });
      assert.equal(warnings.length, 1);
      assert.ok(warnings[0].includes('configureText'), `Expected warning to mention 'configureText', got: ${warnings[0]}`);
    } finally {
      console.warn = original;
    }
  });

  it('_resetTextEngineForTests clears hasMounted', () => {
    _markMounted();
    _resetTextEngineForTests();
    const warnings = [];
    const original = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      configureText({ measure: true });
      assert.equal(warnings.length, 0);
    } finally {
      console.warn = original;
    }
  });
});
