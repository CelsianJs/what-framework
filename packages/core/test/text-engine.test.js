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
  ensurePretext,
  _setPretextForTests,
  measureText,
  clearMeasureCache,
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

// ─────────────────────────────────────────────
// Task 3: Lazy Pretext loader
// ─────────────────────────────────────────────

describe('ensurePretext', () => {
  beforeEach(() => {
    _resetTextEngineForTests();
  });

  it('rejects with clear error when @chenglou/pretext is not installed', async () => {
    await assert.rejects(
      () => ensurePretext(),
      (err) => {
        assert.ok(
          err.message.includes('@chenglou/pretext'),
          `Error should mention '@chenglou/pretext', got: ${err.message}`
        );
        return true;
      }
    );
  });

  it('allows retry after failure (pretextLoadPromise reset to null)', async () => {
    try { await ensurePretext(); } catch (_) {}
    await assert.rejects(
      () => ensurePretext(),
      (err) => {
        assert.ok(err.message.includes('@chenglou/pretext'));
        return true;
      }
    );
  });

  it('returns the cached module on success when using _setPretextForTests', async () => {
    const fake = { prepare: () => {}, layout: () => {} };
    _setPretextForTests(fake);
    const result = await ensurePretext();
    assert.equal(result, fake);
  });

  it('returns the same module on repeated calls (caching)', async () => {
    const fake = { prepare: () => {}, layout: () => {} };
    _setPretextForTests(fake);
    const a = await ensurePretext();
    const b = await ensurePretext();
    assert.equal(a, b);
  });
});

// ─────────────────────────────────────────────
// Task 4: LRU measureText cache
// ─────────────────────────────────────────────

describe('measureText LRU cache', () => {
  beforeEach(() => {
    _resetTextEngineForTests();
  });

  function makeFakePretext() {
    const calls = { prepare: 0, prepareArgs: [] };
    const fake = {
      prepare(text, font) {
        calls.prepare++;
        calls.prepareArgs.push({ text, font });
        return { text, font };
      },
      layout(prepared, width, lineHeight) {
        return { prepared, width, lineHeight };
      },
      calls,
    };
    return fake;
  }

  it('prepare() called once per (font, text) pair, cached on repeat with different width', async () => {
    const fake = makeFakePretext();
    _setPretextForTests(fake);

    await measureText('hello', 'Arial 16px', 100, 1.5);
    await measureText('hello', 'Arial 16px', 200, 1.5);
    assert.equal(fake.calls.prepare, 1, 'prepare should only be called once for the same font+text');
  });

  it('re-prepares when text changes', async () => {
    const fake = makeFakePretext();
    _setPretextForTests(fake);

    await measureText('hello', 'Arial 16px', 100, 1.5);
    await measureText('world', 'Arial 16px', 100, 1.5);
    assert.equal(fake.calls.prepare, 2);
  });

  it('re-prepares when font changes', async () => {
    const fake = makeFakePretext();
    _setPretextForTests(fake);

    await measureText('hello', 'Arial 16px', 100, 1.5);
    await measureText('hello', 'Helvetica 16px', 100, 1.5);
    assert.equal(fake.calls.prepare, 2);
  });

  it('evicts oldest when cacheSize exceeded', async () => {
    configureText({ cacheSize: 2 });
    const fake = makeFakePretext();
    _setPretextForTests(fake);

    await measureText('a', 'Arial 16px', 100, 1.5); // oldest
    await measureText('b', 'Arial 16px', 100, 1.5);
    assert.equal(fake.calls.prepare, 2);

    // 3rd entry evicts oldest ("Arial 16px|a")
    await measureText('c', 'Arial 16px', 100, 1.5);
    assert.equal(fake.calls.prepare, 3);

    // 'a' was evicted, should re-prepare
    await measureText('a', 'Arial 16px', 100, 1.5);
    assert.equal(fake.calls.prepare, 4, 'evicted entry should require re-prepare');
  });

  it('returns the layout result', async () => {
    const fake = makeFakePretext();
    _setPretextForTests(fake);

    const result = await measureText('hello', 'Arial 16px', 200, 1.5);
    assert.ok(result, 'should return a result');
    assert.equal(result.width, 200);
    assert.equal(result.lineHeight, 1.5);
  });

  it('clearMeasureCache forces re-prepare', async () => {
    const fake = makeFakePretext();
    _setPretextForTests(fake);

    await measureText('hello', 'Arial 16px', 100, 1.5);
    assert.equal(fake.calls.prepare, 1);

    clearMeasureCache();
    await measureText('hello', 'Arial 16px', 100, 1.5);
    assert.equal(fake.calls.prepare, 2);
  });
});
