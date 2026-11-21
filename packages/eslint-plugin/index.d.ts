// eslint-plugin-what — TypeScript definitions.
//
// Declared by hand and held to the runtime by `npm run hygiene:types`. The
// plugin is a default export, so the parity checker sees one name; the shapes
// below are what a flat config actually consumes.
//
// ESLint's own types are not imported: `eslint` is a peer dependency, and
// pulling @types/eslint in here would make a type-only package a hard
// requirement for anyone who just wants to spread a preset into their config.

/** One rule module. Structural, so a stock ESLint `Rule.RuleModule` assigns to it. */
export interface WhatRuleModule {
  meta: {
    type?: 'problem' | 'suggestion' | 'layout';
    /** `code`: the ERR_* catalogue code the rule finds, when it has one. */
    docs?: { description?: string; recommended?: boolean; url?: string; code?: string };
    fixable?: 'code' | 'whitespace';
    schema?: unknown[];
    messages?: Record<string, string>;
    [key: string]: unknown;
  };
  create(context: unknown): Record<string, (...args: never[]) => void>;
}

/** The rules this plugin ships, keyed exactly as they are referenced in config. */
export interface WhatRules {
  /** Signals are read by calling them; listing one in a deps array compares functions, not values. */
  'no-signal-read-in-effect-deps': WhatRuleModule;
  /** A signal passed as a JSX child renders once unless it stays reactive. */
  'reactive-jsx-children': WhatRuleModule;
  /** Writing a signal during render re-enters render. */
  'no-signal-write-in-render': WhatRuleModule;
  /** DOM events are lowercase; `onClick` on an intrinsic element never fires. */
  'no-camelcase-events': WhatRuleModule;
  /** `set(next)` over read-modify-write, which races concurrent updates. */
  'prefer-set': WhatRuleModule;
  /** A signal referenced without calling it yields the function, not its value. */
  'no-uncalled-signals': WhatRuleModule;
  /** `h()` is the compiler's output, not an authoring API. */
  'no-h-in-user-code': WhatRuleModule;
  /** A signal in JSX must be called to be read. */
  'signal-call-in-jsx': WhatRuleModule;
  /** A computed that writes a signal is a side effect pretending to be a value. */
  'no-set-in-computed': WhatRuleModule;
  /** A name that left the root entry in 0.15 is imported from where it lives now (autofix). */
  'no-moved-imports': WhatRuleModule;
  /** An effect that reads and writes one signal re-triggers itself forever. */
  'no-effect-self-write': WhatRuleModule;
  /** An effect that adds a listener or an interval must return a cleanup. */
  'effect-cleanup': WhatRuleModule;
  /** innerHTML takes the { __html } marker, never a raw value. */
  'no-unsafe-innerhtml': WhatRuleModule;
  /** Module-scope signals get a debug name (hint). */
  'signal-debug-name': WhatRuleModule;
  /** An effect that only writes one signal should be a computed (hint). */
  'prefer-computed': WhatRuleModule;
}

/**
 * A complete flat-config entry. Each preset carries its own `files` glob and
 * JSX-enabled language options, so spreading one into a config array works
 * against stock ESLint with no extra parser setup for .js/.jsx.
 */
export interface WhatFlatConfig {
  name: string;
  files: string[];
  languageOptions: {
    ecmaVersion: 'latest' | number;
    sourceType: 'module' | 'script';
    parserOptions?: { ecmaFeatures?: { jsx?: boolean }; [key: string]: unknown };
    /**
     * Only the `compiler` preset sets this, declaring the control-flow tags
     * the What compiler lowers itself (`For`, `Show`, `Switch`, `Match`).
     * Under the compiler they need no import; without it they must be
     * imported, so the other presets leave `no-undef` free to say so.
     */
    globals?: Record<string, 'readonly' | 'writable' | 'off'>;
    [key: string]: unknown;
  };
  plugins: Record<string, WhatPlugin>;
  rules: Record<string, 'off' | 'warn' | 'error'>;
}

export interface WhatConfigs {
  /**
   * Warnings, except the rules whose findings are broken code wherever they
   * appear (no-set-in-computed, no-effect-self-write, no-moved-imports), which
   * are errors.
   */
  recommended: WhatFlatConfig;
  /** Everything on as errors, plus prefer-set as a warning. */
  strict: WhatFlatConfig;
  /**
   * For compiler users: the rules the compiler already handles are off, and
   * the compiler-lowered control-flow tags are declared as globals.
   */
  compiler: WhatFlatConfig;
}

export interface WhatPlugin {
  meta: { name: string; version: string };
  rules: WhatRules;
  configs: WhatConfigs;
}

declare const plugin: WhatPlugin;
export default plugin;
