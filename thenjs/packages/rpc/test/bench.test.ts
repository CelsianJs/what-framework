// @thenjs/rpc — Performance Micro-benchmarks
// Measures wire encoding/decoding, RPC handler throughput, and middleware overhead.

import { describe, it, expect } from 'vitest';
import { encode, decode } from '../src/wire.js';
import { procedure, createProcedure } from '../src/procedure.js';
import { router, RPCHandler } from '../src/router.js';
import type { MiddlewareFunction } from '../src/types.js';

function percentile(sorted: number[], p: number): number {
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)]!;
}

function makeRPCRequest(
  path: string,
  options?: {
    method?: string;
    body?: unknown;
    searchParams?: Record<string, string>;
  },
): Request {
  const method = options?.method ?? 'GET';
  const url = new URL(`http://localhost/_rpc/${path}`);
  if (options?.searchParams) {
    for (const [key, value] of Object.entries(options.searchParams)) {
      url.searchParams.set(key, value);
    }
  }
  const init: RequestInit = { method };
  if (options?.body !== undefined) {
    init.body = JSON.stringify(options.body);
    init.headers = { 'content-type': 'application/json' };
  }
  return new Request(url.toString(), init);
}

// ─── Wire Encoding / Decoding Performance ───

describe('Bench: Wire Protocol', () => {
  it('should measure encode/decode speed for simple objects', () => {
    const data = {
      id: '123',
      name: 'Alice',
      age: 30,
      active: true,
      tags: ['admin', 'user'],
    };

    const iterations = 50000;

    // Warm up
    for (let i = 0; i < 100; i++) {
      decode(encode(data));
    }

    const startEncode = performance.now();
    for (let i = 0; i < iterations; i++) {
      encode(data);
    }
    const encodeElapsed = performance.now() - startEncode;

    const encoded = encode(data);

    const startDecode = performance.now();
    for (let i = 0; i < iterations; i++) {
      decode(encoded);
    }
    const decodeElapsed = performance.now() - startDecode;

    console.log(`[Wire: simple object] ${iterations} iterations`);
    console.log(`  encode: ${encodeElapsed.toFixed(1)} ms (${Math.round(iterations / encodeElapsed * 1000)} ops/sec)`);
    console.log(`  decode: ${decodeElapsed.toFixed(1)} ms (${Math.round(iterations / decodeElapsed * 1000)} ops/sec)`);

    // Should handle at least 100k ops/sec for simple objects
    expect(iterations / encodeElapsed * 1000).toBeGreaterThan(100000);
    expect(iterations / decodeElapsed * 1000).toBeGreaterThan(100000);
  });

  it('should measure encode/decode speed for complex objects with special types', () => {
    const data = {
      date: new Date('2025-01-01'),
      bigNum: BigInt('123456789'),
      set: new Set([1, 2, 3]),
      map: new Map([['a', 1], ['b', 2]]),
      regex: /test/gi,
      nested: {
        inner: new Date('2025-06-15'),
      },
    };

    const iterations = 10000;

    // Warm up
    for (let i = 0; i < 100; i++) {
      decode(encode(data));
    }

    const startEncode = performance.now();
    for (let i = 0; i < iterations; i++) {
      encode(data);
    }
    const encodeElapsed = performance.now() - startEncode;

    const encoded = encode(data);

    const startDecode = performance.now();
    for (let i = 0; i < iterations; i++) {
      decode(encoded);
    }
    const decodeElapsed = performance.now() - startDecode;

    console.log(`[Wire: complex object with special types] ${iterations} iterations`);
    console.log(`  encode: ${encodeElapsed.toFixed(1)} ms (${Math.round(iterations / encodeElapsed * 1000)} ops/sec)`);
    console.log(`  decode: ${decodeElapsed.toFixed(1)} ms (${Math.round(iterations / decodeElapsed * 1000)} ops/sec)`);

    // Should handle at least 10k ops/sec for complex objects
    expect(iterations / encodeElapsed * 1000).toBeGreaterThan(10000);
    expect(iterations / decodeElapsed * 1000).toBeGreaterThan(10000);
  });

  it('should measure encode/decode speed for large arrays', () => {
    const data = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      name: `item-${i}`,
      value: Math.random(),
    }));

    const iterations = 1000;

    // Warm up
    for (let i = 0; i < 10; i++) {
      decode(encode(data));
    }

    const startEncode = performance.now();
    for (let i = 0; i < iterations; i++) {
      encode(data);
    }
    const encodeElapsed = performance.now() - startEncode;

    const encoded = encode(data);

    const startDecode = performance.now();
    for (let i = 0; i < iterations; i++) {
      decode(encoded);
    }
    const decodeElapsed = performance.now() - startDecode;

    console.log(`[Wire: array of 1000 objects] ${iterations} iterations`);
    console.log(`  encode: ${encodeElapsed.toFixed(1)} ms (${Math.round(iterations / encodeElapsed * 1000)} ops/sec)`);
    console.log(`  decode: ${decodeElapsed.toFixed(1)} ms (${Math.round(iterations / decodeElapsed * 1000)} ops/sec)`);

    expect(iterations / encodeElapsed * 1000).toBeGreaterThan(100);
  });
});

// ─── RPC Handler Throughput ───

