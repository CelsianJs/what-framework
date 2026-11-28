// what-react/vite — Vite plugin that aliases `react`/`react-dom` to what-react,
// keeps one what-react in the dev server, a production build and a server
// build, and lets native What files and React files share one app
// (src/vite-plugin.js, MIXED.md).

/** A path relative to the project root (prefix), a RegExp, or a test. */
export type FileMatcher = string | RegExp | ((file: string) => boolean);

export interface ReactCompatOptions {
  /**
   * Additional packages to exclude from Vite's dependency pre-bundling. The
   * plugin itself excludes only what it replaces (`react`, `react-dom`,
   * `use-sync-external-store`) and the framework packages; React libraries
   * are pre-bundled like any dependency.
   */
  exclude?: string[];
  /**
   * Find the React packages a server render has to bundle (Vite's
   * `ssr.noExternal`) from the app's package.json. Defaults to true; with
   * false, only what-react is added and the rest is yours to list.
   */
  autoDetect?: boolean;
  /**
   * Native What files and React files in one app (MIXED.md). `'auto'`
   * (the default) turns it on when the config also has what-compiler's
   * what() plugin; off, every JSX file is React code.
   */
  mixed?: boolean | 'auto';
  /** Mixed mode: files that are React files whatever they import. */
  react?: FileMatcher | FileMatcher[];
  /**
   * Mixed mode: a page the server rendered hydrates its React islands by
   * adopting the server's HTML (elements and text are kept, so focus and typed
   * text survive). Installed in the modules what-compiler compiles for
   * hydration. Defaults to true; with false, an island renders in the browser
   * and replaces the server's HTML.
   */
  hydrateIslands?: boolean;
}

// Structural Vite plugin shape — assignable to Vite's `PluginOption` without
// taking a hard type dependency on `vite`.
export interface ReactCompatPlugin {
  name: string;
  enforce?: 'pre' | 'post';
  [hook: string]: unknown;
}

export function reactCompat(options?: ReactCompatOptions): ReactCompatPlugin[];

/**
 * The React packages a server render of the app at `projectRoot` bundles
 * (ssr.noExternal): its dependencies that depend on react, and their React
 * dependencies, that ship ES modules. `commonjs` adds the React packages that
 * ship CommonJS only, `dependencies` everything a React package depends on;
 * a production server build asks for both, the dev server for neither.
 */
export function detectSsrReactPackages(projectRoot: string, options?: { commonjs?: boolean; dependencies?: boolean }): string[];

export default reactCompat;
