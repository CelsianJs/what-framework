/**
 * eslint-plugin-what
 *
 * ESLint rules for What Framework — catch signal bugs, enforce patterns.
 * Designed for ESLint 9+ flat config.
 *
 * Usage:
 *   import what from 'eslint-plugin-what';
 *   export default [what.configs.recommended];
 */

import { createRequire } from 'node:module';

import noSignalReadInEffectDeps from './rules/no-signal-read-in-effect-deps.js';
import reactiveJsxChildren from './rules/reactive-jsx-children.js';
import noSignalWriteInRender from './rules/no-signal-write-in-render.js';
import noCamelcaseEvents from './rules/no-camelcase-events.js';
import preferSet from './rules/prefer-set.js';
import noUncalledSignals from './rules/no-uncalled-signals.js';
import noHInUserCode from './rules/no-h-in-user-code.js';
import signalCallInJsx from './rules/signal-call-in-jsx.js';
import noSetInComputed from './rules/no-set-in-computed.js';
import noMovedImports from './rules/no-moved-imports.js';
import noEffectSelfWrite from './rules/no-effect-self-write.js';
import effectCleanup from './rules/effect-cleanup.js';
import noUnsafeInnerhtml from './rules/no-unsafe-innerhtml.js';
import signalDebugName from './rules/signal-debug-name.js';
import preferComputed from './rules/prefer-computed.js';
import noAsyncComponent from './rules/no-async-component.js';
import noPromiseInUsememo from './rules/no-promise-in-usememo.js';
import noOptimisticSnapshot from './rules/no-optimistic-snapshot.js';
import preferAsyncComputed from './rules/prefer-async-computed.js';

// Read the real version from package.json so plugin meta never goes stale.
const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const plugin = {
  meta: {
    name: 'eslint-plugin-what',
    version: pkg.version,
  },

  rules: {
    'no-signal-read-in-effect-deps': noSignalReadInEffectDeps,
    'reactive-jsx-children': reactiveJsxChildren,
    'no-signal-write-in-render': noSignalWriteInRender,
    'no-camelcase-events': noCamelcaseEvents,
    'prefer-set': preferSet,
    'no-uncalled-signals': noUncalledSignals,
    'no-h-in-user-code': noHInUserCode,
    'signal-call-in-jsx': signalCallInJsx,
    'no-set-in-computed': noSetInComputed,
    'no-moved-imports': noMovedImports,
    'no-effect-self-write': noEffectSelfWrite,
    'effect-cleanup': effectCleanup,
    'no-unsafe-innerhtml': noUnsafeInnerhtml,
    'signal-debug-name': signalDebugName,
    'prefer-computed': preferComputed,
    'no-async-component': noAsyncComponent,
    'no-promise-in-usememo': noPromiseInUsememo,
    'no-optimistic-snapshot': noOptimisticSnapshot,
    'prefer-async-computed': preferAsyncComputed,
  },

  configs: {},
};

// Flat config presets (ESLint 9+)
//
// Each preset is a COMPLETE standalone flat config entry: it carries its own
// `files` glob and JSX-enabled language options, so
// `export default [what.configs.recommended]` works with stock ESLint —
// no extra parser setup required for .js/.jsx. (.ts/.tsx files match the glob
// too, but TypeScript syntax additionally needs a TS parser config layered on
// top, e.g. typescript-eslint.)

const baseLanguageOptions = {
  ecmaVersion: 'latest',
  sourceType: 'module',
  parserOptions: {
    ecmaFeatures: { jsx: true },
  },
};

const FILES = ['**/*.{js,jsx,ts,tsx}'];

