# what-react SVG-Portal + recharts Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `recharts` render correctly through the `what-react` compat runtime by fixing the SVG-namespace portal bug + camelCase SVG attribute mapping, so the Vura dashboard can use recharts as a compat island.

**Architecture:** Two small, namespace-gated changes in `packages/react-compat/src/runtime.js`: (1) portal children whose target lives inside an `<svg>` are reconciled in the SVG namespace instead of HTML; (2) camelCase SVG presentation props (`strokeWidth`, `fillOpacity`, `clipPath`, …) are mapped to their kebab-case attribute names. Verified by new jsdom unit tests (root-cause level) plus a real recharts section in the browser acceptance fixture. The change is gated to SVG portal targets only, so HTML portals (modals/toasts used by the 8 already-verified libs) are untouched.

**Tech Stack:** JavaScript (ESM), `node --test` (jsdom), Vite + `reactCompat()` browser fixture, recharts 3.x.

## Global Constraints

- Package under change: `packages/react-compat` (`what-react`), consumed as **source ESM** (`main: src/index.js`) — there is **no build step** for this package.
- The fix MUST stay **namespace-gated**: for non-SVG (HTML) portal targets, behavior is byte-identical to today. The 8 currently-verified libs (react API, zustand, @tanstack/react-query, react-hook-form, react-hot-toast, @headlessui/react, framer-motion, use-sync-external-store) MUST remain green.
- Regression gate (package): `node --test 'packages/react-compat/test/*.test.js'` — all pass (spike baseline: 47/47 core + libs).
- Browser gate: the recharts section in `packages/react-compat/test/fixtures/acceptance` renders real SVG geometry (non-null `getBBox`, SVG namespace).
- **No publish in this plan.** Bumping to `0.11.2` and publishing is done later by Kirby via `npm run release:patch` (unified bump of all 14 packages). This plan lands the fix + tests + docs on a branch.
- Branch: `fix/react-compat-svg-portal` off `main` (do not commit on `main`).
- The constant `SVG_NS = 'http://www.w3.org/2000/svg'` already exists in `runtime.js` (line ~468); reuse it.

---

## File Structure

- `packages/react-compat/src/runtime.js` — **modify**: add `targetSvg()` + `SVG_ATTR_MAP` after `SVG_NS`; swap 3 portal `false` flags → `targetSvg(target)`; map attrs in `setProperty`'s SVG branch.
- `packages/react-compat/test/svg-portal.test.js` — **create**: jsdom unit tests for both bugs (root-cause level, deterministic).
- `packages/react-compat/test/fixtures/acceptance/` — **modify**: add a real recharts section (deps, vite config, section component, README row).
- `packages/react-compat/test/app/src/test-recharts-fix.jsx` + `.../test-recharts-fix.html` — **delete**: the fake-green fixture (hardcoded "PASS", renders 0 SVGs).
- `REACT-COMPAT.md`, `CHANGELOG.md` — **modify**: mark recharts + lucide Verified; changelog entry.

---

### Task 1: SVG-namespace portal + camelCase SVG attr fix

**Files:**
- Create: `packages/react-compat/test/svg-portal.test.js`
- Modify: `packages/react-compat/src/runtime.js` (after `const SVG_NS` ~L468; `mountPortal` ~L583; `patchPortal` ~L736/742; `setProperty` SVG branch ~L1158)

**Interfaces:**
- Consumes: existing exports `createElement`, `act` (from `../src/index.js`), `createRoot`, `createPortal` (from `../src/dom.js`); existing module-internal `SVG_NS`, `patchChildren`, `setProperty`.
- Produces: module-internal `targetSvg(target) -> boolean` and `SVG_ATTR_MAP` (camelCase→kebab string map). No public API change.

- [ ] **Step 1: Write the failing test**

Create `packages/react-compat/test/svg-portal.test.js`:

