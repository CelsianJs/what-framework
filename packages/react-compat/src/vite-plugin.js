/**
 * what-react Vite Plugin — One-line React → What Framework migration
 *
 * Usage:
 *   import { reactCompat } from 'what-react/vite';
 *   export default defineConfig({ plugins: [reactCompat()] });
 *
 * This plugin aliases all React imports to what-react, configures JSX,
 * and excludes React-ecosystem packages from Vite's pre-bundling to
 * prevent dual module instances.
 */
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { mixedJsx, isReactPackage } from './mixed-plugin.js';

// Common React ecosystem packages that import 'react' internally.
// These must be excluded from Vite's optimizeDeps to prevent pre-bundling
// with real React, which creates dual module instances.
const KNOWN_REACT_PACKAGES = [
  // State management
  'zustand', 'jotai', 'valtio', 'mobx-react', 'mobx-react-lite',
  'react-redux', 'redux', '@reduxjs/toolkit',
  // Data fetching
  '@tanstack/react-query', 'swr',
  // Forms
  'react-hook-form',
  // UI component libraries
  '@radix-ui', '@headlessui/react', 'antd', '@ant-design',
  '@mui/material', '@mui/x-data-grid', '@chakra-ui/react',
  // Tables & grids
  '@tanstack/react-table', '@tanstack/table-core',
  // Virtualization
  '@tanstack/react-virtual', '@tanstack/virtual-core',
  'react-window', 'react-virtualized',
  // Animation
  'framer-motion', 'motion', '@react-spring/web', 'react-spring',
  // Drag and drop
  '@dnd-kit/core', '@dnd-kit/sortable', 'react-dnd',
  // Routing
  'react-router', 'react-router-dom',
  // Notifications
  'react-hot-toast', 'react-toastify',
  // Icons
  'react-icons', '@heroicons/react',
  // Misc
  'react-markdown', 'react-helmet', 'react-helmet-async',
  'react-i18next', 'react-error-boundary',
  'react-select', 'react-datepicker',
  // Internal shims
  'use-sync-external-store', 'immer',
];

// Pure-CJS transitive utilities that do NOT import 'react' themselves (they
// touch react-is / symbols / DOM only). They must stay IN Vite's optimizeDeps
// so esbuild pre-bundles them and synthesizes the ESM default/named exports
// that React UI libs import (e.g. `import hoistStatics from 'hoist-non-react-statics'`).
//
// If these are excluded (or left un-pre-bundled), Vite serves the raw CJS file
// and the browser throws "does not provide an export named 'default'", which
// blank-screens the whole app. This is exactly what happens with react-select
// and @emotion/* — their CJS dep chain pulls in hoist-non-react-statics.
//
// These carry NO dual-React-instance risk: none of them `require('react')`,
// so there is no second copy of React/hooks to worry about. The react→what-react
// alias still applies to anything that DOES import 'react'.
const PURE_CJS_INTEROP_DEPS = [
  'hoist-non-react-statics',
  'react-is',
  'prop-types',
  'memoize-one',
  'use-isomorphic-layout-effect',
  'shallowequal',
  'stylis',
  'react-fast-compare',
  'warning',
  'invariant',
  'object-assign',
  'classnames',
  'tiny-invariant',
  'tiny-warning',
  'dom-helpers',
];

/**
 * Detect which of the pure-CJS interop deps are actually installed, so we only
 * ask Vite to pre-bundle ones that resolve (an `include` for a missing dep is a
 * hard error in Vite).
 */
function detectInstalledInteropDeps(projectRoot) {
  const installed = [];
  for (const pkg of PURE_CJS_INTEROP_DEPS) {
    try {
      const require = createRequire(projectRoot + '/');
      require.resolve(pkg);
      installed.push(pkg);
    } catch {
      // Not installed (it's transitive and may not be hoisted), skip.
    }
  }
  return installed;
}

/**
 * Resolve the directory of a package from the user's project
 */
function resolvePackageDir(packageName, fromDir) {
  try {
    const require = createRequire(fromDir + '/');
    const resolved = require.resolve(packageName);
    // Walk up from the resolved file to find the package root
    let dir = path.dirname(resolved);
    while (dir !== path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, 'package.json'))) {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        if (pkg.name === packageName) return dir;
      }
      dir = path.dirname(dir);
    }
    return path.dirname(resolved);
  } catch {
    return null;
  }
}

