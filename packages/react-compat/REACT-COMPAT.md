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
- Aliases `react`, `react-dom`, `react/jsx-runtime`, `react-dom/client` and the
  `use-sync-external-store` shims to the package `what-react` (deduped to the
  app's root, so the name resolves from any importer).
- Keeps out of Vite's dependency pre-bundling only what it replaces (`react`,
  `react-dom`, `use-sync-external-store`), what-react and the framework
  packages. Every React library is pre-bundled like any dependency.
- Bundles what-react and the React packages into a server render
  (`ssr.noExternal`); see MIXED.md, "What a server render bundles".
- With what-compiler's `what()` next to it, compiles in **mixed mode**: native
  What files stay native, React components in them render as React islands,
  and only React files (they import `react` or call a React package's hook)
  are React code — see [MIXED.md](MIXED.md) and `src/mixed-plugin.js`.

## The pre-bundling boundary (why there is no list of React packages)

Until 0.15 the plugin kept a list of React library names
(`KNOWN_REACT_PACKAGES`) out of pre-bundling, so that their `import 'react'`
went through the alias one file at a time, and a second list
(`PURE_CJS_INTEROP_DEPS`) of CommonJS helpers that had to be pre-bundled
because of the first. Both are gone:

- A library kept out of pre-bundling is served file by file, and so are its
  CommonJS dependencies, which a browser cannot import: react-router (`cookie`),
  antd (`is-mobile`) and react-markdown (`debug`) failed in `vite dev` with
  "does not provide an export named ...". A library that was not on the list
  was pre-bundled with the alias's target inlined, a second what-react.
- What makes pre-bundling safe is that `react` is excluded: Vite then leaves
  `import 'react'` as an import inside each pre-bundled library, the browser
  asks the dev server for it, and the alias answers with `what-react`, the one
  module the app and `what-react/mixed` also import. That holds for any
  package, listed or not, and CommonJS dependencies are converted by Vite as
  in every app.
- `use-sync-external-store` is excluded for the same reason: its shim
  entries are aliased to a file of what-react, and a bundle that inlined that
  file would inline what-react with it.

`reactCompat({ exclude: [...] })` still keeps a package out of pre-bundling
(a linked package, say); its CommonJS dependencies then belong in
`optimizeDeps.include`, as Vite documents for any excluded package.

`test/vite-plugin.test.js` holds this with an installed layout (real package
directories, not workspace links), and the package matrix runs every fixture
in the dev server (`matrix-browser.mjs --serve=dev`).

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
