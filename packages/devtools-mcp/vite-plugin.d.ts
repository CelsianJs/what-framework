export interface WhatDevToolsMCPOptions {
  port?: number;
  token?: string;
  /** Hostname injected into connectDevToolsMCP(). Defaults to 127.0.0.1. */
  host?: string;
}

export default function whatDevToolsMCP(options?: WhatDevToolsMCPOptions): any;
