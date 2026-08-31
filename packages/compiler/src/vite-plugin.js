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
import { generateRoutesModule } from './file-router.js';
import { setupErrorOverlay } from './error-overlay.js';

const VIRTUAL_ROUTES_ID = 'virtual:what-routes';
const RESOLVED_VIRTUAL_ID = '\0' + VIRTUAL_ROUTES_ID;
const SERVER_ACTION_MODULE_RE = /(?:from\s*['"](?:what-framework\/server|what-server(?:\/actions)?)['"]|import\s*['"](?:what-framework\/server|what-server(?:\/actions)?)['"])/;
const SCRIPT_MODULE_RE = /\.[cm]?[jt]sx?$/;

function patternMatches(pattern, value) {
  if (!pattern) return false;
  if (Array.isArray(pattern)) return pattern.some((entry) => patternMatches(entry, value));
  if (pattern instanceof RegExp) {
    pattern.lastIndex = 0;
    return pattern.test(value);
  }
  return typeof pattern === 'function' ? pattern(value) : false;
}

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
 *
 * @param {object} [signals]
 * @param {string|number} [signals.rolldownVersion]
 * @param {string|number} [signals.viteVersion]
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

// --- SSR guard --------------------------------------------------------------
//
// A module that what-compiler lowers cannot run on a server, and the failures it
// produces without this guard both name the wrong thing.
//
// The lowering emits a module-scope `const _tmpl$0 = _$template("<div>...")`,
// and `_$template` calls `document.createElement('template')` EAGERLY. So the
// module throws `ReferenceError: document is not defined` at IMPORT time, before
// any render function runs, with a stack that points into what-core rather than
// at the file the developer wrote. If a DOM shim happens to exist, the component
// instead returns a cloned Element and what-server's assertSafeTag reports
// ERR_COMPILED_JSX_IN_SSR.
//
// Both are runtime failures for something decidable at build time: if Vite is
// transforming this module for the SSR environment and the transform emitted
// DOM-building code, the resulting bundle cannot work. Fail here, name the file,
// and name the two configurations that DO server-render, rather than emitting a
// bundle whose only possible behaviour is to crash.
//
// This is a guard, not a feature. It does not make compiled JSX server-render;
// what-compiler has no hydratable/SSR codegen target. See
// docs/SSR-COMPILED-JSX-SCOPING.md for the seams and the staged plan.

// The two compiler-generated locals that make a module client-only.
//
//   _$template        — hoisted to module scope and calls
//                       document.createElement('template') EAGERLY, so the
//                       module throws at import time on a server.
//   _$createComponent — runs the component and builds its DOM at call time.
//
// Deliberately NOT in this list: _$componentVNode, which is _$createComponent
// stopping one step short of createDOM (what-core render.js). A module whose
// only JSX is the argument of a hydrate() call emits that and nothing else, and
// it is import-safe, so flagging it would be wrong. The other helpers
// (_$insert, _$spread, _$setProp, ...) are all reached only THROUGH a template,
// so they add no cases and would only widen the blast radius.
//
// The `_$` prefix is compiler-generated and never written by hand, which is what
// makes matching on the name safe.
const DOM_BUILDING_LOCALS = /\b_\$(?:template|createComponent)\b/;

function buildsDom(outputCode) {
  return DOM_BUILDING_LOCALS.test(outputCode);
}

function ssrGuardError(id) {
  // ERROR_CODES.COMPILED_JSX_IN_SSR
  return Object.assign(
    new Error(
      `[what-compiler] ${id} is being compiled for the server, but what-compiler's ` +
      'JSX output is client-only. It lowers JSX to module-scope _$template() calls ' +
      'that run document.createElement() at import time, so this module throws ' +
      '"document is not defined" the moment a server imports it.\n\n' +
      'Server-rendered views have two supported spellings:\n' +
      '  1. Author them with h() from what-framework.\n' +
      '  2. Compile them with the automatic JSX runtime instead of what-compiler ' +
      '(jsxImportSource: "what-framework"), which emits h() calls that ' +
      'renderToString and renderToHydratableString understand.\n\n' +
      'If a DOM already exists in this process on purpose, set ssrGuard: false ' +
      'on the plugin. The likeliest reason is a test runner: Vitest applies an ' +
      "SSR transform under `environment: 'node'`, so a component test that " +
      'shims a DOM itself lands here. Note that with the guard off the result ' +
      'is a full client render, not SSR.'
    ),
    { code: 'ERR_COMPILED_JSX_IN_SSR', id, plugin: 'vite-plugin-what' },
  );
}

// Vite reports "this transform is for the server" in two ways depending on its
// major: the third `transform` argument (`{ ssr: true }`) on every version, and
// the Environment API (`this.environment.name === 'ssr'`) from Vite 6. Read both
// — a plugin that checked only one would silently stop guarding on the other.
function isSsrTransform(transformOptions, ctx) {
  if (transformOptions && transformOptions.ssr) return true;
  const env = ctx && ctx.environment;
  return !!(env && env.name === 'ssr');
}

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
    // Refuse to lower JSX for a module in the SSR graph. See ssrGuardError().
    // Set to false only if you have installed a DOM in the server process and
    // accept that the render is a full client render, not SSR.
    ssrGuard = true,
  } = options;

  let rootDir = '';
  let pagesDir = '';
  let isDevMode = false;
  const actionIdRegistry = new Map();

  function registerActionId(metadata) {
    const existing = actionIdRegistry.get(metadata.id);
    if (existing && existing.key !== metadata.key) {
      // ERROR_CODES.DUPLICATE_ACTION_ID
      throw Object.assign(
        new Error(
          `Duplicate server action ID "${metadata.id}". ` +
          `First declared by "${existing.bindingName}" at ${existing.source}; ` +
          `conflicts with "${metadata.bindingName}" at ${metadata.source}.`
        ),
        { code: 'ERR_DUPLICATE_ACTION_ID' },
      );
    }
    actionIdRegistry.set(metadata.id, metadata);
  }

  function clearActionIdsForFile(filename) {
    for (const [id, metadata] of actionIdRegistry) {
      if (metadata.filename === filename) actionIdRegistry.delete(id);
    }
  }

  function actionFilenameForFile(filename) {
    const cleanFilename = filename.replace(/[?#].*$/, '');
    return rootDir
      ? path.relative(rootDir, cleanFilename).split(path.sep).join('/')
      : cleanFilename;
  }

  return {
    name: 'vite-plugin-what',

    configResolved(config) {
      rootDir = config.root;
      pagesDir = path.resolve(rootDir, pages);
      isDevMode = config.command === 'serve';
    },

    configureServer(devServer) {
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
        // Vite will never transform an unlinked module again, so explicitly
        // release its IDs before handling the narrower pages refresh path.
        clearActionIdsForFile(actionFilenameForFile(file));
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
    transform(code, id, transformOptions) {
      const cleanId = id.replace(/[?#].*$/, '');
      const hasJsx = patternMatches(include, cleanId);
      const isScriptModule = SCRIPT_MODULE_RE.test(cleanId);
      const hasServerActions = isScriptModule && SERVER_ACTION_MODULE_RE.test(code);
      if (exclude && patternMatches(exclude, cleanId)) return null;

      // Clear before either transforming the replacement or returning early.
      // Otherwise a .ts/.js module that removes its final action import leaves
      // an ID reserved forever and produces false duplicate-ID failures.
      if (isScriptModule) clearActionIdsForFile(actionFilenameForFile(cleanId));
      // Server action metadata is required in plain .js/.ts modules too, so
      // those modules pass through the same hermetic Babel transform even when
      // they contain no JSX.
      if (!hasJsx && !hasServerActions) return null;

      const guardSsr = ssrGuard && isSsrTransform(transformOptions, this);

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
            [whatBabelPlugin, {
              production,
              projectRoot: rootDir || process.cwd(),
              onActionId: registerActionId,
            }]
          ],
          parserOpts: {
            plugins: ['jsx', 'typescript']
          }
        });

        if (!result || !result.code) {
          return null;
        }

        let outputCode = result.code;

        // Decided from the OUTPUT, not the filename. `.jsx` in the include
        // pattern says the file MAY contain JSX, not that any was lowered, and a
        // .js/.ts module compiled here purely for its server-action metadata
        // emits nothing DOM-building at all. Both would be false positives.
        // buildsDom() asks the only question that matters: did this transform
        // emit code that constructs DOM?
        if (guardSsr && buildsDom(outputCode)) {
          throw ssrGuardError(cleanId);
        }

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
        // The SSR guard is a verdict on a transform that SUCCEEDED, not a Babel
        // failure. Passing it through the enrichment below would log "[what]
        // Error transforming <file>" over it, which says the compile broke when
        // it did not, and buries the part the developer has to read.
        if (error && error.code === 'ERR_COMPILED_JSX_IN_SSR') throw error;
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
    handleHotUpdate({ file, server: devServer}) {
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
