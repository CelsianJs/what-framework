import { defineConfig } from 'vite';
import path from 'path';

// Paths to what-react compat layer and what-core
const compatPath = path.resolve(import.meta.dirname, '../packages/react-compat/src');
const corePath = path.resolve(import.meta.dirname, '../packages/core/src/index.js');
const coreRenderPath = path.resolve(import.meta.dirname, '../packages/core/src/render.js');

export default defineConfig({
  root: 'src',
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react', // aliased to what-react below
  },
  resolve: {
    alias: {
      'react/jsx-runtime': path.join(compatPath, 'jsx-runtime.js'),
      'react/jsx-dev-runtime': path.join(compatPath, 'jsx-dev-runtime.js'),
      'react-dom/client': path.join(compatPath, 'dom.js'),
      'react-dom': path.join(compatPath, 'dom.js'),
      'react': path.join(compatPath, 'index.js'),
      'use-sync-external-store/with-selector.js': path.join(compatPath, 'use-sync-external-store-with-selector.js'),
      'use-sync-external-store/with-selector': path.join(compatPath, 'use-sync-external-store-with-selector.js'),
      'use-sync-external-store/shim/with-selector.js': path.join(compatPath, 'use-sync-external-store-with-selector.js'),
      'use-sync-external-store/shim/with-selector': path.join(compatPath, 'use-sync-external-store-with-selector.js'),
      'use-sync-external-store/shim/index.js': path.join(compatPath, 'index.js'),
      'use-sync-external-store/shim': path.join(compatPath, 'index.js'),
      'what-framework/render': coreRenderPath,
      'what-framework': corePath,
      'what-core/render': coreRenderPath,
      'what-core': corePath,
    },
    dedupe: ['what-core'],
  },
  optimizeDeps: {
    // Exclude everything that touches react — prevent Vite from pre-bundling
    // with real react, which creates dual module instances
    exclude: [
      'what-core', 'what-react',
      'react', 'react-dom',
      'zustand',
      'react-hook-form',
      '@tanstack/react-table', '@tanstack/table-core',
      'jotai',
      '@reduxjs/toolkit', 'react-redux', 'redux', 'immer', 'use-sync-external-store',
      '@tanstack/react-virtual', '@tanstack/virtual-core',
    ],
  },
  server: {
    port: 4569,
  },
});
