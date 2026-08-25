// Types for `what-devtools-mcp/vite`. This is the export TypeScript users hit
// first, because it goes in `vite.config.ts`.

/** Path the dev server answers bridge-discovery probes on. */
export const DISCOVERY_PATH: string;

export interface WhatDevToolsMCPOptions {
  /** Bridge port. Default 9229. */
  port?: number;
  /** Shared secret required by the bridge. */
  token?: string;
}

// Structural Vite plugin shape — assignable to Vite's `PluginOption` without a
// hard type dependency on `vite`. Same convention as `what-compiler/vite`.
export interface WhatDevToolsMCPPlugin {
  name: string;
  apply?: 'serve' | 'build';
  [hook: string]: unknown;
}

/**
 * Vite plugin that injects the devtools MCP client into the dev server.
 *
 * `apply: 'serve'` only: it resolves, loads and injects nothing under
 * `vite build`. `what-devtools` is an optional peer; if it is not installed the
 * plugin degrades to a single log line instead of failing the dev transform.
 */
export default function whatDevToolsMCP(
  options?: WhatDevToolsMCPOptions,
): WhatDevToolsMCPPlugin;
