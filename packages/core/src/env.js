// What Framework - Development flag
//
// What has two tiers, and __DEV__ is the only switch between them.
// reactive.js reads it through the package's `#env` import (package.json
// `imports`): this module by default, env-development.js under the
// `development` condition.
//
// - Production: scripts/build.js (dist/*.min.js) and what-compiler/vite (a
//   production `vite build`, whether it resolves the dist or the source) define
//   `__WHAT_DEV__` as `false`. The expression below then folds to `false` and
//   the minifier removes every `if (__DEV__)` branch: dev code costs nothing.
// - Unbuilt (Node, the test suite, a page without a bundler): `__WHAT_DEV__`
//   is an ordinary global, so setting `globalThis.__WHAT_DEV__ = true` or
//   `false` before the framework loads forces a tier. Without it, Vite's
//   import.meta.env.DEV decides, then process.env.NODE_ENV, and a browser with
//   neither gets production behaviour. `process` counts only as a server
//   runtime's (its `versions.node` is a string): a page's own markup can name
//   a global `process` (`<form id="process"><input name="env">`), but never
//   make a string of it, so markup cannot switch the tier.
//
// The bundler tier (dist/*.js, the `module` export condition) replaces this
// module and every use of the flag with a process.env.NODE_ENV test, which
// the bundlers that resolve it define (scripts/build.js, buildBundlerTier).
//
// This module imports nothing, so every module can read the flag from here
// without risking an import cycle.

/* global __WHAT_DEV__ */
export const __DEV__ =
  typeof __WHAT_DEV__ === 'boolean' ? __WHAT_DEV__
    : import.meta.env ? !!import.meta.env.DEV
      : typeof process !== 'undefined' && typeof process.versions?.node === 'string' ? process.env.NODE_ENV !== 'production'
        : false;
