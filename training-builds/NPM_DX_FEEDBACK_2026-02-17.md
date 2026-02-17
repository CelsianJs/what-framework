# What Framework npm DX Feedback (2026-02-17)

## Scope

This file now tracks two states:

1. **Published npm baseline** (`what-framework@0.5.0`, `what-compiler@0.5.0`, `create-what@0.5.0`)
2. **Current source loop fixes** in this repository after DX cleanup implementation

Validation app locations:

- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/examples/npm-app-suite`
- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/examples/local-loop-validation`

## What Worked Well

- Fast scaffold flow (`npx create-what ...`, `npm run dev`).
- Strong build speed across 8 npm-consumer sample apps.
- Event casing compatibility works (`onClick` + `onclick`).
- Focus utilities (`useFocusRestore` + `FocusTrap`) are practical in modal flows.

## Previously Confirmed npm Baseline Bugs (0.5.0)

1. Compiler node targeting broke with text siblings.
2. Compiler used attribute writes for DOM properties (`checked`, `value`, raw HTML props).
3. `innerHTML` / `dangerouslySetInnerHTML` compile path wrote invalid attributes.

## Current Source Loop Status (Fixed)

### Fixed in compiler/runtime source

1. **Child node targeting**
   - Compiler now emits `childNodes[index]` (not `children[index]`).
   - Expression markers (`<!--$-->`) + `insert(parent, value, marker)` keep ordering stable.

2. **Dynamic prop semantics**
   - Compiler now emits runtime prop helper calls.
   - Runtime `setProp(...)` handles property/attribute semantics consistently.

3. **Raw HTML behavior**
   - `innerHTML` and `dangerouslySetInnerHTML` now apply through runtime prop semantics.
   - Local browser validation confirmed no runtime crash and correct rendering.

4. **Template serialization edge case**
   - Non-void self-closing JSX tags (e.g. `<section />`) are now serialized with explicit closing tags.
   - Prevents HTML parser structure shifts that caused undefined-node targeting.

5. **Scaffold console noise**
   - `create-what` now writes a default `/public/favicon.svg` and links it in `index.html`.

## Remaining Friction (Non-blocking)

- Framework-native CLI abstraction over Vite is still partial (`npm run dev/build/preview` remains canonical).
- npm publish metadata normalization warnings should still be cleaned up before a polished release.

## Loop Verification Results

### Tests

- `npm test`: **pass** (`233` tests, `0` fail)
- `node --test packages/compiler/test/*.test.js`: **pass**

### Benchmarks

- `npm run bench`: **pass**
- `npm run bench:dx`: **pass**
- `npm run bench:gate`: **pass** (regression check passed)

Representative benchmark values from latest gate run:

- `signal() write (1 subscriber)`: `577,024 ops/s`
- `batch() 100 writes, 1 effect`: `586,340 ops/s`
- `event prop normalize (onClick)`: `794 ops/s`
- `innerHTML patch path`: `8,464 ops/s`

## Next Recommendations

1. Publish next npm version containing these compiler/runtime fixes.
2. Add npm-consumer smoke checks to CI (scaffold/build/browser console checks).
3. Decide whether to ship a fully framework-owned CLI (`what dev/build/preview`) or keep Vite as explicit implementation detail.
