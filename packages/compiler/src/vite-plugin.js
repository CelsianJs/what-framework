/**
 * What Framework Vite Plugin
 *
 * 1. Transforms JSX via the What babel plugin
 * 2. Provides file-based routing via virtual:what-routes
 * 3. Watches pages directory for route changes
 * 4. HMR support: component files get granular hot-module replacement,
 *    signal/utility files trigger full reload
 */

import path from 'path';
import { transformSync } from '@babel/core';
import whatBabelPlugin from './babel-plugin.js';
import { generateRoutesModule, scanPages } from './file-router.js';
import { setupErrorOverlay } from './error-overlay.js';

const VIRTUAL_ROUTES_ID = 'virtual:what-routes';
const RESOLVED_VIRTUAL_ID = '\0' + VIRTUAL_ROUTES_ID;

/**
 * Shape the "preserve JSX" transform config for the running Vite version.
 *
 * Vite ≤7 transforms with esbuild and takes `esbuild: { jsx: 'preserve' }`.
 * Vite 8 (rolldown-based) transforms with oxc; the `esbuild` key still works
 * but prints a deprecation warning on every dev/build run
 * ("'esbuild' option ... is deprecated, please use 'oxc' instead"), so we
 * emit `oxc: { jsx: 'preserve' }` there instead.
 *
 * Detection (either signal selects oxc):
 *  - feature: rolldown-vite exposes `this.meta.rolldownVersion` to plugins —
 *    the most reliable signal, also covers `rolldown-vite` aliased as vite 7.
 *  - version: `import('vite')` exports `version`; major ≥ 8 means rolldown.
 *
 * Exported for unit tests.
 */
export function jsxPreserveConfig({ rolldownVersion, viteVersion } = {}) {
  const major = parseInt(String(viteVersion ?? ''), 10);
  const useOxc = Boolean(rolldownVersion) || (Number.isFinite(major) && major >= 8);
  return useOxc
    ? { oxc: { jsx: 'preserve' } }
    : { esbuild: { jsx: 'preserve' } };
}

// Resolved once per process — the Vite version can't change mid-run.
let viteVersionPromise = null;
function detectViteVersion() {
  if (!viteVersionPromise) {
    viteVersionPromise = import('vite')
      .then((vite) => vite.version || '')
      .catch(() => ''); // vite not resolvable (tests) — esbuild fallback
  }
  return viteVersionPromise;
}

// Pattern: exported function starting with uppercase = component
const COMPONENT_EXPORT_RE = /export\s+(?:default\s+)?function\s+([A-Z]\w*)/;
// Pattern: files that are likely signal/store/utility files
const UTILITY_FILE_RE = /(?:store|signal|state|context|util|helper|lib|config)\b/i;

