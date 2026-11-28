import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { transformSync } from '@babel/core';
import whatBabelPlugin from 'what-compiler/babel';

// what-react version, resolved at BUILD time (never hardcoded in the UI).
// Monorepo source of truth first; npm-installed fallbacks for standalone builds.
function whatReactVersion() {
  const candidates = [
    '../../packages/react-compat/package.json', // monorepo (package name: what-react)
    './node_modules/what-react/package.json',
    './node_modules/what-framework/package.json', // lockstep-versioned fallback
  ];
  for (const p of candidates) {
    try {
      const { version } = JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
      if (version) return version;
    } catch { /* try next */ }
  }
  throw new Error('react-compat site: could not resolve what-react version');
}

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
  define: {
    __WHAT_REACT_VERSION__: JSON.stringify(whatReactVersion()),
  },
});
