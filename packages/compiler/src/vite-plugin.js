/**
 * What Framework Vite Plugin
 *
 * 1. Transforms JSX via the What babel plugin (the server target for SSR transforms)
 * 2. Provides file-based routing via virtual:what-routes
 * 3. Watches pages directory for route changes
 * 4. Component hot updates use an installed replacement hook or reload the
 *    page; signal/utility files trigger full reload
 */

import path from 'path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { transformSync } from '@babel/core';
import whatBabelPlugin from './babel-plugin.js';
import { generateRoutesModule } from './file-router.js';
import { setupErrorOverlay } from './error-overlay.js';
import { IMPORT_CHANGES } from './tables/import-changes.js';
import { runtimeMismatch } from './release.js';

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

async function detectViteVersion(root) {
  // A workspace-linked compiler can resolve a different Vite than its consumer.
  // Multiple apps may also build with different versions in the same process.
  try {
    const require = createRequire(path.resolve(root || process.cwd(), 'package.json'));
    return require('vite/package.json').version || '';
  } catch {
    // Keep programmatic/global Vite use working when the app has no local copy.
    return import('vite').then((vite) => vite.version || '').catch(() => '');
  }
}

// Pattern: exported function starting with uppercase = component
const COMPONENT_EXPORT_RE = /export\s+(?:default\s+)?function\s+([A-Z]\w*)/;
// Pattern: files that are likely signal/store/utility files
const UTILITY_FILE_RE = /(?:store|signal|state|context|util|helper|lib|config)\b/i;

// --- Server builds ---
//
// When Vite transforms a module for the server (SSR or the 'ssr' environment),
// JSX is compiled with what-compiler's server target (`generate: "ssr"`):
// string templates rendered by what-server/ssr-runtime, which every
// what-server renderer accepts. Two options change that:
//   - `ssr: false` keeps compiled JSX out of server bundles: a server transform
//     whose output would build DOM is refused with ERR_COMPILED_JSX_IN_SSR,
//     naming the file, instead of shipping a module that throws "document is
//     not defined" the first time it renders.
//   - `ssrGuard: false` compiles every server transform for the DOM, with or
//     without `ssr: false`, for a process that installs a DOM on purpose. The likeliest one is a test runner:
//     Vitest applies an SSR transform under `environment: 'node'`, so a
//     component test that mounts compiled JSX into a DOM shim needs it.
// Whether output builds DOM is reported by the compiler itself
// (`metadata.whatBuildsDom`: a template clone or a component call), so a
// JSX-free server-action module and a hydrate()-only module still compile.

// --- Hydration ---
//
// A page the server rendered is adopted by hydrate() only when the client's
// JSX is compiled for it (what-compiler's `hydratable` option: templates that
// claim the server's nodes instead of cloning). Its cost is client code that
// steps through each template rather than walking it by path, so the plugin
// compiles that way only for a project that renders on the server: one whose
// Vite config says so (`appType: 'custom'`, the shape of every SSR setup in
// Vite's guide; an SSR build; or a client build that writes an SSR manifest,
// `vite build --ssrManifest`, as the guide's production client build does),
// unless `hydratable` is set. A client build with none of these (a project
// whose dev server passes `appType: 'custom'` inline but whose `vite build`
// does not) needs `hydratable: true`. Hydrating
// server markup with JSX compiled without it reports an ERR_HYDRATION_MISMATCH
// of kind not-hydratable and renders the page again on the client.

function rendersOnServer(config) {
  return config.appType === 'custom' || Boolean(config.build && (config.build.ssr || config.build.ssrManifest));
}

