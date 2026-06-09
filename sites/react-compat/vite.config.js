import { defineConfig } from 'vite';
import { transformSync } from '@babel/core';
import whatBabelPlugin from 'what-compiler/babel';

// Minimal What compiler plugin — just JSX transform, no optimizeDeps conflicts.
// Self-contained: `what-framework` + `what-compiler` resolve from npm (see package.json),
// so this site builds standalone on Vercel without the monorepo packages/ tree.
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
        plugins: [[whatBabelPlugin, { production: process.env.NODE_ENV === 'production' }]],
        parserOpts: { plugins: ['jsx', 'typescript'] },
      });
      return result ? { code: result.code, map: result.map } : null;
    },
  };
}

export default defineConfig({
  plugins: [whatJsx()],
});
