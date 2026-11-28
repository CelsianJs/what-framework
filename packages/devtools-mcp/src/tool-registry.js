/**
 * The single source of truth for what tools this MCP server actually exposes,
 * derived from registration by wrapping `server.tool` once before the three
 * register* functions run.
 *
 * The client already has the full list from tools/list, so no tool resends it.
 * What the registry answers is the one thing tools/list cannot: which tools can
 * answer with no browser attached.
 */

const registered = [];

// Tools that answer with no browser attached. Everything else needs a live page
// on the bridge, which is a stronger requirement than "the dev server is up" and
// is the single most common reason an agent's first call comes back empty.
export const OFFLINE_TOOLS = new Set([
  'what_connection_status',
  'what_lint',
  'what_scaffold',
  'what_fix',
]);

/**
 * Wrap `server.tool` so every registration is recorded. Call once, before any
 * register* function runs. Idempotent.
 */
export function instrumentServer(server) {
  if (server.__whatToolRegistryInstalled) return server;
  const original = server.tool.bind(server);
  server.tool = (name, description, ...rest) => {
    registered.push({ name, desc: description });
    return original(name, description, ...rest);
  };
  server.__whatToolRegistryInstalled = true;
  return server;
}

/** Every tool registered so far, in registration order. */
export function getRegisteredTools() {
  return registered.map((t) => ({ ...t }));
}

/**
 * Split the catalogue by what can answer right now. An agent that learns this
 * by calling and failing pays a turn per tool.
 */
export function describeToolAvailability(connected) {
  const all = getRegisteredTools();
  const offline = all.filter((t) => OFFLINE_TOOLS.has(t.name));
  const needsBrowser = all.filter((t) => !OFFLINE_TOOLS.has(t.name));
  return {
    total: all.length,
    available: connected ? all : offline,
    requiresBrowser: connected ? [] : needsBrowser,
  };
}

/** Test hook: drop the recorded registrations. @internal */
export function __resetToolRegistry() {
  registered.length = 0;
}
