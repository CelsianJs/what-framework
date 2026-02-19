import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

// Local paths to what-react compat layer and what-core
const compatPath = path.resolve(import.meta.dirname, '../../packages/react-compat/src');
const corePath = path.resolve(import.meta.dirname, '../../packages/core/src/index.js');
const coreRenderPath = path.resolve(import.meta.dirname, '../../packages/core/src/render.js');

export default defineConfig({
  plugins: [tailwindcss()],
  root: 'src',
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
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
    exclude: [
      'what-core', 'what-react',
      'react', 'react-dom',
    ],
  },
  server: {
    port: 4580,
  },
});