export default function whatVitePlugin(options = {}) {
  const {
    // File extensions to process
    include = /\.[jt]sx$/,
    // Files to exclude
    exclude = /node_modules/,
    // Enable source maps
    sourceMaps = true,
    // Production optimizations
    production = process.env.NODE_ENV === 'production',
    // Pages directory (relative to project root)
    pages = 'src/pages',
    // HMR: enabled by default in dev, disabled in production
    hot = !production,
    // Resolve the `production` exports condition (dist/*.min.js — pre-minified,
    // dev warnings compiled out) during `vite build`. Set to false to build
    // against package sources instead — needed e.g. in a monorepo where
    // workspace-linked dist/ output may be stale or absent. See config() below.
    prodBundles = true,
  } = options;

  let rootDir = '';
  let pagesDir = '';
  let server = null;
  let isDevMode = false;

  return {
    name: 'vite-plugin-what',

    configResolved(config) {
      rootDir = config.root;
      pagesDir = path.resolve(rootDir, pages);
      isDevMode = config.command === 'serve';
    },

    configureServer(devServer) {
      server = devServer;

      // Set up What-branded error overlay
      setupErrorOverlay(devServer);

      // Watch the pages directory for file additions/removals
      devServer.watcher.on('add', (file) => {
        if (file.startsWith(pagesDir)) {
          // Invalidate the virtual routes module
          const mod = devServer.moduleGraph.getModuleById(RESOLVED_VIRTUAL_ID);
          if (mod) {
            devServer.moduleGraph.invalidateModule(mod);
            devServer.ws.send({ type: 'full-reload' });
          }
        }
      });

      devServer.watcher.on('unlink', (file) => {
        if (file.startsWith(pagesDir)) {
          const mod = devServer.moduleGraph.getModuleById(RESOLVED_VIRTUAL_ID);
          if (mod) {
            devServer.moduleGraph.invalidateModule(mod);
            devServer.ws.send({ type: 'full-reload' });
          }
        }
      });
    },

    // Resolve virtual module
    resolveId(id) {
      if (id === VIRTUAL_ROUTES_ID) {
        return RESOLVED_VIRTUAL_ID;
      }
    },

    // Generate the routes module
    load(id) {
      if (id === RESOLVED_VIRTUAL_ID) {
        return generateRoutesModule(pagesDir, rootDir);
      }
    },

    // Transform JSX files
    transform(code, id) {
      // Check if we should process this file
      if (!include.test(id)) return null;
      if (exclude && exclude.test(id)) return null;

      try {
        const result = transformSync(code, {
          filename: id,
          sourceMaps,
          // Hermetic transform (SPRINT v0.11 C7): never load the project's
          // babel.config.js/.babelrc. A user's React preset or unrelated
          // plugins corrupting What's JSX output is a debugging nightmare —
          // and scanning the disk for config files on every transform is
          // wasted I/O in dev.
          configFile: false,
          babelrc: false,
          plugins: [
            [whatBabelPlugin, { production }]
          ],
          parserOpts: {
            plugins: ['jsx', 'typescript']
          }
        });

        if (!result || !result.code) {
          return null;
        }

        let outputCode = result.code;

        // HMR: append hot boundary code for component files in dev mode
        if (hot && isDevMode && !production) {
          const isComponentFile = isComponentModule(code, id);

          if (isComponentFile) {
            outputCode += generateHMRBoundary(id);
          }
        }

        return {
          code: outputCode,
          map: result.map
        };
      } catch (error) {
        // Enrich Babel errors with file context for the error overlay
        error.plugin = 'vite-plugin-what';
        if (!error.id) error.id = id;
        if (error.loc === undefined && error._loc) {
          error.loc = { file: id, line: error._loc.line, column: error._loc.column };
        }
        console.error(`[what] Error transforming ${id}:`, error.message);
        throw error;
      }
    },

    // HMR: detect component vs utility files and handle accordingly
    handleHotUpdate({ file, server: devServer, modules }) {
      if (!hot) return;

      // Only handle files we process
      if (!include.test(file)) return;
      if (exclude && exclude.test(file)) return;

      // Utility/signal/store files: trigger full reload
      // These files may export signals used across multiple components
      if (isUtilityFile(file)) {
        devServer.ws.send({ type: 'full-reload' });
        return [];
      }

      // Component files: let Vite handle HMR normally (our boundary code handles it)
      // Return undefined to let Vite's default HMR proceed
      return;
    },

    // Configure for development
    async config(config, { mode, command }) {
      // SPRINT v0.11 C7: make the `production` exports condition reachable.
      // what-framework/what-core ship pre-minified production bundles behind
      // the `production` condition in their exports maps, but Vite's default
      // resolve conditions never include `production` — so production builds
      // silently shipped the dev source (larger, with dev-only warnings).
      //
      // Guard rationale (documented choice):
      //  - Only during `vite build` in production mode — dev always uses src
      //    so the dev server, HMR, and devtools see un-minified modules.
      //  - Opt-out via `what({ prodBundles: false })` — in a monorepo with
      //    workspace-linked packages, dist/ can be stale (or missing before
      //    the first `npm run build`), and resolving `production` there would
      //    bundle outdated framework code. Apps installing from npm always
      //    have dist/ in sync with the published package, so the default is on.
      //  - `resolve.conditions` is ADDITIVE in Vite (extra conditions on top
      //    of the defaults), so import/browser/default resolution for other
      //    packages is unaffected.
      const useProdCondition = command === 'build' && mode === 'production' && prodBundles;
      // Preserve JSX so our babel plugin handles it — don't let the bundler's
      // built-in transformer (esbuild on Vite ≤7, oxc on Vite 8+) touch it.
      // jsxPreserveConfig picks the right option key for the running version.
      const jsxPreserve = jsxPreserveConfig({
        rolldownVersion: this?.meta?.rolldownVersion,
        viteVersion: await detectViteVersion(),
      });
      return {
        ...(useProdCondition ? { resolve: { conditions: ['production'] } } : {}),
        ...jsxPreserve,
        optimizeDeps: {
          // Exclude framework packages from Vite's dependency pre-bundling.
          //
          // Bug class this prevents — "dual module instance":
          //   The compiler emits `import { ... } from 'what-framework/render'`
          //   (a subpath resolved to the source file). Meanwhile user code
          //   imports `'what-framework'` (the package entry). If Vite
          //   pre-bundles `'what-framework'` into an esbuild chunk under
          //   node_modules/.vite, those two import paths resolve to two
          //   *different* module instances. Module-scoped state — the
          //   `componentStack` used by createComponent, effect ownership,
          //   the signal subscriber registry — is duplicated, so a signal
          //   created in user code never notifies effects created via the
          //   compiler-emitted path, and `getCurrentComponent()` returns
          //   undefined inside components mounted through compiler output.
          //
          // Why `exclude` is the right knob:
          //   `include` would force pre-bundling of the package entry, which
          //   does not resolve the subpath import the compiler emits — so the
          //   split persists. Using `exclude` tells Vite to skip the optimizer
          //   for these packages and serve them via the normal module graph,
          //   where both the package entry and the `/render` subpath share
          //   a single ESM module record.
          //
          // Regression symptom if this is removed:
          //   Components mount but lifecycle hooks (onMount, onCleanup) and
          //   shared store state silently no-op; effects don't re-run on
          //   signal writes from user code; SSR/CSR hydration mismatches.
          exclude: ['what-framework', 'what-core', 'what-compiler', 'what-router'],
        }
      };
    }
  };
}

