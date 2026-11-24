/**
 * Vite plugin that injects the what-devtools-mcp client into the dev server.
 * Only active during `vite dev` (apply: 'serve').
 *
 * Pairing: the page asks its own dev server (same origin) for a bridge
 * credential; the dev server, Node-side, reads the pairing key the bridge wrote
 * under this project's node_modules/.cache (or WHAT_MCP_TOKEN, or the `token`
 * option) and asks the bridge for a credential bound to the page's origin.
 * The key never reaches the browser, and a credential works only from the
 * origin it was issued for.
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

// The bridge writes this file under its project root (see bridge.js BRIDGE_FILE).
const BRIDGE_FILE = join('node_modules', '.cache', 'what-devtools-mcp', 'bridge.json');

// The nearest bridge file at or above the dev server root, read fresh on every
// pairing so a bridge started after the dev server is found.
function readBridgeFile(root) {
  for (let dir = resolve(root); ; dir = dirname(dir)) {
    try {
      const data = JSON.parse(readFileSync(join(dir, BRIDGE_FILE), 'utf-8'));
      if (data && typeof data.key === 'string') return data;
    } catch {
      // No bridge file here; keep walking up.
    }
    if (dirname(dir) === dir) return null;
  }
}

// Virtual module id served via Vite's `\0` convention.
const VIRTUAL_BOOTSTRAP_ID = 'virtual:what-devtools-mcp/bootstrap';
const RESOLVED_BOOTSTRAP_ID = '\0' + VIRTUAL_BOOTSTRAP_ID;
// Vite encodes `\0` as `__x00__` in `/@id/` URLs — stable since Vite 2 (2021).
const BROWSER_BOOTSTRAP_URL = '/@id/__x00__' + VIRTUAL_BOOTSTRAP_ID;

// The bootstrap installs devtools into the app's what-core, found from the app
// when the app can resolve it. An app that depends only on what-framework
// cannot under pnpm, which installs what-core next to what-framework rather
// than in the app's node_modules; then it is found from this package, which
// depends on what-core itself.
const PLUGIN_FILE = fileURLToPath(import.meta.url);

async function resolveBootstrapCore(context, id, importer, options) {
  return (await context.resolve(id, importer, { ...options, skipSelf: true }))
    ?? context.resolve(id, PLUGIN_FILE, { ...options, skipSelf: true });
}

// Same-origin discovery endpoint served by the dev server (see configureServer).
// The browser polls this instead of the bridge's port: a failed cross-origin
// fetch logs net::ERR_CONNECTION_REFUSED on every fresh scaffold (no bridge
// running), which JS cannot suppress. The dev server is always up while the
// page is open, so polling it is silent; the bridge is contacted Node-side.
export const DISCOVERY_PATH = '/__what_mcp_discovery';

/**
 * The discovery endpoint as a plain Node handler, for any dev server: answers
 * { bridge: false } when no bridge is reachable, or { bridge: true, credential,
 * wsPort } with a credential for the requesting page's origin. Only that page
 * may ask: a request from another origin is refused, so no other site can
 * obtain a credential here.
 * @param {{ root?: string, port?: number, token?: string, https?: boolean }} [options]
 *   root: the dev server's project root; port: the bridge port when no bridge
 *   file is found; token: a pre-shared pairing key (also WHAT_MCP_TOKEN)
 */

/** Whether `name` is installed in a node_modules directory at or above `root`. */
function installedAbove(root, name) {
  for (let dir = resolve(root); ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'node_modules', name, 'package.json'))) return true;
    if (dirname(dir) === dir) return false;
  }
}

export function createDiscoveryHandler({ root, port = 9229, token = '', https = false } = {}) {
  return async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    const host = req.headers?.host;
    const origin = host ? `${https ? 'https' : 'http'}://${host}` : null;
    const fetchSite = req.headers?.['sec-fetch-site'];
    if (!origin || (req.headers.origin !== undefined && req.headers.origin !== origin) || (fetchSite !== undefined && fetchSite !== 'same-origin')) {
      res.statusCode = 403;
      res.end(JSON.stringify({ bridge: false, error: 'Discovery answers only the page served by this dev server' }));
      return;
    }
    const projectRoot = resolve(root || process.cwd());
    const file = readBridgeFile(projectRoot);
    const key = file?.key || process.env.WHAT_MCP_TOKEN || token;
    const controlPort = file?.controlPort || port + 1;
    if (key) {
      try {
        const pairing = await fetch(`http://127.0.0.1:${controlPort}/__what_mcp_pair`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, origin, root: projectRoot }),
          signal: AbortSignal.timeout(2000),
        });
        if (pairing.ok) {
          const data = await pairing.json();
          res.end(JSON.stringify({ bridge: true, credential: data.credential, wsPort: data.wsPort }));
          return;
        }
      } catch {
        // Bridge not running — the normal state for a fresh scaffold.
      }
    }
    res.end(JSON.stringify({ bridge: false }));
  };
}

