// Types for `what-devtools-mcp/client`.

export interface DevToolsMCPConnection {
  /** Stop probing and close the socket. Safe to call more than once. */
  disconnect(): void;
  /** Force an immediate reconnect attempt, resetting the probe back-off. */
  reconnect(): void;
  readonly isConnected: boolean;
  /** Events forwarded to the bridge since the connection opened. */
  readonly eventCount: number;
}

export interface ConnectDevToolsMCPOptions {
  /** Bridge port. Default 9229. */
  port?: number;
  /** Shared secret the bridge requires. */
  token?: string;
  /** Override the discovery endpoint instead of deriving it from `port`. */
  discoveryUrl?: string;
}

/**
 * Connect the running app to the devtools MCP bridge.
 *
 * Returns an inert connection in production (`NODE_ENV === 'production'` or
 * `import.meta.env.PROD`) rather than throwing, so it is safe to call
 * unconditionally.
 */
export function connectDevToolsMCP(
  options?: ConnectDevToolsMCPOptions,
): DevToolsMCPConnection;
