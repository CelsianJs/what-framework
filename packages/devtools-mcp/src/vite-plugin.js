/**
 * Vite plugin to auto-inject what-devtools-mcp client into dev server.
 * Only active during `vite dev` (apply: 'serve').
 *
 * Token resolution order:
 * 1. Explicit `token` option passed to the plugin
 * 2. WHAT_MCP_TOKEN environment variable
 * 3. File-based cache (node_modules/.cache/what-devtools-mcp/token) — written by the bridge
 * 4. Empty string — client will auto-discover via HTTP endpoint at runtime
 */

import { readFileSync } from 'fs';
import { join } from 'path';

function resolveToken(explicitToken) {
  // 1. Explicit token
  if (explicitToken) return explicitToken;

  // 2. Environment variable
  if (process.env.WHAT_MCP_TOKEN) return process.env.WHAT_MCP_TOKEN;

  // 3. File-based cache (written by the bridge on startup)
  try {
    const cacheFile = join(process.cwd(), 'node_modules', '.cache', 'what-devtools-mcp', 'token');
    const data = JSON.parse(readFileSync(cacheFile, 'utf-8'));
    if (data.token) return data.token;
  } catch {
    // Cache file doesn't exist — bridge hasn't started yet, or different cwd
  }

  // 4. Empty — client will auto-discover via HTTP at runtime
  return '';
}

// Virtual module id served via Vite's `\0` convention.
// Resolved IDs starting with `\0` are hidden from the file system and recognised
// by Vite as plugin-owned modules. We expose them to the browser via the
// `/@id/<resolved-id>` URL convention so `<script src>` can request them.
const VIRTUAL_BOOTSTRAP_ID = 'virtual:what-devtools-mcp/bootstrap';
const RESOLVED_BOOTSTRAP_ID = '\0' + VIRTUAL_BOOTSTRAP_ID;
// Vite encodes `\0` as `__x00__` in `/@id/` URLs — stable since Vite 2 (2021).
const BROWSER_BOOTSTRAP_URL = '/@id/__x00__' + VIRTUAL_BOOTSTRAP_ID;

export default function whatDevToolsMCP({ port = 9229, token = '' } = {}) {
  return {
    name: 'what-devtools-mcp',
    apply: 'serve',

    // Resolve the virtual module so Vite knows we own it.
    resolveId(id) {
      if (id === VIRTUAL_BOOTSTRAP_ID || id === RESOLVED_BOOTSTRAP_ID) {
        return RESOLVED_BOOTSTRAP_ID;
      }
      return null;
    },

    // Load the bootstrap source. Because this is a real JS module that goes
    // through Vite's transform pipeline, bare specifiers like `what-core` get
    // properly rewritten to dev-server URLs — unlike inline <script type=module>
    // tags injected via transformIndexHtml, which Vite does not transform.
    load(id) {
      if (id !== RESOLVED_BOOTSTRAP_ID) return null;
      const tokenValue = resolveToken(token);
      return [
        `import * as core from 'what-core';`,
        `import { installDevTools } from 'what-devtools';`,
        `import { connectDevToolsMCP } from 'what-devtools-mcp/client';`,
        `installDevTools(core);`,
        `connectDevToolsMCP({ port: ${port}, token: ${JSON.stringify(tokenValue)} });`,
      ].join('\n');
    },

    transformIndexHtml() {
      // Inject a <script src> that points at the virtual module. The browser
      // fetches `/@id/__x00__virtual:what-devtools-mcp/bootstrap`, Vite serves
      // the transformed bootstrap (bare specifiers resolved), and everything
      // loads correctly without "Failed to resolve module specifier" errors.
      return [
        {
          tag: 'script',
          attrs: { type: 'module', src: BROWSER_BOOTSTRAP_URL },
          injectTo: 'body',
        },
      ];
    },
  };
}