export default function whatDevToolsMCP({ port = 9229, token = '' } = {}) {
  // `apply: 'serve'` is the primary guard. It can be defeated (a
  // meta-framework that flattens plugin arrays and re-invokes hooks, or a
  // future Vite change), and getting it wrong once ships devtools and a
  // dev-server `<script src>` into production. So every injecting hook also
  // checks the resolved command and does nothing under `vite build`.
  // `command` stays undefined when configResolved isn't called (unit tests,
  // manual `plugin.load(...)`), which is treated as serve.
  let command;
  let projectRoot;
  let https = false;
  let devtoolsResolvable; // memoized: is the `what-devtools` peer installed?
  const isBuild = () => command === 'build';

  // The bootstrap imports `what-devtools`, an OPTIONAL peer. Without it Vite
  // cannot resolve that import and the dev server fails, so check up front and
  // inject nothing instead.
  //
  // Found the way Vite resolves the bootstrap's bare import: a node_modules
  // directory at or above the project root. Not with require.resolve, which
  // also searches NODE_PATH, and pnpm's bin shims set NODE_PATH to its hidden
  // store (node_modules/.pnpm/node_modules): a what-devtools there (another
  // package's dependency, a version left by an upgrade) passed this check,
  // and Vite, which ignores NODE_PATH, then failed the dev server on the
  // import ("Failed to resolve import \"what-devtools\"").
  const devtoolsAvailable = () => {
    if (devtoolsResolvable === undefined) devtoolsResolvable = installedAbove(projectRoot || process.cwd(), 'what-devtools');
    return devtoolsResolvable;
  };

  const inactive = () => isBuild() || !devtoolsAvailable();

  return {
    name: 'what-devtools-mcp',
    apply: 'serve',

    configResolved(config) {
      command = config.command;
      projectRoot = config.root;
      https = Boolean(config.server?.https);
      if (!isBuild() && !devtoolsAvailable()) {
        console.info(
          '[what-devtools-mcp] `what-devtools` is not installed — skipping DevTools/MCP dev injection. ' +
            'Run `npm i -D what-devtools` to enable live debugging.',
        );
      }
    },

    configureServer(server) {
      server.middlewares.use(DISCOVERY_PATH, (req, res) => createDiscoveryHandler({ root: projectRoot, port, token, https })(req, res));
    },

    resolveId(id, importer, options) {
      if (inactive()) return null;
      if (id === VIRTUAL_BOOTSTRAP_ID || id === RESOLVED_BOOTSTRAP_ID) {
        return RESOLVED_BOOTSTRAP_ID;
      }
      if (importer === RESOLVED_BOOTSTRAP_ID && id === 'what-core/internal') {
        return resolveBootstrapCore(this, id, importer, options);
      }
      return null;
    },

    // A real module so Vite's transform pipeline rewrites the bare imports.
    // The side effects are gated on `import.meta.env.DEV`, statically false in
    // a production bundle, so if this module ever ended up in one the block and
    // its imports would be eliminated.
    load(id) {
      if (inactive()) return null;
      if (id !== RESOLVED_BOOTSTRAP_ID) return null;
      return [
        `import * as core from 'what-core/internal';`,
        `import { installDevTools } from 'what-devtools';`,
        `import { connectDevToolsMCP } from 'what-devtools-mcp/client';`,
        `if (import.meta.env && import.meta.env.DEV) {`,
        `  installDevTools(core);`,
        `  connectDevToolsMCP({ port: ${port}, discoveryUrl: ${JSON.stringify(DISCOVERY_PATH)} });`,
        `}`,
      ].join('\n');
    },

    // First in <head>: module scripts run in document order, so devtools are
    // installed before the app's own entry runs. Checks that fire while app
    // modules load (an uncalled signal at module scope) and errors thrown at
    // startup are then recorded and replayed when the bridge connects.
    transformIndexHtml() {
      if (inactive()) return;
      return [
        {
          tag: 'script',
          attrs: { type: 'module', src: BROWSER_BOOTSTRAP_URL },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}
