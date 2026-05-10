import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..', '..');

export default defineConfig({
  root: __dirname,
  resolve: {
    alias: {
      'what-core': resolve(root, 'packages/core/src/index.js'),
      'what-router': resolve(root, 'packages/router/src/index.js'),
      'what-devtools': resolve(root, 'packages/devtools/src/index.js'),
    },
  },
  optimizeDeps: {
    exclude: ['what-core', 'what-router', 'what-devtools'],
  },
  esbuild: {
    jsx: 'transform',
    jsxFactory: 'h',
    jsxFragment: 'Fragment',
    jsxImportSource: undefined,
  },
});
