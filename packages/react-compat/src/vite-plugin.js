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
 * @param {object} [options]
 * @param {string[]} [options.exclude] - Additional packages to exclude from pre-bundling
 * @param {boolean} [options.autoDetect=true] - Auto-detect installed React packages to exclude
 * @returns {import('vite').Plugin}
 */
export function reactCompat(options = {}) {
  const { exclude = [], autoDetect = true } = options;

  let compatDir;
  let whatCorePath;
  let whatCoreRenderPath;

  return {
    name: 'what-react-compat',
    enforce: 'pre',

    config(config, { command }) {
      const root = config.root || process.cwd();

      // Resolve what-react and what-core paths from installed packages
      compatDir = resolvePackageDir('what-react', root);
      // compatSrc = the directory containing index.js, jsx-runtime.js, dom.js, etc.
      let compatSrc;
      if (compatDir) {
        compatSrc = path.join(compatDir, 'src');
      } else {
        // Fallback: this plugin file lives in src/ — use its directory directly
        compatSrc = path.dirname(new URL(import.meta.url).pathname);
        compatDir = path.dirname(compatSrc);
      }

      const whatCoreDir = resolvePackageDir('what-core', root);
      if (whatCoreDir) {
        whatCorePath = path.join(whatCoreDir, 'src', 'index.js');
        whatCoreRenderPath = path.join(whatCoreDir, 'src', 'render.js');
      } else {
        // Fallback: resolve from what-react's peer dep
        const whatCoreFromCompat = resolvePackageDir('what-core', compatDir);
        if (whatCoreFromCompat) {
          whatCorePath = path.join(whatCoreFromCompat, 'src', 'index.js');
          whatCoreRenderPath = path.join(whatCoreFromCompat, 'src', 'render.js');
        }
      }

      // Auto-detect installed React ecosystem packages
      const autoExclude = autoDetect ? detectInstalledReactPackages(root) : [];
      const allExclude = [
        'what-core', 'what-react',
        'react', 'react-dom',
        ...autoExclude,
        ...exclude,
      ];
      // Deduplicate
      const uniqueExclude = [...new Set(allExclude)];

      // Build alias map
      const aliases = {
        'react/jsx-runtime': path.join(compatSrc, 'jsx-runtime.js'),
        'react/jsx-dev-runtime': path.join(compatSrc, 'jsx-dev-runtime.js'),
        'react-dom/client': path.join(compatSrc, 'dom.js'),
        'react-dom': path.join(compatSrc, 'dom.js'),
        'react': path.join(compatSrc, 'index.js'),
        // use-sync-external-store shims (needed by react-redux, zustand internals)
        'use-sync-external-store/with-selector.js': path.join(compatSrc, 'use-sync-external-store-with-selector.js'),
        'use-sync-external-store/with-selector': path.join(compatSrc, 'use-sync-external-store-with-selector.js'),
        'use-sync-external-store/shim/with-selector.js': path.join(compatSrc, 'use-sync-external-store-with-selector.js'),
        'use-sync-external-store/shim/with-selector': path.join(compatSrc, 'use-sync-external-store-with-selector.js'),
        'use-sync-external-store/shim/index.js': path.join(compatSrc, 'index.js'),
        'use-sync-external-store/shim': path.join(compatSrc, 'index.js'),
      };

      // Add what-core aliases if resolved
      if (whatCorePath) {
        aliases['what-framework/render'] = whatCoreRenderPath;
        aliases['what-framework'] = whatCorePath;
        aliases['what-core/render'] = whatCoreRenderPath;
        aliases['what-core'] = whatCorePath;
      }

      return {
        esbuild: {
          jsx: 'automatic',
          jsxImportSource: 'react', // aliased to what-react
        },
        resolve: {
          alias: aliases,
          dedupe: ['what-core'],
        },
        optimizeDeps: {
          exclude: uniqueExclude,
        },
      };
    },

    configResolved(config) {
      // Log what we set up
      const excluded = config.optimizeDeps?.exclude?.length || 0;
      console.log(`\n  ⚡ what-react compat active — ${excluded} packages excluded from pre-bundling\n`);
    },
  };
}

export default reactCompat;
