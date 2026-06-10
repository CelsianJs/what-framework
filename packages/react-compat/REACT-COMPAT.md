# what-react — Compat Runtime & Bundler Boundary

Real React semantics (value hooks, re-renders, context) running on a dedicated
compat runtime (`src/runtime.js`), wired into Vite via `reactCompat()`
(`src/vite-plugin.js`). This is the current/authoritative doc; `COMPAT-NOTES.md`
is historical (pre-v0.11) and stale.

## One-line setup

```js
// vite.config.js
import { reactCompat } from 'what-react/vite';
export default { plugins: [reactCompat()] };
```

The plugin:
- Aliases `react`, `react-dom`, `react/jsx-runtime`, `react-dom/client`,
  `use-sync-external-store/*` → `what-react`'s source.
- **Excludes** React-ecosystem packages that `import 'react'` from Vite's
  `optimizeDeps` pre-bundling, so the alias reaches them (no dual React copy).
- **Includes** (pre-bundles) pure-CJS transitive utilities so esbuild can
  synthesize their ESM default/named exports — see below.

## The CJS interop boundary (why react-select / @emotion used to blank-screen)

React UI libraries (react-select, anything on `@emotion/*`) pull in **pure-CJS**
helper packages — most notably `hoist-non-react-statics`. These helpers:

- ship **only** a CommonJS build (no `module` / `exports.import` field), and
- do **not** `require('react')` themselves (they touch `react-is` / `$$typeof`
  symbols only) — so they carry **no dual-React-instance risk**.

If such a dep is left out of pre-bundling, Vite serves the raw CJS file and the
browser throws:

```
The requested module '…/hoist-non-react-statics.cjs.js' does not provide an
export named 'default'
```

…because an ESM consumer did `import hoistStatics from 'hoist-non-react-statics'`
and the raw CJS module has no `default`. That single failing import
**blank-screens the entire dev app**.

### Rule of thumb
- A dep that **imports `react`** → must be **excluded** from `optimizeDeps`
  (so the `react → what-react` alias applies). Listed in `KNOWN_REACT_PACKAGES`.
- A **pure-CJS utility that does NOT import `react`** → must be **included** in
  `optimizeDeps` so esbuild interops it. Listed in `PURE_CJS_INTEROP_DEPS`
  (`hoist-non-react-statics`, `react-is`, `prop-types`, `memoize-one`,
  `stylis`, …). Only the installed/resolvable ones are passed to Vite (an
  `include` for a missing dep is a hard error).

The plugin guarantees these two sets never overlap: anything in the interop
include list is filtered back out of the exclude list before returning config.

Verified: with the fix, `react-select` renders and its dropdown opens/selects in
a real headless browser on the compat runtime (previously: blank screen).

## Test layout & CI enforcement

- `test/runtime.test.js` — the compat runtime's own unit tests.
- `test/libs.test.js` — **real** React libraries (zustand, @tanstack/react-query,
  react-hook-form, react-hot-toast, @headlessui/react, framer-motion) exercised
  in jsdom on the compat runtime. The library fixture lives in
  `test/app/node_modules` (gitignored, not a workspace member).
- `test/fixtures/acceptance` — a browser acceptance app driven through the real
  `reactCompat()` plugin (build + headless verify).

### Running tests

```bash
npm test                          # node --test 'test/*.test.js' (canonical glob)
WHAT_REQUIRE_COMPAT_LIBS=1 npm test   # CI mode: missing lib fixture = HARD FAIL
```

`WHAT_REQUIRE_COMPAT_LIBS=1` turns a missing `test/app/node_modules` from a
silent **skip** into a hard **failure**, so CI can guarantee the
"real libraries work" pillar is actually exercised and can't rot to 0/6. Local
dev without the fixture still skips gracefully (flag unset).

> Always run via `npm test` (or `node --test 'test/*.test.js'`), **not** bare
> `node --test`. Bare discovery walks `test/app/dist` and
> `test/fixtures/acceptance/dist` and tries to execute the minified Vite bundles
> there as test files, producing false failures.
