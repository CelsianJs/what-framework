// @thenjs/rpc — Client-side RPC proxy + useSWR integration

import { encode, decode } from './wire.js';

/** Options for RPC client */
export interface RPCClientOptions {
  /** Base URL for RPC endpoints (default: '/_rpc') */
  baseUrl?: string;
  /** Custom fetch function */
  fetch?: typeof globalThis.fetch;
  /** Default headers */
  headers?: Record<string, string>;
}

/** Create an RPC client proxy that auto-generates methods from the router type */
export function createRPCClient<TRouter>(options: RPCClientOptions = {}): RPCClientProxy<TRouter> {
  const baseUrl = options.baseUrl ?? '/_rpc';
  const fetchFn = options.fetch ?? globalThis.fetch;
  const defaultHeaders = options.headers ?? {};

  function createProxy(path: string[] = []): unknown {
    return new Proxy(() => {}, {
      get(_target, prop: string) {
        if (prop === 'then') return undefined; // Prevent accidental await

        // Special methods
        if (prop === 'useSWR') {
          return (input?: unknown) => {
            const procedurePath = path.join('.');
            // This returns the config for What Framework's useSWR
            return {
              key: `rpc:${procedurePath}:${JSON.stringify(input ?? {})}`,
              fetcher: async () => {
                const url = new URL(`${baseUrl}/${procedurePath}`, globalThis.location?.origin ?? 'http://localhost');
                if (input !== undefined) {
                  url.searchParams.set('input', JSON.stringify(encode(input)));
                }
                const res = await fetchFn(url.toString(), {
                  headers: { ...defaultHeaders },
                });
                const data = await res.json();
                if (data.error) throw new RPCError(data.error);
                return decode(data.result);
              },
            };
          };
        }

        if (prop === 'query') {
          return async (input?: unknown) => {
            const procedurePath = path.join('.');
            const url = new URL(`${baseUrl}/${procedurePath}`, globalThis.location?.origin ?? 'http://localhost');
            if (input !== undefined) {
              url.searchParams.set('input', JSON.stringify(encode(input)));
            }
            const res = await fetchFn(url.toString(), {
              headers: { ...defaultHeaders },
            });
            const data = await res.json();
            if (data.error) throw new RPCError(data.error);
            return decode(data.result);
          };
        }

        if (prop === 'mutate') {
          return async (input?: unknown) => {
            const procedurePath = path.join('.');
            const url = `${baseUrl}/${procedurePath}`;
            const res = await fetchFn(url, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                ...defaultHeaders,
              },
              body: JSON.stringify(encode(input)),
            });
            const data = await res.json();
            if (data.error) throw new RPCError(data.error);
            return decode(data.result);
          };
        }

        return createProxy([...path, prop]);
      },

      apply(_target, _thisArg, args) {
        // Direct call — treat as query or mutation depending on convention
        const procedurePath = path.join('.');
        const input = args[0];
        const url = `${baseUrl}/${procedurePath}`;

        return fetchFn(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...defaultHeaders,
          },
          body: JSON.stringify(encode(input)),
        }).then(async (res) => {
          const data = await res.json();
          if (data.error) throw new RPCError(data.error);
          return decode(data.result);
        });
      },
    });
  }

  return createProxy() as RPCClientProxy<TRouter>;
}

/** RPC Error */
export class RPCError extends Error {
  code: string;
  issues?: Array<{ message: string; path?: (string | number)[] }>;

  constructor(error: { message: string; code: string; issues?: Array<{ message: string; path?: (string | number)[] }> }) {
    super(error.message);
    this.name = 'RPCError';
    this.code = error.code;
    this.issues = error.issues;
  }
}

// ─── Type-level magic for auto-complete ───

type RPCClientProxy<T> = {
  [K in keyof T]: T[K] extends { type: 'query'; handler: (opts: { input: infer I; ctx: unknown }) => Promise<infer O> }
    ? {
        query(input: I): Promise<O>;
        useSWR(input: I): { key: string; fetcher: () => Promise<O> };
      }
    : T[K] extends { type: 'mutation'; handler: (opts: { input: infer I; ctx: unknown }) => Promise<infer O> }
      ? {
          mutate(input: I): Promise<O>;
        }
      : T[K] extends Record<string, unknown>
        ? RPCClientProxy<T[K]>
        : never;
};

/** Generate client code as a string (for virtual module) */
export function generateClientCode(manifest: {
  procedures: Record<string, { type: string; path: string }>;
}, baseUrl = '/_rpc'): string {
  const lines: string[] = [
    `import { createRPCClient } from '@thenjs/rpc/client';`,
    `export const rpc = createRPCClient({ baseUrl: '${baseUrl}' });`,
  ];
  return lines.join('\n');
}
