import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const coreRoot = resolve(__dirname, '../../../../packages/core');

export default defineConfig({
  resolve: {
    alias: {
      'what-core/devtools': resolve(coreRoot, 'src/devtools.js'),
      'what-core': resolve(coreRoot, 'src/index.js'),
      'what-devtools': resolve(__dirname, '../../../../packages/devtools/src/index.js'),
    },
  },
  optimizeDeps: {
    exclude: ['what-core', 'what-devtools'],
  },
  esbuild: {
    jsx: 'transform',
    jsxFactory: 'h',
    jsxFragment: 'Fragment',
    jsxImportSource: undefined,
  },
});
