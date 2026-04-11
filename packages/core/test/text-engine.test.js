/**
 * Tests for text-engine.js — the internal adapter for @chenglou/pretext.
 * Covers: config, timing contract, lazy loader, LRU cache, font resolution, font-ready gate.
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
  resolveFontInfo,
  fontInfoToString,
  ensureFontsReady,
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
    // Stub document.fonts so ensureFontsReady resolves immediately
    global.document = {
      fonts: {
        ready: Promise.resolve(),
        addEventListener: () => {},
      },
    };
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

// ─────────────────────────────────────────────
// Task 5: Font resolution
// ─────────────────────────────────────────────

describe('resolveFontInfo and fontInfoToString', () => {
  let dom;

  beforeEach(async () => {
    _resetTextEngineForTests();
    const { JSDOM } = await import('jsdom');
    dom = new JSDOM('<!DOCTYPE html><html><body><div id="test" style="font-family: Arial; font-size: 14px; font-weight: bold; font-style: italic; line-height: 1.6;"></div></body></html>');
    global.document = dom.window.document;
    global.getComputedStyle = dom.window.getComputedStyle;
  });

  it('resolveFontInfo reads all 5 properties from the element', () => {
    const el = dom.window.document.getElementById('test');
    const info = resolveFontInfo(el);
    assert.ok(info.fontFamily, 'should have fontFamily');
    assert.ok(info.fontSize, 'should have fontSize');
    assert.ok(info.fontWeight, 'should have fontWeight');
    assert.ok(info.fontStyle, 'should have fontStyle');
    assert.ok(info.lineHeight, 'should have lineHeight');
    assert.ok(info.fontFamily.includes('Arial'), `expected Arial, got ${info.fontFamily}`);
    assert.ok(info.fontStyle.includes('italic'), `expected italic, got ${info.fontStyle}`);
  });

  it('fontInfoToString formats as Canvas font string', () => {
    const info = {
      fontFamily: 'Arial',
      fontSize: '14px',
      fontWeight: 'bold',
      fontStyle: 'italic',
      lineHeight: '1.6',
    };
    const result = fontInfoToString(info);
    assert.equal(result, 'italic bold 14px Arial');
  });

  it('resolveFontInfo falls back to defaults when getComputedStyle is unavailable', () => {
    const savedGetCS = global.getComputedStyle;
    delete global.getComputedStyle;
    try {
      const info = resolveFontInfo(null);
      assert.equal(info.fontFamily, 'sans-serif');
      assert.equal(info.fontSize, '16px');
      assert.equal(info.fontWeight, '400');
      assert.equal(info.fontStyle, 'normal');
    } finally {
      global.getComputedStyle = savedGetCS;
    }
  });
});

// ─────────────────────────────────────────────
// Task 6: Font-ready gate
// ─────────────────────────────────────────────

describe('ensureFontsReady font-ready gate', () => {
  beforeEach(() => {
    _resetTextEngineForTests();
  });

  it('measureText blocks until fonts.ready resolves', async () => {
    let resolveFonts;
    const fontsReadyPromise = new Promise((resolve) => { resolveFonts = resolve; });

    global.document = {
      fonts: {
        ready: fontsReadyPromise,
        addEventListener: () => {},
      },
    };

    const fake = {
      prepare(text, font) { return { text, font }; },
      layout(prepared, width, lineHeight) { return { prepared, width, lineHeight }; },
    };
    _setPretextForTests(fake);

    let measured = false;
    const measurePromise = measureText('hello', 'Arial 16px', 100, 1.5).then((r) => {
      measured = true;
      return r;
    });

    // Allow microtasks to run — measurement should not have completed yet
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(measured, false, 'measureText should not complete before fonts are ready');

    // Resolve fonts
    resolveFonts();
    const result = await measurePromise;
    assert.equal(measured, true);
    assert.ok(result);
  });

  it('subsequent measurements are not re-gated (instant after first resolve)', async () => {
    let callCount = 0;
    global.document = {
      fonts: {
        ready: Promise.resolve(),
        addEventListener: () => {},
      },
    };

    const fake = {
      prepare(text, font) { return { text, font }; },
      layout(prepared, width, lineHeight) { return { prepared, width, lineHeight, count: ++callCount }; },
    };
    _setPretextForTests(fake);

    // Resolve the gate once
    await ensureFontsReady();

    // Now measureText should use cached fontsReadyPromise
    const r1 = await measureText('hello', 'Arial 16px', 100, 1.5);
    const r2 = await measureText('world', 'Arial 16px', 100, 1.5);
    assert.equal(r1.count, 1);
    assert.equal(r2.count, 2);
  });

  it('resolves immediately in SSR/Node (no document.fonts)', async () => {
    const savedDoc = global.document;
    delete global.document;
    try {
      const p = ensureFontsReady();
      assert.ok(p instanceof Promise);
      await assert.doesNotReject(() => p);
    } finally {
      global.document = savedDoc;
    }
  });
});
