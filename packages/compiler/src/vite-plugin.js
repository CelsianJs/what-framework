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
    config(config, { mode }) {
      return {
        esbuild: {
          // Preserve JSX so our babel plugin handles it -- don't let esbuild transform it
          jsx: 'preserve',
        },
        optimizeDeps: {
          // Pre-bundle the framework
          include: ['what-framework']
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
