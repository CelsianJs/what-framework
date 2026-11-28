// Types for `what-devtools-mcp/vite`. This is the export TypeScript users hit
// first, because it goes in `vite.config.ts`.

/** Path the dev server answers bridge-discovery probes on. */
export const DISCOVERY_PATH: string;

export interface WhatDevToolsMCPOptions {
  /** Bridge port when no bridge file is found under the project. Default 9229. */
  port?: number;
  /** Pre-shared pairing key (also WHAT_MCP_TOKEN), when the bridge file is not readable. */
  token?: string;
}

/**
 * The same-origin discovery endpoint as a plain Node `(req, res)` handler, for
 * a dev server that is not Vite. Pairs with the bridge Node-side and answers
 * the requesting page with a credential bound to its origin, or
 * `{ bridge: false }`.
 */
export function createDiscoveryHandler(options?: WhatDevToolsMCPOptions & {
  /** The dev server's project root (default: cwd). */
  root?: string;
  /** The dev server serves https. */
  https?: boolean;
}): (req: { headers: Record<string, string | string[] | undefined> }, res: {
  setHeader(name: string, value: string): unknown;
  statusCode: number;
  end(body: string): unknown;
}) => Promise<void>;

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
