// ESLint flat config for the What Framework monorepo.
//
// The point of this file is dogfooding. The repo publishes eslint-plugin-what
// and tells users to lint their What code with it, while linting none of its
// own. Any rule this project ships must hold on the code that ships it, or the
// rule is advice nobody has tested.
//
// Severity policy, deliberately narrow: `no-unused-vars` and `no-undef` are
// errors because both catch real defects that types and tests miss cheaply
// (a typo'd identifier in an error branch is a ReferenceError at the worst
// possible moment). Everything else in eslint:recommended is a warning, so the
// gate stays trustworthy instead of becoming a wall of noise people learn to
// ignore.

import js from '@eslint/js';
import globals from 'globals';
import what from './packages/eslint-plugin/src/index.js';

const RECOMMENDED_AS_WARNINGS = Object.fromEntries(
  Object.entries(js.configs.recommended.rules ?? {})
    .filter(([rule]) => rule !== 'no-unused-vars' && rule !== 'no-undef')
    .map(([rule]) => [rule, 'warn']),
);

const jsxLanguageOptions = {
  ecmaVersion: 'latest',
  sourceType: 'module',
  parserOptions: { ecmaFeatures: { jsx: true } },
};

export default [
  {
    // Build output, vendored copies, fixtures compiled from other sources, and
    // the scaffolded apps under smoke/ (which are generated, not authored).
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.vite/**',
      'smoke/apps/**',
      // Deliberately-broken inputs. They exist to be linted BY
      // packages/eslint-plugin/test, which asserts the violations they
      // contain; linting them here would report those same violations as
      // repo defects.
      'packages/eslint-plugin/test/fixture/**',
      'smoke/.work/**',
      // Committed build output: vendored bundles the sites serve directly.
      // Linting minified vendor code reports the minifier's choices as repo
      // defects.
      'docs-site/public/**',
      'marketing-site/public/**',
      'sites/*/public/vendor/**',
      'packages/*/example/dist/**',
      'benchmark/frameworks/**',
      'benchmark/results/**',
    ],
  },

  {
    files: ['**/*.{js,jsx,mjs,cjs}'],
    languageOptions: {
      ...jsxLanguageOptions,
      globals: { ...globals.browser, ...globals.node },
    },
    linterOptions: { reportUnusedDisableDirectives: 'warn' },
    rules: {
      ...RECOMMENDED_AS_WARNINGS,
      // Underscore-prefixed names are the repo's existing convention for
      // deliberately-unused bindings (internal test hooks, ignored catch
      // params, positional placeholders).
      'no-unused-vars': ['error', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'all',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
      'no-undef': 'error',
    },
  },

  // The framework's own rules, run against the framework. Sourced from the
  // workspace rather than the published package so a rule change is linted by
  // the same commit that makes it.
  {
    files: ['packages/*/src/**/*.{js,jsx}'],
    plugins: { what },
    rules: what.configs.recommended.rules,
  },

  // Everything under examples/, sites/ and the JSX benchmarks is built by
  // what-compiler/vite, which lowers <For>, <Show>, <Switch> and <Match>
  // itself. Those tags are therefore never imported, so the compiler preset's
  // globals are what keeps no-undef honest here.
  {
    files: ['examples/**/*.jsx', 'sites/**/*.jsx', 'benchmark/**/*.jsx', 'packages/*/example/**/*.jsx'],
    languageOptions: {
      globals: what.configs.compiler.languageOptions.globals,
    },
  },

  // Build-time constants substituted by Vite `define`. They exist in the built
  // bundle and nowhere in the source, so no-undef needs telling.
  {
    files: ['packages/devtools-mcp/test/**/*.jsx'],
    languageOptions: {
      globals: { __BRIDGE_AUTH_TOKEN__: 'readonly', __BRIDGE_PORT__: 'readonly' },
    },
  },
  {
    files: ['sites/react-compat/src/**/*.jsx'],
    languageOptions: { globals: { __WHAT_REACT_VERSION__: 'readonly' } },
  },

  // CommonJS config files and scripts.
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },

  // Node-only surfaces: no browser globals, so a stray `window` is an error
  // rather than silently accepted.
  {
    files: ['scripts/**/*.{js,mjs}', 'smoke/*.mjs', 'benchmark/**/*.{js,mjs}'],
    languageOptions: { globals: globals.node },
  },

  // Tests run under node:test with jsdom set up per file.
  {
    files: ['**/test/**/*.{js,jsx,mjs}', '**/*.test.{js,jsx,mjs}', 'stress-tests/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
