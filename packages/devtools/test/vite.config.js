import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { transformSync } from '@babel/core';
import whatBabelPlugin from '../../compiler/src/babel-plugin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgs = (...p) => path.resolve(__dirname, '..', '..', ...p);

function whatJsx() {
  return {
    name: 'what-jsx',
    config() {
      return { esbuild: { jsx: 'preserve' } };
    },
    transform(code, id) {
      if (!/\.[jt]sx$/.test(id) || /node_modules/.test(id)) return null;
      const result = transformSync(code, {
        filename: id,
        sourceMaps: true,
        plugins: [[whatBabelPlugin, { production: false }]],
        parserOpts: { plugins: ['jsx'] },
      });
      return result ? { code: result.code, map: result.map } : null;
    },
  };
}

export default defineConfig({
  plugins: [whatJsx()],
  root: __dirname,
  resolve: {
    alias: {
      'what-core': pkgs('core', 'src', 'index.js'),
      'what-devtools/panel': pkgs('devtools', 'src', 'DevPanel.jsx'),
      'what-devtools': pkgs('devtools', 'src', 'index.js'),
    },
  },
  server: { port: 4599, strictPort: true },
});