describe('Bench: RPC Handler Throughput', () => {
  it('should measure query handling throughput (no middleware, no schema)', async () => {
    const routes = router({
      health: procedure.query(() => ({ status: 'ok' })),
    });

    const handler = new RPCHandler(routes);
    const iterations = 3000;

    // Warm up
    for (let i = 0; i < 50; i++) {
      await handler.handle(makeRPCRequest('health'));
    }

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      await handler.handle(makeRPCRequest('health'));
    }
    const elapsed = performance.now() - start;

    const reqPerSec = Math.round((iterations / elapsed) * 1000);

    console.log(`[RPC handler, no middleware, no schema]`);
    console.log(`  ${iterations} requests in ${elapsed.toFixed(1)} ms`);
    console.log(`  ~${reqPerSec} req/sec`);

    expect(reqPerSec).toBeGreaterThan(500);
  });

  it('should measure query handling throughput with middleware chain', async () => {
    const mw1: MiddlewareFunction = async ({ next }) => next();
    const mw2: MiddlewareFunction = async ({ next }) => next();
    const mw3: MiddlewareFunction = async ({ next }) => next();

    const routes = router({
      test: procedure
        .use(mw1)
        .use(mw2)
        .use(mw3)
        .query(() => ({ ok: true })),
    });

    const handler = new RPCHandler(routes);
    const iterations = 3000;

    // Warm up
    for (let i = 0; i < 50; i++) {
      await handler.handle(makeRPCRequest('test'));
    }

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      await handler.handle(makeRPCRequest('test'));
    }
    const elapsed = performance.now() - start;

    const reqPerSec = Math.round((iterations / elapsed) * 1000);

    console.log(`[RPC handler, 3 middlewares]`);
    console.log(`  ${iterations} requests in ${elapsed.toFixed(1)} ms`);
    console.log(`  ~${reqPerSec} req/sec`);

    expect(reqPerSec).toBeGreaterThan(300);
  });

  it('should measure mutation handling throughput with POST body', async () => {
    const routes = router({
      create: procedure.mutation(({ input }) => ({
        id: '1',
        data: input,
      })),
    });

    const handler = new RPCHandler(routes);
    const iterations = 2000;

    // Warm up
    for (let i = 0; i < 20; i++) {
      await handler.handle(
        makeRPCRequest('create', { method: 'POST', body: encode({ name: 'test' }) }),
      );
    }

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      await handler.handle(
        makeRPCRequest('create', { method: 'POST', body: encode({ name: `user-${i}` }) }),
      );
    }
    const elapsed = performance.now() - start;

    const reqPerSec = Math.round((iterations / elapsed) * 1000);

    console.log(`[RPC handler, mutation POST with body]`);
    console.log(`  ${iterations} requests in ${elapsed.toFixed(1)} ms`);
    console.log(`  ~${reqPerSec} req/sec`);

    expect(reqPerSec).toBeGreaterThan(300);
  });

  it('should measure procedure lookup performance across many routes', async () => {
    // Register 200 procedures across nested namespaces
    const routeDef: Record<string, any> = {};
    for (let ns = 0; ns < 20; ns++) {
      const namespace: Record<string, any> = {};
      for (let p = 0; p < 10; p++) {
        namespace[`proc${p}`] = procedure.query(() => ({ ns, p }));
      }
      routeDef[`ns${ns}`] = namespace;
    }

    const routes = router(routeDef);
    const handler = new RPCHandler(routes);

    const iterations = 5000;
    const timings: number[] = [];

    // Warm up
    for (let i = 0; i < 50; i++) {
      await handler.handle(makeRPCRequest(`ns${i % 20}.proc${i % 10}`));
    }

    for (let i = 0; i < iterations; i++) {
      const path = `ns${i % 20}.proc${i % 10}`;
      const start = performance.now();
      await handler.handle(makeRPCRequest(path));
      const end = performance.now();
      timings.push(end - start);
    }

    timings.sort((a, b) => a - b);
    const p50 = percentile(timings, 50);
    const p99 = percentile(timings, 99);
    const avg = timings.reduce((a, b) => a + b, 0) / timings.length;

    console.log(`[RPC handler, 200 procedures, lookup + handle]`);
    console.log(`  avg: ${(avg * 1000).toFixed(2)} us`);
    console.log(`  p50: ${(p50 * 1000).toFixed(2)} us`);
    console.log(`  p99: ${(p99 * 1000).toFixed(2)} us`);
    console.log(`  ~${Math.round(1000 / avg)} req/sec`);

    // Each request should take < 2ms on average
    expect(avg).toBeLessThan(2);
  });
});

// ─── OpenAPI Generation Performance ───

describe('Bench: OpenAPI Generation', () => {
  it('should measure OpenAPI spec generation time for 100 procedures', () => {
    const routeDef: Record<string, any> = {};
    for (let i = 0; i < 100; i++) {
      routeDef[`procedure${i}`] = procedure
        .input({
          safeParse: (v: unknown) => ({ success: true, data: v }),
          parse: (v: unknown) => v,
          validate: (v: unknown) => ({ success: true, data: v }),
          toJsonSchema: () => ({
            type: 'object',
            properties: { name: { type: 'string' }, id: { type: 'number' } },
          }),
          _input: undefined,
          _output: undefined,
        })
        .query(({ input }) => input);
    }

    const routes = router(routeDef);
    const handler = new RPCHandler(routes);

    const iterations = 100;

    // Warm up
    for (let i = 0; i < 5; i++) {
      handler.generateOpenAPI();
    }

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      handler.generateOpenAPI();
    }
    const elapsed = performance.now() - start;

    console.log(`[OpenAPI generation, 100 procedures] ${iterations} iterations`);
    console.log(`  total: ${elapsed.toFixed(1)} ms`);
    console.log(`  per call: ${(elapsed / iterations).toFixed(2)} ms`);

    // Should be < 10ms per generation
    expect(elapsed / iterations).toBeLessThan(10);
  });
});
