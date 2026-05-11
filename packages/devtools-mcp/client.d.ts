export interface DevToolsMCPConnection {
  disconnect(): void;
  readonly isConnected: boolean;
  readonly eventCount: number;
}

export interface ConnectDevToolsMCPOptions {
  port?: number;
  token?: string;
  /** Hostname used by the browser client for token discovery and the bridge WebSocket. Defaults to 127.0.0.1. */
  host?: string;
}

export function connectDevToolsMCP(options?: ConnectDevToolsMCPOptions): DevToolsMCPConnection;
