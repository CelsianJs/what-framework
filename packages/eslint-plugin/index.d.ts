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
    docs?: { description?: string; recommended?: boolean; url?: string };
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
  'no-signal-in-effect-deps': WhatRuleModule;
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
  /** Everything on as warnings, except no-set-in-computed, which is always an error. */
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
