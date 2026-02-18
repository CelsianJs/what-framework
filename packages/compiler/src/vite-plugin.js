/**
 * What Framework Vite Plugin
 *
 * 1. Transforms JSX via the What babel plugin
 * 2. Provides file-based routing via virtual:what-routes
 * 3. Watches pages directory for HMR
 */

import path from 'path';
import { transformSync } from '@babel/core';
import whatBabelPlugin from './babel-plugin.js';
import { generateRoutesModule, scanPages } from './file-router.js';
import { setupErrorOverlay } from './error-overlay.js';

const VIRTUAL_ROUTES_ID = 'virtual:what-routes';
const RESOLVED_VIRTUAL_ID = '\0' + VIRTUAL_ROUTES_ID;

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
  } = options;

  let rootDir = '';
  let pagesDir = '';
  let server = null;

  return {
    name: 'vite-plugin-what',

    configResolved(config) {
      rootDir = config.root;
      pagesDir = path.resolve(rootDir, pages);
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

        return {
          code: result.code,
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

    // Configure for development
    config(config, { mode }) {
      return {
        esbuild: {
          // Preserve JSX so our babel plugin handles it — don't let esbuild transform it
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

// Named export for compatibility
export { whatVitePlugin as what };