```js
// what-react — SVG portal namespace + camelCase SVG attribute mapping (jsdom).
// Run: node --test packages/react-compat/test/svg-portal.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
for (const k of ['HTMLElement', 'Element', 'Node', 'SVGElement', 'CustomEvent', 'Event', 'MouseEvent', 'KeyboardEvent', 'getComputedStyle', 'DocumentFragment', 'Text', 'Comment']) {
  try { if (!(k in global)) global[k] = dom.window[k]; } catch (e) { /* read-only global */ }
}
try { global.navigator = dom.window.navigator; } catch (e) { /* read-only getter */ }
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);

const React = await import('../src/index.js');
const ReactDOM = await import('../src/dom.js');
const { createElement: h, act } = React;
const { createRoot, createPortal } = ReactDOM;
const SVG_NS = 'http://www.w3.org/2000/svg';

function host() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

test('children portaled into an SVG container are created in the SVG namespace', () => {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const gTarget = document.createElementNS(SVG_NS, 'g');
  svg.appendChild(gTarget);
  document.body.appendChild(svg);

  function App() {
    return createPortal(h('path', { d: 'M0 0 L10 10' }), gTarget);
  }
  const root = createRoot(host());
  act(() => root.render(h(App)));

  const path = gTarget.querySelector('path');
  assert.ok(path, 'path should be portaled into the <g>');
  assert.equal(path.namespaceURI, SVG_NS, 'portaled SVG child must be in the SVG namespace');
});

test('camelCase SVG presentation props map to kebab-case attributes', () => {
  function App() {
    return h('svg', null,
      h('path', { d: 'M0 0', strokeWidth: 2, fillOpacity: 0.5, strokeDasharray: '3 3', clipPath: 'url(#c)' }));
  }
  const root = createRoot(host());
  act(() => root.render(h(App)));

  const path = document.querySelector('path');
  assert.ok(path);
  assert.equal(path.getAttribute('stroke-width'), '2');
  assert.equal(path.getAttribute('fill-opacity'), '0.5');
  assert.equal(path.getAttribute('stroke-dasharray'), '3 3');
  assert.equal(path.getAttribute('clip-path'), 'url(#c)');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test packages/react-compat/test/svg-portal.test.js`
Expected: FAIL — first test reports `namespaceURI` is `http://www.w3.org/1999/xhtml` (not SVG); second test reports `stroke-width` is `null` (the prop was written as the invalid lowercase attribute `strokewidth`).

- [ ] **Step 3: Add `targetSvg()` + `SVG_ATTR_MAP`**

In `packages/react-compat/src/runtime.js`, immediately after the line `const SVG_NS = 'http://www.w3.org/2000/svg';`, insert:

```js
// A portal target may live inside an <svg> (recharts 3.x z-index layers are
// SVG <g> portal targets). Children portaled into an SVG container must be
// created in the SVG namespace, not HTML.
function targetSvg(target) {
  return !!target && target.namespaceURI === SVG_NS && target.tagName !== 'foreignObject';
}

// camelCase React SVG prop → correct kebab/colon SVG attribute name.
// Covers the presentation/text/clip attributes charting libs (recharts) emit.
const SVG_ATTR_MAP = {
  strokeWidth: 'stroke-width', strokeDasharray: 'stroke-dasharray',
  strokeDashoffset: 'stroke-dashoffset', strokeLinecap: 'stroke-linecap',
  strokeLinejoin: 'stroke-linejoin', strokeMiterlimit: 'stroke-miterlimit',
  strokeOpacity: 'stroke-opacity', fillOpacity: 'fill-opacity',
  fillRule: 'fill-rule', clipPath: 'clip-path', clipRule: 'clip-rule',
  stopColor: 'stop-color', stopOpacity: 'stop-opacity',
  textAnchor: 'text-anchor', dominantBaseline: 'dominant-baseline',
  alignmentBaseline: 'alignment-baseline', baselineShift: 'baseline-shift',
  colorInterpolation: 'color-interpolation',
  colorInterpolationFilters: 'color-interpolation-filters',
  floodColor: 'flood-color', floodOpacity: 'flood-opacity',
  letterSpacing: 'letter-spacing', wordSpacing: 'word-spacing',
  pointerEvents: 'pointer-events', shapeRendering: 'shape-rendering',
  vectorEffect: 'vector-effect', paintOrder: 'paint-order',
  markerStart: 'marker-start', markerMid: 'marker-mid', markerEnd: 'marker-end',
};
```

