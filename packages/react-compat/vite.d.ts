// what-react/vite — Vite plugin that aliases `react`/`react-dom` to what-react,
// keeps installed React packages out of pre-bundling, and lets native What
// files and React files share one app (src/vite-plugin.js, MIXED.md).

/** A path relative to the project root (prefix), a RegExp, or a test. */
export type FileMatcher = string | RegExp | ((file: string) => boolean);

export interface ReactCompatOptions {
  /** Additional packages to exclude from Vite's dependency pre-bundling. */
  exclude?: string[];
  /** Auto-detect installed React packages to exclude. Defaults to true. */
  autoDetect?: boolean;
  /**
   * Native What files and React files in one app (MIXED.md). `'auto'`
   * (the default) turns it on when the config also has what-compiler's
   * what() plugin; off, every JSX file is React code.
   */
  mixed?: boolean | 'auto';
  /** Mixed mode: files that are React files whatever they import. */
  react?: FileMatcher | FileMatcher[];
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
 * The React packages a Vite server build of the app at `projectRoot` bundles
 * (ssr.noExternal): its dependencies that depend on react, and their React
 * dependencies, that ship ES modules.
 */
export function detectSsrReactPackages(projectRoot: string): string[];

export default reactCompat;
