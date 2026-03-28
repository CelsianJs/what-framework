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

export default function whatDevToolsMCP({ port = 9229, token = '' } = {}) {
  return {
    name: 'what-devtools-mcp',
    apply: 'serve',
    transformIndexHtml(html) {
      const tokenValue = resolveToken(token);
      return html.replace(
        '</body>',
        `<script type="module">
import * as core from 'what-core';
import { installDevTools } from 'what-devtools';
import { connectDevToolsMCP } from 'what-devtools-mcp/client';
installDevTools(core);
connectDevToolsMCP({ port: ${port}, token: ${JSON.stringify(tokenValue)} });
</script>
</body>`
      );
    },
  };
}
