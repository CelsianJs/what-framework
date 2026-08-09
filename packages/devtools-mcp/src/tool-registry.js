/**
 * The single source of truth for what tools this MCP server actually exposes.
 *
 * `what_connection_status` is the tool CLAUDE.md tells every agent to call FIRST
 * to orient, and it used to answer with a hand-maintained literal array of 17
 * entries while 29 tools were registered. The product under-reported its own
 * differentiator by 41% at the moment of first contact, and the same catalogue
 * was hand-copied into CLAUDE.md, AGENTS.md and the docs, each free to drift.
 *
 * A framework whose thesis is machine-readable truth cannot hand-maintain its own
 * machine-readable index, so the catalogue is now derived from registration by
 * wrapping `server.tool` once before the three register* functions run.
 */

const registered = [];

// Tools that answer with no browser attached. Everything else needs a live page
// on the bridge, which is a stronger requirement than "the dev server is up" and
// is the single most common reason an agent's first call comes back empty.
const OFFLINE_TOOLS = new Set([
  'what_connection_status',
  'what_lint',
  'what_validate',
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
 * Split the catalogue by what can actually answer right now.
 *
 * No competitor's MCP server distinguishes "this tool exists" from "this tool can
 * answer in this session", which is the distinction that actually costs an agent
 * turns: it discovers the difference by calling and failing.
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
