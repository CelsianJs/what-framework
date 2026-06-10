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
      // Subpath aliases MUST come before the bare 'what-core' alias —
      // @rollup/plugin-alias prefix-matches, so the bare alias alone would
      // rewrite 'what-core/render' to '<core>/src/index.js/render'.
      'what-core/render': pkgs('core', 'src', 'render.js'),
      'what-core/jsx-runtime': pkgs('core', 'src', 'jsx-runtime.js'),
      'what-core/jsx-dev-runtime': pkgs('core', 'src', 'jsx-dev-runtime.js'),
      'what-core/testing': pkgs('core', 'src', 'testing.js'),
      'what-core': pkgs('core', 'src', 'index.js'),
      'what-devtools/panel': pkgs('devtools', 'src', 'DevPanel.jsx'),
      'what-devtools': pkgs('devtools', 'src', 'index.js'),
    },
  },
  server: { port: 4901, strictPort: true }, // Track E port range (4900-4999)
});
