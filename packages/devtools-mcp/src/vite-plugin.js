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

// Same-origin discovery endpoint served by the dev server (see configureServer).
// The browser polls THIS instead of the bridge's cross-origin port directly:
// a failed cross-origin fetch logs net::ERR_CONNECTION_REFUSED in the console
// on every fresh scaffold (no bridge running) — unsuppressible from JS. The
// dev server itself is always up while the page is open, so polling it never
// produces console noise; the bridge probe happens Node-side instead.
export const DISCOVERY_PATH = '/__what_mcp_discovery';

export default function whatDevToolsMCP({ port = 9229, token = '' } = {}) {
  // Defense-in-depth: `apply: 'serve'` is the primary guard — Vite excludes the
  // whole plugin from `vite build`, so none of these hooks run for a production
  // bundle. But `apply` can be defeated (a meta-framework that flattens plugin
  // arrays and re-invokes hooks, a consumer that spreads this plugin into
  // another plugin's returned list, or a future Vite change), and getting it
  // wrong once ships devtools + a dev-server `<script src>` into production
  // (observed on a real deploy: the prod page requested
  // `virtual:what-devtools-mcp/bootstrap` and, with a dev server live on the
  // machine, followed it to localhost). So we ALSO gate every injecting hook on
  // the resolved Vite command: if we ever run under `command === 'build'`, we
  // resolve/load/inject NOTHING. `command` stays undefined when configResolved
  // isn't called (unit tests, manual `plugin.load(...)`) — treated as serve.
  let command;
  const isBuild = () => command === 'build';

  return {
    name: 'what-devtools-mcp',
    apply: 'serve',

    // Capture the resolved command so the injecting hooks below can hard-refuse
    // to run during a production build even if `apply: 'serve'` was bypassed.
    configResolved(config) {
      command = config.command;
    },

    // Node-side bridge probe, exposed same-origin to the browser client.
    // Responds { bridge: false } when no bridge is running (quietly), or
    // { bridge: true, token, wsPort } when it is — one round-trip discovery.
    configureServer(server) {
      server.middlewares.use(DISCOVERY_PATH, async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        try {
          const probe = await fetch(`http://127.0.0.1:${port + 1}/__what_mcp_token`, {
            signal: AbortSignal.timeout(1000),
          });
          if (probe.ok) {
            const data = await probe.json();
            res.end(JSON.stringify({
              bridge: true,
              token: data.token || '',
              wsPort: data.wsPort || port,
            }));
            return;
          }
        } catch {
          // Bridge not running — the normal state for a fresh scaffold.
        }
        res.end(JSON.stringify({ bridge: false }));
      });
    },

    // Resolve the virtual module so Vite knows we own it.
    resolveId(id) {
      if (isBuild()) return null; // never own the virtual module in a build
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
      if (isBuild()) return null; // never emit devtools source into a build
      if (id !== RESOLVED_BOOTSTRAP_ID) return null;
      const tokenValue = resolveToken(token);
      // The side effects are gated behind `import.meta.env.DEV`. In a dev server
      // that's statically `true`, so devtools install and connect normally. If
      // this module ever ends up in a production bundle (e.g. a consumer imports
      // the virtual id directly, or a bundler pulls it in despite the guards
      // above), `import.meta.env.DEV` is statically `false`, the whole block is
      // dead-code-eliminated, and the now-unused imports tree-shake away — so a
      // prod bundle carries zero devtools/MCP code and can never open a
      // connection to a local dev server.
      return [
        `import * as core from 'what-core';`,
        `import { installDevTools } from 'what-devtools';`,
        `import { connectDevToolsMCP } from 'what-devtools-mcp/client';`,
        `if (import.meta.env && import.meta.env.DEV) {`,
        `  installDevTools(core);`,
        `  connectDevToolsMCP({ port: ${port}, token: ${JSON.stringify(tokenValue)}, discoveryUrl: ${JSON.stringify(DISCOVERY_PATH)} });`,
        `}`,
      ].join('\n');
    },

    transformIndexHtml() {
      if (isBuild()) return; // never inject the bootstrap <script> into built HTML
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