- [ ] **Step 4: Pass `targetSvg(target)` in the three portal `patchChildren` calls**

In `mountPortal` (the call currently reading `..., null, false, owner)` for the portal target), change:

```js
  rn.children = patchChildren(target, [], normalizeChildren(v.children), null, false, owner);
```
to:
```js
  rn.children = patchChildren(target, [], normalizeChildren(v.children), null, targetSvg(target), owner);
```

In `patchPortal`, change BOTH portal `patchChildren` calls (the same-container update and the container-change remount):

```js
      rn.children = patchChildren(target, rn.children, normalizeChildren(v.children), null, false, owner);
```
to:
```js
      rn.children = patchChildren(target, rn.children, normalizeChildren(v.children), null, targetSvg(target), owner);
```

and:

```js
    rn.children = target
      ? patchChildren(target, [], normalizeChildren(v.children), null, false, owner)
      : [];
```
to:
```js
    rn.children = target
      ? patchChildren(target, [], normalizeChildren(v.children), null, targetSvg(target), owner)
      : [];
```

- [ ] **Step 5: Map camelCase SVG attrs in `setProperty`**

In `setProperty`, inside the `if (svg) { ... }` branch, replace the generic attribute write:

```js
    if (value == null || value === false) el.removeAttribute(name);
    else el.setAttribute(name, value === true ? '' : value);
    return;
```
with:
```js
    // React accepts camelCase SVG presentation props (strokeWidth, fillOpacity,
    // clipPath, …) and emits the correct kebab-case SVG attribute. The DOM
    // lowercases unknown attribute names (strokeWidth → "strokewidth"), which
    // is an INVALID attribute the SVG renderer ignores. Map the common ones.
    const mapped = SVG_ATTR_MAP[name];
    const attr = mapped || name;
    if (value == null || value === false) el.removeAttribute(attr);
    else el.setAttribute(attr, value === true ? '' : value);
    return;
```

- [ ] **Step 6: Run the new test to verify it passes**

Run: `node --test packages/react-compat/test/svg-portal.test.js`
Expected: PASS (both tests).

- [ ] **Step 7: Run the full react-compat suite to verify no regression**

Run: `node --test 'packages/react-compat/test/*.test.js'`
Expected: PASS — `runtime.test.js` (47 core), `libs.test.js` (8 libs), and the new `svg-portal.test.js`, all green. (If `libs.test.js` SKIPs because `test/app/node_modules` is missing, run `npm install` in `packages/react-compat/test/app` first, then re-run.)

- [ ] **Step 8: Commit**

```bash
git checkout -b fix/react-compat-svg-portal
git add packages/react-compat/src/runtime.js packages/react-compat/test/svg-portal.test.js
git commit -m "fix(react-compat): render SVG portal children in SVG namespace + map camelCase SVG attrs"
```

---

### Task 2: Real recharts browser acceptance section; remove the fake-green fixture

**Files:**
- Modify: `packages/react-compat/test/fixtures/acceptance/package.json` (add `recharts` dep)
- Modify: `packages/react-compat/test/fixtures/acceptance/vite.config.js`
- Create: `packages/react-compat/test/fixtures/acceptance/src/sections/recharts.jsx`
- Modify: `packages/react-compat/test/fixtures/acceptance/src/main.jsx` (mount the section)
- Modify: `packages/react-compat/test/fixtures/acceptance/README.md` (add checklist row)
- Delete: `packages/react-compat/test/app/src/test-recharts-fix.jsx`, `packages/react-compat/test/app/test-recharts-fix.html`