// Control-flow tags the What compiler lowers itself rather than resolving as
// components (LOWERED_TAGS in what-compiler's babel plugin). Under the
// compiler they need no import, so `no-undef` would otherwise report every
// <For>, <Show>, <Switch> and <Match> in a compiled file as undefined.
//
// Only the `compiler` preset declares them. Without the compiler these really
// must be imported from what-framework, and reporting that is correct.
const COMPILER_LOWERED_TAGS = {
  For: 'readonly',
  Show: 'readonly',
  Switch: 'readonly',
  Match: 'readonly',
};

plugin.configs.recommended = {
  name: 'what/recommended',
  files: FILES,
  languageOptions: baseLanguageOptions,
  plugins: { what: plugin },
  rules: {
    'what/no-signal-read-in-effect-deps': 'warn',
    'what/reactive-jsx-children': 'warn',
    'what/no-signal-write-in-render': 'warn',
    'what/no-camelcase-events': 'warn',
    'what/no-uncalled-signals': 'warn',
    'what/prefer-set': 'off',
    'what/no-h-in-user-code': 'warn',
    'what/signal-call-in-jsx': 'warn',
    'what/no-set-in-computed': 'error',
    'what/no-moved-imports': 'error',
    'what/no-effect-self-write': 'error',
    'what/effect-cleanup': 'warn',
    'what/no-unsafe-innerhtml': 'warn',
    'what/signal-debug-name': 'off',
    'what/prefer-computed': 'off',
    'what/no-async-component': 'warn',
    'what/no-promise-in-usememo': 'warn',
    'what/no-optimistic-snapshot': 'warn',
    'what/prefer-async-computed': 'warn',
  },
};

// Stricter config — all rules as errors + prefer-set
plugin.configs.strict = {
  name: 'what/strict',
  files: FILES,
  languageOptions: baseLanguageOptions,
  plugins: { what: plugin },
  rules: {
    'what/no-signal-read-in-effect-deps': 'error',
    'what/reactive-jsx-children': 'error',
    'what/no-signal-write-in-render': 'error',
    'what/no-camelcase-events': 'error',
    'what/no-uncalled-signals': 'error',
    'what/prefer-set': 'warn',
    'what/no-h-in-user-code': 'error',
    'what/signal-call-in-jsx': 'error',
    'what/no-set-in-computed': 'error',
    'what/no-moved-imports': 'error',
    'what/no-effect-self-write': 'error',
    'what/effect-cleanup': 'error',
    'what/no-unsafe-innerhtml': 'error',
    'what/signal-debug-name': 'warn',
    'what/prefer-computed': 'warn',
    'what/no-async-component': 'error',
    'what/no-promise-in-usememo': 'error',
    'what/no-optimistic-snapshot': 'error',
    'what/prefer-async-computed': 'error',
  },
};

// Config for projects using the What compiler (disables rules the compiler handles)
plugin.configs.compiler = {
  name: 'what/compiler',
  files: FILES,
  languageOptions: { ...baseLanguageOptions, globals: COMPILER_LOWERED_TAGS },
  plugins: { what: plugin },
  rules: {
    'what/no-signal-read-in-effect-deps': 'warn',
    'what/reactive-jsx-children': 'off',       // compiler handles reactive wrapping
    'what/no-signal-write-in-render': 'warn',
    'what/no-camelcase-events': 'off',          // compiler normalizes events
    'what/no-uncalled-signals': 'warn',
    'what/prefer-set': 'off',
    'what/no-h-in-user-code': 'warn',
    'what/signal-call-in-jsx': 'off',          // compiler handles signal wrapping in JSX
    'what/no-set-in-computed': 'error',
    'what/no-moved-imports': 'error',
    'what/no-effect-self-write': 'error',
    'what/effect-cleanup': 'warn',
    'what/no-unsafe-innerhtml': 'warn',
    'what/signal-debug-name': 'off',
    'what/prefer-computed': 'off',
    'what/no-async-component': 'warn',
    'what/no-promise-in-usememo': 'warn',
    'what/no-optimistic-snapshot': 'warn',
    'what/prefer-async-computed': 'warn',
  },
};

export default plugin;
