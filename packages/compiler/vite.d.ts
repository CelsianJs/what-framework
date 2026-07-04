// what-compiler/vite — Vite plugin that compiles What JSX and wires the
// file-router / HMR (src/vite-plugin.js).

export interface WhatVitePluginOptions {
  /** Files to process. Defaults to /\.[jt]sx$/. */
  include?: RegExp | RegExp[];
  /** Files to skip. Defaults to /node_modules/. */
  exclude?: RegExp | RegExp[];
  /** Emit source maps. Defaults to true. */
  sourceMaps?: boolean;
  /** Apply production optimizations. Defaults to NODE_ENV === 'production'. */
  production?: boolean;
  /** Pages directory, relative to project root. Defaults to 'src/pages'. */
  pages?: string;
  /** Enable HMR. Defaults to enabled in dev, disabled in production. */
  hot?: boolean;
  /** Resolve the `production` exports condition during build. Defaults to true. */
  prodBundles?: boolean;
}

// Structural Vite plugin shape — assignable to Vite's `PluginOption` without a
// hard type dependency on `vite`.
export interface WhatVitePlugin {
  name: string;
  enforce?: 'pre' | 'post';
  [hook: string]: unknown;
}

export interface JsxPreserveConfigInput {
  rolldownVersion?: string;
  viteVersion?: string;
}

/** esbuild/JSX config so Vite preserves What JSX for the plugin to compile. */
export function jsxPreserveConfig(
  input?: JsxPreserveConfigInput,
): Record<string, unknown>;

declare function whatVitePlugin(options?: WhatVitePluginOptions): WhatVitePlugin;

export { whatVitePlugin as what };
export default whatVitePlugin;
