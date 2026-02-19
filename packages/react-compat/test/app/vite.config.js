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
    alias: {
      // React → what-react aliases (longer paths first)
      'react/jsx-runtime': path.join(compatPath, 'jsx-runtime.js'),
      'react/jsx-dev-runtime': path.join(compatPath, 'jsx-dev-runtime.js'),
      'react-dom/client': path.join(compatPath, 'dom.js'),
      'react-dom': path.join(compatPath, 'dom.js'),
      'react': path.join(compatPath, 'index.js'),
      // Force single what-core instance
      'what-framework/render': coreRenderPath,
      'what-framework': corePath,
      'what-core/render': coreRenderPath,
      'what-core': corePath,
    },
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