/**
 * Auto-detect which React packages are installed in the project
 */
function detectInstalledReactPackages(projectRoot) {
  const installed = [];
  for (const pkg of KNOWN_REACT_PACKAGES) {
    try {
      const require = createRequire(projectRoot + '/');
      require.resolve(pkg);
      installed.push(pkg);
    } catch {
      // Not installed, skip
    }
  }
  return installed;
}

/**
 * The React packages a server build has to bundle (Vite's ssr.noExternal):
 * an external package is loaded by Node, where its `import 'react'` reaches
 * React itself instead of what-react, so a React island could not render on
 * the server. Found from the app's dependencies, and the dependencies of each
 * React package found, so a library's own React dependencies (react-redux
 * under recharts) come too. Packages Node cannot run as ES modules once
 * bundled (CommonJS only) stay external; an island that uses one renders in
 * the browser.
 */
export function detectSsrReactPackages(projectRoot) {
  const found = new Set();
  const seen = new Set();
  const readPkg = (name, fromDir) => {
    for (let dir = fromDir; ; dir = path.dirname(dir)) {
      const file = path.join(dir, 'node_modules', name, 'package.json');
      if (fs.existsSync(file)) {
        try { return { pkg: JSON.parse(fs.readFileSync(file, 'utf8')), dir: path.dirname(fs.realpathSync(file)) }; } catch { return null; }
      }
      if (dir === path.dirname(dir)) return null;
    }
  };
  let app;
  try { app = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')); } catch { return []; }
  const queue = Object.keys({ ...app.dependencies, ...app.optionalDependencies }).map((name) => [name, projectRoot]);
  while (queue.length > 0) {
    const [name, fromDir] = queue.shift();
    if (seen.has(name) || name === 'react' || name === 'react-dom' || FRAMEWORK_PACKAGES.includes(name) || name === 'what-react') continue;
    seen.add(name);
    const hit = readPkg(name, fromDir);
    if (hit === null || !isReactPackage(hit.pkg)) continue;
    const esm = hit.pkg.type === 'module' || Boolean(hit.pkg.module) || JSON.stringify(hit.pkg.exports ?? '').includes('"import"');
    if (esm) found.add(name);
    for (const dep of Object.keys({ ...hit.pkg.dependencies, ...hit.pkg.peerDependencies })) queue.push([dep, hit.dir]);
  }
  return [...found];
}

// The packages an app reaches the engine through: what-framework's entries
// re-export what-core, what-router and what-server. They are served as ES
// modules rather than pre-bundled, so all of them share one what-core.
const FRAMEWORK_PACKAGES = ['what-framework', 'what-core', 'what-router', 'what-server'];

// Vite matches a string alias as a prefix, so 'react-dom' would also capture
// 'react-dom/server' and rewrite it to `<dir>/dom.js/server`. Each alias here
// names one module.
function exactAlias(specifier, replacement) {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { find: new RegExp(`^${escaped}$`), replacement };
}

// Whether the app's config also uses what-compiler's plugin (what()).
function usesWhatCompiler(plugins) {
  const list = Array.isArray(plugins) ? plugins.flat(Infinity) : [];
  return list.some((p) => p && typeof p === 'object' && p.name === 'vite-plugin-what');
}

/**
 * @param {object} [options]
 * @param {string[]} [options.exclude] - Additional packages to exclude from pre-bundling
 * @param {boolean} [options.autoDetect=true] - Auto-detect installed React packages to exclude
 * @param {boolean | 'auto'} [options.mixed='auto'] - Native What files and React files in one app
 *   (MIXED.md). 'auto' turns it on when the config also has what-compiler's what() plugin.
 *   Off, every JSX file is React code.
 * @param {string | RegExp | ((file: string) => boolean) | Array<string | RegExp | ((file: string) => boolean)>} [options.react]
 *   Mixed mode: files (paths relative to the root) that are React files whatever they import.
 * @returns {import('vite').Plugin[]}
 */
export function reactCompat(options = {}) {
  const { exclude = [], autoDetect = true, mixed = 'auto' } = options;
  let mixedOn = false;
  const mixedPlugin = mixedJsx({ react: options.react });
  const mixedTransform = mixedPlugin.transform;
  const mixedHot = mixedPlugin.handleHotUpdate;
  mixedPlugin.transform = function (code, id, opts) {
    return mixedOn ? mixedTransform.call(this, code, id, opts) : null;
  };
  mixedPlugin.handleHotUpdate = function (ctx) {
    return mixedOn ? mixedHot.call(this, ctx) : undefined;
  };

  return [{
    name: 'what-react-compat',
    enforce: 'pre',

    config(config) {
      const root = path.resolve(config.root || process.cwd());
      mixedOn = mixed === true || (mixed === 'auto' && usesWhatCompiler(config.plugins));

      // The directory holding index.js, jsx-runtime.js, dom.js, ...: the
      // installed what-react, else the one this plugin file belongs to.
      const compatDir = resolvePackageDir('what-react', root) || path.dirname(path.dirname(fileURLToPath(import.meta.url)));
      const compatSrc = path.join(compatDir, 'src');

      // Auto-detect installed React ecosystem packages
      const autoExclude = autoDetect ? detectInstalledReactPackages(root) : [];

      // Pure-CJS utilities that MUST be pre-bundled for ESM interop (so their
      // `import x from 'cjs-only-pkg'` consumers don't blank-screen). Only the
      // ones actually resolvable get included.
      const interopInclude = autoDetect ? detectInstalledInteropDeps(root) : [];
      const includeSet = new Set(interopInclude);

      const allExclude = [
        ...FRAMEWORK_PACKAGES, 'what-react',
        'react', 'react-dom',
        ...autoExclude,
        ...exclude,
      ];
      // Deduplicate, and make sure nothing we explicitly want pre-bundled
      // (interop deps) leaks back into the exclude list.
      const uniqueExclude = [...new Set(allExclude)].filter((p) => !includeSet.has(p));
      const uniqueInclude = [...includeSet];

      const withSelector = path.join(compatSrc, 'use-sync-external-store-with-selector.js');
      const alias = [
        exactAlias('react/jsx-runtime', path.join(compatSrc, 'jsx-runtime.js')),
        exactAlias('react/jsx-dev-runtime', path.join(compatSrc, 'jsx-dev-runtime.js')),
        exactAlias('react-dom/client', path.join(compatSrc, 'dom.js')),
        exactAlias('react-dom', path.join(compatSrc, 'dom.js')),
        exactAlias('react', path.join(compatSrc, 'index.js')),
        // use-sync-external-store shims (needed by react-redux, zustand internals)
        exactAlias('use-sync-external-store/with-selector.js', withSelector),
        exactAlias('use-sync-external-store/with-selector', withSelector),
        exactAlias('use-sync-external-store/shim/with-selector.js', withSelector),
        exactAlias('use-sync-external-store/shim/with-selector', withSelector),
        exactAlias('use-sync-external-store/shim/index.js', path.join(compatSrc, 'index.js')),
        exactAlias('use-sync-external-store/shim', path.join(compatSrc, 'index.js')),
      ];

      return {
        // Mixed mode: what-compiler keeps JSX for itself, and React files are
        // lowered by the mixed plugin; otherwise every file is React code.
        ...(mixedOn ? {} : {
          esbuild: {
            jsx: 'automatic',
            jsxImportSource: 'react', // aliased to what-react
          },
        }),
        resolve: {
          alias,
          // what-framework and what-core are not aliased: each import,
          // subpaths included, resolves through the package's own exports
          // under the active conditions (`production` in a build). Deduping
          // what-core gives the app, what-react and every kit one engine. A
          // deduped package is resolved from the root, so this applies only
          // when the root can resolve it (under pnpm an indirect what-core is
          // reachable only from the packages that depend on it).
          dedupe: resolvePackageDir('what-core', root) ? ['what-core'] : [],
        },
        optimizeDeps: {
          exclude: uniqueExclude,
          include: uniqueInclude,
        },
        // A server build bundles React packages, so their `react` is what-react.
        ...(autoDetect ? { ssr: { noExternal: detectSsrReactPackages(root) } } : {}),
      };
    },

    configResolved(config) {
      // Log what we set up
      const excluded = config.optimizeDeps?.exclude?.length || 0;
      const included = config.optimizeDeps?.include?.length || 0;
      console.log(`\n  ⚡ what-react compat active${mixedOn ? ' (mixed: native What files and React files)' : ''} — ${excluded} packages excluded from pre-bundling` + (included ? `, ${included} pure-CJS deps pre-bundled for interop` : '') + `\n`);
    },
  }, mixedPlugin];
}

export default reactCompat;