function ssrGuardError(id) {
  // ERROR_CODES.COMPILED_JSX_IN_SSR
  return Object.assign(
    new Error(
      `[what-compiler] ${id} is being compiled for the server with ssr: false, so ` +
      "what-compiler emits its client output, which builds DOM: _$template() calls that " +
      'parse their markup with document.createElement(), so this module throws ' +
      '"document is not defined" the first time a server renders it.\n\n' +
      'Remove ssr: false to compile server modules with what-compiler\'s server ' +
      'target, which what-server renders directly. Or author server views with h() ' +
      'from what-framework, or compile them with the automatic JSX runtime ' +
      '(jsxImportSource: "what-framework").\n\n' +
      'If a DOM already exists in this process on purpose (a test runner such as ' +
      "Vitest applies an SSR transform under `environment: 'node'`), set " +
      'ssrGuard: false to compile server transforms for the DOM.'
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
    // Compile server transforms with the server target. See "Server builds".
    ssr = true,
    // With ssr: false, refuse server transforms whose output builds DOM; false
    // compiles them for the DOM instead (a process that installs a DOM).
    ssrGuard = true,
    // Rewrite `selected() === row.id` in keyed .map() rows to a createSelector
    // lookup. Set to false to keep every comparison as written.
    autoSelector = true,
    // Compile client JSX so that hydrate() adopts server-rendered markup.
    // 'auto' does when the project renders on the server. See "Hydration".
    hydratable = 'auto',
  } = options;

  let rootDir = '';
  let pagesDir = '';
  let isDevMode = false;
  let hydratableOutput = hydratable === true;
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
      // What the app's compiled modules will import: the runtime of this
      // compiler's release, or ERR_COMPILER_RUNTIME_MISMATCH before any build.
      const mismatch = runtimeMismatch(config.root, fs);
      if (mismatch) throw mismatch;
      rootDir = config.root;
      pagesDir = path.resolve(rootDir, pages);
      isDevMode = config.command === 'serve';
      hydratableOutput = hydratable === 'auto' ? rendersOnServer(config) : hydratable === true;
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

      // A name the root entry (what-framework, what-core) no longer exports
      // fails here with the answer IMPORT_CHANGES records for it
      // (ERR_MOVED_IMPORT), not later with the bundler's "is not exported". The
      // regex only picks candidates and Babel's parse decides, so an import
      // statement quoted in a string never fails a build.
      const changeFor = (name) => IMPORT_CHANGES.find((c) => (c.name === name && !c.onRoot) || c.as === name);
      const rootClauses = isScriptModule ? [...code.matchAll(/\b(?:import|export)\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*['"]what-(?:framework|core)['"]/g)] : [];
      if (rootClauses.some(([, names]) => names.split(',').some((n) => changeFor(n.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0])))) {
        let body = [];
        try {
          body = transformSync(code, { ast: true, code: false, configFile: false, babelrc: false, parserOpts: { plugins: ['jsx', 'typescript'] } }).ast.program.body;
        } catch {
          // Unparseable here; the rest of the pipeline reports the syntax error.
        }
        const moved = [];
        for (const node of body) {
          const source = node.source && node.source.value;
          if ((source !== 'what-framework' && source !== 'what-core') || node.importKind === 'type' || node.exportKind === 'type') continue;
          for (const spec of node.specifiers || []) {
            const remote = spec.type === 'ImportSpecifier' ? spec.imported : spec.type === 'ExportSpecifier' ? spec.local : null;
            const name = remote && spec.importKind !== 'type' && spec.exportKind !== 'type' ? remote.name ?? remote.value : null;
            const change = name && changeFor(name);
            if (change) moved.push({ start: spec.loc.start, text: `"${name}" is not exported by ${source}. ${change.answer}` });
          }
        }
        if (moved.length) {
          throw Object.assign(
            new Error(
              `[what-compiler] ERR_MOVED_IMPORT in ${path.relative(rootDir || process.cwd(), cleanId)}:\n` +
              moved.map((m) => `  ${m.text}\n`).join('') +
              "eslint --fix with eslint-plugin-what's no-moved-imports rule rewrites the moved names; UPGRADING.md lists every change."
            ),
            { code: 'ERR_MOVED_IMPORT', id, plugin: 'vite-plugin-what', loc: { file: cleanId, line: moved[0].start.line, column: moved[0].start.column } },
          );
        }
      }

      // Clear before either transforming the replacement or returning early.
      // Otherwise a .ts/.js module that removes its final action import leaves
      // an ID reserved forever and produces false duplicate-ID failures.
      if (isScriptModule) clearActionIdsForFile(actionFilenameForFile(cleanId));
      // Server action metadata is required in plain .js/.ts modules too, so
      // those modules pass through the same hermetic Babel transform even when
      // they contain no JSX.
      const hasDevMetadata = isScriptModule && isDevMode && !production && /['"]what-(?:core|framework)['"]/.test(code);
      if (!hasJsx && !hasServerActions && !hasDevMetadata) return null;

      const serverTransform = isSsrTransform(transformOptions, this);
      const generate = serverTransform && ssr !== false && ssrGuard !== false ? 'ssr' : 'dom';
      const guardSsr = serverTransform && ssr === false && ssrGuard !== false;

      try {
        const result = transformSync(code, {
          filename: id,
          sourceMaps,
          // Hermetic transform: never load the project's
          // babel.config.js/.babelrc. A user's React preset or unrelated
          // plugins corrupting What's JSX output is a debugging nightmare —
          // and scanning the disk for config files on every transform is
          // wasted I/O in dev.
          configFile: false,
          babelrc: false,
          plugins: [
            [whatBabelPlugin, {
              generate,
              hydratable: generate === 'dom' && hydratableOutput,
              production,
              devMetadata: isDevMode && !production,
              autoSelector,
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

        // Decided from the OUTPUT, not the filename: `.jsx` in the include
        // pattern says the file MAY contain JSX, not that any was lowered.
        if (guardSsr && result.metadata && result.metadata.whatBuildsDom) {
          throw ssrGuardError(cleanId);
        }

        // HMR: append hot boundary code for component files in dev mode. The
        // boundary drives the browser, so a server module never gets one.
        if (hot && isDevMode && !production && !serverTransform) {
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
      // Make the `production` exports condition reachable.
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
      // Every build except `--mode development` is What's production tier,
      // whichever files it resolves: defining __WHAT_DEV__ folds the
      // development flag (what-core/src/env.js) to false, so source builds and
      // aliased checkouts lose their dev branches exactly as dist/*.min.js does.
      const productionBuild = command === 'build' && mode !== 'development';
      // Preserve JSX so our babel plugin handles it — don't let the bundler's
      // built-in transformer (esbuild on Vite ≤7, oxc on Vite 8+) touch it.
      // jsxPreserveConfig picks the right option key for the running version.
      const jsxPreserve = jsxPreserveConfig({
        rolldownVersion: this?.meta?.rolldownVersion,
        viteVersion: await detectViteVersion(config.root),
      });
      return {
        ...(useProdCondition ? { resolve: { conditions: ['production'] } } : {}),
        ...(productionBuild ? { define: { __WHAT_DEV__: 'false' } } : {}),
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
          //   current owner that components and hooks resolve through,
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
 * Vite calls the accept callback after reevaluating the updated module.
 * An installed replacement runtime owns the update. Otherwise reload the page:
 * accepting the module alone leaves its already-mounted component unchanged.
 */
function generateHMRBoundary(filePath) {
  return `

// --- What Framework HMR Boundary ---
if (import.meta.hot) {
  import.meta.hot.accept((newModule) => {
    if (newModule) {
      // Signal to the What runtime that this module was hot-updated
      if (typeof window.__WHAT_HMR_ACCEPT__ === 'function') {
        window.__WHAT_HMR_ACCEPT__(${JSON.stringify(filePath)}, newModule);
      } else {
        window.location.reload();
      }
    }
  });
}
`;
}

// Named export for compatibility
export { whatVitePlugin as what };
