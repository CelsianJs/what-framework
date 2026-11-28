// What Framework - Development flag, under the `development` condition
//
// reactive.js reads the flag through the package's `#env` import (package.json
// `imports`), which resolves here for every tool that resolves the
// `development` export condition: Vite's dev server, webpack and Rollup
// development builds, `bun build`, `node --conditions=development`. Their
// development builds run the development tier with its diagnostics wherever
// the code then runs, whether or not the page has a `process` or
// `import.meta.env`. `__WHAT_DEV__` still forces a tier, as in env.js.

/* global __WHAT_DEV__ */
export const __DEV__ = typeof __WHAT_DEV__ === 'boolean' ? __WHAT_DEV__ : true;
