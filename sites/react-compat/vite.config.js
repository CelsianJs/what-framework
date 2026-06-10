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

// what-core computes its dev flag at runtime from `typeof process`; the
// published minified dist folds it to `!(typeof process<"u")`, which is TRUE
// in every browser — so even production bundles run dev-mode and log the
// "[what] template() is a compiler internal… XSS" guard on load. Force the
// flag to false in production builds so dev-only warnings are compiled out,
// exactly as the flag's own comment ("build tools can dead-code-eliminate
// when false") intends. Handles both the src form and the minified dist form.
function whatProdDevFlag() {
  return {
    name: 'what-prod-dev-flag',
    apply: 'build',
    transform(code, id) {
      if (!/node_modules\/what-(core|framework)\//.test(id)) return null;
      const out = code
        .replace(/export const __DEV__ =[^;]+;/, 'export const __DEV__ = false;')
        .replaceAll('!(typeof process<"u")', '!1');
      return out === code ? null : { code: out, map: null };
    },
  };
}

export default defineConfig({
  plugins: [whatJsx(), whatProdDevFlag()],
  define: {
    __WHAT_REACT_VERSION__: JSON.stringify(whatReactVersion()),
  },
});
