import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { transformSync } from '@babel/core';
import whatBabelPlugin from '../../packages/compiler/src/babel-plugin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgs = (...p) => path.resolve(__dirname, '..', '..', 'packages', ...p);

// Minimal What compiler plugin — just JSX transform, no optimizeDeps conflicts
function whatJsx() {
  return {
    name: 'what-jsx',
    config() {
      return {
        esbuild: { jsx: 'preserve' },
      };
    },
    transform(code, id) {
      if (!/\.[jt]sx$/.test(id) || /node_modules/.test(id)) return null;
      const result = transformSync(code, {
        filename: id,
        sourceMaps: true,
        plugins: [[whatBabelPlugin, { production: process.env.NODE_ENV === 'production', mode: 'vdom' }]],
        parserOpts: { plugins: ['jsx', 'typescript'] },
      });
      return result ? { code: result.code, map: result.map } : null;
    },
  };
}

export default defineConfig({
  plugins: [whatJsx()],
  resolve: {
    alias: {
      'what-framework/render': pkgs('what', 'src', 'render.js'),
      'what-framework': pkgs('what', 'src', 'index.js'),
      'what-core/render': pkgs('core', 'src', 'render.js'),
      'what-core': pkgs('core', 'src', 'index.js'),
    },
  },
});
