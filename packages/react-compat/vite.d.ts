// what-react/vite — Vite plugin that aliases `react`/`react-dom` to what-react
// and keeps installed React packages out of pre-bundling (src/vite-plugin.js).

export interface ReactCompatOptions {
  /** Additional packages to exclude from Vite's dependency pre-bundling. */
  exclude?: string[];
  /** Auto-detect installed React packages to exclude. Defaults to true. */
  autoDetect?: boolean;
}

// Structural Vite plugin shape — assignable to Vite's `PluginOption` without
// taking a hard type dependency on `vite`.
export interface ReactCompatPlugin {
  name: string;
  enforce?: 'pre' | 'post';
  [hook: string]: unknown;
}

export function reactCompat(options?: ReactCompatOptions): ReactCompatPlugin;

export default reactCompat;