/**
 * Check if a file likely contains a component (has exported function starting with uppercase)
 */
function isComponentModule(source, filePath) {
  // .jsx/.tsx files with component exports
  if (COMPONENT_EXPORT_RE.test(source)) return true;
  // Pages are always component files
  if (filePath.includes('/pages/') || filePath.includes('\\pages\\')) return true;
  return false;
}

/**
 * Check if a file is a utility/signal/store file (should trigger full reload)
 */
function isUtilityFile(filePath) {
  const basename = path.basename(filePath, path.extname(filePath));
  return UTILITY_FILE_RE.test(basename);
}

/**
 * Generate HMR boundary code for a component file.
 * When the module is updated, Vite's HMR runtime calls import.meta.hot.accept(),
 * which re-runs the module. The component re-renders in place.
 */
function generateHMRBoundary(filePath) {
  return `

// --- What Framework HMR Boundary ---
if (import.meta.hot) {
  import.meta.hot.accept((newModule) => {
    if (newModule) {
      // Signal to the What runtime that this module was hot-updated
      if (window.__WHAT_HMR_ACCEPT__) {
        window.__WHAT_HMR_ACCEPT__(${JSON.stringify(filePath)}, newModule);
      }
    }
  });
}
`;
}

// Named export for compatibility
export { whatVitePlugin as what };
