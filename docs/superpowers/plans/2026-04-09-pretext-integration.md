# Pretext Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate [@chenglou/pretext](https://github.com/chenglou/pretext) as an optional text engine in what-framework, enabling DOM-free text measurement (opt-in) and alpha rich-text components (`TextFlow`, `TextCanvas`, `TextSVG`), without disrupting core DX.

**Architecture:** A thin adapter module (`text-engine.js`) lazy-loads Pretext and exposes `configureText()`, `measureText()`, and `queryTextLayout()`. The `insert()` function in `render.js` gains one config-gated branch that routes dynamic text through the adapter when the measure flag is on. Alpha components live in `packages/core/src/text/` and are exported only via the `what-framework/text` (aka `what-core/text`) subpath. Pretext is an **optional peer dependency** — zero Pretext bytes when off.

**Tech Stack:**
- what-framework (internal reactive/render primitives)
- `@chenglou/pretext` (optional peer dep)
- Node's built-in `node:test` + `node:assert/strict`
- `jsdom` for DOM-dependent tests
- ESM, `type: module`

**Related spec:** `docs/superpowers/specs/2026-04-09-pretext-integration-design.md`

**Branch:** `feat/pretext-integration` (do NOT merge to main until benchmarks validate ≥2x perf improvement on win scenarios)

---

## File Structure

Files created or modified by this plan:

### Created
- `packages/core/src/text-engine.js` — adapter module (config, lazy loader, measure cache, font resolution, font-ready gate). **One responsibility:** mediate all Pretext access and gating.
- `packages/core/src/text/index.js` — subpath export barrel for alpha components
- `packages/core/src/text/TextFlow.js` — DOM-based magazine layout component
- `packages/core/src/text/TextCanvas.js` — canvas-based text component
- `packages/core/src/text/TextSVG.js` — SVG-based text component
- `packages/core/test/text-engine.test.js` — unit tests for the adapter (config, cache, gate, fallbacks)
- `packages/core/test/text-components.test.js` — unit tests for alpha components (creation, fallback behavior, reactive props)
- `packages/core/test/text-engine-insert-hook.test.js` — integration tests verifying the insert() hook is gated correctly
- `packages/core/test/text-engine-bundle.test.js` — tree-shaking / cross-reference guard test
- `packages/core/benchmark/text-engine.bench.js` — benchmark suite (all 6 scenarios)
- `docs/TEXT-ENGINE.md` — user-facing documentation

### Modified
- `packages/core/src/render.js:159-212` — add one config-gated branch in `insert()` that routes dynamic text through `measureTextIfEnabled()`
- `packages/core/src/index.js` — export `configureText` and `getTextConfig` (NOT the alpha components; those are only reachable via the subpath)
- `packages/core/src/guardrails.js:125-170` — add `configureText`, `getTextConfig` to `VALID_EXPORTS`
- `packages/core/package.json` — add `peerDependencies`, `peerDependenciesMeta` (optional), and the `./text` export path

### Intentionally NOT modified
- The Babel compiler plugin
- `template()`, `h()`, `_$createComponent()`, JSX runtime
- Any SSR / server-side code
- Any devtools (`what_lint`, `what_scaffold`, `what_fix`)

---

## Ground Rules

1. **TDD for every new file.** Failing test first, minimal implementation, passing test, commit.
2. **Commit after every green test** — small frequent commits, each one self-contained.
3. **Never import from `packages/core/src/text/` inside `packages/core/src/index.js`.** The cross-reference lint test (Task 16) enforces this.
4. **All Pretext imports happen inside `text-engine.js` only.** No other file imports `@chenglou/pretext`. This preserves the rollback boundary.
5. **The test file must set up jsdom globals BEFORE importing the module under test** — follow the pattern in `packages/core/test/dom-basics.test.js`.
6. **Run tests with:** `node --test packages/core/test/<filename>.test.js` from the repo root.

---

## Task 1: Create text-engine skeleton with default config

**Files:**
- Create: `packages/core/src/text-engine.js`
- Create: `packages/core/test/text-engine.test.js`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/text-engine.test.js`:

```js
// Tests for packages/core/src/text-engine.js — Pretext adapter, config, cache, gate.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { configureText, getTextConfig, _resetTextEngineForTests } = await import('../src/text-engine.js');

