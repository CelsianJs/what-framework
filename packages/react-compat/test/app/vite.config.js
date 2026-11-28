import { defineConfig } from 'vite';
import path from 'path';

// Absolute paths to ensure single module instances
const corePath = path.resolve(import.meta.dirname, '../../../../packages/core/src/index.js');
const coreRenderPath = path.resolve(import.meta.dirname, '../../../../packages/core/src/render.js');
const compatPath = path.resolve(import.meta.dirname, '../../../../packages/react-compat/src');

export default defineConfig({
  // NO what compiler plugin — React compat apps use React's JSX pipeline
  // The what compiler injects `import { h } from 'what-framework'` which
  // creates dual module instances with the pre-bundled deps.
  plugins: [],
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react', // aliased to what-react below
  },
  resolve: {
    // Exact matches: Vite reads a string alias as a prefix, which would send
    // what-core/internal to `…/index.js/internal`. Other subpaths resolve
    // through each package's exports, to the same source files.
    alias: [
      { find: /^react\/jsx-runtime$/, replacement: path.join(compatPath, 'jsx-runtime.js') },
      { find: /^react\/jsx-dev-runtime$/, replacement: path.join(compatPath, 'jsx-dev-runtime.js') },
      { find: /^react-dom\/client$/, replacement: path.join(compatPath, 'dom.js') },
      { find: /^react-dom$/, replacement: path.join(compatPath, 'dom.js') },
      { find: /^react$/, replacement: path.join(compatPath, 'index.js') },
      // Force single what-core instance
      { find: /^what-framework\/render$/, replacement: coreRenderPath },
      { find: /^what-framework$/, replacement: corePath },
      { find: /^what-core\/render$/, replacement: coreRenderPath },
      { find: /^what-core$/, replacement: corePath },
    ],
    dedupe: ['what-core'],
  },
  optimizeDeps: {
    // Exclude what-core from pre-bundling — prevents dual module instances.
    // Zustand/framer-motion will import what-core as external, resolving
    // to the same source files the app uses.
    exclude: ['what-core', 'what-react'],
  },
  server: {
    port: 4567,
  },
});
