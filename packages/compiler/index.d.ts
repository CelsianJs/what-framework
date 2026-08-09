// what-compiler — TypeScript declarations for the public compiler entry point
// (src/index.js). Types the surface that is actually exported so vite.config /
// babel.config authoring against what-compiler is type-checked, not `any`.

export { default as babelPlugin } from './babel.js';
export { default as vitePlugin, what } from './vite.js';
export * from './runtime.js';
export {
  scanPages,
  extractPageConfig,
  generateRoutesModule,
} from './file-router.js';

export type { WhatVitePluginOptions, WhatVitePlugin } from './vite.js';
export type { BabelPluginPass } from './babel.js';
export type {
  ScannedRoutes,
  ScannedPage,
  PageConfig,
  PageExports,
} from './file-router.js';