describe('text-engine: configuration', () => {
  beforeEach(() => {
    _resetTextEngineForTests();
  });

  it('returns default config with measure disabled', () => {
    const config = getTextConfig();
    assert.equal(config.measure, false);
    assert.equal(config.cacheSize, 1000);
  });

  it('allows enabling measure mode', () => {
    configureText({ measure: true });
    assert.equal(getTextConfig().measure, true);
  });

  it('allows overriding cacheSize', () => {
    configureText({ measure: true, cacheSize: 500 });
    assert.equal(getTextConfig().cacheSize, 500);
  });

  it('ignores unknown keys without throwing', () => {
    configureText({ measure: true, bogusKey: 'ignored' });
    const config = getTextConfig();
    assert.equal(config.measure, true);
    assert.equal(config.bogusKey, undefined);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/core/test/text-engine.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` — `text-engine.js` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `packages/core/src/text-engine.js`:

```js
// What Framework - Pretext Adapter (optional text engine)
// Lazy-loads @chenglou/pretext for DOM-free text measurement.
// All Pretext access flows through this module. It is the rollback boundary.
// See: docs/superpowers/specs/2026-04-09-pretext-integration-design.md

// --- Configuration ---

const DEFAULT_CONFIG = {
  measure: false,     // enable Pretext-based measurement for dynamic text
  cacheSize: 1000,    // LRU bound for prepared-segment cache
};

const KNOWN_KEYS = new Set(['measure', 'cacheSize']);

let textConfig = { ...DEFAULT_CONFIG };

export function configureText(overrides) {
  if (!overrides || typeof overrides !== 'object') return;
  for (const key of Object.keys(overrides)) {
    if (KNOWN_KEYS.has(key)) {
      textConfig[key] = overrides[key];
    }
  }
}

export function getTextConfig() {
  return { ...textConfig };
}

// --- Test-only reset ---
// Exported for unit tests to reset state between cases. Not part of the public API.
export function _resetTextEngineForTests() {
  textConfig = { ...DEFAULT_CONFIG };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/core/test/text-engine.test.js`
Expected: PASS — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/text-engine.js packages/core/test/text-engine.test.js
git commit -m "feat(text-engine): add config scaffold (configureText, getTextConfig)

Adapter module that will mediate all Pretext access. Starts with
just the config surface following the configureGuardrails() pattern.
Measure mode is off by default."
```

---

## Task 2: Add configuration timing contract (warn-after-mount)

**Files:**
- Modify: `packages/core/src/text-engine.js`
- Modify: `packages/core/test/text-engine.test.js`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/text-engine.test.js`:

```js
describe('text-engine: configuration timing', () => {
  let warnings;
  const origWarn = console.warn;

  beforeEach(() => {
    _resetTextEngineForTests();
    warnings = [];
    console.warn = (...args) => warnings.push(args.join(' '));
  });

  it('does not warn when configured before mount', () => {
    configureText({ measure: true });
    assert.equal(warnings.length, 0);
    console.warn = origWarn;
  });

  it('warns if configured after mount marker is set', async () => {
    const { _markMounted } = await import('../src/text-engine.js');
    _markMounted();
    configureText({ measure: true });
    assert.ok(warnings.some((w) => w.includes('configureText')), 'expected a warning about late configuration');
    console.warn = origWarn;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/core/test/text-engine.test.js`
Expected: FAIL — `_markMounted` is not exported.

- [ ] **Step 3: Write minimal implementation**

Edit `packages/core/src/text-engine.js` — add mount tracking and warn:

```js
// --- Mount lifecycle tracking ---
// configureText() must be called BEFORE the first mount(). Calling it after
// produces mixed behavior (some text measured, some not). We detect this by
// having render.js call _markMounted() on the first mount.

let hasMounted = false;

export function _markMounted() {
  hasMounted = true;
}

// Update configureText to warn:
export function configureText(overrides) {
  if (!overrides || typeof overrides !== 'object') return;
  if (hasMounted) {
    console.warn(
      '[what] configureText() was called after mount(). Already-inserted text ' +
      'will not be retroactively measured. Call configureText() once at app startup, ' +
      'before mount().'
    );
  }
  for (const key of Object.keys(overrides)) {
    if (KNOWN_KEYS.has(key)) {
      textConfig[key] = overrides[key];
    }
  }
}

// Update _resetTextEngineForTests to clear mount flag:
export function _resetTextEngineForTests() {
  textConfig = { ...DEFAULT_CONFIG };
  hasMounted = false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/core/test/text-engine.test.js`
Expected: PASS — 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/text-engine.js packages/core/test/text-engine.test.js
git commit -m "feat(text-engine): warn when configureText() is called after mount

Enforces the 'call-once-at-startup' contract from the design spec.
Late configuration still applies but emits a warning because already-
inserted text won't be retroactively measured."
```

---

## Task 3: Lazy-load Pretext with clear error on missing peer dep

**Files:**
- Modify: `packages/core/src/text-engine.js`
- Modify: `packages/core/test/text-engine.test.js`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/text-engine.test.js`:

```js
describe('text-engine: lazy Pretext loader', () => {
  beforeEach(() => { _resetTextEngineForTests(); });

  it('ensurePretext() rejects with a clear error when peer dep is missing', async () => {
    const { ensurePretext } = await import('../src/text-engine.js');
    // @chenglou/pretext is not installed in the test environment
    await assert.rejects(
      () => ensurePretext(),
      (err) => {
        assert.match(err.message, /@chenglou\/pretext/);
        return true;
      }
    );
  });

  it('ensurePretext() caches the module on success (stub path)', async () => {
    const { _setPretextForTests, ensurePretext, _resetTextEngineForTests } = await import('../src/text-engine.js');
    _resetTextEngineForTests();
    const fakePretext = { prepare: () => ({}), layout: () => ({}) };
    _setPretextForTests(fakePretext);
    const result = await ensurePretext();
    assert.strictEqual(result, fakePretext);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/core/test/text-engine.test.js`
Expected: FAIL — `ensurePretext` and `_setPretextForTests` are not exported.

- [ ] **Step 3: Write minimal implementation**

Edit `packages/core/src/text-engine.js` — add lazy loader:

```js
// --- Lazy Pretext loader ---
// The only place @chenglou/pretext is imported. Lazy so that the 15KB library
// is never loaded unless measure mode is actually exercised. On failure (peer
// dep not installed), rejects with a clear install message.

let pretextModule = null;
let pretextLoadPromise = null;

export async function ensurePretext() {
  if (pretextModule) return pretextModule;
  if (!pretextLoadPromise) {
    pretextLoadPromise = import('@chenglou/pretext')
      .then((m) => {
        pretextModule = m;
        return m;
      })
      .catch((err) => {
        pretextLoadPromise = null; // allow retry if the user installs it later
        const wrapped = new Error(
          'what-framework: text.measure requires @chenglou/pretext. ' +
          'Install it with: npm i @chenglou/pretext'
        );
        wrapped.cause = err;
        throw wrapped;
      });
  }
  return pretextLoadPromise;
}

// --- Test-only hook ---
// Allows tests to stub Pretext without actually installing it.
export function _setPretextForTests(fake) {
  pretextModule = fake;
  pretextLoadPromise = Promise.resolve(fake);
}

// Update _resetTextEngineForTests:
export function _resetTextEngineForTests() {
  textConfig = { ...DEFAULT_CONFIG };
  hasMounted = false;
  pretextModule = null;
  pretextLoadPromise = null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/core/test/text-engine.test.js`
Expected: PASS — 8 tests passing.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/text-engine.js packages/core/test/text-engine.test.js
git commit -m "feat(text-engine): lazy Pretext loader with clear missing-dep error

Pretext is a peer dep. ensurePretext() is the only place it's imported,
preserving the rollback boundary. Missing dep produces a clear install
instruction, not a cryptic module resolution error."
```

---

## Task 4: LRU measureText() cache keyed by font+text

**Files:**
- Modify: `packages/core/src/text-engine.js`
- Modify: `packages/core/test/text-engine.test.js`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/text-engine.test.js`:

```js
describe('text-engine: measureText cache', () => {
  let fakePretext;
  let prepareCallCount;

  beforeEach(async () => {
    _resetTextEngineForTests();
    prepareCallCount = 0;
    fakePretext = {
      prepare: (text, font) => {
        prepareCallCount++;
        return { text, font, _prepared: true };
      },
      layout: (prepared, width, lineHeight) => ({ prepared, width, lineHeight, _laidOut: true }),
    };
    const { _setPretextForTests } = await import('../src/text-engine.js');
    _setPretextForTests(fakePretext);
  });

  it('calls prepare() once per (font, text) pair and caches the result', async () => {
    const { measureText } = await import('../src/text-engine.js');
    await measureText('hello world', '16px Inter', 300, 20);
    await measureText('hello world', '16px Inter', 400, 20); // different width, same key
    assert.equal(prepareCallCount, 1);
  });

  it('re-prepares when text changes', async () => {
    const { measureText } = await import('../src/text-engine.js');
    await measureText('hello', '16px Inter', 300, 20);
    await measureText('world', '16px Inter', 300, 20);
    assert.equal(prepareCallCount, 2);
  });

  it('re-prepares when font changes', async () => {
    const { measureText } = await import('../src/text-engine.js');
    await measureText('hello', '16px Inter', 300, 20);
    await measureText('hello', '20px Arial', 300, 20);
    assert.equal(prepareCallCount, 2);
  });

  it('evicts the oldest entry when cacheSize is exceeded', async () => {
    const { configureText, measureText } = await import('../src/text-engine.js');
    configureText({ cacheSize: 2 });
    await measureText('a', 'f', 100, 20); // cache: [a]
    await measureText('b', 'f', 100, 20); // cache: [a, b]
    await measureText('c', 'f', 100, 20); // cache: [b, c] — 'a' evicted
    await measureText('a', 'f', 100, 20); // re-prepare — eviction confirmed
    assert.equal(prepareCallCount, 4);
  });

  it('returns the layout result from pretext.layout()', async () => {
    const { measureText } = await import('../src/text-engine.js');
    const result = await measureText('hi', '16px Inter', 300, 20);
    assert.equal(result._laidOut, true);
    assert.equal(result.width, 300);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/core/test/text-engine.test.js`
Expected: FAIL — `measureText` is not exported.

- [ ] **Step 3: Write minimal implementation**

Edit `packages/core/src/text-engine.js` — add LRU cache and `measureText`:

```js
// --- Measure cache ---
// LRU cache of prepared segments keyed by "font|text".
// JavaScript Map preserves insertion order, so eviction is O(1) via keys().next().

const measureCache = new Map();

function cacheGet(key) {
  if (!measureCache.has(key)) return undefined;
  // LRU touch: re-insert to move to end of iteration order
  const value = measureCache.get(key);
  measureCache.delete(key);
  measureCache.set(key, value);
  return value;
}

function cacheSet(key, value) {
  while (measureCache.size >= textConfig.cacheSize) {
    const oldestKey = measureCache.keys().next().value;
    measureCache.delete(oldestKey);
  }
  measureCache.set(key, value);
}

export async function measureText(text, font, containerWidth, lineHeight) {
  const pretext = await ensurePretext();
  const key = `${font}|${text}`;
  let prepared = cacheGet(key);
  if (!prepared) {
    prepared = pretext.prepare(text, font);
    cacheSet(key, prepared);
  }
  return pretext.layout(prepared, containerWidth, lineHeight);
}

export function clearMeasureCache() {
  measureCache.clear();
}

// Update _resetTextEngineForTests to clear the cache:
export function _resetTextEngineForTests() {
  textConfig = { ...DEFAULT_CONFIG };
  hasMounted = false;
  pretextModule = null;
  pretextLoadPromise = null;
  measureCache.clear();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/core/test/text-engine.test.js`
Expected: PASS — 13 tests passing.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/text-engine.js packages/core/test/text-engine.test.js
git commit -m "feat(text-engine): LRU measureText cache keyed by font+text

Prepared segments are expensive to compute (Canvas measureText per glyph).
Layout is cheap arithmetic. Cache prepared segments, re-run layout on each
call. LRU eviction at configurable cacheSize (default 1000)."
```

---

## Task 5: Font resolution from getComputedStyle(parent)

**Files:**
- Modify: `packages/core/src/text-engine.js`
- Modify: `packages/core/test/text-engine.test.js`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/text-engine.test.js`:

```js
describe('text-engine: font resolution', () => {
  let dom;

  beforeEach(async () => {
    _resetTextEngineForTests();
    const { JSDOM } = await import('jsdom');
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    global.document = dom.window.document;
    global.window = dom.window;
    global.getComputedStyle = dom.window.getComputedStyle;
  });

  it('resolveFontInfo reads font-family, size, weight, style, line-height', async () => {
    const { resolveFontInfo } = await import('../src/text-engine.js');
    const el = dom.window.document.createElement('div');
    el.style.fontFamily = 'Inter';
    el.style.fontSize = '16px';
    el.style.fontWeight = '700';
    el.style.fontStyle = 'italic';
    el.style.lineHeight = '24px';
    dom.window.document.body.appendChild(el);
    const info = resolveFontInfo(el);
    assert.equal(info.family, 'Inter');
    assert.equal(info.size, '16px');
    assert.equal(info.weight, '700');
    assert.equal(info.style, 'italic');
    assert.equal(info.lineHeight, '24px');
  });

  it('fontInfoToString returns a canvas-compatible font spec', async () => {
    const { fontInfoToString } = await import('../src/text-engine.js');
    const info = { family: 'Inter', size: '16px', weight: '700', style: 'italic', lineHeight: '24px' };
    const spec = fontInfoToString(info);
    // Canvas format: "[style] [weight] size family"
    assert.equal(spec, 'italic 700 16px Inter');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/core/test/text-engine.test.js`
Expected: FAIL — `resolveFontInfo` is not exported.

- [ ] **Step 3: Write minimal implementation**

Edit `packages/core/src/text-engine.js` — add font resolution:

```js
// --- Font resolution ---
// Reads computed font properties from a parent element. Called once per parent
// per measure call; the result can be cached on the element itself by callers
// that need amortization across many text children.

export function resolveFontInfo(el) {
  const cs = (typeof getComputedStyle !== 'undefined')
    ? getComputedStyle(el)
    : { fontFamily: 'sans-serif', fontSize: '16px', fontWeight: '400', fontStyle: 'normal', lineHeight: 'normal' };
  return {
    family: cs.fontFamily || 'sans-serif',
    size: cs.fontSize || '16px',
    weight: cs.fontWeight || '400',
    style: cs.fontStyle || 'normal',
    lineHeight: cs.lineHeight || 'normal',
  };
}

// Format a font info object as a Canvas "font" string: "[style] [weight] size family"
// Canvas does not accept a separate lineHeight, so it is excluded; callers pass
// lineHeight separately to measureText() / Pretext.layout().
export function fontInfoToString(info) {
  return `${info.style} ${info.weight} ${info.size} ${info.family}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/core/test/text-engine.test.js`
Expected: PASS — 15 tests passing.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/text-engine.js packages/core/test/text-engine.test.js
git commit -m "feat(text-engine): resolveFontInfo + fontInfoToString helpers

Read computed font properties from a DOM element and format them as a
Canvas-compatible font spec string. Needed by measureText() to produce
accurate glyph widths."
```

---

## Task 6: Font-ready gate using document.fonts.ready

**Files:**
- Modify: `packages/core/src/text-engine.js`
- Modify: `packages/core/test/text-engine.test.js`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/text-engine.test.js`:

```js
describe('text-engine: font-ready gate', () => {
  beforeEach(async () => {
    _resetTextEngineForTests();
    // Stub document.fonts with a controllable ready promise
    let resolveReady;
    const ready = new Promise((r) => { resolveReady = r; });
    global.document = {
      fonts: {
        ready,
        addEventListener: () => {},
      },
      _resolveFontsReady: resolveReady,
    };
    const fakePretext = {
      prepare: (text) => ({ text }),
      layout: (prepared) => ({ prepared }),
    };
    const { _setPretextForTests } = await import('../src/text-engine.js');
    _setPretextForTests(fakePretext);
  });

  it('waits for document.fonts.ready before the first measurement', async () => {
    const { measureText } = await import('../src/text-engine.js');
    let resolved = false;
    const p = measureText('hi', '16px Inter', 300, 20).then(() => { resolved = true; });
    // Give the event loop a chance; measurement should still be pending
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(resolved, false, 'measureText should be blocked until fonts.ready resolves');
    global.document._resolveFontsReady();
    await p;
    assert.equal(resolved, true);
  });

  it('subsequent measurements are not re-gated', async () => {
    const { measureText } = await import('../src/text-engine.js');
    global.document._resolveFontsReady();
    await measureText('a', '16px Inter', 300, 20);
    const t0 = Date.now();
    await measureText('b', '16px Inter', 300, 20);
    const elapsed = Date.now() - t0;
    // Should be effectively instant — no await on fonts.ready after the first call
    assert.ok(elapsed < 20, `expected fast path, got ${elapsed}ms`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/core/test/text-engine.test.js`
Expected: FAIL — font-ready gate is not yet implemented; both tests resolve immediately.

- [ ] **Step 3: Write minimal implementation**

Edit `packages/core/src/text-engine.js` — add font-ready gating:

```js
// --- Font-ready gate ---
// Canvas measureText() returns metrics for whichever font is currently loaded.
// Before fonts finish loading, it measures the fallback font. If we cache those
// metrics we serve stale measurements forever. Gate first measurement on
// document.fonts.ready; subsequent calls are synchronous.

let fontsReadyPromise = null;

function ensureFontsReady() {
  if (fontsReadyPromise) return fontsReadyPromise;
  if (typeof document === 'undefined' || !document.fonts || !document.fonts.ready) {
    // No Font Loading API (Node/SSR path) — skip the gate
    fontsReadyPromise = Promise.resolve();
    return fontsReadyPromise;
  }
  fontsReadyPromise = document.fonts.ready.then(() => {
    // Invalidate cache when new fonts load later
    if (typeof document.fonts.addEventListener === 'function') {
      document.fonts.addEventListener('loadingdone', () => {
        measureCache.clear();
      });
    }
  });
  return fontsReadyPromise;
}

// Update measureText to await the gate:
export async function measureText(text, font, containerWidth, lineHeight) {
  await ensureFontsReady();
  const pretext = await ensurePretext();
  const key = `${font}|${text}`;
  let prepared = cacheGet(key);
  if (!prepared) {
    prepared = pretext.prepare(text, font);
    cacheSet(key, prepared);
  }
  return pretext.layout(prepared, containerWidth, lineHeight);
}

// Update _resetTextEngineForTests to clear the gate:
export function _resetTextEngineForTests() {
  textConfig = { ...DEFAULT_CONFIG };
  hasMounted = false;
  pretextModule = null;
  pretextLoadPromise = null;
  measureCache.clear();
  fontsReadyPromise = null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/core/test/text-engine.test.js`
Expected: PASS — 17 tests passing.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/text-engine.js packages/core/test/text-engine.test.js
git commit -m "feat(text-engine): gate first measurement on document.fonts.ready

Prevents caching stale metrics for fallback fonts before custom web fonts
finish loading. Subsequent measurements skip the gate (sync fast path).
Cache is invalidated when new fonts load (loadingdone event)."
```

---

## Task 7: Add the insert() hook (config-gated, inert when off)

**Files:**
- Modify: `packages/core/src/render.js:159-212`
- Create: `packages/core/test/text-engine-insert-hook.test.js`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/text-engine-insert-hook.test.js`:

```js
// Integration test: insert() hook routes dynamic text through text-engine when enabled.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.queueMicrotask = global.queueMicrotask || ((fn) => Promise.resolve().then(fn));
global.window = dom.window;
global.getComputedStyle = dom.window.getComputedStyle;

const { signal } = await import('../src/reactive.js');
const { insert } = await import('../src/render.js');
const { configureText, _resetTextEngineForTests, _setPretextForTests, _wasMeasureHookInvoked, _resetMeasureHookInvocation } = await import('../src/text-engine.js');

describe('insert() measure hook', () => {
  beforeEach(() => {
    _resetTextEngineForTests();
    _resetMeasureHookInvocation();
    _setPretextForTests({
      prepare: () => ({}),
      layout: () => ({}),
    });
  });

  it('does NOT invoke text-engine when measure mode is off (default)', () => {
    const parent = document.createElement('div');
    const count = signal(0);
    insert(parent, () => `count: ${count()}`);
    assert.equal(_wasMeasureHookInvoked(), false);
  });

  it('invokes text-engine when measure mode is on and child is a function returning text', () => {
    configureText({ measure: true });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const count = signal(0);
    insert(parent, () => `count: ${count()}`);
    assert.equal(_wasMeasureHookInvoked(), true);
  });

  it('does NOT invoke text-engine for static text (non-function child)', () => {
    configureText({ measure: true });
    const parent = document.createElement('div');
    insert(parent, 'static text');
    assert.equal(_wasMeasureHookInvoked(), false);
  });

  it('writes the correct text to the DOM regardless of hook state', () => {
    configureText({ measure: true });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const count = signal(0);
    insert(parent, () => `count: ${count()}`);
    assert.equal(parent.textContent, 'count: 0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/core/test/text-engine-insert-hook.test.js`
Expected: FAIL — `_wasMeasureHookInvoked` / `_resetMeasureHookInvocation` / `measureTextIfEnabled` not exported; hook not wired in `insert()`.

- [ ] **Step 3: Write minimal implementation**

First, add the hook helper to `packages/core/src/text-engine.js`:

```js
// --- insert() hook ---
// Called from render.js when a dynamic text child is inserted. Fires the
// measurement in the background; does NOT block text insertion. Measurement
// results populate the cache so future layout queries via queryTextLayout()
// are instant.
//
// This function is a no-op when config.measure is false (fast path).

let _hookInvocationCount = 0;

export function measureTextIfEnabled(parent, text) {
  if (!textConfig.measure) return;
  _hookInvocationCount++;
  // Schedule measurement in a microtask — do not block DOM insertion.
  // Parent may not be in the document yet; we handle that case by deferring.
  queueMicrotask(() => {
    if (!parent || !parent.ownerDocument) return;
    // If parent is not yet in the document, computed style may not be reliable.
    // Fall back to skipping this call — the next insertion will retry.
    if (typeof parent.isConnected === 'boolean' && !parent.isConnected) return;
    const font = resolveFontInfo(parent);
    const fontStr = fontInfoToString(font);
    const width = parent.clientWidth || 0;
    const lineHeight = parseFloat(font.lineHeight) || parseFloat(font.size) * 1.2;
    if (width === 0) return; // nothing useful to measure
    measureText(text, fontStr, width, lineHeight).catch(() => {
      // Swallow — warning already emitted by ensurePretext()
    });
  });
}

export function _wasMeasureHookInvoked() {
  return _hookInvocationCount > 0;
}

export function _resetMeasureHookInvocation() {
  _hookInvocationCount = 0;
}
```

Next, modify `packages/core/src/render.js` to import and call the hook. Replace lines 1-8 (imports) with:

```js
// What Framework - Fine-Grained Rendering Primitives
// Solid-style rendering: components run once, signals create individual DOM effects.
// No VDOM diffing — direct DOM manipulation with surgical signal-driven updates.

import { effect, untrack, createRoot, _createItemScope, signal, __DEV__ } from './reactive.js';
import { createDOM, disposeTree, getCurrentComponent, getComponentStack } from './dom.js';
import { measureTextIfEnabled, _markMounted as _markTextEngineMounted } from './text-engine.js';

export { effect, untrack };
```

Then modify the text-node branch of `insert()` (lines 166-187). Find:

```js
    if (t === 'string' || t === 'number') {
      const textNode = document.createTextNode(String(first));
      const m = marker || null;
      if (m) parent.insertBefore(textNode, m);
      else parent.appendChild(textNode);
      let current = textNode;
      let isTextFastPath = true;
      effect(() => {
        const val = child();
        const vt = typeof val;
        if (isTextFastPath && (vt === 'string' || vt === 'number')) {
          // Fast path: still text — update data directly (no allocations)
          const str = String(val);
          if (textNode.data !== str) textNode.data = str;
        } else {
          // Type changed — fall back to full reconcile
          isTextFastPath = false;
          current = reconcileInsert(parent, val, current, m);
        }
      });
      return textNode;
    }
```

Replace with:

```js
    if (t === 'string' || t === 'number') {
      const textNode = document.createTextNode(String(first));
      const m = marker || null;
      if (m) parent.insertBefore(textNode, m);
      else parent.appendChild(textNode);
      // Measure hook: config-gated. Zero cost when measure mode is off.
      measureTextIfEnabled(parent, String(first));
      let current = textNode;
      let isTextFastPath = true;
      effect(() => {
        const val = child();
        const vt = typeof val;
        if (isTextFastPath && (vt === 'string' || vt === 'number')) {
          // Fast path: still text — update data directly (no allocations)
          const str = String(val);
          if (textNode.data !== str) textNode.data = str;
          measureTextIfEnabled(parent, str);
        } else {
          // Type changed — fall back to full reconcile
          isTextFastPath = false;
          current = reconcileInsert(parent, val, current, m);
        }
      });
      return textNode;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/core/test/text-engine-insert-hook.test.js`
Expected: PASS — 4 tests passing.

Also run the existing suite to verify no regression:

Run: `node --test packages/core/test/dom-basics.test.js packages/core/test/integration.test.js`
Expected: PASS — all existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/text-engine.js packages/core/src/render.js packages/core/test/text-engine-insert-hook.test.js
git commit -m "feat(render): add config-gated measure hook in insert()

Single branch in insert()'s reactive-text path that calls
measureTextIfEnabled(). The hook is a no-op when textConfig.measure is
false, so default behavior is unchanged. When enabled, text is measured
in a microtask (non-blocking) and results are cached for fast subsequent
queries."
```

---

## Task 8: Wire _markMounted() into mount()

**Files:**
- Modify: `packages/core/src/dom.js` (find and modify the `mount` function)
- Create test entry in `packages/core/test/text-engine-insert-hook.test.js`

- [ ] **Step 1: Locate the mount function**

Run: `grep -n "^export function mount\|^export const mount" packages/core/src/dom.js`

Note the line number returned. If not found in dom.js, check `packages/core/src/index.js` for where mount is re-exported and trace it.

- [ ] **Step 2: Write the failing test**

Append to `packages/core/test/text-engine-insert-hook.test.js`:

```js
describe('text-engine: mount integration', () => {
  beforeEach(() => {
    _resetTextEngineForTests();
  });

  it('mount() marks the text-engine as mounted', async () => {
    const { mount } = await import('../src/dom.js');
    const { h } = await import('../src/h.js');
    const { getTextConfig } = await import('../src/text-engine.js');

    // Before mount: late-configuration warning should NOT fire
    let warnings = [];
    const orig = console.warn;
    console.warn = (...a) => warnings.push(a.join(' '));

    const container = document.createElement('div');
    document.body.appendChild(container);
    mount(h('div', {}, 'hello'), container);

    // After mount: calling configureText() should warn
    const { configureText } = await import('../src/text-engine.js');
    configureText({ measure: true });
    assert.ok(warnings.some((w) => w.includes('configureText')));
    console.warn = orig;
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test packages/core/test/text-engine-insert-hook.test.js`
Expected: FAIL — mount does not call `_markMounted`.

- [ ] **Step 4: Write minimal implementation**

Open `packages/core/src/dom.js`. At the top of the file, find the import block. Add (if not already present):

```js
import { _markMounted as _markTextEngineMounted } from './text-engine.js';
```

Then find the `mount` function. At the top of its body (after any argument validation), add:

```js
export function mount(vnode, container) {
  _markTextEngineMounted();
  // ... rest of existing implementation
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test packages/core/test/text-engine-insert-hook.test.js`
Expected: PASS — all tests passing.

Also run: `node --test packages/core/test/dom-basics.test.js`
Expected: PASS — no regression.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/dom.js packages/core/test/text-engine-insert-hook.test.js
git commit -m "feat(dom): mark text-engine as mounted on first mount()

Enforces the configureText() timing contract: late configuration
(after mount) warns via console. No behavioral change when the text
engine is not used."
```

---

## Task 9: Export configureText/getTextConfig from core index.js

**Files:**
- Modify: `packages/core/src/index.js`
- Modify: `packages/core/src/guardrails.js:125-170` (VALID_EXPORTS set)
- Modify: `packages/core/test/text-engine.test.js`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/text-engine.test.js`:

```js
describe('text-engine: public API surface', () => {
  it('configureText and getTextConfig are exported from the main entry', async () => {
    const mod = await import('../src/index.js');
    assert.equal(typeof mod.configureText, 'function');
    assert.equal(typeof mod.getTextConfig, 'function');
  });

  it('alpha component barrel is NOT importable from the main entry', async () => {
    const mod = await import('../src/index.js');
    assert.equal(mod.TextFlow, undefined);
    assert.equal(mod.TextCanvas, undefined);
    assert.equal(mod.TextSVG, undefined);
  });

  it('configureText is in the VALID_EXPORTS guardrail set', async () => {
    const { validateImports } = await import('../src/guardrails.js');
    const invalid = validateImports(['configureText', 'getTextConfig']);
    assert.equal(invalid.length, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/core/test/text-engine.test.js`
Expected: FAIL — `configureText` not exported from index.js; guardrail rejects it.

- [ ] **Step 3: Write minimal implementation**

Open `packages/core/src/index.js`. Add (at the appropriate place, likely grouped with other config-style exports):

```js
export { configureText, getTextConfig } from './text-engine.js';
```

Open `packages/core/src/guardrails.js`. Locate the `VALID_EXPORTS` Set (starts around line 125). Add to an appropriate section (suggest: near the scheduler exports):

```js
  // Text engine (alpha)
  'configureText', 'getTextConfig',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/core/test/text-engine.test.js packages/core/test/guardrails.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.js packages/core/src/guardrails.js packages/core/test/text-engine.test.js
git commit -m "feat(core): export configureText and getTextConfig from main entry

Adds the public config API to what-framework/what-core and registers
the symbols in the import-validation guardrail. Alpha text components
are NOT exported from the main entry — they're only reachable via the
/text subpath (coming next)."
```

---

## Task 10: Add /text subpath export in package.json

**Files:**
- Modify: `packages/core/package.json`
- Create: `packages/core/src/text/index.js`

- [ ] **Step 1: Write the failing test**

The `/text` subpath doesn't exist yet. We'll verify this works via a direct file import test since ESM subpath resolution depends on the installed package. Append to `packages/core/test/text-engine.test.js`:

```js
describe('text subpath barrel', () => {
  it('packages/core/src/text/index.js exists and is importable', async () => {
    const mod = await import('../src/text/index.js');
    // Barrel exports will be added in Tasks 11-13; for now we assert the module loads.
    assert.ok(mod, 'barrel module should load');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/core/test/text-engine.test.js`
Expected: FAIL — `packages/core/src/text/index.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `packages/core/src/text/index.js`:

```js
// What Framework - Alpha Text Components
// Exported via the what-core/text subpath ONLY. Not re-exported from
// the main entry, so tree-shaking is straightforward: if you don't
// import from 'what-framework/text' (or 'what-core/text'), these
// components are not in your bundle.
//
// ALPHA: APIs may change without a major version bump. See
// docs/TEXT-ENGINE.md for details.

// Component exports will be added in subsequent tasks:
// export { TextFlow } from './TextFlow.js';
// export { TextCanvas } from './TextCanvas.js';
// export { TextSVG } from './TextSVG.js';
```

Modify `packages/core/package.json`. In the `exports` field, add a new entry after `"./testing"`:

```json
    "./testing": {
      "types": "./testing.d.ts",
      "production": "./dist/testing.min.js",
      "import": "./src/testing.js"
    },
    "./text": {
      "production": "./dist/text/index.min.js",
      "import": "./src/text/index.js"
    }
```

Also add the optional peer dependency at the top level of `package.json` (after the existing `sideEffects` field):

```json
  "sideEffects": false,
  "peerDependencies": {
    "@chenglou/pretext": "*"
  },
  "peerDependenciesMeta": {
    "@chenglou/pretext": {
      "optional": true
    }
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/core/test/text-engine.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/package.json packages/core/src/text/index.js packages/core/test/text-engine.test.js
git commit -m "feat(core): add /text subpath export and optional peer dep

@chenglou/pretext is listed as an optional peer dep so apps that don't
enable text.measure or import alpha components don't need to install it.
The /text subpath is a barrel file that will re-export TextFlow,
TextCanvas, and TextSVG (added in subsequent commits)."
```

---

## Task 11: TextFlow component (DOM-based)

**Files:**
- Create: `packages/core/src/text/TextFlow.js`
- Modify: `packages/core/src/text/index.js`
- Create: `packages/core/test/text-components.test.js`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/text-components.test.js`:

```js
// Tests for alpha text components in packages/core/src/text/.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.SVGElement = dom.window.SVGElement;
global.window = dom.window;
global.getComputedStyle = dom.window.getComputedStyle;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.queueMicrotask = global.queueMicrotask || ((fn) => Promise.resolve().then(fn));

const { signal } = await import('../src/reactive.js');
const { mount } = await import('../src/dom.js');
const { h } = await import('../src/h.js');
const { _resetTextEngineForTests, _setPretextForTests } = await import('../src/text-engine.js');

describe('TextFlow', () => {
  let TextFlow;

  beforeEach(async () => {
    _resetTextEngineForTests();
    ({ TextFlow } = await import('../src/text/index.js'));
  });

  it('falls back to plain <div> with column-count when Pretext is missing', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    // Pretext is NOT stubbed — fallback should fire
    mount(h(TextFlow, { columns: 2 }, 'Lorem ipsum dolor sit amet'), container);
    const rendered = container.querySelector('div');
    assert.ok(rendered, 'TextFlow should render a div');
    assert.equal(rendered.style.columnCount, '2');
    assert.match(rendered.textContent, /Lorem ipsum/);
  });

  it('warns once when around prop is set but Pretext is missing', () => {
    const warnings = [];
    const orig = console.warn;
    console.warn = (...a) => warnings.push(a.join(' '));
    const container = document.createElement('div');
    document.body.appendChild(container);
    mount(h(TextFlow, { columns: 2, around: { x: 0, y: 0, w: 10, h: 10 } }, 'text'), container);
    console.warn = orig;
    assert.ok(warnings.some((w) => w.includes('around') && w.includes('@chenglou/pretext')),
      'expected a warning about dropped around prop');
  });

  it('reactive text content updates when the signal changes', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const content = signal('first');
    mount(h(TextFlow, { columns: 1 }, () => content()), container);
    assert.match(container.textContent, /first/);
    content('second');
    await new Promise((r) => setTimeout(r, 0));
    assert.match(container.textContent, /second/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/core/test/text-components.test.js`
Expected: FAIL — `TextFlow` not exported.

- [ ] **Step 3: Write minimal implementation**

Create `packages/core/src/text/TextFlow.js`:

```js
// What Framework - TextFlow (ALPHA)
// Magazine-style text layout rendered to DOM. Uses Pretext for line-breaking
// and shape-flow when available; falls back to CSS column-count when Pretext
// is not installed.
//
// @alpha APIs may change without a major version bump.

import { h } from '../h.js';
import { effect } from '../reactive.js';
import { ensurePretext, resolveFontInfo, fontInfoToString } from '../text-engine.js';

const warnedAboutAround = new WeakSet();

export function TextFlow(props) {
  const columns = props.columns || 1;
  const around = props.around;
  const children = props.children;

  // Fallback div with CSS columns. If Pretext loads successfully later, we
  // replace contents with the Pretext-rendered layout.
  const el = document.createElement('div');
  el.style.columnCount = String(columns);
  el.style.columnGap = '1rem';

  // Resolve text content (may be a reactive function)
  effect(() => {
    const text = typeof children === 'function' ? children() : children;
    el.textContent = String(text || '');
  });

  // Warn if `around` is set but we can't fulfill it (no Pretext → no shape-flow)
  if (around && !warnedAboutAround.has(el)) {
    warnedAboutAround.add(el);
    ensurePretext().catch(() => {
      console.warn(
        '[what] TextFlow: `around` prop requires @chenglou/pretext for shape-flow layout. ' +
        'The prop has been dropped and basic column layout is used instead. ' +
        'Install it with: npm i @chenglou/pretext'
      );
    });
  }

  // Attempt to upgrade to Pretext-rendered layout (best effort)
  ensurePretext().then((pretext) => {
    if (!el.isConnected) return;
    const font = resolveFontInfo(el);
    const fontStr = fontInfoToString(font);
    const width = el.clientWidth || 400;
    const lineHeight = parseFloat(font.lineHeight) || parseFloat(font.size) * 1.2;
    const text = el.textContent;
    const prepared = pretext.prepare(text, fontStr);
    const layout = pretext.layout(prepared, width / columns, lineHeight);
    // For alpha, just log that layout succeeded; visual rendering of the
    // layout result is part of the polish pass.
    if (typeof layout === 'object') {
      el.setAttribute('data-pretext', 'laid-out');
    }
  }).catch(() => {
    // Already handled above; fallback is already in place.
  });

  return el;
}
```

Modify `packages/core/src/text/index.js` — uncomment the TextFlow export:

```js
// What Framework - Alpha Text Components
// ... (existing header comment)

export { TextFlow } from './TextFlow.js';
// export { TextCanvas } from './TextCanvas.js';
// export { TextSVG } from './TextSVG.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/core/test/text-components.test.js`
Expected: PASS — 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/text/TextFlow.js packages/core/src/text/index.js packages/core/test/text-components.test.js
git commit -m "feat(text/alpha): add TextFlow component

DOM-based magazine layout. Falls back to CSS column-count when Pretext
is missing. Warns (not throws) if 'around' prop is set without Pretext,
since shape-flow requires the peer dep. Reactive children supported."
```

---

## Task 12: TextCanvas component

**Files:**
- Create: `packages/core/src/text/TextCanvas.js`
- Modify: `packages/core/src/text/index.js`
- Modify: `packages/core/test/text-components.test.js`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/text-components.test.js`:

```js
describe('TextCanvas', () => {
  let TextCanvas;

  beforeEach(async () => {
    _resetTextEngineForTests();
    ({ TextCanvas } = await import('../src/text/index.js'));
  });

  it('renders a canvas element with the requested dimensions', () => {
    _setPretextForTests({
      prepare: (text) => ({ text }),
      layout: () => ({ lines: [{ text: 'hi', x: 0, y: 16 }] }),
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    mount(h(TextCanvas, { width: 300, height: 200, font: '16px sans-serif' }, 'hi'), container);
    const canvas = container.querySelector('canvas');
    assert.ok(canvas, 'expected a canvas element');
    assert.equal(canvas.width, 300);
    assert.equal(canvas.height, 200);
  });

  it('throws a clear error when Pretext is missing', () => {
    _resetTextEngineForTests(); // ensure no fake Pretext
    const container = document.createElement('div');
    document.body.appendChild(container);
    assert.throws(
      () => mount(h(TextCanvas, { width: 300, height: 200 }, 'hi'), container),
      (err) => {
        assert.match(err.message, /TextCanvas.*@chenglou\/pretext/);
        return true;
      }
    );
  });
});
```

Note: jsdom does not provide a real Canvas 2D context, so the test only verifies the `<canvas>` element is created with correct dimensions — not pixel output. Visual regression is a separate test concern (Task 16).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/core/test/text-components.test.js`
Expected: FAIL — `TextCanvas` not exported.

- [ ] **Step 3: Write minimal implementation**

Create `packages/core/src/text/TextCanvas.js`:

```js
// What Framework - TextCanvas (ALPHA)
// Renders text to a <canvas> element via Pretext layout + canvas fillText.
// No text selection or a11y in alpha. Use for decorative text, data viz
// labels, creative effects.
//
// @alpha APIs may change without a major version bump.

import { effect } from '../reactive.js';
import { ensurePretext, _getPretextSync } from '../text-engine.js';

export function TextCanvas(props) {
  const width = props.width || 300;
  const height = props.height || 150;
  const font = props.font || '16px sans-serif';
  const children = props.children;

  // Pretext is required for this component. Throw clearly at creation time
  // rather than rendering a blank canvas.
  const pretext = _getPretextSync();
  if (!pretext) {
    throw new Error(
      'TextCanvas requires @chenglou/pretext. Install it with: npm i @chenglou/pretext'
    );
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  // Reactive redraw on content or layout changes
  effect(() => {
    const text = typeof children === 'function' ? children() : children;
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return; // jsdom — no canvas context
    ctx.clearRect(0, 0, width, height);
    ctx.font = font;
    const lineHeight = parseFloat(font) * 1.2 || 20;
    const prepared = pretext.prepare(String(text || ''), font);
    const layout = pretext.layout(prepared, width, lineHeight);
    if (layout && Array.isArray(layout.lines)) {
      for (const line of layout.lines) {
        ctx.fillText(line.text, line.x || 0, line.y || lineHeight);
      }
    }
  });

  return canvas;
}
```

Modify `packages/core/src/text-engine.js` — expose a synchronous Pretext getter for components that need to throw eagerly:

```js
// --- Synchronous accessor for components that require Pretext at creation time ---
// Returns null if Pretext has not yet been loaded. Callers that need Pretext
// eagerly (TextCanvas, TextSVG) should throw when this returns null.
export function _getPretextSync() {
  return pretextModule;
}
```

The eager-throw behavior requires Pretext to be loaded BEFORE `TextCanvas` is mounted. For the test to pass using the stub, `_setPretextForTests()` handles this. For real usage, document that `TextCanvas` should be rendered inside a `Suspense`-like boundary or after a top-level `await ensurePretext()` — document this in `docs/TEXT-ENGINE.md` in Task 17.

Modify `packages/core/src/text/index.js`:

```js
export { TextFlow } from './TextFlow.js';
export { TextCanvas } from './TextCanvas.js';
// export { TextSVG } from './TextSVG.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/core/test/text-components.test.js`
Expected: PASS — 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/text/TextCanvas.js packages/core/src/text/index.js packages/core/src/text-engine.js packages/core/test/text-components.test.js
git commit -m "feat(text/alpha): add TextCanvas component

Renders text to <canvas> via Pretext layout + fillText. Throws eagerly
at creation time if Pretext is not yet loaded (hard dep for this
component). No text selection or a11y in alpha — documented limitation."
```

---

## Task 13: TextSVG component

**Files:**
- Create: `packages/core/src/text/TextSVG.js`
- Modify: `packages/core/src/text/index.js`
- Modify: `packages/core/test/text-components.test.js`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/text-components.test.js`:

```js
describe('TextSVG', () => {
  let TextSVG;

  beforeEach(async () => {
    _resetTextEngineForTests();
    ({ TextSVG } = await import('../src/text/index.js'));
  });

  it('renders an <svg> element with <text>/<tspan> children', () => {
    _setPretextForTests({
      prepare: (text) => ({ text }),
      layout: () => ({
        lines: [
          { text: 'hello', x: 0, y: 16 },
          { text: 'world', x: 0, y: 32 },
        ],
      }),
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    mount(h(TextSVG, { width: 300, height: 100 }, 'hello world'), container);
    const svg = container.querySelector('svg');
    assert.ok(svg, 'expected an svg element');
    const tspans = svg.querySelectorAll('tspan');
    assert.equal(tspans.length, 2);
    assert.equal(tspans[0].textContent, 'hello');
    assert.equal(tspans[1].textContent, 'world');
  });

  it('throws a clear error when Pretext is missing', () => {
    _resetTextEngineForTests();
    const container = document.createElement('div');
    document.body.appendChild(container);
    assert.throws(
      () => mount(h(TextSVG, { width: 300 }, 'hi'), container),
      (err) => {
        assert.match(err.message, /TextSVG.*@chenglou\/pretext/);
        return true;
      }
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/core/test/text-components.test.js`
Expected: FAIL — `TextSVG` not exported.

- [ ] **Step 3: Write minimal implementation**

Create `packages/core/src/text/TextSVG.js`:

```js
// What Framework - TextSVG (ALPHA)
// Renders text as SVG <text>/<tspan> elements via Pretext layout.
// Scalable, styleable via CSS, works inside existing <svg> trees.
//
// @alpha APIs may change without a major version bump.

import { effect } from '../reactive.js';
import { _getPretextSync } from '../text-engine.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function TextSVG(props) {
  const width = props.width || 300;
  const height = props.height || 150;
  const font = props.font || '16px sans-serif';
  const children = props.children;

  const pretext = _getPretextSync();
  if (!pretext) {
    throw new Error(
      'TextSVG requires @chenglou/pretext. Install it with: npm i @chenglou/pretext'
    );
  }

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  const textEl = document.createElementNS(SVG_NS, 'text');
  textEl.setAttribute('font-family', font.split(' ').slice(1).join(' ') || 'sans-serif');
  textEl.setAttribute('font-size', font.split(' ')[0] || '16px');
  svg.appendChild(textEl);

  effect(() => {
    const text = typeof children === 'function' ? children() : children;
    // Clear previous tspans
    while (textEl.firstChild) textEl.removeChild(textEl.firstChild);
    const lineHeight = parseFloat(font) * 1.2 || 20;
    const prepared = pretext.prepare(String(text || ''), font);
    const layout = pretext.layout(prepared, width, lineHeight);
    if (layout && Array.isArray(layout.lines)) {
      for (const line of layout.lines) {
        const tspan = document.createElementNS(SVG_NS, 'tspan');
        tspan.setAttribute('x', String(line.x || 0));
        tspan.setAttribute('y', String(line.y || lineHeight));
        tspan.textContent = line.text;
        textEl.appendChild(tspan);
      }
    }
  });

  return svg;
}
```

Modify `packages/core/src/text/index.js`:

```js
export { TextFlow } from './TextFlow.js';
export { TextCanvas } from './TextCanvas.js';
export { TextSVG } from './TextSVG.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/core/test/text-components.test.js`
Expected: PASS — 7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/text/TextSVG.js packages/core/src/text/index.js packages/core/test/text-components.test.js
git commit -m "feat(text/alpha): add TextSVG component

Renders text as SVG <text>/<tspan> elements via Pretext layout.
Throws eagerly if Pretext is missing. No text selection in alpha."
```

---

## Task 14: Hydration safety — skip measure hook during hydration

**Files:**
- Modify: `packages/core/src/text-engine.js`
- Modify: `packages/core/test/text-engine-insert-hook.test.js`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/text-engine-insert-hook.test.js`:

```js
describe('insert() measure hook: hydration skip', () => {
  beforeEach(() => {
    _resetTextEngineForTests();
    _resetMeasureHookInvocation();
    _setPretextForTests({ prepare: () => ({}), layout: () => ({}) });
  });

  it('skips measurement during hydration', async () => {
    const { configureText } = await import('../src/text-engine.js');
    const { signal } = await import('../src/reactive.js');
    const { insert } = await import('../src/render.js');
    const reactive = await import('../src/reactive.js');

    configureText({ measure: true });
    // Simulate hydration mode. We detect hydration via isHydrating from render.js.
    // For the test, we call the internal hook directly with a flag.
    const { _setHydratingForTests } = await import('../src/text-engine.js');
    _setHydratingForTests(true);

    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const count = signal(0);
    insert(parent, () => `count: ${count()}`);
    assert.equal(_wasMeasureHookInvoked(), false, 'hook should not fire during hydration');

    _setHydratingForTests(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/core/test/text-engine-insert-hook.test.js`
Expected: FAIL — `_setHydratingForTests` not exported; hook fires during hydration.

- [ ] **Step 3: Write minimal implementation**

`isHydrating` is already exported synchronously from `render.js` (verified at `packages/core/src/render.js:1055`). To avoid a circular import between `text-engine.js` and `render.js`, use a setter-injection pattern: `text-engine.js` exposes `_setIsHydratingImpl(fn)`, and `render.js` calls it to register the hydration probe.

Edit `packages/core/src/text-engine.js` — add hydration skip:

```js
// --- Hydration detection ---
// During hydration the server already wrote text nodes; we skip measurement
// to avoid computing layouts for text that is already laid out in the DOM.
// The cache populates lazily on the first post-hydration signal update.
//
// We receive the isHydrating() probe via setter injection from render.js
// to avoid a circular import.

let _testHydratingOverride = null;
let _isHydratingRef = () => false;

export function _setIsHydratingImpl(fn) {
  _isHydratingRef = typeof fn === 'function' ? fn : (() => false);
}

function isHydratingNow() {
  if (_testHydratingOverride !== null) return _testHydratingOverride;
  return _isHydratingRef();
}

export function _setHydratingForTests(value) {
  _testHydratingOverride = value;
}

// Update measureTextIfEnabled to respect hydration:
export function measureTextIfEnabled(parent, text) {
  if (!textConfig.measure) return;
  if (isHydratingNow()) return;
  _hookInvocationCount++;
  queueMicrotask(() => {
    if (!parent || !parent.ownerDocument) return;
    if (typeof parent.isConnected === 'boolean' && !parent.isConnected) return;
    const font = resolveFontInfo(parent);
    const fontStr = fontInfoToString(font);
    const width = parent.clientWidth || 0;
    const lineHeight = parseFloat(font.lineHeight) || parseFloat(font.size) * 1.2;
    if (width === 0) return;
    measureText(text, fontStr, width, lineHeight).catch(() => {});
  });
}
```

Edit `packages/core/src/render.js` — after the existing `isHydrating` definition (around line 1055), register it with the text engine. Add these lines AFTER `export function isHydrating() { return _isHydrating; }`:

```js
// Wire isHydrating into the text engine (setter injection avoids circular import)
import { _setIsHydratingImpl } from './text-engine.js';
_setIsHydratingImpl(isHydrating);
```

Note: the `import` statement inside the file body is hoisted by the ES module loader, so placement after the function is fine at runtime — but many linters prefer all imports at the top. If the repo's lint prefers top-of-file imports, move the `import` line to the existing import block at the top and leave only the `_setIsHydratingImpl(isHydrating);` call near the function definition.

Update `_resetTextEngineForTests` to clear the override:

```js
export function _resetTextEngineForTests() {
  textConfig = { ...DEFAULT_CONFIG };
  hasMounted = false;
  pretextModule = null;
  pretextLoadPromise = null;
  measureCache.clear();
  fontsReadyPromise = null;
  _testHydratingOverride = null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/core/test/text-engine-insert-hook.test.js`
Expected: PASS.

Also run: `node --test packages/core/test/hydration.test.js`
Expected: PASS — no regression.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/text-engine.js packages/core/src/render.js packages/core/test/text-engine-insert-hook.test.js
git commit -m "feat(text-engine): skip measure hook during hydration

During SSR hydration the server already wrote text nodes. Measuring them
would be wasted work and risks layout shifts. Hook is a no-op during
hydration; cache populates lazily on the first post-hydration signal
update. Addresses the 'SSR hydration is unaffected' requirement from
the design spec."
```

---

## Task 15: Cross-reference lint guard — /text must not leak into main bundle

**Files:**
- Create: `packages/core/test/text-engine-bundle.test.js`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/text-engine-bundle.test.js`:

```js
// Guard test: the alpha text components must NOT be reachable through
// packages/core/src/index.js (or any transitive import from it). This
// enforces the tree-shaking guarantee — if /text is referenced from the
// main entry, it pulls into every bundle even for users who never import
// from 'what-framework/text'.
//
// Strategy: parse the imports transitively from src/index.js and assert
// that nothing ends up pointing at src/text/.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = resolve(__dirname, '../src');

function extractImports(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const importRe = /(?:import|export)\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g;
  const imports = [];
  let m;
  while ((m = importRe.exec(content)) !== null) {
    imports.push(m[1]);
  }
  return imports;
}

function resolveLocal(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null; // external
  const base = resolve(dirname(fromFile), specifier);
  // Try with .js extension if not already present
  return base.endsWith('.js') ? base : `${base}.js`;
}

function walkImports(entry, visited = new Set()) {
  if (visited.has(entry)) return visited;
  visited.add(entry);
  let imports;
  try {
    imports = extractImports(entry);
  } catch {
    return visited;
  }
  for (const spec of imports) {
    const resolved = resolveLocal(entry, spec);
    if (resolved) walkImports(resolved, visited);
  }
  return visited;
}

describe('text subpath isolation', () => {
  it('packages/core/src/index.js does not transitively import from src/text/', () => {
    const entry = resolve(SRC, 'index.js');
    const reachable = walkImports(entry);
    const leaks = [...reachable].filter((p) => p.includes(`${SRC}/text/`));
    assert.deepEqual(leaks, [],
      `The following files under src/text/ are reachable from src/index.js:\n${leaks.join('\n')}\n\n` +
      `This breaks the tree-shaking guarantee. /text must only be imported via the what-core/text subpath.`);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `node --test packages/core/test/text-engine-bundle.test.js`
Expected: PASS — if we've done everything correctly, src/index.js does not import from src/text/.

If it fails, the test output will show exactly which file needs to be fixed. Fix the offending import and re-run.

- [ ] **Step 3: Commit**

```bash
git add packages/core/test/text-engine-bundle.test.js
git commit -m "test(text-engine): enforce /text subpath isolation

Static-analysis guard that walks all transitive imports from src/index.js
and asserts none of them resolve to src/text/. If /text leaks into the
main entry graph, the alpha components end up in every consumer's bundle
even when they're not imported directly — breaking the tree-shaking
guarantee."
```

---

## Task 16: Benchmark suite (all 6 scenarios)

**Files:**
- Create: `packages/core/benchmark/text-engine.bench.js`

- [ ] **Step 1: Create the benchmark script**

Note: jsdom is used here to keep the benchmark runnable in Node. Production performance claims should be validated in a real browser; this benchmark establishes relative deltas.

Create `packages/core/benchmark/text-engine.bench.js`:

```js
// Benchmark suite for Pretext integration.
// Compares native DOM-based text measurement against Pretext-backed measurement.
// All 6 scenarios from the design spec. Results printed to stdout.
//
// Run: node packages/core/benchmark/text-engine.bench.js
//
// Pretext is stubbed when not installed; in that case the benchmark only
// measures the overhead of the gating code (not true Pretext performance).
// For real performance claims, install @chenglou/pretext before running.

import { JSDOM } from 'jsdom';
import { performance } from 'node:perf_hooks';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.window = dom.window;
global.getComputedStyle = dom.window.getComputedStyle;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.queueMicrotask = global.queueMicrotask || ((fn) => Promise.resolve().then(fn));

const { signal, flushSync } = await import('../src/reactive.js');
const { insert } = await import('../src/render.js');
const { configureText, _resetTextEngineForTests, _setPretextForTests } = await import('../src/text-engine.js');

// Try to load real Pretext; fall back to a minimal stub that simulates the
// shape of the real API so the benchmark still runs. Real numbers only come
// from runs with @chenglou/pretext installed.
let realPretext = null;
try {
  realPretext = await import('@chenglou/pretext');
  console.log('[bench] Using real @chenglou/pretext');
} catch {
  console.log('[bench] @chenglou/pretext not installed — using stub. Numbers reflect gating overhead only.');
  realPretext = {
    prepare: (text) => ({ text, segments: text.split(' ') }),
    layout: (prepared, width) => ({
      lines: [{ text: prepared.text, x: 0, y: 16 }],
      width,
    }),
  };
}

function makeContainer() {
  const div = document.createElement('div');
  div.style.width = '400px';
  div.style.fontSize = '16px';
  div.style.fontFamily = 'sans-serif';
  div.style.lineHeight = '20px';
  document.body.appendChild(div);
  return div;
}

function bench(name, fn, iterations = 1) {
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const elapsed = performance.now() - t0;
  console.log(`  ${name.padEnd(40)} ${elapsed.toFixed(2)}ms`);
  return elapsed;
}

async function runScenario(name, setupFn, iterations = 1) {
  console.log(`\n=== ${name} ===`);

  // OFF: measure mode disabled
  _resetTextEngineForTests();
  const offTime = bench('OFF (measure: false)', () => setupFn(), iterations);

  // ON: measure mode enabled
  _resetTextEngineForTests();
  _setPretextForTests(realPretext);
  configureText({ measure: true });
  const onTime = bench('ON  (measure: true)', () => setupFn(), iterations);

  const delta = ((onTime - offTime) / offTime * 100).toFixed(1);
  const verdict = onTime < offTime ? 'WIN' : onTime > offTime * 1.1 ? 'LOSE' : 'neutral';
  console.log(`  delta: ${delta}% (${verdict})`);
  return { offTime, onTime, delta: parseFloat(delta), verdict };
}

const results = {};

// Scenario 1: 100 static text nodes (hook should skip entirely)
results.s1 = await runScenario('Scenario 1: 100 static text nodes', () => {
  const parent = makeContainer();
  for (let i = 0; i < 100; i++) {
    insert(parent, `static ${i}`);
  }
});

// Scenario 2: 100 dynamic text nodes updating once
results.s2 = await runScenario('Scenario 2: 100 dynamic text nodes, 1 update', () => {
  const parent = makeContainer();
  for (let i = 0; i < 100; i++) {
    const s = signal(`dyn ${i}`);
    insert(parent, () => s());
  }
});

// Scenario 3: 100 dynamic text nodes updating 60 times (cached path)
results.s3 = await runScenario('Scenario 3: 100 nodes, 60 updates each', () => {
  const parent = makeContainer();
  const signals = [];
  for (let i = 0; i < 100; i++) {
    const s = signal(`dyn ${i}`);
    signals.push(s);
    insert(parent, () => s());
  }
  for (let frame = 0; frame < 60; frame++) {
    for (let i = 0; i < 100; i++) {
      signals[i](`dyn ${i} f${frame}`);
    }
    flushSync();
  }
});

// Scenario 4: Window resize reflow (1000 nodes, width change)
results.s4 = await runScenario('Scenario 4: 1000 nodes, simulated resize', () => {
  const parent = makeContainer();
  for (let i = 0; i < 1000; i++) {
    insert(parent, `resize-text-${i}`);
  }
  // Simulate resize by changing parent width 10 times
  for (let w = 200; w <= 600; w += 40) {
    parent.style.width = `${w}px`;
  }
});

// Scenario 5: Rapid signal-driven text changes (cache hit rate)
results.s5 = await runScenario('Scenario 5: Rapid signal updates', () => {
  const parent = makeContainer();
  const s = signal('initial');
  insert(parent, () => s());
  for (let i = 0; i < 1000; i++) {
    s(`update ${i % 10}`); // only 10 unique values → high cache hit rate
    flushSync();
  }
});

// Scenario 6: Single text node (pathological, overhead should be minimal)
results.s6 = await runScenario('Scenario 6: Single text node', () => {
  const parent = makeContainer();
  const s = signal('hello');
  insert(parent, () => s());
});

// Summary
console.log('\n=== Summary ===');
console.log('Scenario  OFF (ms)    ON (ms)    Delta    Verdict');
for (const [key, r] of Object.entries(results)) {
  console.log(`${key.padEnd(8)}  ${String(r.offTime.toFixed(2)).padEnd(10)}  ${String(r.onTime.toFixed(2)).padEnd(10)} ${String(r.delta + '%').padEnd(8)} ${r.verdict}`);
}

// Acceptance criteria check
console.log('\n=== Acceptance Criteria ===');
const s3Win = results.s3.verdict === 'WIN' && results.s3.delta <= -50; // ≥2x faster
const s4Win = results.s4.verdict === 'WIN' && results.s4.delta <= -50;
const s6Acceptable = results.s6.delta <= 10; // no more than 10% worse

console.log(`Scenario 3 ≥2x faster: ${s3Win ? 'PASS' : 'FAIL'}`);
console.log(`Scenario 4 ≥2x faster: ${s4Win ? 'PASS' : 'FAIL'}`);
console.log(`Scenario 6 ≤10% slower: ${s6Acceptable ? 'PASS' : 'FAIL'}`);

const allPass = s3Win && s4Win && s6Acceptable;
console.log(`\nOverall: ${allPass ? 'PASS — ready for review' : 'FAIL — does not meet bar for shipping'}`);

if (!realPretext || realPretext.prepare.toString().includes('segments')) {
  console.log('\nNOTE: This run used a STUB, not real Pretext. Install @chenglou/pretext and re-run for real numbers.');
}

process.exit(allPass ? 0 : 1);
```

- [ ] **Step 2: Run the benchmark**

Run: `node packages/core/benchmark/text-engine.bench.js`

Expected output: All 6 scenarios run, summary printed, and acceptance criteria checked. With the stub, the result will likely FAIL (the stub adds overhead without Pretext's measurement speed). This is expected — the benchmark is a placeholder that will be validated with real Pretext.

- [ ] **Step 3: Document the benchmark in the plan**

The benchmark result with the stub is not the shipping signal. Record the result in the plan's status file (create `packages/core/benchmark/text-engine.results.md`):

```markdown
# text-engine Benchmark Results

## Run 1 (stub Pretext)
Date: <fill in>
Command: `node packages/core/benchmark/text-engine.bench.js`
Result: <paste the summary output>

## Run 2 (real @chenglou/pretext)
Date: <fill in>
Command: `npm i @chenglou/pretext && node packages/core/benchmark/text-engine.bench.js`
Result: <paste the summary output>

**For the PR to merge to main, Run 2 must show PASS on all acceptance criteria.**
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/benchmark/text-engine.bench.js packages/core/benchmark/text-engine.results.md
git commit -m "bench(text-engine): add benchmark suite for all 6 scenarios

Measures gating overhead (OFF) vs measurement time (ON) for:
1. 100 static text nodes
2. 100 dynamic text nodes, 1 update
3. 100 nodes, 60 updates (cached path)
4. 1000 nodes, simulated resize
5. Rapid signal updates (cache hits)
6. Single text node (pathological)

Acceptance criteria from design spec: scenarios 3 & 4 must be ≥2x
faster ON vs OFF; scenario 6 must be ≤10% slower. Falls back to a stub
when @chenglou/pretext is not installed — real numbers require real
Pretext."
```

---

## Task 17: User documentation

**Files:**
- Create: `docs/TEXT-ENGINE.md`

- [ ] **Step 1: Write the documentation**

Create `docs/TEXT-ENGINE.md`:

```markdown
# Text Engine (Alpha)

What Framework has optional integration with [@chenglou/pretext](https://github.com/chenglou/pretext), a 15KB text-measurement library that performs layout entirely outside the DOM. This enables two capabilities:

1. **Measure-only mode** — a runtime opt-in that routes dynamic text through Pretext for line-break and dimension computation. No visual change; pure performance optimization for text-heavy apps.
2. **Alpha components** — `<TextFlow>`, `<TextCanvas>`, `<TextSVG>` — rich text layout for magazine-style columns, canvas rendering, and SVG text.

**Status:** All features here are alpha. APIs may change without a major version bump.

## Installation

Pretext is an optional peer dependency. Install it only if you want to use these features:

```bash
npm install @chenglou/pretext
```

If you don't install it:
- `configureText({ measure: true })` emits a console warning and falls back to native DOM text
- `<TextFlow>` falls back to CSS `column-count`
- `<TextCanvas>` and `<TextSVG>` throw a clear error at component creation

## Measure-Only Mode

```js
import { configureText } from 'what-framework';

configureText({
  measure: true,    // enable Pretext measurement for dynamic text
  cacheSize: 1000,  // LRU bound for prepared-segment cache (default 1000)
});
```

**Call `configureText()` once at app startup, BEFORE `mount()`.** Calling it later produces mixed behavior and logs a warning.

**What it does:**
- When dynamic text is inserted via `insert()` (i.e., any `{signal()}` expression in JSX), the text is measured in a microtask and the result is cached
- Future layout queries use the cache instead of triggering browser reflow
- Zero visual change — text still renders as normal DOM text nodes
- No effect during SSR hydration — server-written text is trusted

**When it helps:**
- Apps with many simultaneous dynamic text nodes
- Window resize handling (re-layout is pure arithmetic)
- Real-time dashboards with rapidly changing text

**When it's a no-op:**
- Static text (baked into templates, never goes through `insert()`)
- When Pretext is not installed (graceful fallback with console warning)

## `<TextFlow>`

Magazine-style DOM text layout with multi-column support.

```jsx
import { TextFlow } from 'what-framework/text';

<TextFlow columns={2}>
  {articleText}
</TextFlow>

<TextFlow columns={3} width={800}>
  {() => article()}
</TextFlow>
```

**Props:**
- `columns: number` — number of columns (default 1)
- `width: number | () => number` — container width in px (default: natural flow)
- `around: { x, y, w, h } | () => {...}` — shape to flow text around (**requires Pretext**; silently dropped otherwise with a warning)

**Fallback without Pretext:** plain `<div>` with CSS `column-count`. Multi-column still works; `around` is dropped.

## `<TextCanvas>`

Renders text to a `<canvas>` element via Pretext layout.

```jsx
import { TextCanvas } from 'what-framework/text';

<TextCanvas width={600} height={400} font="16px Inter">
  {label}
</TextCanvas>
```

**Props:**
- `width: number` — canvas width in px (default 300)
- `height: number` — canvas height in px (default 150)
- `font: string` — CSS font string (default `"16px sans-serif"`)

**Requires Pretext to be loaded before mount.** If you use `<TextCanvas>`, either:
- Install Pretext as a regular dep (not just peer)
- Or ensure `ensurePretext()` resolves before the component mounts

**Limitations (alpha):**
- No text selection
- No screen-reader accessibility
- No find-in-page support

Use for decorative text, data viz labels, and creative effects — not for primary content.

## `<TextSVG>`

Renders text as SVG `<text>`/`<tspan>` elements.

```jsx
import { TextSVG } from 'what-framework/text';

<TextSVG width={600} height={200} font="20px serif">
  {title}
</TextSVG>
```

**Props:** same as `<TextCanvas>`.

**Requires Pretext to be loaded before mount** (same as `<TextCanvas>`).

**Limitations (alpha):** no text selection. A11y is partial — SVG text is technically selectable by some assistive tech but not reliably.

## Rollback

If you want to remove Pretext integration entirely from your app:

1. Remove the call to `configureText({ measure: true })`
2. Remove any `import` from `what-framework/text`
3. Uninstall: `npm uninstall @chenglou/pretext`

The framework's core text path is unchanged; you're back to default DOM behavior.

## Known Issues

- **Canvas measureText divergence:** Pretext's line breaks may differ from actual browser rendering by a few pixels for text with ligatures, kerning, or `font-feature-settings`. Measure mode is informational; alpha components position their own text so divergence is self-consistent.
- **Font loading:** the first measurement awaits `document.fonts.ready` to avoid caching fallback-font metrics. This may cause a one-frame delay on first paint when measure mode is on.
- **Alpha components in SSR:** `<TextCanvas>` and `<TextSVG>` are client-only. Wrap in `<Island>` or disable on the server.

## Related

- Design spec: `docs/superpowers/specs/2026-04-09-pretext-integration-design.md`
- Benchmark: `packages/core/benchmark/text-engine.bench.js`
- Adapter source: `packages/core/src/text-engine.js`
```

- [ ] **Step 2: Commit**

```bash
git add docs/TEXT-ENGINE.md
git commit -m "docs: add text engine user guide

User-facing docs for the Pretext integration: installation, configureText,
alpha components, fallback behavior, rollback instructions, and known
issues. Labels all features as alpha."
```

---

## Task 18: Hydration parity test (SSR → client round-trip)

**Files:**
- Modify: `packages/core/test/hydration.test.js` (append a new describe block) OR create `packages/core/test/text-engine-hydration.test.js`

- [ ] **Step 1: Check the existing hydration test setup**

Run: `head -40 packages/core/test/hydration.test.js`

Note the import pattern and jsdom setup. The existing file likely already imports `renderToString` (or equivalent SSR API) and `hydrate`. If so, append a new describe block there. If not (or if the file is large and splitting makes sense), create a new test file.

- [ ] **Step 2: Write the failing test**

Append (or create) with this block:

```js
describe('text-engine: hydration parity', () => {
  it('hydration produces identical DOM whether or not measure is enabled', async () => {
    const { renderToString } = await import('../src/testing.js'); // or whichever module exports the SSR helper
    const { hydrate } = await import('../src/render.js');
    const { h } = await import('../src/h.js');
    const { signal } = await import('../src/reactive.js');
    const { configureText, _resetTextEngineForTests, _setPretextForTests } = await import('../src/text-engine.js');

    // Build a component that mixes static and dynamic text
    function App(props) {
      const count = signal(props.initial);
      return h('div', {},
        h('h1', {}, 'Title'),
        h('p', {}, () => `Count: ${count()}`),
      );
    }

    // Render to HTML string on the server (no Pretext involvement)
    const html = renderToString(h(App, { initial: 5 }));

    // --- Baseline hydrate (measure OFF) ---
    _resetTextEngineForTests();
    const container1 = document.createElement('div');
    container1.innerHTML = html;
    hydrate(h(App, { initial: 5 }), container1);
    const baselineHtml = container1.innerHTML;

    // --- Hydrate with measure ON ---
    _resetTextEngineForTests();
    _setPretextForTests({ prepare: () => ({}), layout: () => ({}) });
    configureText({ measure: true });
    const container2 = document.createElement('div');
    container2.innerHTML = html;
    hydrate(h(App, { initial: 5 }), container2);
    const measuredHtml = container2.innerHTML;

    assert.equal(measuredHtml, baselineHtml,
      'hydration with measure enabled must produce identical DOM to the baseline');
  });
});
```

If `renderToString` is not in `testing.js`, grep for the correct path:

```bash
grep -rn "export.*renderToString" packages/core/src/ packages/server/src/
```

Use the import path that matches.

- [ ] **Step 3: Run test to verify it fails (or passes)**

Run: `node --test packages/core/test/hydration.test.js`

If our Task 14 skip-during-hydration logic is correct, this test should PASS on first run. If it FAILS, the hook is firing during hydration and producing a side effect that diverges the DOM — investigate and fix.

- [ ] **Step 4: Commit**

```bash
git add packages/core/test/hydration.test.js
git commit -m "test(text-engine): hydration parity — measure mode is transparent to SSR

Renders a component to HTML, hydrates once with measure OFF and once with
measure ON, and asserts the resulting DOM is byte-identical. If the measure
hook leaks into hydration, this test catches it."
```

---

## Task 19: Gap documentation — per-bundler size tests (deferred)

The spec asks for per-bundler bundle-size tests (Webpack, Vite, esbuild, Rollup) to verify that Pretext is not pulled into the main chunk when the flag is off. This plan **does not implement** per-bundler CI tests because:

- The repo currently does not have any bundler-specific CI infrastructure
- Setting it up correctly is its own multi-task effort that would double the scope of this plan
- The static-analysis guard (Task 15) catches the most common failure mode (direct/transitive imports from `/text` leaking into `index.js`)

**What this plan does instead:**

- Static-analysis guard in Task 15
- Manual bundler spot-check documented in the PR description (reviewer runs `npm pack`, inspects the output, and runs one bundler by hand)
- A follow-up task is created to add per-bundler CI tests AFTER this PR merges (or is ready to merge)

- [ ] **Step 1: Document the deferral**

Append to `docs/TEXT-ENGINE.md`:

```markdown
## Implementation Notes

### Per-bundler verification

The adapter ships with a static-analysis guard (`text-engine-bundle.test.js`) that prevents `packages/core/src/text/` from being imported by the main entry point. This catches the most common tree-shaking violation.

Automated per-bundler tests (Webpack, Vite, esbuild, Rollup) are a planned follow-up. For now, reviewers verify by hand:

1. `npm pack packages/core/`
2. Create a minimal project that imports only `configureText` (not the alpha components)
3. Bundle with the target bundler
4. Verify `@chenglou/pretext` is NOT in the output

If you find Pretext in the bundle when the flag is off, please file an issue.
```

- [ ] **Step 2: Commit**

```bash
git add docs/TEXT-ENGINE.md
git commit -m "docs(text-engine): document deferral of per-bundler CI tests

Static-analysis guard in text-engine-bundle.test.js catches the common
failure mode. Full per-bundler CI is a follow-up task documented in the
plan and in the user-facing docs."
```

---

## Task 20: Gap documentation — visual regression (deferred)

The spec lists "Visual regression suite for alpha components" as an acceptance criterion. This plan **does not implement** pixel-diff visual regression tests because:

- jsdom (the test DOM) does not provide a real Canvas 2D rendering context, so `<TextCanvas>` cannot be pixel-tested in the unit test environment
- SVG pixel output depends on the actual rendering engine, which varies across browsers
- Implementing browser-based visual regression (e.g., Playwright snapshot tests) is significant infrastructure

**What this plan does instead:**

- Structural tests for each alpha component (verify DOM structure, attributes, child elements) — Tasks 11-13
- Manual visual check documented in the PR description (reviewer opens the example/demo page in a browser, compares to screenshots)
- A follow-up task is created to add Playwright-based visual regression AFTER this PR merges (or is ready to merge)

- [ ] **Step 1: Create a minimal demo page**

Create `demo/text-engine-demo.html` (or wherever demo files live — check with `ls demo/` first):

```html
<!DOCTYPE html>
<html>
<head>
  <title>Pretext Integration Demo</title>
  <style>
    body { font-family: sans-serif; padding: 2rem; max-width: 800px; }
    .section { margin-bottom: 3rem; }
  </style>
</head>
<body>
  <h1>Pretext Integration Demo</h1>
  <div id="app"></div>
  <script type="module">
    import { signal, mount, h, configureText } from '../packages/core/src/index.js';
    import { TextFlow, TextCanvas, TextSVG } from '../packages/core/src/text/index.js';

    configureText({ measure: true });

    const content = signal('The quick brown fox jumps over the lazy dog. '.repeat(5));

    mount(
      h('div', {},
        h('div', { class: 'section' },
          h('h2', {}, 'TextFlow (DOM columns)'),
          h(TextFlow, { columns: 2 }, () => content()),
        ),
        h('div', { class: 'section' },
          h('h2', {}, 'TextCanvas'),
          h(TextCanvas, { width: 600, height: 200 }, () => content()),
        ),
        h('div', { class: 'section' },
          h('h2', {}, 'TextSVG'),
          h(TextSVG, { width: 600, height: 200 }, () => content()),
        ),
        h('button', { onclick: () => content('Updated text content for reactive check.') }, 'Update'),
      ),
      document.getElementById('app')
    );
  </script>
</body>
</html>
```

Important: `<TextCanvas>` and `<TextSVG>` require `@chenglou/pretext` to be resolvable at import time for the demo to work. Install it locally before running the demo:

```bash
npm install @chenglou/pretext
```

- [ ] **Step 2: Document the demo in the plan**

Append to `docs/TEXT-ENGINE.md`:

```markdown
### Visual regression

Alpha components have structural tests (DOM shape, attributes) but not pixel-diff visual regression. For manual verification, open `demo/text-engine-demo.html` in a browser after installing Pretext.

Automated visual regression via Playwright is a planned follow-up.
```

- [ ] **Step 3: Commit**

```bash
git add demo/text-engine-demo.html docs/TEXT-ENGINE.md
git commit -m "feat(demo): add Pretext integration demo page

Manual visual check for TextFlow, TextCanvas, and TextSVG. Documented
in the user guide. Automated visual regression is deferred as a follow-up."
```

---

## Task 21: Self-review and run the full test suite

- [ ] **Step 1: Run the full core test suite**

Run: `npm test`

Expected: All existing tests continue to pass, plus the new tests:
- `text-engine.test.js` (~20 tests)
- `text-components.test.js` (7 tests)
- `text-engine-insert-hook.test.js` (6 tests — includes hydration skip)
- `text-engine-bundle.test.js` (1 test)
- `hydration.test.js` (existing + 1 new hydration parity test)

If anything fails, fix the issue and commit the fix.

- [ ] **Step 2: Run the benchmark with the stub**

Run: `node packages/core/benchmark/text-engine.bench.js`

Expected: Benchmark runs all 6 scenarios and prints the summary. With the stub, the overall verdict will likely be FAIL — this is expected and documented. The real validation happens in Step 3.

- [ ] **Step 3: Install real Pretext and re-run the benchmark**

```bash
npm install --save-dev @chenglou/pretext
node packages/core/benchmark/text-engine.bench.js
```

Expected: Scenarios 3 and 4 show ≥2x improvement with Pretext on. Scenario 6 shows ≤10% overhead. Overall PASS.

**If the benchmark does not meet the acceptance criteria:** the feature does NOT ship. Options:
- Investigate whether the measure hook is correctly routing through Pretext
- Tune the cache size or eviction strategy
- Reconsider the scope (maybe only alpha components ship, not measure mode)

Document the real-Pretext results in `packages/core/benchmark/text-engine.results.md`.

- [ ] **Step 4: Verify the bundle guard test still passes**

Run: `node --test packages/core/test/text-engine-bundle.test.js`

Expected: PASS. If it fails, the subpath isolation was violated somewhere — find the offending import and remove it.

- [ ] **Step 5: Commit the benchmark results**

```bash
git add packages/core/benchmark/text-engine.results.md
git commit -m "bench(text-engine): record first real-Pretext benchmark results

<Paste actual results into the commit body>"
```

- [ ] **Step 6: Push the branch**

```bash
git push -u origin feat/pretext-integration
```

**Do NOT merge to main.** The PR description should include:
- Link to the design spec
- Benchmark results (from Step 5)
- Known limitations
- Rollback plan (see design spec)

---

## Success Criteria (from the spec)

- ✅ Bundle size impact when `measure: false` and alpha components not imported: ≤1KB (adapter only)
- ✅ Scenarios 3 & 4 in the benchmark show ≥2x improvement with real Pretext
- ✅ Scenario 6 shows ≤10% overhead
- ✅ All existing tests pass without modification
- ✅ `text-engine-bundle.test.js` passes (no /text leakage into main entry)
- ✅ Hydration parity test passes
- ✅ Benchmark results committed to `packages/core/benchmark/text-engine.results.md`
- ✅ Feature branch only; not merged to main until the above are verified
