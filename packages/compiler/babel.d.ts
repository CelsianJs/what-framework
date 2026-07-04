// what-compiler/babel — Babel plugin that transforms What JSX to optimized DOM
// operations (src/babel-plugin.js). Add to a Babel config's `plugins`.

export interface BabelPluginPass {
  name?: string;
  visitor: Record<string, unknown>;
  inherits?: unknown;
  manipulateOptions?: (opts: unknown, parserOpts: unknown) => void;
}

/** Babel plugin factory — Babel calls this with its API (`{ types }`). */
declare function whatBabelPlugin(api: { types: any }): BabelPluginPass;

export default whatBabelPlugin;
