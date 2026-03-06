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

import noSignalInEffectDeps from './rules/no-signal-in-effect-deps.js';
import reactiveJsxChildren from './rules/reactive-jsx-children.js';
import noSignalWriteInRender from './rules/no-signal-write-in-render.js';
import noCamelcaseEvents from './rules/no-camelcase-events.js';
import preferSet from './rules/prefer-set.js';
import noUncalledSignals from './rules/no-uncalled-signals.js';

const plugin = {
  meta: {
    name: 'eslint-plugin-what',
    version: '0.5.6',
  },

  rules: {
    'no-signal-in-effect-deps': noSignalInEffectDeps,
    'reactive-jsx-children': reactiveJsxChildren,
    'no-signal-write-in-render': noSignalWriteInRender,
    'no-camelcase-events': noCamelcaseEvents,
    'prefer-set': preferSet,
    'no-uncalled-signals': noUncalledSignals,
  },

  configs: {},
};

// Flat config presets (ESLint 9+)

plugin.configs.recommended = {
  plugins: { what: plugin },
  rules: {
    'what/no-signal-in-effect-deps': 'warn',
    'what/reactive-jsx-children': 'warn',
    'what/no-signal-write-in-render': 'warn',
    'what/no-camelcase-events': 'warn',
    'what/no-uncalled-signals': 'warn',
    'what/prefer-set': 'off',
  },
};

// Stricter config — all rules as errors + prefer-set
plugin.configs.strict = {
  plugins: { what: plugin },
  rules: {
    'what/no-signal-in-effect-deps': 'error',
    'what/reactive-jsx-children': 'error',
    'what/no-signal-write-in-render': 'error',
    'what/no-camelcase-events': 'error',
    'what/no-uncalled-signals': 'error',
    'what/prefer-set': 'warn',
  },
};

// Config for projects using the What compiler (disables rules the compiler handles)
plugin.configs.compiler = {
  plugins: { what: plugin },
  rules: {
    'what/no-signal-in-effect-deps': 'warn',
    'what/reactive-jsx-children': 'off',       // compiler handles reactive wrapping
    'what/no-signal-write-in-render': 'warn',
    'what/no-camelcase-events': 'off',          // compiler normalizes events
    'what/no-uncalled-signals': 'warn',
    'what/prefer-set': 'off',
  },
};

export default plugin;
