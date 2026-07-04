// what-compiler — TypeScript declarations for the public compiler entry point
// (src/index.js). Types the surface that is actually exported so vite.config /
// babel.config authoring against what-compiler is type-checked, not `any`.

export { default as babelPlugin } from './babel';
export { default as vitePlugin, what } from './vite';
export * from './runtime';
export {
  scanPages,
  extractPageConfig,
  generateRoutesModule,
} from './file-router';

export type { WhatVitePluginOptions, WhatVitePlugin } from './vite';
export type { BabelPluginPass } from './babel';
export type {
  ScannedRoutes,
  ScannedPage,
  PageConfig,
  PageExports,
} from './file-router';
