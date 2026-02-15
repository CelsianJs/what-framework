/**
 * What Framework Vite Plugin
 * Enables JSX transformation via the What babel plugin.
 * JSX is compiled to h() calls that go through what-core's VNode reconciler.
 */

import { transformSync } from '@babel/core';
import whatBabelPlugin from './babel-plugin.js';

export default function whatVitePlugin(options = {}) {
  const {
    // File extensions to process
    include = /\.[jt]sx$/,
    // Files to exclude
    exclude = /node_modules/,
    // Enable source maps
    sourceMaps = true,
    // Production optimizations
    production = process.env.NODE_ENV === 'production'
  } = options;

  return {
    name: 'vite-plugin-what',

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
