// what-compiler/babel — Babel plugin that lowers What JSX (src/babel-plugin.js).
// Add to a Babel config's `plugins`, with the `jsx` parser plugin enabled.

export interface ServerActionIdMetadata {
  id: string;
  key: string;
  bindingName: string;
  filename: string;
  /** "path:line:column" of the action() call. */
  source: string;
  loc: { line: number; column: number };
}

export interface WhatBabelPluginOptions {
  /**
   * Which back end lowers JSX. 'dom' (the default) emits cloned templates and
   * fine-grained bindings (what-framework/render). 'ssr' emits server string
   * templates whose holes are evaluated as h() evaluates its arguments,
   * rendered by every what-server renderer (what-framework/ssr-runtime). The
   * Vite plugin picks 'ssr' for server transforms.
   */
  generate?: 'dom' | 'ssr';
  /** Production build: no development warnings and no development metadata. */
  production?: boolean;
  /**
   * Development builds only (ignored when `production` is true): pass names
   * and source locations to the runtime. Every string has the form
   * "name@path:line:column" (path relative to `projectRoot`, forward slashes,
   * 1-based line and column, positions of the original source):
   *
   *   _$createComponent(Row, props, children, "Row@src/App.jsx:12:5")
   *   _$componentVNode(App, props, children, "App@src/main.jsx:4:9")
   *   _$ssrComponent(Row, props, children, "Row@src/App.jsx:12:5")   (generate: 'ssr')
   *   signal(0)  -> signal(0, "count@src/store.js:3:15")              (What's signal, unnamed)
   *   effect(fn) -> effect(fn, { name: "effect@src/store.js:9:1" })   (What's effect)
   *   _$effect(() => ..., { name: "li.title@src/App.jsx:14:9" })      (attribute bindings)
   *   _$insert(el, value, marker, "li.children@src/App.jsx:15:11")    (child bindings)
   *
   * The name part is the component's JSX tag, the variable or property a
   * signal or effect is assigned to (else the primitive's name), and
   * "tag.prop" / "tag.children" for bindings. A production build is
   * byte-identical with the option on or off. Defaults to false; the Vite
   * plugin turns it on in the dev server (`vite`), never in `vite build`.
   */
  devMetadata?: boolean;
  /** Root that source locations and server action ids are relative to. Defaults to Babel's cwd. */
  projectRoot?: string;
  /**
   * DOM back end: rewrite `selected() === row.id` inside keyed `.map()` rows to
   * a createSelector lookup. Defaults to true.
   */
  autoSelector?: boolean;
  /**
   * DOM back end: output that `hydrate()` adopts server-rendered markup with.
   * Each template claims the node the hydration walk stands on instead of
   * cloning one, and is reached in document order rather than by path.
   * Defaults to false: such output still renders on the client, a little
   * larger and slower than the default.
   */
  hydratable?: boolean;
  /** Called with every server action id the plugin assigns or reads. Throwing fails the build. */
  onActionId?: (metadata: ServerActionIdMetadata) => void;
  /**
   * Compile a file one of What's own packages publishes as the app's source.
   * Such a file is the framework: by default only its JSX is compiled, with no
   * development names, no server action ids, and no function of it without
   * JSX taken for a component. Defaults to false.
   */
  appSource?: boolean;
}

export interface BabelPluginPass {
  name?: string;
  visitor: Record<string, unknown>;
  inherits?: unknown;
  manipulateOptions?: (opts: unknown, parserOpts: unknown) => void;
}

/** Babel plugin factory — Babel calls this with its API (`{ types }`). */
declare function whatBabelPlugin(api: { types: any }): BabelPluginPass;

export default whatBabelPlugin;