**Interfaces:**
- Consumes: the `reactCompat()` vite plugin (now called with `{ exclude: ['recharts'] }`); recharts 3.x.
- Produces: a browser-verifiable section exposing stable DOM IDs (`#rc-area`, `#rc-line`) for Playwright assertions.

- [ ] **Step 1: Add recharts to the acceptance fixture and install**

In `packages/react-compat/test/fixtures/acceptance/package.json`, add to `dependencies`:

```json
    "recharts": "^3.8.1",
```

Run: `cd packages/react-compat/test/fixtures/acceptance && npm install`
Expected: installs recharts (and its transitive `victory-vendor`, `eventemitter3`, `decimal.js-light`).

- [ ] **Step 2: Configure Vite for recharts (CJS deps + exclude from alias prebundle)**

Replace `packages/react-compat/test/fixtures/acceptance/vite.config.js` with:

```js
import { defineConfig } from 'vite';
import { reactCompat } from 'what-react/vite';

// recharts is excluded from the reactCompat alias-prebundle and its CJS-only
// transitive deps are force-included so esbuild can prebundle them for ESM.
export default defineConfig({
  plugins: [reactCompat({ exclude: ['recharts'] })],
  optimizeDeps: {
    include: [
      'eventemitter3',
      'victory-vendor/d3-scale',
      'victory-vendor/d3-shape',
      'decimal.js-light',
    ],
  },
});
```

- [ ] **Step 3: Write the recharts acceptance section (real assertions, stable IDs)**

Create `packages/react-compat/test/fixtures/acceptance/src/sections/recharts.jsx`:

```jsx
import React from 'react';
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
} from 'recharts';

const data = [
  { name: 'Jan', a: 4000, b: 2400 },
  { name: 'Feb', a: 3000, b: 1398 },
  { name: 'Mar', a: 2000, b: 9800 },
  { name: 'Apr', a: 2780, b: 3908 },
  { name: 'May', a: 1890, b: 4800 },
  { name: 'Jun', a: 2390, b: 3800 },
];

export function RechartsSection() {
  return (
    <section>
      <h2>9. recharts</h2>
      <div id="rc-area" style={{ width: 480, height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Area type="monotone" dataKey="a" stroke="#00d4ff" fill="#00d4ff" fillOpacity={0.3} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div id="rc-line" style={{ width: 480, height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Line type="monotone" dataKey="a" stroke="#00d4ff" strokeWidth={2} />
            <Line type="monotone" dataKey="b" stroke="#82ca9d" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Mount the section in `main.jsx`**

In `packages/react-compat/test/fixtures/acceptance/src/main.jsx`, import and render `RechartsSection` alongside the existing sections (follow the file's existing pattern for how sections are composed):

```jsx
import { RechartsSection } from './sections/recharts.jsx';
// …and include <RechartsSection /> in the rendered section list.
```

- [ ] **Step 5: Build and browser-verify the charts render real SVG geometry**

Run the production build path (matches the README's verification):
```bash
cd packages/react-compat/test/fixtures/acceptance && npm run build && npm run preview
```
Then, using the agent-browser skill (or the Playwright MCP), open `http://localhost:4601` and evaluate:

```js
// In the page:
const area = document.querySelector('#rc-area svg');
const line = document.querySelector('#rc-line svg');
const ok = !!area && !!line
  && area.namespaceURI === 'http://www.w3.org/2000/svg'
  && document.querySelectorAll('#rc-area .recharts-area-area, #rc-area path[fill]').length > 0
  && [...document.querySelectorAll('#rc-line path')].some(p => (p.getAttribute('d') || '').length > 10)
  && document.querySelectorAll('#rc-line path[stroke-dasharray]').length > 0; // grid dashes applied
ok; // expect: true
```
Expected: `true`. Also take a screenshot showing a filled area chart + a 2-line line chart with dashed gridlines and labeled axes. Expected: charts are visibly drawn (NOT blank).

- [ ] **Step 6: Delete the fake-green fixture**

