// what-compiler/vite — Vite plugin that compiles What JSX and wires the
// file-router / HMR (src/vite-plugin.js).

export interface WhatVitePluginOptions {
  /** Files to process. Defaults to /\.[jt]sx$/. */
  include?: RegExp | RegExp[];
  /** Files to skip. Defaults to /node_modules/. */
  exclude?: RegExp | RegExp[];
  /**
   * A dependency's files to compile as the app's own. Nothing under
   * node_modules is compiled, whatever `include` and `exclude` say, and no
   * script file of one of What's own packages (what-core, what-react,
   * what-router and the rest) is, a workspace link included: they are the
   * framework, not the app. A file this matches is compiled as the app's
   * files are: a package that publishes What JSX as source. Defaults to none.
   */
  compileDependencies?: RegExp | ((id: string) => boolean) | Array<RegExp | ((id: string) => boolean)>;
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
  /**
   * Compile modules Vite transforms for the server (SSR, or the 'ssr'
   * environment) with what-compiler's server target, which what-server renders.
   * Defaults to true. With false, a server transform whose output would build
   * DOM is refused with ERR_COMPILED_JSX_IN_SSR.
   */
  ssr?: boolean;
  /**
   * False compiles every server transform for the DOM, whatever `ssr` says,
   * for a process that installs a DOM on purpose, such as a test runner
   * applying SSR transforms. Defaults to true: server transforms use the
   * server target, or with `ssr: false` one that would build DOM is refused.
   */
  ssrGuard?: boolean;
  /**
   * Rewrite `selected() === row.id` inside keyed `.map()` rows to a
   * `createSelector` lookup, so a selection change re-runs two rows instead of
   * every row. Defaults to true; false keeps every comparison as written.
   */
  autoSelector?: boolean;
  /**
   * Compile client JSX so that `hydrate()` adopts server-rendered markup
   * (what-compiler's `hydratable` option). `'auto'`, the default, does when
   * the config says the project renders on the server: `appType: 'custom'`,
   * an SSR build, or a client build with `build.ssrManifest`. Set `true` when
   * the client build has none of these.
   */
  hydratable?: boolean | 'auto';
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