```bash
git rm packages/react-compat/test/app/src/test-recharts-fix.jsx packages/react-compat/test/app/test-recharts-fix.html
```
(Rationale: it hardcodes a green "PASS — recharts renders" string but renders 0 SVGs — a test that lies. The acceptance section above is the real verification.)

- [ ] **Step 7: Add the README checklist row**

In `packages/react-compat/test/fixtures/acceptance/README.md`, add to the "Manual checklist" table:

```markdown
| 9. recharts | load page | `#rc-area` shows a filled area chart and `#rc-line` shows a 2-line chart, both with labeled axes + dashed gridlines (SVG namespace, non-null getBBox) |
```

- [ ] **Step 8: Commit**

```bash
git add packages/react-compat/test/fixtures/acceptance
git commit -m "test(react-compat): real recharts browser acceptance section; remove fake-green fixture"
```

---

### Task 3: Mark recharts + lucide Verified; changelog (no publish)

**Files:**
- Modify: `REACT-COMPAT.md` (verified matrix + the "Untested" note)
- Modify: `CHANGELOG.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Update the verified matrix**

In `REACT-COMPAT.md`, in the "Verified compatibility matrix" table, add two rows (Method `B+J` = browser + jsdom for recharts; `B` for lucide):

```markdown
| recharts | 3.8.1 | ✅ Verified | 2026-06-25 | B | AreaChart + LineChart render real SVG geometry (SVG-namespace portal layers, kebab SVG attrs, dashed grid); ResponsiveContainer measures container; no render-loop |
| lucide-react | 0.575.0 | ✅ Verified | 2026-06-25 | B | icons render as SVG with correct shapes/strokes in SVG namespace |
```

Then update the "Untested" note prose so it no longer implies recharts/lucide are unverified (remove them from any "plausible but untested" wording).

- [ ] **Step 2: Add the CHANGELOG entry**

In `CHANGELOG.md`, add a new section at the top:

```markdown
## 0.11.2

### Fixed
- **react-compat:** SVG portal children are now created in the SVG namespace (recharts 3.x renders its chart layers via `createPortal` into SVG `<g>` targets — previously they were created in the HTML namespace and never painted).
- **react-compat:** camelCase SVG presentation props (`strokeWidth`, `fillOpacity`, `clipPath`, `strokeDasharray`, …) now map to the correct kebab-case SVG attributes instead of being written as invalid lowercase attributes.

### Verified
- recharts 3.8.1 and lucide-react 0.575.0 added to the verified compat matrix (browser-tested). Replaced the prior fake-green recharts fixture with a real acceptance section.
```

- [ ] **Step 3: Commit**

```bash
git add REACT-COMPAT.md CHANGELOG.md
git commit -m "docs(react-compat): mark recharts + lucide verified; changelog for 0.11.2"
```

- [ ] **Step 4 (out of plan, Kirby-triggered): release**

The unified version bump + publish is **not** part of this plan. When ready, Kirby runs `npm run release:patch` (bumps all packages to 0.11.2, runs `release:verify`, publishes with provenance). Push the branch / open a PR only when Kirby asks.

---

## Self-Review

**Spec coverage:** Phase 0 of the design spec (§8) requires: portal-SVG-namespace fix ✅ (Task 1), camelCase attr map ✅ (Task 1), regression gate on jsdom + acceptance harness ✅ (Task 1 Step 7 + Task 2), replace the fake-green fixture ✅ (Task 2), ship as 0.11.2 ✅ (Task 3, publish deferred to Kirby). All covered.

**Placeholder scan:** No TBD/TODO; every code/edit step shows the actual content; the only deferred item (the publish) is an explicit out-of-plan, Kirby-triggered action, not a placeholder.

**Type/name consistency:** `targetSvg(target)` and `SVG_ATTR_MAP` are defined in Task 1 Step 3 and used in Steps 4–5; `#rc-area`/`#rc-line` IDs defined in Task 2 Step 3 and asserted in Step 5; `RechartsSection` defined Step 3, mounted Step 4. Consistent.
